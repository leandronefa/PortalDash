# Pre-agregar ventas/tránsito por día para acelerar cambios de fecha en el tablero

**Fecha:** 2026-09-02
**Estado:** Aprobado por Claudia, pendiente de implementar.

## Contexto

El 2026-09-01 se armaron 3 mejoras de rendimiento del tablero (`docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md`): virtualizar "Ver en detalle" (✅ funcionando), precalentar la caché del combo de fechas por defecto (✅ funcionando), y agregar índices SQL en `Vta_detalle`/`dis_transf_emitidas`/`CGD_CONDCOM_VTA_DET` — estos últimos se **probaron en producción y se revirtieron** el mismo día: cada índice mejoraba la operación puntual que atacaba, pero el tiempo total de `QUERY_QUIEBRE_DETALLE` no bajaba de punta a punta (en un caso, empeoró), señal de que el cuello de botella real no es de indexación sino de **cuánto dato en crudo se escanea en vivo por cada request**.

Perfilado con `SET STATISTICS TIME` contra la base real (ver commits de esa fecha), el tiempo de `QUERY_QUIEBRE_DETALLE` para un rango de fechas NUEVO (cache-miss real en `cacheQuiebre`) se reparte, aproximadamente, entre:

- `#VentasRango` (agrega `Vta_detalle` por Sucursal+CodArticulo+COLOR+TALLE, filtrado por `[@fechaDesde,@fechaHasta]`) — con el índice cubriente puesto, bajó a ~2ms. Sin él, es la pieza más cara sobre la tabla más grande (8.743.786 filas).
- `#PromoRango` (mismo filtro de fecha sobre `Vta_detalle`, cruzado con `CGD_CONDCOM_VTA_DET` para detectar promoción) — ~8.6s medidos, la pieza más cara identificada.
- `#TransitoRango` (agrega `dis_transf_emitidas`, filtrado por `fecha >= @fechaDesdeTransito`) — ~2.7-3.5s medidos.
- El resto (armado final, joins con catálogo, `#DiasConStockRango` ya precalculado) — varios segundos más.

**Hallazgo clave sobre `#TransitoRango`:** a diferencia de `#VentasRango`/`#PromoRango` (que dependen del "Período de ventas" que elige el usuario, `@fechaDesde`/`@fechaHasta`), `#TransitoRango` usa `@fechaDesdeTransito`, que **siempre** es "hoy menos `TRANSITO_VIGENCIA_DIAS` (30) días" — no cambia con lo que el usuario elija. Es decir, su costo no depende en absoluto del Período de ventas elegido; es una ventana fija recalculable una sola vez por noche, no algo que necesite agregado incremental por día.

Sesión previa: se investigó también por qué la carga inicial de la página (antes del login) se sentía "trabada" — resultó ser un tema aparte (475.882 filas de detalle bajando y procesándose en el navegador), ya mitigado ese mismo día con procesamiento en tandas (`mapearFilasEnTandas`, `tablero_motor_quiebre.html`). Ese cambio y el de este documento son independientes: éste no toca el frontend en absoluto.

## Objetivo

Que cambiar el "Período de ventas" a un rango de fechas que hoy es un cache-miss real corra sensiblemente más rápido (de 25-48s medidos a algo del orden de 1-3s), **sin cambiar ningún número que el tablero muestra** — mismo resultado exacto, solo más rápido de calcular. Sin romper nada de lo que ya funciona (virtualización de "Ver en detalle", precalentado de caché, `obtenerDataPesadaQuiebre`).

## Diseño aprobado

### 1. Tabla nueva: `dbo.MotorReposicion_VentasPorDia`

Una fila por **día × Sucursal × CodArticulo × COLOR × TALLE** que tuvo alguna venta ese día — reemplaza tanto a `#VentasRango` como a `#PromoRango` (ambas agrupan por las mismas 4 columnas sobre la misma tabla origen; se combinan en un solo pase en vez de escanear `Vta_detalle` dos veces).

```sql
CREATE TABLE dbo.MotorReposicion_VentasPorDia (
  Fecha              DATE            NOT NULL,
  Sucursal           VARCHAR(20)     NOT NULL,
  CodArticulo        VARCHAR(50)     NOT NULL,
  COLOR              VARCHAR(50)     NOT NULL,
  TALLE              VARCHAR(20)     NOT NULL,
  CantidadVendida    DECIMAL(18,4)   NOT NULL,
  CantidadVentasPromo INT            NOT NULL,
  NombrePromoDia     VARCHAR(100)    NULL,
  DescuentoPromoDia  FLOAT           NULL,
  CONSTRAINT PK_MotorReposicion_VentasPorDia PRIMARY KEY CLUSTERED (Fecha, Sucursal, CodArticulo, COLOR, TALLE)
);
```

(Tipos calcados de `MotorReposicion_UniversoCompleto`/`CGD_CONDCOM_VTA_DET` reales, vía `INFORMATION_SCHEMA.COLUMNS`, no adivinados.)

**Por qué el agregado en dos pasos da el mismo número exacto (no una aproximación):**
- `SUM(CantidadVendida)` por rango = `SUM` de los `SUM` diarios → igual a sumar el crudo directo.
- `CantidadVentasPromo` por rango = `SUM` de los conteos diarios → igual a `COUNT(*)` directo sobre el crudo.
- `MAX(NombrePromoDia)`/`MAX(DescuentoPromoDia)` por rango = `MAX` de los `MAX` diarios → matemáticamente el mismo valor que un `MAX` directo sobre todo el rango (MAX es asociativo).
- `COUNT(DISTINCT FECHA)` (días con venta) = `COUNT(*)` de filas de `VentasPorDia` en el rango, porque la clave primaria garantiza como mucho una fila por Fecha+combo.
- `MAX(FECHA)` (última venta) = `MAX(Fecha)` sobre las filas de `VentasPorDia` en el rango.

Esto se **verifica con datos reales** antes de dar el cambio por bueno (ver Task de verificación en el plan) — no alcanza con el razonamiento de arriba solo.

### 2. Tabla nueva: `dbo.MotorReposicion_TransitoHoy`

Snapshot simple, recalculado completo cada noche — mismo patrón que `MotorReposicion_UniversoHoy`/`_DepositoHoy` (Etapa 4 existente), NO un agregado por día (no hace falta, ver el hallazgo de `#TransitoRango` arriba).

```sql
CREATE TABLE dbo.MotorReposicion_TransitoHoy (
  Sucursal          VARCHAR(20)     NOT NULL,
  CodArticulo       VARCHAR(50)     NOT NULL,
  COLOR             VARCHAR(50)     NOT NULL,
  TALLE             VARCHAR(20)     NOT NULL,
  TransitoPendiente DECIMAL(18,4)   NOT NULL,
  CONSTRAINT PK_MotorReposicion_TransitoHoy PRIMARY KEY CLUSTERED (Sucursal, CodArticulo, COLOR, TALLE)
);
```

### 3. Etapa 8 nueva en `MotorReposicion_sp_PreCalcularStockSemanal`

El SP ya declara `@fechaDesde = DATEADD(MONTH, -18, CAST(@ahora AS DATE))` al principio (línea ~15, la misma ventana de retención de 18 meses que ya usa Etapa 1 para `StockSemanal` — documentada ahí con su propia historia de por qué 18 y no 12 o 24). **La Etapa 8 reusa esta MISMA variable** para el borrado de `VentasPorDia` — si el sistema cambia esa ventana de retención en el futuro, ambas etapas se actualizan solas, a pedido explícito de Claudia (no se introduce una constante nueva separada).

Pasos de la Etapa 8, todas las noches:
1. **Incremental (rápido):** borrar de `VentasPorDia` las filas de "ayer" (por si el job corrió dos veces) e insertar de nuevo "ayer", agregando `Vta_detalle` + el cruce de promoción (mismos filtros exactos que hoy usa `#PromoRango`: `c.PVP_REBAJADO < c.PRECIOLLENO`, excluir `NOMBRE_COND LIKE '%MES DE TU CUMPLEA%'`) para ESE único día.
2. **`TransitoHoy` (rápido, tabla chica):** `TRUNCATE` + `INSERT` completo, mismo filtro de `Sucursales` (`viewSuc='S'` o la lista de sucursales especiales, excluyendo `000226`/`000235`) y `cantpend > 0` que usa hoy `#TransitoRango`, sin filtro de fecha en el `WHERE` final (la vigencia de 30 días se resuelve con `fecha >= DATEADD(DAY, -30, @ahora)` igual que hoy, pero recalculada fresca cada noche en vez de en cada request).
3. **Recálculo semanal (seguridad ante correcciones retroactivas):** los **domingos** (`DATEPART(WEEKDAY, @ahora) = 1`, día de menor actividad comercial — confirmado con Claudia), además del paso 1, borrar e insertar de nuevo los **últimos 3 meses completos** de `VentasPorDia` (no los 18 meses enteros — ventas de hace más de 3 meses no deberían corregirse retroactivamente en la práctica, y recalcular los 18 meses cada semana sería caro sin necesidad).
4. **Retención:** `DELETE FROM MotorReposicion_VentasPorDia WHERE Fecha < @fechaDesde` (la misma variable del punto de arriba).

### 4. `server.js` — `QUERY_QUIEBRE_DETALLE`

Se reemplazan las 3 sub-consultas, manteniendo **exactamente las mismas columnas de salida** (mismos alias: `Sucursal, CodArticulo, COLOR, TALLE, VentasRango/DiasConVenta/UltimaVenta` para `#VentasRango`; `Sucursal, CodArticulo, COLOR, TALLE, CantidadVentasPromo/NombrePromo/DescuentoPromo` para `#PromoRango`; `Sucursal, CodArticulo, COLOR, TALLE, TransitoPendiente` para `#TransitoRango`) — así el resto de la consulta (los joins de más abajo) y todo el pipeline de Node (`construirDetalleDesdeFilas`, etc.) no necesitan tocarse en absoluto:

```sql
SELECT Sucursal, CodArticulo, COLOR, TALLE,
       SUM(CantidadVendida) AS VentasRango,
       COUNT(*) AS DiasConVenta,
       MAX(Fecha) AS UltimaVenta
INTO #VentasRango
FROM dbo.MotorReposicion_VentasPorDia
WHERE Fecha >= @fechaDesde AND Fecha <= @fechaHasta
GROUP BY Sucursal, CodArticulo, COLOR, TALLE;

SELECT Sucursal, CodArticulo, COLOR, TALLE,
       SUM(CantidadVentasPromo) AS CantidadVentasPromo,
       MAX(NombrePromoDia) AS NombrePromo,
       MAX(DescuentoPromoDia) AS DescuentoPromo
INTO #PromoRango
FROM dbo.MotorReposicion_VentasPorDia
WHERE Fecha >= @fechaDesde AND Fecha <= @fechaHasta AND CantidadVentasPromo > 0
GROUP BY Sucursal, CodArticulo, COLOR, TALLE;

SELECT Sucursal, CodArticulo, COLOR, TALLE, TransitoPendiente
INTO #TransitoRango
FROM dbo.MotorReposicion_TransitoHoy;
```

El parámetro `@fechaDesdeTransito` deja de usarse en esta consulta (ya no hace falta — `TransitoHoy` no toma fecha). **No se lo saca de `obtenerDataPesadaQuiebre`/la llamada desde Node todavía** en este cambio si eso complica el diff — más simple: se puede dejar de pasar el parámetro `fechaDesdeTransito` a `.input(...)` para esta consulta específica sin tocar la firma de `obtenerDataPesadaQuiebre` (que no lo expone hacia afuera, es interno). El detalle exacto de qué tocar en `server.js` línea por línea queda para el plan de implementación.

### 5. Script manual de recálculo puntual (`scripts/precalc/recalcular_ventas_por_dia.js`)

El recálculo semanal automático (punto 3, Etapa 8) solo cubre los últimos 3 meses — una corrección a una venta de **más de 3 meses de antigüedad** (poco común, pero posible) no se reflejaría sola en `VentasPorDia` nunca, no solo "hasta 1 día" (a diferencia de UniversoHoy/DiasConStockPorSemana, que se recalculan enteros cada noche y no tienen este punto ciego). Para ese caso raro, un script de un solo uso — mismo patrón que `scripts/precalc/desplegar_sp.js`/`correr_sp_y_medir.js` — que recibe un rango de fechas por parámetro y borra+reinserta `VentasPorDia` para ESE rango puntual, para correrlo a mano si alguien avisa de una corrección vieja. No es parte de la corrida nocturna — es una herramienta de mantenimiento, igual que los demás scripts de `scripts/precalc/`.

## No-objetivos (fuera de alcance de este cambio)

- **`QUERY_ARTICULO_COMPLETO`** (endpoint `/api/tablero/articulo`, usado al abrir el detalle de UN artículo) y **`QUERY_COMPRAS_VENTAS_POR_MES`** (endpoint `/api/tablero/compras-ventas`) tienen sub-consultas con forma similar sobre `Vta_detalle`, pero ya son rápidas hoy porque están filtradas por `@modelo`/color desde el primer paso (no escanean toda la red). No se tocan.
- **Consecuencia aceptada de no tocarlas — dos escenarios distintos:**
  1. **Venta de HOY, o corrección reciente (últimos 3 meses):** la lista principal (`QUERY_QUIEBRE_DETALLE`, vía `VentasPorDia`) puede quedar hasta 1 día desactualizada respecto de `Vta_detalle`, mientras que el detalle de un artículo puntual (`QUERY_ARTICULO_COMPLETO`, sigue en vivo) refleja el dato al segundo. Mismo comportamiento que ya tienen `UniversoHoy`/`DiasConStockPorSemana` hoy — no es un desfase nuevo, es consistente con el resto del sistema. Se corrige solo, en la corrida nocturna o, a más tardar, el domingo siguiente.
  2. **Corrección a una venta de MÁS de 3 meses de antigüedad (rara):** no se corrige sola nunca — el recálculo semanal automático solo cubre 3 meses. Para este caso está el script manual del punto 5 (`recalcular_ventas_por_dia.js`), a correr a pedido si alguien avisa de una corrección vieja.
- No se toca el frontend (`tablero_motor_quiebre.html`) en absoluto — ni la virtualización de "Ver en detalle" ni el procesamiento en tandas de la carga inicial.
- No se toca `precalentarComboDefaultSiHaceFalta` ni `obtenerDataPesadaQuiebre` como funciones (su firma/comportamiento externo no cambia) — solo cambia, puertas adentro de `QUERY_QUIEBRE_DETALLE`, de dónde sale el dato de `#VentasRango`/`#PromoRango`/`#TransitoRango`.
- No se reintroduce el índice de `CGD_CONDCOM_VTA_DET` revertido el 2026-09-01 — con `#PromoRango` leyendo de `VentasPorDia` (una tabla propia, chica, sin el join contra `CGD_CONDCOM_VTA_DET` en el camino en vivo), ese índice deja de tener sentido: la promoción ya viene resuelta desde la noche anterior.

## Riesgos / puntos de atención para la implementación

- **Verificar con datos reales, no solo razonamiento:** antes de dar el cambio por terminado, comparar el resultado de `QUERY_QUIEBRE_DETALLE` (números de `VentasRango`, `CantidadVentasPromo`, `TransitoPendiente` por combo) calculado con las tablas nuevas contra el resultado calculado en vivo (la consulta actual, sin tocar), para varias combinaciones de fechas reales — deben coincidir EXACTO, no aproximado.
- **Primera carga de `VentasPorDia`:** la tabla arranca vacía. Hace falta una carga inicial de los 18 meses completos (una sola vez, fuera de la corrida nocturna normal) antes de que la Etapa 8 empiece a mantenerla incremental — probablemente un script aparte en `scripts/precalc/`, no parte de la Etapa 8 en sí (que solo espera mantener, no poblar desde cero). Medir cuánto tarda esa carga inicial única antes de correrla contra producción.
- **Backup antes de tocar el SP** (`backups/<fecha>-<descripcion>/`), regla ya establecida del proyecto — guardar `OBJECT_DEFINITION` actual antes de la carga inicial y del `ALTER PROCEDURE`.
- **`CREATE TABLE` es aditivo** (tablas nuevas, no se modifica ninguna existente) pero sigue siendo un cambio de esquema en producción — confirmar con Claudia antes de crearlas, mismo criterio que se usó con los índices el 2026-09-01.
- **Medir el costo de la Etapa 8 en la corrida nocturna** (cuánto le suma al tiempo total del job) — sobre todo los domingos (recálculo semanal de 3 meses), que va a ser la corrida más pesada de las 8 etapas.
