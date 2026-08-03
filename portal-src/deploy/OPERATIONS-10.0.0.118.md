# Estado operativo del servidor 10.0.0.118

> Handover / contexto operativo. Describe cómo quedó instalado el Portal de Dashboards y los 3 dashboards Node.js en el server, con los problemas reales que se resolvieron. Útil como contexto para Claude o para cualquier administrador.

## Layout en disco (local del server)

```
C:\apps\
├── portal\                         Portal de Dashboards (.NET 9, self-contained)
│   ├── DashboardPortal.exe          → Servicio Windows "DashboardPortal", puerto 80
│   ├── appsettings.json / .Production.json
│   ├── App_Data\portal.db           (SQLite: dashboards, usuarios, permisos, auditoría)
│   └── deploy\                       scripts de instalación (este folder)
└── dashboards\
    ├── comisiones-app\              Node/Express  → servicio "dashcomisiones",  puerto 3001
    ├── DashPromocionesMP\           Node/Express  → servicio "dashpromociones", puerto 3002
    ├── sucursal-user-visualizer\    Node/Express  → servicio "dashsucursal",    puerto 3003
    ├── MovimientosCaja\             Node/Express  → servicio "dashmovimientoscaja.exe",   puerto 3004
    ├── ConciliacionPunitorios\      Node/Express  → servicio "dashconciliacionpunitorios.exe", puerto 3006
    ├── ValidacionCobranzas\         Node/Express  → servicio "dashvalidacioncobranzas.exe", puerto 3007
    ├── EstadoResultado\             Node/Express  → servicio "dashestadoresultado.exe",     puerto 3008
    ├── PassReset\                   Node/Express  → servicio "dashpassreset.exe",           puerto 3009
    ├── DashMeLi\                    Node/Express  → servicio "dashmeli.exe",                puerto 3010
    ├── ControlAcceso\               Node/Express  → servicio "dashcontrolacceso.exe",       puerto 3012
    └── APCWeb\                      ASP.NET Core 9 → servicio "dashapcweb",                  puerto 3013
```

> `\\10.0.0.118\apps` es el recurso compartido que apunta a `C:\apps`. En el server SIEMPRE usar la ruta **local `C:\apps\...`** (los servicios no deben referenciar rutas UNC).

## Servicios de Windows (todos con arranque automático)

| Servicio (Name real) | DisplayName | App / puerto | Entrada |
|---|---|---|---|
| `DashboardPortal` | Portal de Dashboards | portal .NET / **80** | DashboardPortal.exe |
| `dashcomisiones.exe` | Dash-Comisiones | comisiones-app / **3001** | `server.cjs` |
| `dashpromociones.exe` | Dash-Promociones | DashPromocionesMP / **3002** | `server.js` |
| `dashsucursal.exe` | Dash-Sucursal | sucursal-user-visualizer / **3003** | `dist-server\index.js` |
| `dashvalidacioncobranzas.exe` | Dash-ValidacionCobranzas | ValidacionCobranzas / **3007** | `server.cjs` |
| `dashestadoresultado.exe` | Dash-EstadoResultado | EstadoResultado / **3008** | `server.js` |
| `dashpassreset.exe` | Dash-PassReset | PassReset / **3009** | `server.cjs` |
| `dashmeli.exe` | Dash-MeLi | DashMeLi / **3010** | `server.js` |
| `dashcontrolacceso.exe` | Dash-ControlAcceso | ControlAcceso / **3012** | `server.cjs` |
| `dashapcweb` | Dash-APCWeb | APCWeb / **3013** | `publish\APCWeb.exe` (ASP.NET Core, sin sufijo `.exe` en el Name: se creó con `sc.exe`, no con node-windows) |

⚠️ **node-windows registra los servicios con sufijo `.exe`** en el Name real. `Get-Service Dash-*` **no** los encuentra. Usar:
```powershell
Get-Service | Where-Object DisplayName -like 'Dash-*' | Format-Table Name, DisplayName, Status
# o por nombre real:
Get-Service dash*
Restart-Service dashpromociones.exe
```

## Gestión

```powershell
# Estado de todo
Get-Service DashboardPortal, dash* | Format-Table Name, Status
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 80,3001,3002,3003,3004,3006,3007,3008,3009,3010,3011,3012,3013 | Format-Table LocalPort, OwningProcess

# Reiniciar / detener (nombre real con .exe)
Restart-Service dashcomisiones.exe
Stop-Service dashpromociones.exe

# Logs de cada dashboard (node-windows)
Get-Content C:\apps\dashboards\<carpeta>\daemon\<servicio>.err.log -Tail 30
```

## PassReset — sistema de reset automático de contraseñas Windows

Dashboard en `http://10.0.0.118/d/12/` vía portal (servicio `dashpassreset.exe`, puerto 3009 solo loopback). Gestiona el ciclo de cambio de contraseñas Windows en los servidores remotos monitoreados.

### Arquitectura

- **Agente** (`sucursal-user-visualizer/agent/index.js`) corre en cada servidor remoto con `PASSRESET_ENABLED=true`.
- **Base de datos** `db_Cegid` en `10.0.0.115`: tablas `tbl_PassReset_Usuarios` y `tbl_PassReset_Log`.
- **Correo** vía Database Mail de SQL Server (`msdb.dbo.sp_send_dbmail`).

### Flujo por servidor remoto

1. Al arrancar, el agente registra todos los usuarios Windows locales habilitados en `tbl_PassReset_Usuarios` (`sp_PassReset_AgentUpsertUsuario`). Los nuevos quedan con correo vacío.
2. Cada 5 min consulta `sp_PassReset_AgentGetPendientes`: usuarios activos **con correo asignado** cuya contraseña venció.
3. Genera contraseña (12 chars: lower/upper/dígito/especial), la aplica con `net user`, reporta con `sp_PassReset_AgentReportarCambio`.
4. SQL Server envía el correo con la nueva contraseña post-commit (`sp_PassReset_EnviarCorreo`).

### Asignar correo a un usuario

Desde el dashboard PassReset → tabla de usuarios → columna **Correo** → ícono lápiz (✎). Sin correo asignado, el agente registra al usuario pero no le cambia la contraseña.

### Instalar el agente en un servidor remoto

```powershell
# Copiar agent\ al servidor remoto, luego ejecutar:
cd <ruta-del-agente>
.\install-agent.ps1 `
  -ServerName "NOMBRESERVIDOR" `
  -CentralUrl "http://10.0.0.118:3003" `
  -PassresetEnabled "true" `
  -PassresetSqlServer "10.0.0.115" `
  -PassresetSqlDb "db_Cegid" `
  -PassresetSqlUser "sa" `
  -PassresetSqlPass "la_contraseña"
```

### Consideraciones

- El agente corre como SYSTEM → `net user` funciona para cuentas locales.
- Contraseñas generadas con charset `@#$!` (sin `%` — cmd.exe lo expande).
- Si Database Mail no está configurado en SQL Server: el cambio se aplica igual pero `Resultado` queda `OK_MAIL_ERROR` en el log.
- Scripts SQL en `dashboards/PassReset/SQL/`: `01_Database.sql` (tablas) y `02_StoredProcedures.sql` (SPs). Ya ejecutados en `db_Cegid`.

---

## EstadoResultado — flujo de datos (importante)

El botón **Actualizar** del tablero (y el chequeo diario de las 01:00) lee `\\10.0.0.115\Cegid`
**directo de la red** (`SAP_NETWORK_PATH`, read-only); ya no hace falta copiar archivos al
inbox a mano. Verificado el 28/07/2026: el servicio, con su cuenta normal, lee la UNC sin
problemas (log: `TESI desde red — traidos: [...] preservados: []`, ídem PUEBLO). Si alguna vez
aparece `EACCES`/`EPERM` en `daemon\dashestadoresultado.out.log`, es permisos del share — hay
que darle al servicio una cuenta con acceso a `Cegid`. Mientras tanto "Subir files" sigue
funcionando igual (no depende de la red).

**Empresas (31/07/2026): TESI, PUEBLO e INDO.** INDO se sumó leyendo `SAP_INDO_RESULT.TXT` de
la misma ruta de red, con el mismo circuito que las otras dos (refresh, descarga byte a byte,
ajustes manuales protegidos). El registro único de empresas es `EMPRESAS` en
`dashboards\EstadoResultado\server\sap-store.js`: agregar otra empresa es **una línea ahí** (el
selector del tablero y los botones de descarga/subida se derivan de `/api/status`).

El estado vigente vive en `data-store\` (un `.txt` por empresa: `SAP_RESULT.txt`,
`SAP_PU_RESULT.txt`, `SAP_INDO_RESULT.txt`, más
`manifest.json`), que marca cada período (mes) de cada empresa como origen `sap` o `manual`:
una lectura de red nunca pisa un período `manual`, solo otro upload lo reemplaza. No hay
"restaurar desde SAP" — los originales quedan archivados en `sap-inbox\SAPResultProcesado\`
(nombre `<timestamp>_<origen>_<archivo>.txt`).

Nuevo endpoint `GET /api/download?empresa=TESI|PUEBLO|INDO` sirve el archivo vigente byte a byte
(mismo nombre original), para el circuito **Descargar files → ajustar a mano → Subir files**.
Verificado end-to-end el 28/07/2026 con TESI: hash de la descarga idéntico al de la red, edición
de un importe de 2026-06, upload, los 6 períodos pasaron a `manual`, y un refresh posterior no
los tocó (`traidos: []`, `preservados` los 6 meses) mientras PUEBLO sí se actualizó. Repetido el
31/07/2026 con INDO, con el mismo resultado (hash idéntico, ajuste conservado tras el refresh);
el estado de prueba se revirtió y hoy las tres empresas están en origen `sap`, 2026-01..2026-06.

Variables nuevas en el `.env`: `SAP_NETWORK_PATH` (fuente real) y `SAP_SOURCE_PATH` (inbox local
de uploads manuales — pese al nombre, ya no es "la fuente").

Tests: `node --test "tests/*.test.js"` desde `C:\apps\dashboards\EstadoResultado` (37 tests, el
glob va entre comillas). El usuario validó en el navegador (03/08/2026) la vista de INDO y sus
números contra el Excel de contabilidad. Sigue pendiente el resto del checklist visual (las 3
descargas simultáneas, punto ámbar de mes ajustado, consola sin errores) — no se puede hacer en
este entorno por falta de la extensión de Chrome.

---

## ControlAcceso — portería, ingreso/egreso de vehículos (jul 2026)

Servicio `dashcontrolacceso.exe`, puerto **3012** (solo loopback), carpeta `C:\apps\dashboards\ControlAcceso`.
Registrar en el portal (Administración → Dashboards, puerto 3012) para acceder vía `/d/{id}/`.

- Reemplaza la planilla `R RH O8-0 INGRESO Y EGRESO DE VEHÍCULOS.xlsx` (propios y no propios).
- **Login propio de la app** (además de la sesión del portal): tabla `tbl_CtrlAcceso_Usuarios` en `db_Cegid` @ 10.0.0.115, roles **PORTERO** (carga) y **ADMIN** (KPIs + ABM de vehículos/conductores/usuarios). Seed inicial `admin/admin` si la tabla está vacía — **cambiar la contraseña**.
- Tablas `tbl_CtrlAcceso_*` se crean solas al arrancar el servicio (idempotente).
- Gotcha: el SQL de 10.0.0.115 no soporta `LEAD` → los KPIs usan `CROSS APPLY` (detalle en el CLAUDE.md del dashboard).

## Particularidades / problemas resueltos (importante)

1. **El PORT lo fija el servicio** (variable de entorno) y tiene prioridad sobre el `PORT` del `.env`. Así se evitan choques (antes varios usaban el mismo puerto y solo arrancaba uno → `EADDRINUSE`).
2. **PM2 quedó descartado**: en Windows su auto-arranque depende de una sesión iniciada. Se usan servicios nativos (node-windows). Si reaparece un daemon de PM2: `pm2 kill`.
3. **comisiones-app**: es CommonJS (usa `require`) pero su `package.json` traía `"type": "module"` → fallaba con *"require is not defined in ES module scope"*. **Se quitó `"type": "module"`** y se renombró el entry a `server.cjs`. Además faltaba la dependencia `cors` (`npm install cors`).
4. **sucursal-user-visualizer**: el backend es TypeScript y se compila a **`dist-server\index.js`** (`npm run build:prod`). El servicio apunta a ese archivo, no a `server.js`. (La carpeta trae también un `nssm.exe`/`install-service.ps1` propios que NO se usan.)
5. **Restos de node-windows**: al borrar un servicio con `sc.exe delete`, queda la subcarpeta `daemon\` en la app y node-windows cree que "ya existe". Para reinstalar limpio: borrar esa carpeta `daemon\` primero.
6. **Red / iframe — proxy inverso (jul 2026)**: el navegador ya NO va directo a `http://10.0.0.118:PUERTO`. El portal actúa de **proxy inverso** (YARP `IHttpForwarder`, ver `Services/DashboardProxy.cs`): el iframe usa `/d/{id}/` y toda petición pasa por la sesión + permisos del portal antes de reenviarse a `127.0.0.1:{puerto}` (o al `Host` registrado). Las rutas absolutas de las apps (`/api/...`, `/assets/...`) se rutean por la cookie `DashboardPortal.ActiveDash` (fallback). Limitación conocida: no usar dos dashboards con requests simultáneas en pestañas distintas (la cookie apunta al último abierto).
7. **Acceso directo por puerto CERRADO vía binding a loopback (08/07/2026)**: el Firewall de Windows está **deshabilitado** en este server (los 3 perfiles), así que el cierre NO es por firewall: cada dashboard escucha en `127.0.0.1` (`app.listen(PORT, HOST)` con env `HOST`, default `127.0.0.1`). Verificado: `10.0.0.118:3001..3011` rechazan conexión, salvo **3003** que sigue en `0.0.0.0` porque los agentes remotos (sucursal/PassReset) reportan a `http://10.0.0.118:3003` (`CENTRAL_URL`; los agentes solo hacen push, el server nunca les inicia conexión). Diagnóstico local: `http://localhost:PUERTO` sigue funcionando.
8. **Comisiones INDO movido de 3005 a 3011 (08/07/2026)**: el conector `QvOdbcConnectorPackage` (QlikView Gateway) escucha en `127.0.0.1:3005` (restport) y capturaba el loopback. Se movió el dashboard al **3011** (env `PORT` en `ComisionesINDO\server\daemon\dashcomisionesindo.xml`) y se quitó el workaround `Host=10.0.0.118` del registro del portal. No reutilizar 3005.
7. **Login del portal aceptaba cualquier contraseña** (jul 2026): el SP real `SP_VALIDAR_INICIO_SESION_APPS` devuelve SIEMPRE una fila con una única columna **sin nombre** (`'ok'` o `'Acceso denegado!'`). La autodetección por nombre de columna no encontraba indicador y `TreatAnyRowAsSuccess=true` daba por válido cualquier login de usuario existente. **Fix**: `CorporateAuthService.cs` ahora usa el valor de la columna única como indicador (compara contra `SuccessValues`, que incluye `"ok"`), y `TreatAnyRowAsSuccess` pasó a `false` en `appsettings.json` (fuente y `C:\apps\portal`).

## Cómo agregar / reinstalar un dashboard

```powershell
# 1) (si reinstala) limpiar restos
sc.exe delete <nombreservicio>.exe   # el name real incluye .exe (ej: dashpromociones.exe)
Remove-Item C:\apps\dashboards\<carpeta>\daemon -Recurse -Force -ErrorAction SilentlyContinue

# 2) instalar el servicio  (4º arg opcional = archivo de entrada)
cd C:\apps\portal\deploy\dashboards
node install-dashboard-service.js "Dash-Nombre" "C:\apps\dashboards\<carpeta>" <PUERTO> ["entrada.js"]

# 3) registrar en el portal: http://10.0.0.118/  ->  Administración -> Dashboards  (con su PUERTO)
```

## Portal

- URL: **http://10.0.0.118/** · Master local: `admin` (cambiar la contraseña en `appsettings.json`).
- Login corporativo: valida contra `db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS` (SQL Server 10.0.0.115).
- Administración → Dashboards / Usuarios / Permisos / Configuración.
- Los dashboards consultan SQL Server por su cuenta vía su propio `.env` (paquete `mssql`).
