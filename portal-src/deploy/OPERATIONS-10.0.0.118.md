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
    └── sucursal-user-visualizer\    Node/Express  → servicio "dashsucursal",    puerto 3003
```

> `\\10.0.0.118\apps` es el recurso compartido que apunta a `C:\apps`. En el server SIEMPRE usar la ruta **local `C:\apps\...`** (los servicios no deben referenciar rutas UNC).

## Servicios de Windows (todos con arranque automático)

| Servicio (Name real) | DisplayName | App / puerto | Entrada |
|---|---|---|---|
| `DashboardPortal` | Portal de Dashboards | portal .NET / **80** | DashboardPortal.exe |
| `dashcomisiones.exe` | Dash-Comisiones | comisiones-app / **3001** | `server.cjs` |
| `dashpromociones.exe` | Dash-Promociones | DashPromocionesMP / **3002** | `server.js` |
| `dashsucursal.exe` | Dash-Sucursal | sucursal-user-visualizer / **3003** | `dist-server\index.js` |

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
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 80,3001,3002,3003 | Format-Table LocalPort, OwningProcess

# Reiniciar / detener (nombre real con .exe)
Restart-Service dashcomisiones.exe
Stop-Service dashpromociones.exe

# Logs de cada dashboard (node-windows)
Get-Content C:\apps\dashboards\<carpeta>\daemon\<servicio>.err.log -Tail 30
```

## Particularidades / problemas resueltos (importante)

1. **El PORT lo fija el servicio** (variable de entorno) y tiene prioridad sobre el `PORT` del `.env`. Así se evitan choques (antes varios usaban el mismo puerto y solo arrancaba uno → `EADDRINUSE`).
2. **PM2 quedó descartado**: en Windows su auto-arranque depende de una sesión iniciada. Se usan servicios nativos (node-windows). Si reaparece un daemon de PM2: `pm2 kill`.
3. **comisiones-app**: es CommonJS (usa `require`) pero su `package.json` traía `"type": "module"` → fallaba con *"require is not defined in ES module scope"*. **Se quitó `"type": "module"`** y se renombró el entry a `server.cjs`. Además faltaba la dependencia `cors` (`npm install cors`).
4. **sucursal-user-visualizer**: el backend es TypeScript y se compila a **`dist-server\index.js`** (`npm run build:prod`). El servicio apunta a ese archivo, no a `server.js`. (La carpeta trae también un `nssm.exe`/`install-service.ps1` propios que NO se usan.)
5. **Restos de node-windows**: al borrar un servicio con `sc.exe delete`, queda la subcarpeta `daemon\` en la app y node-windows cree que "ya existe". Para reinstalar limpio: borrar esa carpeta `daemon\` primero.
6. **Red / iframe**: los dashboards escuchan en `0.0.0.0` y el firewall está abierto en 3001/3002/3003. El iframe lo carga el navegador del cliente, que va directo a `http://10.0.0.118:PUERTO`.

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
