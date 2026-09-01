# CLAUDE.md — VentaObjetivo

## Qué es

Port web de `VENTASCOMPARATIVAS.qvw` (QlikView): 5 pivots Año × Mes (Ventas, Operaciones,
Unidades, Tkt Prom, Uni x Cli) por sucursal/empresa, más **carga de objetivos del mes que
viene** y una pestaña **Totales** (Días Venta/Margen % → Margen Total, ahora también con
histórico de meses cerrados). Backend Express CommonJS (`server/server.js` +
`server/consultas.js`) + frontend estático vanilla (`server/public/index.html`, sin build).
Layout original recuperado inflando streams zlib del `.qvw` (formato binario propietario,
sin parser directo) — ver `extraido-del-qvw/layout-qlikview-raw.txt`.

## Servicio y acceso

- Servicio de Windows: **`dashventaobjetivo.exe`** (node-windows), puerto **3016**, entrada
  `server.js`, carpeta de trabajo `server/`.
- **Los usuarios acceden SOLO vía el portal**: `http://10.0.0.118/d/18/` (`Dashboards.Id=18`
  en `portal.db`, no versionado — ver "Qué NO está en este repo" más abajo).
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\VentaObjetivo\server; $env:PORT=3016; node server.js
  ```
- Logs: `daemon\Dash-VentaObjetivo.out.log` (y `.err.log`).
- Reinstalar el servicio desde cero (server nuevo o roto):
  ```powershell
  cd C:\apps\portal\deploy\dashboards
  node install-dashboard-service.js "Dash-VentaObjetivo" "C:\apps\dashboards\VentaObjetivo\server" 3016
  ```
- `.env` (ver `server/.env.example` para nombres y valores por defecto no sensibles):
  `PORT`, `HOST`, `DB_SERVER`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`,
  `DB_TRUST_CERT`, `DB_POOL_MAX`, `DB_TIMEOUT_MS`, `DB_DATABASE_TABLEROS` (=`TABLEROS`),
  `DB_DATABASE_DWVALLEJO` (=`dw_vallejo`), `ANIOMES_DESDE`, `TTL_CERRADO_MIN`,
  `TTL_ABIERTO_MIN`. Todas contra SQL Server **10.0.0.115** (usuario `sa`, misma password
  que otros dashboards — ver `.env` real, nunca commiteado).

## Dependencias en SQL Server (10.0.0.115)

- **`TABLEROS.dbo.GrillaVentasComparativas`**: venta real ya agregada por sucursal/mes,
  SOLO meses cerrados (el ETL no genera la fila del mes en curso todavía). Fuente única de
  Comparativas — **Totales no la usa** (siempre objetivo, ver más abajo).
- **`dw_vallejo.dbo.f_objetivos`** (`id_vendedor=0`) + **`dw_vallejo.dbo.f_dias_habiles`**:
  objetivo/Días Venta/Margen % por sucursal y mes — se usa para el mes en curso (mientras
  no está en la Grilla) y queda como historial permanente de Días/Margen de cualquier mes
  ya cargado (ver `DIAS_MARGEN_DEL_MES` en `consultas.js`).
- **`dw_vallejo.dbo.l_sucursal`**: puente `id_sucursal` (clave de `f_objetivos`) ↔
  `cod_sucursal` (clave de la Grilla). Los 5 canales web/MeLi (`E1/E2/WE1/WE2/FK1`) no
  tienen fila propia acá — mapeo fijo `CANAL_A_COD` en `consultas.js`.
- **`db_Cegid.dbo.TEMP_BI_APP`**: staging table del proceso manual real de carga de
  objetivos (no es nuestra, no crearla si no existe — es preexistente al dashboard).
- **`db_Cegid.dbo.SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI_DASHBOARD`** + tipo TVP
  **`db_Cegid.dbo.VentaObjetivo_AjusteMargenType`**: **SÍ están en este repo**
  (`sql/crear-sp-dashboard.sql`) — es una copia del SP original `SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI`
  (`sql/sp-original-referencia.sql`, sólo de referencia, INTOCABLE) con las 2 líneas finales
  (push real a `f_objetivos`/`f_dias_habiles`, comentadas en el original) activadas y
  parametrizadas por `@anomes`. Si el servidor SQL se reconstruye desde cero, correr
  `crear-sp-dashboard.sql` para recrear estos 2 objetos.

## Flujo de "GUARDAR OBJETIVOS" (mes que viene)

No escribe `f_objetivos` directo: inserta en `TEMP_BI_APP` y ejecuta el SP de arriba
(`EXEC_SP_DASHBOARD` en `consultas.js`), que es quien mueve los datos a las tablas reales
— mismo camino que el proceso manual, pero automático. El `EXEC` necesita la conexión
posicionada en `db_Cegid` (no alcanza calificar `db_Cegid.dbo.SP_...` desde una conexión a
`dw_vallejo`, SQL Server no resuelve el tipo TVP) — ver `getPoolCegid()` en `server.js`.
Borrador local mientras no se guarda: `data-store/objetivos-<mes>.json` y
`data-store/margenes-<mes>.json` (no versionados, se pierden si se borra la carpeta —
sólo importa mientras alguien está cargando el mes que viene y no guardó todavía).

## Universo de sucursales — exclusiones hardcodeadas

- **"Calz SJ LIQUIDACION" (cod 14)**: eliminada de TODO el tablero (`SUCURSALES_ELIMINADAS`
  en `server.js`).
- **"Calzados 01" (cod 01)**: no carga objetivo, pero sigue en Comparativas
  (`SUCURSALES_SIN_OBJETIVO`).
- Universo dinámico de **objetivos** (no de Comparativas): una sucursal sin venta en
  ninguno de los últimos 12 AñoMes cerrados queda afuera sin necesidad de lista a mano
  (`SUCURSALES_ACTIVAS_RECIENTES` en `consultas.js`).

## Pestaña "Totales" — Días Venta / Margen % / columnas x Día / histórico

- Objetivo/Unidades/Operaciones ya cargados en Comparativas + Días Venta y Margen % a
  mano por sucursal (`storeMargenes`). Grupos **Pueblo** / **Tesi** / **Digitales** (canales
  web/MeLi, `CANALES_WEB` en `server.js`) — Digitales tiene ajuste de margen editable **por
  sucursal**; Pueblo/Tesi tienen un único % editable **por grupo** (default 0% Tesi, +1,5%
  Pueblo, +1% Digitales — `AJUSTE_MARGEN`).
- Columnas **"Unidades x Día"** y **"Operaciones x Día"** (= Unidades/Operaciones ÷ Días
  Venta, mismo criterio que "Diario sin/con IVA").
- **Selector de mes** (`#peSelectMes`): "mes que viene" (editable, default) + todos los
  meses con objetivo cargado (`GET /api/margenes-empresa/meses`, `DISTINCT id_mes` de
  `f_objetivos`, acotado a `[ANIOMES_DESDE, mes editable]` para filtrar basura de pruebas
  viejas). **Totales SIEMPRE muestra objetivo, nunca venta real** (30/08/2026) — a
  diferencia de Comparativas: cualquier mes que no sea el editable sale 100% de
  `dw_vallejo` (`f_objetivos` + `f_dias_habiles`), no de `GrillaVentasComparativas`, así un
  mes recién cerrado (objetivo guardado, todavía sin fila real por el retraso del ETL)
  también aparece. **Siempre de sólo lectura** — ni vallejo/admin puede editar un mes que
  no sea el editable (`construirVistaMargenesParaMes(anioMes)` en `server.js`, endpoint
  `GET /api/margenes-empresa?mes=AAAAMM`).

## Permisos por usuario

- Header `X-Portal-User` (inyectado por el portal, `DashboardProxy.cs`) identifica al
  usuario logueado — sin ese header (acceso directo al puerto) se asume solo lectura.
- `puedeEditar(req)`: sólo usuario con "vallejo" en el nombre o `admin` puede cargar/editar
  el mes que viene; el resto es sólo lectura (`exigirEdicion` middleware en las rutas
  POST/DELETE).
- `SUPERVISORES_RESTRINGIDOS` (mapa hardcodeado en `server.js`): 6 usuarios ven SOLO sus
  sucursales asignadas (`TABLEROS.EncargadosSucursalObjetivos`, columna `NombreApellido`).
  Si el username del portal no coincide con `NombreApellido` (ya pasó un caso), no asumir
  la convención — verificar con el usuario. **Para encargados de una sola sucursal existe
  un tablero aparte**, ver [VentaObjetivoSucursal](../VentaObjetivoSucursal/CLAUDE.md).

## Qué NO está en este repo (restaurar server ≠ sólo `git clone`)

- **`C:\apps\portal\App_Data\portal.db`** (SQLite): el registro del dashboard (`Id=18`),
  los `Users`/`Permissions` de quién puede entrar, y la config de proxy. **No está en
  git** (excluido a propósito, es estado runtime). Si el servidor se pierde sin backup de
  esta base, hay que volver a dar de alta el dashboard a mano en Portal → Administración.
- **`.env`** de este dashboard (contraseña de SQL) — `dashboards/**/.env` está en
  `.gitignore`. Recrear desde `server/.env.example` + la password real de `sa` (compartida
  con otros dashboards que pegan a 10.0.0.115).
- **`data-store/`** (borradores sin guardar) — se pierde y no importa (sólo son objetivos
  del mes que viene todavía no guardados; lo ya guardado vive en SQL Server).
- La tabla **`USUARIOS_APPS`** que valida el login corporativo del portal — vive en algún
  lado de SQL Server (no confirmado en qué base), fuera del control de este repo.

## Gotchas

- El `PORT` que inyecta el servicio pisa al del `.env` — mantener 3016 único.
- Cambios en `server/` necesitan `Restart-Service dashventaobjetivo.exe` (sin build).
  Cambios sólo en `server/public/index.html` se sirven directo desde disco, sin reinicio.
- No commitear `.env` ni tocar `sp-original-referencia.sql` (es sólo de referencia).
- Pedir confirmación antes de reinstalar el servicio, tocar `.env`, o correr
  `crear-sp-dashboard.sql` contra producción.
