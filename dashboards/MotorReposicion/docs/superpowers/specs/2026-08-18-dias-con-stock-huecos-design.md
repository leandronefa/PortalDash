# Corrección de fondo: semanas sin stock deben generar su fila real en `MotorReposicion_StockSemanal`

**Fecha:** 2026-08-18
**Estado:** Aprobado por Claudia, pendiente de implementar.

## Contexto

El Motor de Reposición calcula la velocidad de venta de cada SKU (talle/color/sucursal) como
`unidades vendidas del período ÷ días con stock reales en ese período` (con un piso de 7 días, ver
`docs`/comentarios en `server.js`). Los "días con stock" vienen de una cadena de precálculo nocturno:

1. **Etapa 1** (`MotorReposicion_StockSemanal`): agrupa las fotos de stock de `FotoStock` por semana
   (semana que termina un sábado) y guarda el máximo stock visto esa semana, por combinación
   sucursal+artículo+color+talle. Ventana rodante de 12 meses.
2. **Etapa 3** (`MotorReposicion_DiasConStockPorSemana`): recorre la Etapa 1 semana por semana y
   decide cuántos días de cada semana cuentan como "con stock" vs. "quiebre" — con lógica de
   puente entre semanas positivas consecutivas, y un rescate que usa `Vta_detalle` para recuperar
   días con venta real aunque la foto de esa semana muestre stock ≤ 0.

## El problema encontrado

`FotoStock` (igual que `FOTOSTOCK_Diaria`) **nunca guarda una fila con stock=0** — un artículo sin
stock simplemente no tiene fila esa foto, en vez de tener una fila con el valor 0. Como la Etapa 1
se construye agrupando lo que hay en `FotoStock`, una semana genuinamente sin stock (0 fotos con
stock, porque no hubo ninguna) **no genera ninguna fila** en `MotorReposicion_StockSemanal` — no
hay ninguna diferencia entre "esta combinación nunca existió en esta sucursal" y "esta combinación
se quedó sin stock esta semana".

Consecuencia verificada con datos reales:
- `MotorReposicion_StockSemanal` tiene 8.001.970 filas; **0 tienen `StockSemana = 0`** (solo 7.321
  tienen valores negativos, por ajustes/errores del ERP — no representan quiebres reales).
- La Etapa 3 depende de que exista una fila con `StockSemana <= 0` para activar tanto el conteo de
  "días quebrado" como el rescate por ventas reales. Como esa fila casi nunca existe, **ese
  mecanismo no se dispara en la práctica**.
- De 56.135 artículos que hoy están en estado QUIEBRE real (stock = 0 ahora mismo), solo 228 (0,4%)
  muestran algún "día quebrado" en el período elegido — el resto queda en 0, aunque el artículo
  realmente haya estado semanas sin stock. Este dato se muestra al comprador como
  "🕘 X episodios · Y días quebrado (período)" en la cuadrícula de cobertura.

Este hallazgo salió de una pregunta más chica de Claudia sobre la precisión del cálculo de días con
stock en la transición entre una semana con stock y la siguiente sin stock — al investigarla se
encontró que el problema de fondo es más grave: esas semanas de quiebre ni siquiera están
representadas en el precálculo.

## Objetivo

Que una semana genuinamente sin stock (para una combinación que sí existió antes, en esa sucursal)
**genere su fila real con `StockSemana = 0`** en `MotorReposicion_StockSemanal`, para que la Etapa 3
—sin ningún cambio en su propia lógica— empiece a detectar y rescatar quiebres reales como estaba
pensada desde el principio.

## No-objetivos (fuera de alcance de este cambio)

- No se toca la lógica de la Etapa 3 (`DiasConStockPorSemana`) — ya está bien diseñada, solo le
  faltaban las filas en cero para funcionar.
- No se generan filas para combinaciones que **nunca** existieron en una sucursal (evitar
  fabricar "quiebre" para algo que la sucursal jamás manejó).
- No se toca la fórmula de velocidad en sí (`server.js`, `VdRaw`) — este cambio vive enteramente
  dentro del stored procedure de precálculo.
- No se rehace la validación línea-por-línea contra el tablero anterior (SQLite) — esa validación
  fue sobre el cálculo de Quiebre general, no sobre este detalle interno; la validación de este
  cambio es la descripta más abajo.

## Diseño de la solución

Dentro de la Etapa 1 del SP (`MotorReposicion_sp_PreCalcularStockSemanal`), después de armar
`#StockSemanalNuevo` (las filas reales agrupadas desde `FotoStock`, sin cambios), agregar un paso de
**relleno de huecos**:

1. Por cada combinación (Sucursal, CodArticulo, COLOR, TALLE) presente en `#StockSemanalNuevo`,
   calcular `Primera` = MIN(FechaSemana) y `Ultima` = MAX(FechaSemana) — el rango donde sabemos que
   la combinación existió en esa sucursal.
2. Generar las semanas "esperadas" entre `Primera` y `Ultima` (cada 7 días) usando una tabla de
   números chica (0-63, 64 valores vía cross join de dos subconsultas de 8 filas — suficiente para
   los ~53 semanas máximo de la ventana de 12 meses) armada con la técnica estándar compatible con
   SQL Server 2008 R2 (`ROW_NUMBER() OVER (ORDER BY (SELECT NULL))`) — no requiere ninguna función
   nueva del motor. Si algún combo llegara a superar 63 semanas de span, el SP corta con `RAISERROR`
   + `RETURN` en vez de rellenar en silencio de forma incompleta (ver comentario en el .sql).
3. Cruzar esa lista de semanas esperadas contra las filas reales de `#StockSemanalNuevo` (LEFT
   JOIN); donde no haya fila real, es un hueco genuino → insertar una fila con `StockSemana = 0`.
4. Unir (UNION) las filas reales + las filas de hueco rellenadas antes del `TRUNCATE` + `INSERT`
   final hacia `dbo.MotorReposicion_StockSemanal` (que ya se hace hoy, sin cambios en esa parte).

El resto del SP (Etapas 2, 3, 4) queda igual EN EL CÓDIGO. La Etapa 3 empieza a recibir filas con
`StockSemana = 0` reales, y su lógica existente (puente entre semanas positivas, rescate por
ventas, conteo de quiebre) se activa correctamente sin que haya que tocarla.

**Corrección (revisión final, 2026-08-18): "queda igual" es cierto para el código de la Etapa 2,
pero NO para su comportamiento.** La Etapa 2 (`MotorReposicion_VelocidadAmplia`) lee de
`MotorReposicion_StockSemanal`, así que las filas nuevas del relleno de huecos también entran ahí.
La Etapa 2 tiene su propio rescate (`NOT EXISTS` contra `dis_transf_recibidas`) pensado para
semanas con recepción real de transferencia que, antes de este fix, no tenían ninguna fila en
`#StockAmplioNuevo` — ahora esas semanas SÍ tienen fila (`StockSemana=0`, puesta por el relleno de
la Etapa 1), así que ese `NOT EXISTS` da falso y el rescate ya no se dispara: una semana con
recepción real ahora cuenta como quiebre en la Etapa 2 en vez de "con stock". Esto es un cambio de
comportamiento real heredado silenciosamente de la Etapa 1, aunque el código de la Etapa 2 en sí
no se tocó. Hoy es inofensivo porque `server.js` ya no lee `MotorReposicion_VelocidadAmplia` (se
sacó el respaldo por venta esporádica el mismo día, ver
`backups/2026-08-18_quitar-velocidad-esporadica/`), pero si esa lógica se re-habilitara en el
futuro, heredaría este efecto sin que sea evidente mirando solo el código de la Etapa 2. Ver el
comentario correspondiente en `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` (junto al
bloque de relleno de huecos de la Etapa 1 y junto al inicio de la Etapa 2) y
`.superpowers/sdd/2026-08-18-dias-con-stock-huecos/task-final-fixes-report.md` (Hallazgo 1).

## Aclaraciones de diseño (para que no queden ambiguas)

- **Por qué `Primera`/`Ultima` se calculan sobre `MIN`/`MAX(FechaSemana)` de la propia
  `#StockSemanalNuevo`, y no sobre `PrimeraAceptacion` de `dis_transf_recibidas`** (que la Etapa 3 ya
  usa para su propio filtro): no hace falta que coincidan. La Etapa 3 ya filtra por
  `PrimeraAceptacion` de forma independiente — si el relleno de huecos de la Etapa 1 empieza un poco
  antes o después de la aceptación real, la Etapa 3 lo corrige igual con su propio chequeo existente.
  Alcanza con que la Etapa 1 rellene huecos dentro del rango donde HAY evidencia real de que la
  combinación existió (entre su primera y su última semana vista).
- **El relleno NO se extiende más allá de `Ultima`**: si una combinación dejó de aparecer del todo
  (por ejemplo, se descontinuó) hace 3 meses, no se sigue generando una fila en cero cada semana
  hacia adelante para ella — eso sería inventar un quiebre perpetuo para algo que puede simplemente
  haber salido del catálogo. El relleno solo cubre huecos ENTRE dos puntos con evidencia real.

## Dimensionado (verificado contra datos reales, no estimado)

| Métrica | Valor real |
|---|---|
| Combinaciones distintas en los últimos 12 meses | 404.532 |
| Combinaciones con al menos un hueco real | 50.880 (12,6%) |
| Total de semanas a rellenar | 526.541 |
| Filas actuales en `MotorReposicion_StockSemanal` | 8.001.970 |
| Crecimiento esperado | ~6,5% más filas |

El crecimiento es manejable — comparable a otras etapas del mismo job que ya procesan millones de
filas.

## Rollout

La Etapa 1 ya hace `TRUNCATE TABLE` + reconstrucción completa de los 12 meses en cada corrida
nocturna. No hace falta decidir "recalcular todo el historial vs. solo de acá en adelante" — la
primera corrida después de este cambio reconstruye automáticamente los 12 meses completos con la
lógica nueva, igual que cualquier otro cambio a esta etapa.

## Validación

Antes de dar por buena la corrección:
1. **Backup** del `OBJECT_DEFINITION` actual del SP (como con cualquier cambio de precálculo), en
   `backups/2026-08-18-dias-con-stock-huecos/`.
2. Después de correr el SP modificado una vez (manualmente, no esperar a las 06:30), repetir el
   mismo chequeo que reveló el problema: de los artículos hoy en estado QUIEBRE real, ¿qué
   porcentaje muestra ahora "días quebrado (período) > 0"? Hoy es 0,4% — se espera una suba
   consistente con la realidad (no necesariamente 100%, porque un artículo recién quebrado esta
   semana todavía no acumuló muchos "días quebrado" en el período).
3. Medir cuánto tarda de más el job completo (hoy ronda los 7 minutos).
4. Revisar a mano 2-3 combinaciones puntuales conocidas (ej. algún artículo real en quiebre desde
   hace semanas) para confirmar que el número de días/episodios de quiebre tiene sentido con lo que
   se ve en `Vta_detalle`/`FotoStock` directamente.
5. Confirmar que la velocidad de venta (`Vd`) de artículos con rotación normal (sin huecos) no
   cambió — el relleno solo debería afectar a las 50.880 combinaciones con huecos reales.

## Riesgos conocidos

- El cross join numeros×combinaciones, aunque acotado por combinación (no es un cross join global),
  agrega trabajo computacional a la Etapa 1 — a validar con el tiempo real de corrida (punto 3 de
  validación).
- Si el rescate por ventas de la Etapa 3 empieza a dispararse en muchos más casos que antes (porque
  ahora sí hay filas en cero que lo activan), el `DiasConStockEstimado` de algunos artículos podría
  cambiar de forma más notoria de lo esperado para casos con venta real durante un quiebre — esto es
  el comportamiento CORRECTO y esperado, pero conviene revisarlo con casos reales antes de confirmar
  que no hay ninguna sorpresa (punto 4 de validación).
