# Spec — Historización de Montos por período (foto congelada al calcular)

**Fecha**: 2026-07-27
**Módulo**: ComisionesINDO — motor de cálculo, todos los entry points que cargan montos
**Alcance**: las 5 tablas de `Montos*` + `RankingMultiplicador`. No toca el ABM de edición ni las reglas de negocio de ningún motor de cálculo.

## 1. Contexto

Hoy ninguna tabla de montos (`tbl_CoVenAppINDO_Montos`, `MontosVendedor`, `MontosSupervisor`, `MontosPrestamos`, `MontosCajero`, `RankingMultiplicador`) tiene noción de período: el ABM (`server/routes/montos.js`, página `visor-montos.js`) edita el valor "actual" sobreescribiéndolo, y el motor de cálculo (`calcEngine.js`) siempre lee ese valor actual (`SELECT * FROM tbl_CoVenAppINDO_Montos`, sin filtro de período) en cada uno de los 4 puntos donde se cargan montos para calcular.

Ejemplo del problema: si el monto de Cajero en marzo era $10.000 y se calculó ese período con ese valor, y en mayo se edita a $15.000, reprocesar marzo hoy tomaría $15.000 — perdiendo el dato de qué valor se usó realmente en marzo.

## 2. Regla de negocio (confirmada con el usuario 2026-07-27)

- **Foto congelada al primer cálculo**: la primera vez que se calcula CUALQUIER cosa de un período (Total, Cajeros standalone, Operadores standalone, Operadores Millón standalone — cualquiera de los 4 entry points), se toma una foto de los 6 valores de montos vigentes en ESE momento y se persiste asociada a ese período.
- **Reprocesar = misma foto**: cualquier recálculo posterior de ese mismo período (desde cualquiera de los 4 botones) usa SIEMPRE esa foto ya persistida — nunca los valores "actuales" del ABM, sin importar cuánto tiempo pasó ni cuántas veces se editó el ABM después.
- **Alcance de tablas**: las 5 tablas `Montos*` + `RankingMultiplicador` (A/B/C) — todo lo que el motor lee como insumo de montos para calcular.
- **El ABM no cambia**: `montos.js`/`visor-montos.js` siguen leyendo y editando el valor "actual" (vivo) como hoy — la foto es un insumo del motor de cálculo, no reemplaza la tabla editable.
- **Períodos ya calculados sin foto** (todo lo calculado antes de este cambio): al desplegar, se les crea una foto con los montos **actuales de hoy** (mejor dato disponible; no es retroactivamente exacto pero evita que a futuro tomen valores que ni existían cuando se calcularon originalmente).
- **Sin cambios de UI**: no hay ningún aviso ni indicador visual nuevo — la lógica es transparente para el usuario.

## 3. Esquema — tabla de snapshot

Un JSON por período (mismo patrón que `tbl_CoVenAppINDO_CalculoHistorial.resultado_json`), no 6 tablas paralelas con columna `periodo`:

```sql
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_MontosHistorial') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_MontosHistorial (
    periodo         VARCHAR(7) PRIMARY KEY,
    montos_json     NVARCHAR(MAX),
    fecha_snapshot  DATETIME DEFAULT GETDATE()
);
```

`montos_json` es un objeto con las mismas 6 claves que ya usa `ctx` en el motor (nombres exactos, incluido el typo histórico `montosPrestamaos`):

```json
{
  "montos": [...],
  "montosVendedor": [...],
  "montosSupervisor": [...],
  "montosPrestamaos": [...],
  "montosCajero": [...],
  "multiplicadores": [...]
}
```

## 4. Mecanismo — carga con foto congelada

Nueva función `cargarMontosDelPeriodo(pool, periodo)` en `server/services/montosHistorial.js`:

1. `SELECT montos_json FROM tbl_CoVenAppINDO_MontosHistorial WHERE periodo=@periodo`.
2. Si existe fila → `JSON.parse(montos_json)` y se devuelve tal cual (foto congelada).
3. Si NO existe → se leen las 6 tablas actuales (mismas queries que hoy usa `cargarContexto` en `calculo.js`: `SELECT * FROM tbl_CoVenAppINDO_Montos`, `MontosVendedor`, `MontosSupervisor`, `MontosPrestamos`, `MontosCajero`, `RankingMultiplicador`), se arma el objeto con esas 6 claves, se persiste como fila nueva (`INSERT`), y se devuelve.

### Puntos de integración (los 4 entry points que hoy cargan montos directo de las tablas)

| Archivo | Función/endpoint | Qué reemplaza |
|---|---|---|
| `server/routes/calculo.js` | `cargarContexto(pool, periodo)` | Las 5 queries de `montosR`/`montosVendR`/`montoSupR`/`montosPresR`/`montosCajR` + `multR` (RankingMultiplicador) → una sola llamada a `cargarMontosDelPeriodo` |
| `server/routes/calculo.js` | `POST /cajeros` | La query de `montosCajR` + `multR` → `cargarMontosDelPeriodo`, usa `.montosCajero` y `.multiplicadores` |
| `server/routes/operadores.js` | `calcularYGuardarOperadores(pool, periodo)` | Las queries de `montosR` (Montos) + `montosPresR` (MontosPrestamos) + `multR` → `cargarMontosDelPeriodo`, usa `.montos`, `.montosPrestamaos`, `.multiplicadores` |
| `server/routes/millon.js` | `calcularYGuardarOperadoresMillon(pool, periodo)` | Las queries de `montosPresR` + `multR` → `cargarMontosDelPeriodo`, usa `.montosPrestamaos`, `.multiplicadores` |

Estos 4 puntos son los únicos que hoy leen montos ligados a un cálculo por período — confirmado por grep sobre `server/routes/calculo.js`, `operadores.js`, `millon.js` (no hay otro lugar que arme `ctx.montos*`/`ctx.multiplicadores` a partir de las tablas vivas).

**No se toca**: `server/routes/montos.js` (ABM, sigue editando/leyendo el valor vivo), `server/routes/ranking.js` (RankingMultiplicador en `GET /multiplicadores` y el cascade de `montos.js` al editar categoría C — eso es edición del valor vivo, no cálculo de un período).

## 5. Backfill de períodos ya calculados

Rutina self-healing en `server/index.js` (corre una vez al arrancar el proceso, idempotente):

1. `SELECT DISTINCT periodo FROM` cada una de: `tbl_CoVenAppINDO_CalculoHistorial`, `tbl_CoVenAppINDO_ResultadoCajeros`, `tbl_CoVenAppINDO_ResultadoOperadores`, `tbl_CoVenAppINDO_ResultadoOpMillon` — unión de todos los períodos que ya tienen algo calculado.
2. Para cada período de esa lista que NO tenga fila en `tbl_CoVenAppINDO_MontosHistorial`: crear la foto con los montos **actuales de hoy** (mismo camino que el paso 3 de `cargarMontosDelPeriodo` — reutilizar esa lógica, no duplicarla).
3. Si no hay períodos faltantes, no hace nada (costo de un arranque: unas pocas queries `SELECT DISTINCT`, despreciable).

## 6. Fuera de alcance

- No se modifica la lógica de ningún motor de cálculo (`calcEngine.js`) — solo cambia de dónde vienen los datos de montos que se le pasan en `ctx`.
- No se agrega ninguna UI nueva (ABM, avisos, indicadores).
- No se permite "forzar" un re-snapshot de un período ya congelado desde la UI — si hiciera falta corregir una foto ya tomada, es una operación manual sobre `tbl_CoVenAppINDO_MontosHistorial` (fuera de este alcance).
- No afecta objetivos (`ObjConsumo`/`ObjEfectivo`), ranking de categorías, ni datos de ventas/BeClever — esos ya tienen su propia noción de período (tablas con columna `periodo`) y no forman parte de este cambio.

## 7. Verificación

- Test manual: calcular un período nuevo (ej. `2026-08`, sin datos previos) desde Total, confirmar que aparece una fila en `MontosHistorial` con `fecha_snapshot` de hoy. Editar un monto en el ABM. Recalcular `2026-08` de nuevo y confirmar que el resultado usa el valor ANTERIOR a la edición (el congelado), no el nuevo.
- Test manual de backfill: antes de desplegar, contar períodos distintos en `CalculoHistorial`/`ResultadoCajeros`/`ResultadoOperadores`/`ResultadoOpMillon`; después de desplegar y reiniciar el servicio, confirmar que `MontosHistorial` tiene una fila por cada uno de esos períodos.
- No hay test automatizado nuevo esperado más allá de lo que ya cubre `calcEngine.supervisores.test.js` (no aplica, es lógica de negocio del motor, no de esta capa de historización) — se puede sumar un test simple de `cargarMontosDelPeriodo` si el plan lo justifica (función con efecto de DB, similar convención a otros servicios del proyecto que no llevan test unitario propio).
