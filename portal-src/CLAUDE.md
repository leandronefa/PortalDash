# CLAUDE.md — Guía para Claude Code

Guía operativa de este proyecto. Léela antes de actuar. Para detalle profundo: `CONTEXT.md` (portal) y `deploy/OPERATIONS-10.0.0.118.md` (estado del server).

## Qué es

**Portal de Dashboards**: app **ASP.NET Core 9 / Razor Pages** que centraliza el acceso a dashboards Node.js alojados en distintos puertos del mismo server. Login corporativo vía Stored Procedure de SQL Server + usuario Master local. BD propia en **SQLite** (`App_Data/portal.db`).

**El login NO valida contra usuarios de Windows/AD** (31/08/2026, corrección de un supuesto previo): `CorporateAuthService` llama a `db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS` (ver `appsettings.json` → `CorporateAuth`), que a su vez valida contra una tabla mantenida a mano, **`USUARIOS_APPS`** — no se confirmó en qué base vive exactamente (no está en `db_Cegid`; un intento de buscarla en todas las bases fue bloqueado por el clasificador de seguridad de Claude Code). Dar de alta a alguien nuevo en `portal.db` (`Users`/`Permissions`, vía Administración o script) **no alcanza** para que pueda loguearse si no tiene ya una fila en `USUARIOS_APPS` — eso se carga aparte, a mano, directo por SQL.

- Código: `Program.cs`, `Services/`, `Pages/`, `Data/`, `Models/`.
- Docs: `README.md`, `ARCHITECTURE.md`, `INSTALL-SERVER.md`, `DEPLOY.md`, `CONTEXT.md`.
- Despliegue: `deploy/` (portal) y `deploy/dashboards/` (dashboards Node como servicios).

## Desarrollo

```powershell
dotnet build DashboardPortal.csproj -c Release   # compilar (debe dar 0 errores)
dotnet run                                        # dev → http://localhost:5080  (admin/admin)
.\deploy\publish.ps1 -Output C:\publish\DashboardPortal   # publicar (self-contained + carpeta deploy)
```

- Tras editar el modelo de datos: el esquema se crea con `EnsureCreated()`. En dev, borrar `App_Data/portal.db` regenera. (No hay EF Migrations.)
- Validar siempre con `dotnet build` antes de dar por terminado un cambio de código.

## Servidor de producción: 10.0.0.118

Portal en `http://10.0.0.118/` (puerto 80). Layout local: `C:\apps\portal` (portal .NET) y `C:\apps\dashboards\*` (dashboards). **Usar rutas locales `C:\apps\...`, nunca UNC `\\10.0.0.118\...`.**

Servicios (Windows, auto-arranque). **node-windows crea los servicios con sufijo `.exe`** — `Get-Service Dash-*` NO los encuentra. Usar `Get-Service dash*` o el nombre exacto:

| Servicio (Name real) | App | Puerto | Entrada |
|---|---|---|---|
| `DashboardPortal` | portal .NET | 80 | DashboardPortal.exe |
| `dashcomisiones.exe` | comisiones-app | 3001 | `server.cjs` |
| `dashpromociones.exe` | DashPromocionesMP | 3002 | `server.js` |
| `dashsucursal.exe` | sucursal-user-visualizer | 3003 | `dist-server\index.js` |

```powershell
# estado
Get-Service | Where-Object DisplayName -like 'Dash-*' | ft Name,DisplayName,Status
Get-NetTCPConnection -State Listen | ? LocalPort -in 80,3001,3002,3003 | ft LocalPort,OwningProcess
# manejar (nombre real con .exe)
Restart-Service dashpromociones.exe ; Stop-Service dashcomisiones.exe
# logs de un dashboard
Get-Content C:\apps\dashboards\<carpeta>\daemon\<servicio>.err.log -Tail 30
# instalar/reinstalar un dashboard
cd C:\apps\portal\deploy\dashboards
node install-dashboard-service.js "Dash-Nombre" "C:\apps\dashboards\<carpeta>" <PUERTO> ["entrada.js"]
```

## Gotchas (ya nos pasaron)

- **Puerto del servicio** (env `PORT`) pisa el del `.env` → asignar uno único por dashboard evita `EADDRINUSE`.
- **node-windows deja carpeta `daemon\`** al borrar con `sc.exe delete` → para reinstalar limpio, borrar `C:\apps\dashboards\<app>\daemon` primero.
- **`comisiones-app`** es CommonJS pero tenía `"type":"module"` → se quitó esa línea del `package.json`; entrada `server.cjs`; requería `npm install cors`.
- **`sucursal-user-visualizer`** compila el backend a `dist-server\index.js` (`npm run build:prod`); no usa `server.js`.
- **PM2 descartado** en Windows (su autostart depende de sesión). Si reaparece: `pm2 kill`.
- **Kestrel**: el puerto 80 vive en `appsettings.Production.json` (no en el base) porque `Kestrel:Endpoints` pisa a `--urls`. No reintroducir `Kestrel` en `appsettings.json`.
- **Proxy inverso (jul 2026)**: el iframe usa `/d/{id}/` — el portal proxya hacia `127.0.0.1:{puerto}` con sesión + permisos (`Services/DashboardProxy.cs`, YARP). Rutas absolutas de las apps (`/api`, `/assets`) se rutean por la cookie `DashboardPortal.ActiveDash`.
- **Los dashboards escuchan solo en `127.0.0.1`** (08/07/2026) — el acceso directo `10.0.0.118:puerto` está cerrado por binding (el firewall del server está deshabilitado). Excepción: 3003 en `0.0.0.0` (agentes remotos). Comisiones INDO corre en el **3011** (Qlik ocupa `127.0.0.1:3005`).

## Reglas

- **Pedir confirmación antes de operaciones destructivas** en el server (borrar/reinstalar servicios, `sc.exe delete`, borrar `App_Data`).
- No exponer ni commitear secretos: `appsettings.json` tiene la contraseña de SQL (sa) y cada dashboard su `.env`.
- No cambiar puertos sin actualizar también el registro del dashboard en el portal (Administración → Dashboards).
- Para diagnosticar un dashboard que no arranca: correrlo en primer plano (`cd <app>; $env:PORT=<p>; node <entrada>`) para ver el error real.
- Mantener este archivo y `deploy/OPERATIONS-10.0.0.118.md` actualizados si cambia la instalación.
