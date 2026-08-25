# CLAUDE.md — Dashboards Node.js (servidor 10.0.0.118)

> COPIAR ESTE ARCHIVO A:  `C:\apps\dashboards\CLAUDE.md`
> Contexto anidado: aplica al trabajar dentro de `C:\apps\dashboards`.

Cada dashboard es una app **Node.js / Express** (sirve un frontend Vite/React desde `dist` y consulta SQL Server con `mssql` vía su propio `.env`). Corren como **servicios de Windows** creados con `node-windows`, con arranque automático y reinicio.

## Acceso de usuarios: SOLO vía el portal (proxy inverso)

Desde jul 2026 los usuarios **no** acceden por `http://10.0.0.118:PUERTO`: el portal (puerto 80) actúa de **proxy inverso** con sesión y permisos, y cada dashboard se abre en `http://10.0.0.118/d/{id}/` (columna "Proxy" de la tabla). El puerto directo queda solo para diagnóstico local en el server. Cada carpeta tiene su propio `CLAUDE.md` con el detalle de la app.

## Mapa

| Carpeta | Servicio (Name real) | Puerto | Proxy | Entrada | Notas |
|---|---|---|---|---|---|
| `comisiones-app` | `dashcomisiones.exe` | 3001 | `/d/5/` | `server.cjs` | CommonJS; se quitó `"type":"module"` del package.json; requiere `cors`. |
| `DashPromocionesMP` | `dashpromociones.exe` | 3002 | `/d/4/` | `server.js` | ESM (usa `import`). Funciona tal cual. |
| `sucursal-user-visualizer` | `dashsucursal.exe` | 3003 | `/d/6/` | `dist-server\index.js` | Backend TS compilado con `npm run build:prod`. Los agentes remotos pegan directo a `:3003` (CentralUrl). |
| `MovimientosCaja` | `dashmovimientoscaja.exe` | 3004 | `/d/7/` | ver package.json | Movimientos de Caja INDO. |
| `ComisionesINDO` | `dashcomisionesindo.exe` | 3011 | `/d/8/` | `server\index.js` | Antes 3005; se movió porque Qlik (`QvOdbcConnectorPackage`) ocupa `127.0.0.1:3005`. |
| `ConciliacionPunitorios` | `dashconciliacionpunitorios.exe` | 3006 | `/d/9/` | ver package.json | Conciliación de punitorios. |
| `ValidacionCobranzas` | `dashvalidacioncobranzas.exe` | 3007 | `/d/10/` | `server.cjs` | Concilia 1167 vs Libro Mayor. |
| `EstadoResultado` | `dashestadoresultado.exe` | 3008 | `/d/11/` | `server.js` | Refresh lee `\\10.0.0.115\Cegid` (read-only); `sap-inbox\` es solo para uploads manuales. |
| `PassReset` | `dashpassreset.exe` | 3009 | `/d/12/` | `server.cjs` | Rotación de contraseñas Windows; agentes en servidores remotos. |
| `DashMeLi` | `dashmeli.exe` | 3010 | `/d/13/` | `server.js` | Stock dep. 198/199 + MercadoLibre; tokens OAuth se renuevan solos. |
| `ControlAcceso` | `dashcontrolacceso.exe` | 3012 | `/d/14/` | `server.cjs` | Portería: ingreso/egreso de vehículos. Login propio con roles PORTERO/ADMIN. |
| `APCWeb` | `dashapcweb` | 3013 | `/d/15/` | `publish\APCWeb.exe` | **ASP.NET Core 9** (no Node). Versión web de `C:\apps\ActualizarPreciosCostos` (Desktop intocable; objetos SQL propios `APCWeb_`). Login contra `SP_VALIDAR_INICIO_SESION_APPS`. Exports UNC requieren cuenta de servicio con permisos (LocalSystem no escribe en `\\vmapp...`). Ver `APCWeb\CLAUDE.md`. |
| `ControlCaja` | `dashcontrolcaja.exe` | 3014 | `/d/16/` | `server.js` | Solo lectura de `SAP_REPORTE_Z` / `SAP_PU_REPORTE_Z` en `\\10.0.0.115\Cegid`: matriz sucursal × día de Diferencias de Caja. Sin uploads ni store. |
| `tablero-objetivos-web` | `dashtableroobjetivos.exe` | 3012 | *(pendiente de alta)* | `server\server.js` | Objetivos Sucursal — port web de `TABLERO OBJETIVO SUCURSALES OLD.qvw` (hoja SH23). Reusa el puerto 3012 liberado por ControlAcceso. **Conectado a SQL Server real** (10.0.0.115, base **dw_vallejo** — no "TABLEROS"; sa/ver `.env`, sin TLS). Falta validar los números contra el `.qvw` y dar de alta en Portal → Administración → Dashboards. Ver `DEPLOY.md`, `README.md` y `server/consultas.js` (mapeo real + aproximaciones marcadas). |
| `VentaObjetivo` | `dashventaobjetivo.exe` | 3016 | `/d/18/` | `server\server.js` | Ventas Comparativas — port web de `VENTASCOMPARATIVAS.qvw`: 5 pivots Año×Mes (Ventas/Operaciones/Unidades/Tkt Prom/Uni x Cli) desde `TABLEROS.dbo.GrillaVentasComparativas` (meses cerrados) + `dw_vallejo.f_objetivos` bridgeado vía `l_sucursal` para el mes en curso (resaltado, sin cerrar). Además, **carga de objetivos del mes siguiente**: columna editable inline por sucursal (Uni x Cli/Tkt Prom/Operaciones → Unidades/Venta $ calculados), borrador local en `data-store/` hasta guardar (INSERT/UPDATE transaccional a `f_objetivos`, por empresa o red completa). "Calzados 01" no carga objetivo (deshabilitada a pedido); "Calz SJ LIQUIDACION" excluida de todo el tablero. Ver `server/consultas.js` y `extraido-del-qvw/` (layout recuperado del `.qvw`, formato binario propietario). |

## Operación

```powershell
# estado / escucha
Get-Service dash* | ft Name,Status
Get-NetTCPConnection -State Listen | ? LocalPort -in 3001,3002,3003 | ft LocalPort,OwningProcess

# reiniciar / detener (nombre real, con sufijo .exe)
Restart-Service dashpromociones.exe
Stop-Service dashcomisiones.exe

# ver el error de uno que falla (log de node-windows)
Get-Content C:\apps\dashboards\<carpeta>\daemon\<servicio>.err.log -Tail 30

# diagnóstico en primer plano (muestra el error real al instante; Ctrl+C para cortar)
cd C:\apps\dashboards\<carpeta>
$env:PORT=<puerto> ; node <entrada>     # ej: node server.cjs  /  node server.js  /  node dist-server\index.js
```

## Instalar / reinstalar un dashboard como servicio

```powershell
# 1) limpiar restos (si reinstala) — node-windows deja la carpeta daemon\
sc.exe delete <servicio>.exe 2>$null   # el name real incluye .exe (ej: dashpromociones.exe)
Remove-Item C:\apps\dashboards\<carpeta>\daemon -Recurse -Force -ErrorAction SilentlyContinue

# 2) instalar (4º arg opcional = archivo de entrada; por defecto server.js)
cd C:\apps\portal\deploy\dashboards
node install-dashboard-service.js "Dash-Nombre" "C:\apps\dashboards\<carpeta>" <PUERTO> ["entrada.js"]

# 3) registrar/ajustar en el portal: http://10.0.0.118/  → Administración → Dashboards (con su PUERTO)
```

## Gotchas

- **El `PORT` del servicio pisa al del `.env`** → cada dashboard con puerto único evita `EADDRINUSE`.
- Si `node-windows` dice **"ya existe"** pero `Get-Service` no lo muestra → quedó la carpeta `daemon\`; borrarla y reinstalar.
- App CommonJS (`require`) con `"type":"module"` en package.json → error *"require is not defined in ES module scope"*. Solución: quitar esa línea del package.json (o renombrar a `.cjs`).
- Falta `dist` → pantalla en blanco (correr `npm run build`). Falta `dist-server` (apps con backend TS) → `npm run build:prod`.
- `Cannot find module 'X'` → `npm install X` en la carpeta de la app.
- **PM2 no se usa** (en Windows su autostart depende de sesión iniciada). Si reaparece un daemon: `pm2 kill`.
- **Bind a loopback (jul 2026)**: todos los dashboards escuchan en `127.0.0.1` (env `HOST` en el `listen` de cada entrada; default `127.0.0.1`) — el acceso directo por `10.0.0.118:puerto` está cerrado; solo entra el proxy del portal. **Excepción: `sucursal-user-visualizer` (3003) escucha en `0.0.0.0`** porque los agentes remotos le reportan directo (`CENTRAL_URL`). El Firewall de Windows está deshabilitado en este server; el cierre es por binding, no por firewall.

## Regla

Pedir confirmación antes de borrar/reinstalar servicios o tocar archivos `.env`.
