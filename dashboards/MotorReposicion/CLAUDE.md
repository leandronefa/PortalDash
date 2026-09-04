# Motor de Reposición — CLAUDE.md

Tablero web de reposición/quiebre de stock para Cegid, con conexión directa a SQL Server (sin capa intermedia SQLite). 100% datos reales, no simulados.

## Stack y estructura

- **Backend:** Node.js + Express (`server.js`, ~740 líneas, archivo único). Conexión a SQL Server vía `mssql` (pool de conexiones), variables de entorno en `.env` (no versionado) con `dotenv`.
- **Base de datos:** SQL Server 2008 R2, servidor `10.0.0.115`, base `db_Cegid`. **Ojo con las limitaciones de esta versión** (ver sección abajo).
- **Frontend:** una sola página estática (`public/tablero_motor_quiebre.html`, ~3.600 líneas, HTML+CSS+JS vanilla sin build step) servida por Express (`express.static`).
- **Precálculo nocturno:** un stored procedure (`sql/MotorReposicion_sp_PreCalcularStockSemanal.sql`) corrido por un SQL Agent Job ("MotorReposicion - PreCalcular DiasConStock", 06:30 diario) que puebla tablas `MotorReposicion_*` para que el backend nunca calcule en vivo lo que es pesado.
- **Scripts de mantenimiento/diagnóstico:** `scripts/precalc/*.js` — scripts Node sueltos (backup de SPs, pruebas aisladas, verificación de impacto), no forman parte de la app en runtime.
- **Docs:** `docs/superpowers/{specs,plans}/` — specs y planes de cambios grandes hechos con el flujo brainstorming → plan → implementación (ver `docs/superpowers/specs/` para el historial de decisiones de diseño ya tomadas antes de proponer algo que pueda solaparse).
- **Backups:** `backups/<fecha>-<descripcion>/` — snapshots de `server.js`/HTML/definición de SP tomados antes de cambios riesgosos. Ver regla de trabajo más abajo: seguir haciendo esto SIEMPRE antes de un `ALTER PROCEDURE` o cambio de esquema.
- **Git:** repo local, sin remoto (`git init` hecho el 2026-08-18). Se sigue usando de acá en adelante para todo cambio de código de este proyecto.
- **Servicio:** `dashmotorreposicion.exe`, puerto **3019**, instalado el 2026-09-01 (`node C:\apps\portal\deploy\dashboards\install-dashboard-service.js "Dash-MotorReposicion" "C:\apps\dashboards\MotorReposicion" 3019`). Escucha solo en `127.0.0.1` — se agregó `HOST=process.env.HOST || '127.0.0.1'` y `app.listen(PORT, HOST, ...)` en `server.js` (antes no bindeaba HOST y quedaba en todas las interfaces). Dado de alta en el portal el 2026-09-01 (Dashboard **Id 21**, URL vía proxy `/d/21/`) con permisos otorgados a los usuarios que lo van a usar.

## Convenciones de nombres

- **Tablas precalculadas:** `dbo.MotorReposicion_<Nombre>` (`MotorReposicion_StockSemanal`, `MotorReposicion_VelocidadAmplia`, `MotorReposicion_DiasConStockPorSemana`, `MotorReposicion_CatalogoValido`, `MotorReposicion_UniversoHoy`, `MotorReposicion_DepositoHoy`, `MotorReposicion_UltimaRecepcion`).
- **Stored procedures:** `dbo.MotorReposicion_sp_<Verbo><Objeto>` (ej. `MotorReposicion_sp_PreCalcularStockSemanal`). Un solo SP hace las 5 etapas del precálculo nocturno.
- **Tablas temporales dentro del SP:** `#<NombreTablaReal>Nuevo`/`Nueva` (género según el nombre) — patrón `TRUNCATE tabla_real` + `INSERT ... SELECT FROM #TablaNueva`, todo dentro de una transacción explícita (`BEGIN/COMMIT TRANSACTION`). Ej.: `#StockSemanalNuevo`, `#StockAmplioNuevo`, `#VelocidadAmpliaNueva`, `#CatalogoValidoNuevo`, `#UniversoHoyNuevo`, `#DepositoHoyNuevo`, `#UltimaRecepcionNueva`.
- **CTEs:** nombres descriptivos en español, PascalCase (`RangoPorCombo`, `SemanasEsperadas`, `Huecos`, `ConAnteriorA`, `BaseA`). Tablas de números chicas para evitar funciones no soportadas en 2008 R2 se llaman `E1`/`Nums`.
- **Queries embebidas en `server.js`:** constantes en mayúsculas con prefijo `QUERY_` (`QUERY_QUIEBRE_DETALLE`, `QUERY_ARTICULO_COMPLETO`).
- **Scripts de `scripts/precalc/`:** verbo_objeto en snake_case español (`verificar_impacto.js`, `desplegar_sp.js`, `probar_relleno_huecos.js`) — cada uno es de un solo uso/diagnóstico puntual, no una librería reusable.

## Cómo ejecutar/probar

**Levantar el servidor:**
```
npm install        # primera vez
npm start           # node server.js, puerto 3050 (3000 está ocupado por otra app)
```
Requiere `.env` con `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_DATABASE` (y opcionalmente `USE_MOCK=true` para no conectar a SQL real, `PORT`, `PEDIDOS_ANTIGUEDAD_MESES`).
Si el proceso se corta solo al levantarlo en segundo plano dentro de una tarea del harness: usar `Start-Process -FilePath "node" -ArgumentList "server.js" -WindowStyle Hidden` en vez del mecanismo normal de `run_in_background` — ese sí sobrevive al reciclado de tareas.

**No hay test suite automatizado** (no hay `npm test`, ni carpeta `tests/`). La validación de cambios se hace con scripts Node ad-hoc contra la base real:
```
node scripts/precalc/verificar_impacto.js     # ejemplos de scripts de verificación ya existentes
```
Patrón estándar de estos scripts: `require('dotenv').config()` + `mssql` + `async function main() { const pool = await sql.connect(dbConfig); ...; await pool.close(); } main().catch(e => { console.error(e); process.exit(1); })`.

**Cambios al stored procedure de precálculo:**
1. Backup de la definición actual (`OBJECT_DEFINITION`) antes de tocar nada.
2. Editar `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` (el archivo versionado).
3. Desplegar contra la base real convirtiendo `CREATE PROCEDURE` → `ALTER PROCEDURE` (ver `scripts/precalc/desplegar_sp.js` como referencia del patrón de despliegue + verificación exacta post-deploy).
4. Correr el SP manualmente una vez (no esperar a las 06:30) y medir tiempo.
5. Verificar impacto con un script de un solo uso contra datos reales, no solo leer el código.

## Popover "Cálculo de la necesidad de compra" (Reposición/Edición de recompra)

Al hacer clic en "Sugerido"/un talle, se abre un popover armado por `pintarFormulaDesglose` +
`formulaBoxesHtml` (buscar esos nombres en `tablero_motor_quiebre.html`). Piezas clave:

- **2 escenarios SIEMPRE visibles (2026-09-04, a pedido explícito — reemplaza el mecanismo
  condicional anterior de `AJUSTES_FORMULA`/`vdReal`/`itemsConVdReal`):** `d.escenarioHistorico`
  (izquierda, título fijo "📌 Evidencia histórica") = velocidad de TODO el historial disponible
  (`ventasHistoricoSiempre`/`diasConStockHistoricoSiempre`, expuestos siempre por el backend, ver
  `vdHistoricoSiempre`/`itemsConVdHistoricoSiempre`). `d.escenarioReal` (derecha, "📊 Real (días
  reales)") = velocidad del período elegido (`vdDiasReales`/`itemsConVdDiasReales`) — usa
  `diasStockVd` (con el piso de 7 días) si `usoEvidenciaHistorica` está activo para ese item, o
  `diasStockVdReal` (sin piso) si no — mismo divisor que ya mostraba esta pantalla antes del
  cambio, a propósito, para no alterar el número ya conocido. Ninguno de los dos toca `it.vd` (la
  velocidad real que usa el resto del tablero para "a comprar" fuera de este popover).
- **Formato en bloques, no una sola ecuación:** Objetivo/Stock/GAP bruto NO se dibujan como una
  resta continua (`Objetivo − Stock = GAP bruto` es matemáticamente falso cuando hay más de una
  sucursal, porque GAP bruto es la suma de `máx(0, objetivo−stock)` por sucursal). Van en bloques
  separados ("Demanda" / "Stock actual" / "Resultado"), con las notas explicativas compartidas
  una sola vez arriba de las dos columnas.
- **Lupita (🔎) = detalle por sucursal:** solo aparece con `nSucursales>1 && porSucursal` — con 1
  sola sucursal el número ya es una cuenta directa visible, no hay nada nuevo que desglosar.
- **Ventana de detalle:** `abrirDetalleCajita`/`#desglose-detalle-popover`, arrastrable
  (`habilitarDragPopover`), separada del popover principal (los dos quedan visibles a la vez).
- **Botón "Volver a la cobertura"** (desde Reposición, tras venir de "Ver propuesta de recompra"):
  nace `position:absolute` pegado al recuadro de la tarjeta (sigue el scroll normal de la
  página), y se congela a `position:fixed` en su posición actual justo después del scroll
  automático hacia la tarjeta (`fijarBotonVolverEnPantalla`) — así queda "cerca del recuadro" al
  aparecer, pero no desaparece si después se sigue bajando mucho más.

## Rendimiento del tablero (2026-09-02)

Ver `docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md` y los planes en
`docs/superpowers/plans/` para el detalle completo. Resumen de resultado real:

- **Virtualización de "Ver en detalle"** (`tablero_motor_quiebre.html`): implementada y funcionando
  — solo se pintan las filas visibles del scroll (antes: todas, miles de filas, varios segundos por
  click). Gotcha real encontrado en el camino: un mismo elemento con `max-height` **y** un
  `padding-bottom` enorme (para simular filas no pintadas) no respeta `max-height` de forma
  confiable, incluso con `box-sizing:border-box` global — el elemento termina midiendo el padding
  completo. Se resolvió separando en dos elementos: uno "de afuera" que solo recorta/scrollea
  (`#det-lista-scroll`, con `max-height`, sin padding propio) y uno "de adentro" que lleva el
  padding simulado + las filas reales (`#det-lista-contenido`, sin restricción de alto propia). Si
  se necesita otra lista virtualizada en el futuro, usar este mismo patrón de entrada.
- **Precalentado de caché del combo de fechas por defecto** (`server.js`): funcionando, confirmado
  con datos reales — el combo que realmente manda el navegador en el primer load (no el fallback
  interno del handler, que es distinto y solo se usa si no vienen parámetros) responde en <1s en
  vez de 25-30s+.
- **Índices SQL en `Vta_detalle`/`dis_transf_emitidas`/`CGD_CONDCOM_VTA_DET`: PROBADOS Y
  REVERTIDOS.** Cada índice mejoró la operación puntual que atacaba (confirmado con
  `sys.dm_db_index_usage_stats` y `SET STATISTICS TIME`), pero el tiempo total de
  `QUERY_QUIEBRE_DETALLE` para una fecha nueva no mejoró de punta a punta (en un caso, empeoró) —
  el optimizador parece elegir un plan distinto para el resto de la consulta multi-statement al
  cambiar cómo se resuelve una parte. Se hizo `DROP INDEX` de los 3 el mismo día; la base quedó
  igual que antes. Detalle completo en `sql/2026-09-01_indices_rendimiento_fechas.sql`. Una mejora
  real acá necesitaría un rediseño más profundo (ej. pre-agregar ventas por día en el precálculo
  nocturno, no escanear `Vta_detalle` en vivo) — evaluarlo como proyecto aparte, no como índices
  sueltos.
- **Payload inicial de `/api/tablero/quiebre` — causa de fondo identificada, NO resuelta todavía.**
  La carga inicial de la página (antes de elegir cualquier filtro, antes incluso de loguearse) trae
  `detalle` con **475.882 filas** (SKU×sucursal, ~117MB de JSON) — confirmado con datos reales. Solo
  el `JSON.parse` en el navegador tarda ~1-2s; sumado al mapeo a objetos JS y el render, el hilo
  principal queda bloqueado varios segundos, lo que hace sentir "trabado" el login (que no depende
  de esta carga, pero corre en el mismo hilo). Causa de fondo: casi todo el procesamiento (ranking
  de Atención Prioritaria, agrupado/orden/filtro de "Ver en detalle", cascada de filtros de
  Sección/Familia/etc.) se hace en el navegador a partir del detalle CRUDO por SKU×sucursal — por
  eso el servidor manda todo, no un resumen. Una reducción real de tamaño movería ese agrupado
  (por artículo+color) al SQL/backend, mandando al navegador solo lo ya agregado que las pantallas
  muestran, y dejando el detalle crudo solo para lo que de verdad lo necesita (ej. exportar CSV).
  Es un cambio de arquitectura grande (toca la consulta SQL, el backend, y varias pantallas del
  frontend a la vez) — evaluarlo como proyecto aparte con brainstorming completo, no de un dia para
  el otro. Mientras tanto (2026-09-02, parche quirúrgico al síntoma, no a la causa): el mapeo de
  filas a objetos JS ahora corre en tandas de 5.000 (`mapearFilasEnTandas`, cerca de
  `cargarAllReal`), cediendo el hilo entre tanda y tanda — el tiempo total de carga es el mismo,
  pero la página ya no se congela de punta a punta (el tipeo del login puede intercalarse).

## Pre-agregado de ventas/tránsito por día (2026-09-02)

Ver `docs/superpowers/specs/2026-09-02-preagregado-ventas-diarias-design.md` y
`docs/superpowers/plans/2026-09-02-preagregado-ventas-diarias.md` para el detalle completo.

**Implementado:** `dbo.MotorReposicion_VentasPorDia` (una fila por día×Sucursal×CodArticulo×COLOR×
TALLE con ventas y promoción, retiene 18 meses = misma `@fechaDesde` que ya usa Etapa 1, no una
constante separada — si esa ventana cambia en el futuro, esta tabla la sigue sola) y
`dbo.MotorReposicion_TransitoHoy` (snapshot simple, recalculado completo cada noche — `#TransitoRango`
nunca dependió del rango de fechas elegido por el usuario, solo de "hoy"). Pobladas por la Etapa 8
nueva del SP nocturno (incremental "ayer" todas las noches + recálculo completo de últimos 3 meses
los domingos + limpieza de lo que pasó los 18 meses). Script manual `recalcular_ventas_por_dia.js`
para corregir a mano una venta de más de 3 meses de antigüedad si hiciera falta (el recálculo
semanal automático no llega tan atrás).

**`QUERY_QUIEBRE_DETALLE`** (`server.js`) ahora lee `#VentasRango`/`#PromoRango`/`#TransitoRango` de
estas tablas en vez de escanear `Vta_detalle`/`dis_transf_emitidas` en vivo. Verificado exacto contra
el cálculo en vivo (515K+ filas de detalle, coincidencia exacta como conjunto, en 2 combinaciones
reales) — única diferencia encontrada: el campo `color` del catálogo puede venir con distinta
capitalización (ej. "WHITE" vs "White") en ~0,1% de las entradas — confirmado con datos reales
(`MotorReposicion_UniversoCompleto`) que es una ambigüedad PREEXISTENTE (distintas sucursales cargan
el mismo color con distinta capitalización), no determinística incluso sin tocar nada, sin ningún
efecto en cálculos de negocio.

**Bugs reales encontrados y corregidos durante la implementación** (quedan documentados en los
commits, no repetirlos si se retoma esto):
- `Vta_detalle` tiene ~14% de filas con `TALLE`/`COLOR` `NULL` (y `dis_transf_emitidas` un ~0,24%) —
  hace falta `ISNULL(...,'')` en toda consulta de población, igual que ya hace el resto del sistema.
- Combinar el cálculo de `CantidadVendida` (sin join de promo) y el de promoción (con `JOIN` contra
  `CGD_CONDCOM_VTA_DET`) en una sola pasada con `LEFT JOIN` **duplica** las ventas cuando una línea
  matchea más de una condición comercial — siempre en 2 pasadas separadas, combinar recién al final.

**Resultado de rendimiento — objetivo NO logrado del todo, documentado con honestidad:**
Las 3 sub-consultas que se optimizaron mejoraron enormemente en aislado (de varios segundos cada
una a 26ms/701ms/~1,5s combinado), pero el tiempo TOTAL de la consulta no bajó por sí solo — el
bloque final que junta todo (`#Universo` + `MotorReposicion_UltimaRecepcion` +
`_EvidenciaHistorica`, tablas de 1 a 4 millones de filas) pasó a tomar un plan de ejecución peor
(el optimizador llegó a sobre-estimar 15,6x la cardinalidad de `UltimaRecepcion` tras el cambio de
tamaño de las tablas de entrada). Se agregó `OPTION (FORCE ORDER)` al final de ese `SELECT` para
estabilizar el plan — con eso, el total vuelve a estar en línea con el original (~32s), **sin
empeorar nada**, pero sin lograr el objetivo original (1-3s). Confirmado que `MotorReposicion_
UltimaRecepcion`/`_EvidenciaHistorica` ya tienen el índice correcto (Sucursal, CodArticulo, COLOR,
TALLE) — el costo real está en que el otro lado del cruce (`#Universo`) es una tabla temporal sin
índice, y el propio código YA documentó (comentario "Ajuste evidencia histórica") que indexar temp
tables ahí se probó antes y empeoró el resultado neto. Acelerar ese cruce final necesitaría un
proyecto aparte (analizar/reescribir esa parte específica de la consulta), fuera de alcance de este
cambio.

**Decisión final: se mantienen las tablas y la Etapa 8 (no se revierte).** A diferencia del intento
de índices SQL del 2026-09-01 (revertido porque agregaba costo de escritura en `Vta_detalle`, tabla
de alto tráfico, sin beneficio neto), esta pre-agregación solo escribe una vez por noche en la
Etapa 8 (ya medida en segundos, no minutos) y no toca ninguna tabla de alto tráfico en vivo — el
costo de mantenerla es bajo. El usuario no va a notar hoy un cambio de velocidad al cambiar fechas
en el tablero (el total sigue en ~32s), pero queda como base ya hecha para si en el futuro se ataca
el cuello de botella real (el cruce final contra `MotorReposicion_UltimaRecepcion`/
`_EvidenciaHistorica`/`#Universo`, ver arriba).

**Confirmación adicional de "sin regresión" (2026-09-02, tarde):** una medición previa (un solo
request por combo, sesiones separadas por 16 minutos) había mostrado el código nuevo 7-17% más
lento que el viejo en 3 combos — se sospechó regresión real. Se repitió con protocolo riguroso:
código viejo (commit `eb05b5e^`) y nuevo corriendo en paralelo (puertos distintos, misma base real),
6 combos de fecha, viejo/nuevo intercalados, 2 repeticiones cada uno. Resultado: nuevo igual o 2-8%
más rápido en los 6 combos — el "7-17% más lento" de la medición anterior era ruido de carga variable
del servidor SQL de producción entre mediciones, no una regresión (confirmado: la variación entre dos
corridas del MISMO servidor llegó a 28%, mayor que cualquier diferencia viejo/nuevo). Lección: para
comparar rendimiento antes/después contra este SQL Server, correr ambas versiones en paralelo e
intercaladas, nunca en sesiones de medición separadas en el tiempo.

**Intento descartado: sacar `#Universo` (temp table sin índice) y leer directo de
`dbo.MotorReposicion_UniversoCompleto` (que ya tiene el índice correcto en Sucursal/CodArticulo/
COLOR/TALLE).** Probado contra datos reales (2026-09-02): el bloque final pasó de ~11s a ~23-26s
(con o sin `FORCE ORDER`) — más del doble de lento, no más rápido. El índice de la tabla permanente
no ayuda acá; copiar a un temp table propio de la sesión (aunque sin índice) le sale más barato al
optimizador que compartir acceso a la tabla base. **No volver a probar esta idea puntual** — quedó
descartada con evidencia real, no es una pista a futuro. (Nunca se aplicó a `server.js` ni al SP,
todo fue comparación directa en scripts descartables.)

## Bugs de "Solo mis líneas" y de "simulador viejo" visible (2026-09-03)

Reportado por un usuario real (Gastón Maldonado, comprador): al loguearse veía artículos de OTROS
compradores (ej. `JP9771-1074`, asignado a Carlos Parodi/Sebastián Ramos en
`dbo.TBL_COMPRADOR_LINEA_MARCA`) tanto en "Atención Prioritaria" como en "Ver en detalle". Investigado
a fondo con datos reales (no alcanzaba con leer el código): dos bugs distintos, ambos corregidos.

**Bug 1 (el de fondo, afectaba a TODOS los usuarios, no solo a Gastón): `server.js`,
`QUERY_QUIEBRE_DETALLE`, el `SELECT DISTINCT` que arma el recordset "catalogo" nunca incluía
`Genero`/`Marca`** (agregados el 31/08 para este mismo filtro, calculados bien en `#EstadoFinal`,
pero nunca sumados a esta lista de columnas puntual). Resultado: el navegador recibía
`genero: null, marca: null` para el 100% del catálogo, siempre — con esos dos campos vacíos, la
clave sección+género+familia+línea+proveedor+marca nunca podía coincidir con ninguna fila real de
`TBL_COMPRADOR_LINEA_MARCA`, así que TODO artículo se trataba como "huérfano" (sin comprador
asignado) y se mostraba a cualquier usuario, filtro tildado o no. Fix: agregar `Genero, Marca` a ese
`SELECT DISTINCT` (una sola línea). Verificado con datos reales, forzando un cálculo nuevo (no
cacheado): 100% de género y 98,4% de marca no-null en 76.045 entradas (los faltantes son huecos
reales y preexistentes en `cgd_ARTICULOS`, no del bug), `JP9771-1074` queda oculto para Gastón, y la
forma completa de la respuesta (`resumen`/`detalleColumnas`/`detalle`/`catalogo`) no cambió.

**Bug 2 (aparte, solo en la pantalla Favoritos): `renderCatalogoFavoritos()` arma su lista directo
desde `ALL`, sin pasar por `base()`** — el checkbox "Solo mis líneas" se mostraba y se podía tildar
ahí, pero no tenía ningún efecto (nunca leía `misLineasKeys`/`soloMisLineas`). Fix: aplicar el mismo
criterio exacto de `base()` (oculta solo lo asignado a OTRO comprador, nunca lo huérfano) dentro de
`renderCatalogoFavoritos()`, sin tocar el filtro de stock>0 existente ni el hecho de no acotarse a
favoritos ya marcados (ambos a propósito, no son parte de este bug).

**Bug 3 (encontrado de paso, mismo día): los items del "simulador viejo" (`x.sim===true`, datos
demo/hardcodeados, distintos de los reales que vienen del backend) se mostraban en TODAS las
pantallas** — `let st={...,sim:true}` y `let sti={...,sim:true}` (los flags que en teoría deciden si
excluirlos) **arrancan en `true` y no tienen ningún control en la UI que los cambie a `false`** — la
condición `st.sim?ALL:ALL.filter(x=>!x.sim)` repetida en 7 lugares (`filtered()` código muerto sin
ningún caller, `base()`, `conCurvaRota()`, `baseInmov()`, `coberturaPorLinea()`, `renderExec()`,
`renderCatalogoFavoritos()`) era en la práctica siempre `ALL` sin filtrar. Fix: exclusión de `x.sim`
ahora incondicional en los 7 lugares (no se tocaron los lookups puntuales de un artículo ya
seleccionado desde una lista, ej. `ALL.find(x=>x.sku===...)` al abrir una ficha — si el item nunca
aparece en ninguna lista, nunca se llega a abrir su detalle, tocar esos lookups no hacía falta).

**Bug 4 (rendimiento, encontrado al verificar lo de arriba): el buscador de artículo (en "Ver en
detalle"/"Atención Prioritaria" vía `bindFiltrosCategoria`, y en Favoritos) re-renderizaba la lista
ENTERA en cada tecla, sin ningún debounce** — con catálogos reales de decenas de miles de artículos,
cada letra tipeada (o borrada) recalculaba filtro+agrupado+orden+HTML desde cero, sintiéndose como
demora de segundos por letra. Fix: debounce de 200ms en ambos buscadores (el input en sí nunca se
retrasa, solo la actualización de la lista de resultados, y solo tras una pausa breve de tipeo).

## Fix "días con stock" en evidencia histórica cuando se vende casi enseguida (2026-09-04)

Reportado por un usuario real (Claudia): `KJ1736-1074/CORE BLACK-CLOUD WHITE-SILVER METAL/talle
5/Sucursal 000028` — recibió 1 unidad el 25/11/2025 y la vendió el 26/11/2025 (2 días reales de
stock), pero el popover mostraba "5 días con stock" en Evidencia histórica. Investigado con datos
reales (`MotorReposicion_EvidenciaHistorica`/`_DiasConStockPorSemana`/`_StockSemanal`,
`dis_transf_recibidas`, `Vta_detalle` directamente, no solo leyendo el código).

**Causa raíz:** la Etapa 3 del precálculo nocturno (`MotorReposicion_sp_PreCalcularStockSemanal.sql`),
al detectar una "racha nueva" (semana con stock que arranca de cero), ya tenía una corrección del
mismo día (`RecepcionArranqueH`) que acota el INICIO del conteo a la fecha real de recepción — pero
seguía contando hasta el CIERRE de esa semana como si el stock hubiera durado toda la semana
(`DATEDIFF(recepción, cierre_semana) + 1` = `DATEDIFF(25/11,29/11)+1 = 5`), sin considerar que el
artículo se vendió apenas 1 día después.

**Fix:** nueva CTE `PrimeraVentaTrasRecepcionH` — si hay una venta real dentro de la misma semana,
después de la recepción, se acota también el FIN del conteo a esa venta en vez del cierre de
semana (mismo criterio ya usado para el inicio). Verificado: el caso puntual pasó de 5 a 2 días
exactos; sanity check general de la tabla completa (2.022.971 filas, 0 negativos, promedio 37.2
días) sin cambios anómalos; un caso con racha continua de varias semanas (sin este ajuste
puntual) no se modificó.

**Índice nuevo, `IX_VtaDetalle_Sucursal_Articulo_Fecha` (Sucursal/CodArticulo/COLOR/TALLE/FECHA):**
el fix necesita, para cada "arranque" (656.771 casos en toda la base), buscar la primera venta real
dentro de esa semana en `Vta_detalle` (8,75 millones de filas) — ninguno de los índices existentes
sirve para esa búsqueda puntual (todos intercalan otras columnas entre las claves y FECHA). **Sin
este índice, la corrida no llegó a terminar ni en 20 minutos** (probado y revertido el mismo día,
antes de crear el índice). Con el índice: el JOIN aislado bajó a ~83s, y el SP completo corrió OK
en ~22,8 minutos. A diferencia de `IX_VtaDetalle_Fecha_Cubriente` (2026-09-01, revertido — llevaba
FECHA primero, para un patrón de "escanear un rango ancho"), este índice lleva las columnas de
igualdad primero y FECHA al final (patrón de "muchos grupos chicos, cada uno con un rango angosto")
— **decisión distinta a la del 1/09** porque acá el uso es para el cálculo nocturno (una escritura
por noche en `Vta_detalle` paga el costo de mantenimiento del índice), no para una consulta en
vivo — el usuario confirmó explícitamente agregar el índice sabiendo este trade-off.

## Reglas de trabajo (seguir siempre)

- **Los cambios son siempre quirúrgicos: tocar solo la sección que se pide, sin refactorizar el resto.** No reordenar, renombrar ni "mejorar de paso" código que no forma parte del pedido puntual, aunque se vea una oportunidad de limpieza — proponerla aparte, no mezclarla en el mismo cambio.
- Backup antes de cambios grandes en la base o el SP de precálculo (`backups/<fecha>-<descripcion>/`).
- Verificar con datos/pruebas reales antes de afirmar que algo está arreglado — no alcanza con razonamiento teórico.
- Decisiones de producto/UX (qué ve el usuario, no solo velocidad interna) se preguntan con opciones concretas antes de implementar. Fixes invisibles se pueden implementar directo.
- SQL Server 2008 R2 no soporta `CONCAT`, `CREATE OR ALTER`, `LAG()`/funciones de ventana modernas, ni generadores nativos de secuencias de fechas — usar tablas de números vía `ROW_NUMBER() OVER (ORDER BY (SELECT NULL))` sobre un cross join chico.
- **Nunca adivinar un offset de píxeles para `position:fixed`/`sticky` en elementos anidados dentro de otro contenedor con su propio encabezado fijo** (ej. el modal con `.modal-hd` sticky) — la altura real varía con el contenido (título largo → 2 líneas) y un número fijo se queda corto. Medir en vivo con `getBoundingClientRect()`/`ResizeObserver` y guardar el resultado en una CSS variable (ver `--modal-hd-alto` en el CSS). Perdimos 2 rondas de ida y vuelta con la usuaria por adivinar en vez de medir.
- **`overflow:hidden`/`auto` en un ancestro (incluso solo en un eje) rompe `position:sticky` de los descendientes** — cualquier valor de `overflow` distinto de `visible` convierte a ese ancestro en el contenedor de referencia del sticky, y si ese ancestro no scrollea por sí mismo, el sticky queda inerte. Si un sticky "no se queda fijo", revisar overflow en los ancestros antes que nada.
