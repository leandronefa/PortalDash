# Rendimiento del tablero: virtualizar "Ver en detalle", precalentar caché de fechas, índices en SQL

**Fecha:** 2026-09-01
**Estado:** Aprobado por Claudia, pendiente de implementar.

## Contexto

Claudia reportó que varias interacciones del tablero (`public/tablero_motor_quiebre.html` +
`server.js`) demoran "varios segundos" en actualizar: los filtros de fecha (Período de ventas,
Fecha de última compra), abrir "Ver en detalle", cambiar el orden dentro de esa lista, y los
filtros de Sección/Familia/Línea/Proveedor. Investigación de causa raíz (sin cambiar código)
encontró **dos problemas independientes, con causas distintas**:

### A) Filtros de fecha → lento por el backend

Cada combinación de fechas no pedida hoy dispara `QUERY_QUIEBRE_DETALLE` completa contra SQL
Server 2008 R2 (~15-25s en frío, según los propios comentarios del código). Hay una caché en
memoria (`cacheQuiebre`, keyed por fechaDesde/fechaHasta/riesgoDias/ucFechaDesde/ucFechaHasta,
invalidada por `ultimoRefrescoEsperado()`) que sirve rápido ante una repetición exacta el mismo
día, pero cualquier combinación nueva es cache-miss real. El equipo ya movió a precálculo nocturno
las partes más caras que NO dependen del rango de fechas elegido (universo, días con stock) —lo
que queda en vivo por request es exactamente lo que SÍ depende del rango: `#VentasRango`,
`#PromoRango` (ambas sobre `Vta_detalle`, filtradas por `FECHA`) y `#TransitoRango` (sobre
`dis_transf_emitidas`, filtrada por `fecha`).

### B) "Ver en detalle" (abrir, cambiar orden, filtrar por Sección/Familia/etc.) → lento por el frontend, no por el backend

Confirmado que estas interacciones **no hacen ningún fetch al servidor** — `abrirVerDetalle`,
el `onchange` de `#det-orden` y `bindFiltrosCategoria` solo llaman a funciones de render en JS. El
costo real es reconstruir el HTML completo de la lista agrupada (casos reales con **~9.000+ filas**
tras `agruparPorArticuloColor`) y reemplazar `innerHTML` entero en cada click, sin paginación ni
virtualización. Ya hay dos optimizaciones puntuales documentadas en el propio código (agrupar
pasó de O(n²) a O(n) porque congelaba el navegador; se reordenó una medición de
`getBoundingClientRect()` para no forzar un reflow sobre miles de filas recién insertadas), pero el
costo central —crear e insertar miles de nodos DOM en cada interacción— nunca se atacó.
"Atención Prioritaria" se descartó como parte del problema: ya limita a top-10 artículos
(`top10PorArticulo`) y su propio render es barato; la lentitud percibida ahí, confirmado con
Claudia, en realidad ocurre al entrar/interactuar con "Ver en detalle".

Evidencia adicional levantada en vivo (solo lectura, `SELECT COUNT_BIG(*)` + `sys.indexes`, sin
tocar nada) sobre las tablas que sí se consultan en vivo por rango de fechas:

| Tabla | Filas | Índices existentes | Problema |
|---|---|---|---|
| `Vta_detalle` | 8.743.786 | `(FECHA, ARTCEGID)` entre otros | No cubre `ESTAB/COLOR/TALLE/CANTIDAD/NUMERO/CODBARRA_prin` que la consulta necesita → probable key lookup por fila devuelta |
| `dis_transf_emitidas` | 2.863.800 | único índice arranca por `estab` | La consulta filtra por `fecha`/`destino`, no por `estab` → candidato a escaneo completo en cada request |

## Objetivo

Reducir la demora percibida en ambos frentes, sin cambiar ningún resultado/cálculo que ya esté
correcto — solo el CÓMO se llega a ese resultado:

- Interacciones dentro de "Ver en detalle" (abrir, ordenar, filtrar por estado) deberían sentirse
  instantáneas (~debajo de 200ms), no varios segundos.
- La primera carga del día con el rango de fechas por defecto (Período de ventas: últimos 90 días
  terminando ayer; Última compra: últimos 365 días) debería estar ya cacheada cuando el primer
  usuario abra el tablero.
- Un cambio de fecha a un rango NUEVO (no default) sigue pagando una consulta real a SQL Server —
  eso no se elimina— pero esa consulta debería correr más rápido gracias a los índices nuevos.

## Diseño aprobado

### 1. Virtualización de la lista de "Ver en detalle" (frontend, 100% vanilla — sin librerías ni build step)

- Se agrega un helper de "lista virtualizada" genérico, en el mismo estilo del resto del archivo:
  recibe el array ya agrupado/ordenado/filtrado (`ordenado`, calculado exactamente igual que hoy)
  y la altura de fila fija (ya definida por el CSS grid de `.pcard`/`.pcg`), y solo genera HTML real
  para las filas que caen en el rango visible de `#det-lista-scroll` (+ un colchón de over-scan
  arriba/abajo para que no se note un parpadeo al scrollear rápido).
- El resto del alto de la lista se simula con `padding-top`/`padding-bottom` sobre el contenedor
  scrolleable, calculado como `filas_antes * alto_fila` / `filas_despues * alto_fila`, para que la
  scrollbar se comporte de forma normal (mismo tamaño/posición que si estuvieran todas las filas).
- El listener de scroll recalcula el rango visible y vuelve a pintar solo esas filas — sin re-
  agrupar ni re-ordenar el array completo (eso ya es barato, sigue igual que hoy).
- `renderVerDetalle()` sigue siendo el punto de entrada: arma `ordenado` igual que ahora, y en vez
  de `listaEl.innerHTML = filas` (todas las filas), delega al helper de virtualización.
- **No se toca:** `exportarDetalleCSV` (ya lee de `detalleData()`, no del DOM), `agruparPorArticuloColor`,
  `ordenarBarras`, `aplicarFiltrosCategoria`, el popover de Estado, ni "Atención Prioritaria".

### 2. Precalentado del combo de fechas por defecto (backend)

- Se extrae la lógica de "calcular (o servir de `cacheQuiebre`) el resultado pesado para un juego
  de parámetros dado" que hoy vive inline dentro de `app.get('/api/tablero/quiebre', ...)` a una
  función reusable (ej. `calcularOServirQuiebre(params)`), sin cambiar su comportamiento actual.
- Se agrega un chequeo periódico liviano en el servidor (ej. cada 5 minutos): si ya pasó
  `ultimoRefrescoEsperado()` de hoy y `cacheQuiebre` todavía no tiene la clave correspondiente al
  combo por defecto (Período de ventas = últimos 90 días terminando ayer, Última compra = últimos
  365 días, `riesgoDias` = default), se llama a `calcularOServirQuiebre` en background para esa
  combinación exacta.
- Este chequeo también cubre el reinicio del servicio a mitad de mañana (por ejemplo, tras un
  despliegue): al arrancar, si ya pasaron las 06:30 y no hay caché tibia, se dispara el precalentado
  igual que en el chequeo periódico normal.
- Cambios de fecha personalizados (fuera del combo default) siguen pagando el costo real la primera
  vez — este punto no lo resuelve, ver punto 3.

### 3. Índices nuevos en SQL Server (más riesgoso — requiere ventana de mantenimiento)

Dos índices nuevos, aditivos (no se borra ni modifica ningún índice existente):

```sql
CREATE NONCLUSTERED INDEX IX_VtaDetalle_Fecha_Cubriente
  ON Vta_detalle (FECHA)
  INCLUDE (ESTAB, ARTCEGID, COLOR, TALLE, CANTIDAD, NUMERO, CODBARRA_prin);

CREATE NONCLUSTERED INDEX IX_DisTransfEmitidas_Fecha_Cubriente
  ON dis_transf_emitidas (fecha)
  INCLUDE (destino, arprove, color, talle, cantpend);
```

Antes de aplicar en producción:
1. Confirmar edición real de SQL Server (`SELECT SERVERPROPERTY('Edition')`) — si es Standard (lo
   más probable en 2008 R2), la creación bloquea la tabla mientras corre (no hay `ONLINE=ON`).
2. Backup de la definición de índices actuales de ambas tablas (ya lo dejé documentado arriba, en
   la tabla de contexto) antes de tocar nada, siguiendo la regla de trabajo ya establecida del
   proyecto para cambios de esquema.
3. Programar la creación en una ventana de bajo uso (de noche, después de que corra el precálculo
   — mismo horario que ya usa `MotorReposicion - PreCalcular DiasConStock`, para no competir con
   ese job).
4. Medir antes/después con un caso real: tiempo de `/api/tablero/quiebre` en frío (cache-miss
   forzado) para 2-3 combinaciones de fechas distintas, comparando el mismo request antes y después
   de crear los índices.
5. Si el tiempo de creación en sí resulta excesivo (tablas de millones de filas), considerar
   `CREATE INDEX ... WITH (ONLINE=ON)` si la edición lo permite, o coordinarlo como una tarea aparte
   con quien administre ese SQL Server.

## No-objetivos (fuera de alcance de este cambio)

- No se toca el cálculo de ningún número del tablero (Vd, Estado, GAP, etc.) — este trabajo es
  puramente de rendimiento, mismo resultado, más rápido.
- No se agregan botones de rango de fechas rápido ("últimos 30/90/180 días") — Claudia prefirió no
  cambiar la UX del filtro de fechas en este trabajo.
- No se rediseña `QUERY_QUIEBRE_DETALLE` para pre-agregar ventas por día (un enfoque más profundo
  que haría CUALQUIER rango de fechas rápido, no solo el default) — quedó fuera de alcance por ahora,
  se puede evaluar como un trabajo aparte si los índices no alcanzan.
- No se virtualizan otras listas (Atención Prioritaria, Inmov, Favoritos, Registro) — no mostraron
  evidencia de ser el cuello de botella real.

## Riesgos / puntos de atención para la implementación

- El helper de virtualización debe manejar bien los casos borde: lista vacía, cambio de alto de
  ventana (resize), y el filtro de Estado que puede reducir el array a mitad de sesión sin cerrar
  el modal — el rango visible se tiene que recalcular en esos casos, no solo en scroll.
- El precalentado de backend no debe competir por la misma conexión/pool que un request real de un
  usuario si ambos caen al mismo tiempo — usar el mismo `poolPromise` ya existente alcanza (el pool
  ya maneja concurrencia), pero verificar que no se disparen dos precalentados en paralelo si el
  chequeo periódico corre más de una vez antes de que termine el primero (usar una bandera simple
  tipo `precalentandoDefault` en memoria).
- Los índices son el punto de mayor riesgo real (tocan tablas de producción de millones de filas) —
  no se aplican sin coordinar la ventana de mantenimiento y confirmar la edición de SQL Server
  primero. Verificar impacto con datos/tiempos reales antes y después, no alcanza con razonamiento
  teórico (regla ya establecida del proyecto).
