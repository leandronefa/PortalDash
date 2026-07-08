# Dashboards Node.js como servicios de Windows

> **ACTUALIZACIÓN jul 2026**: el portal es **proxy inverso** (`/d/{id}/`) — los dashboards nuevos deben escuchar en **`127.0.0.1`** (`app.listen(PORT, process.env.HOST || '127.0.0.1')`), NO en `0.0.0.0`, y **no** hay que abrir el firewall por puerto. Probarlos vía el portal (`http://10.0.0.118/d/{id}/`) o `http://localhost:PUERTO` desde el server, no desde otra PC. Las menciones a `0.0.0.0` / firewall / URL directa de abajo son del esquema anterior.

Tus dashboards son apps **Node.js (Express + Vite/React)** tipo `DashPromocionesMP`: un `server.js` que escucha en `PORT` (hoy solo loopback), sirve la carpeta `dist` y consulta SQL Server (`mssql`).

Esta carpeta los registra como **servicios de Windows** con **arranque automático** (sin depender de que alguien inicie sesión) y **reinicio ante caídas** — el mismo modelo que el portal.

> ¿Por qué no PM2? En Windows, el auto-arranque de PM2 depende de una sesión de usuario iniciada. Para un servidor que se reinicia solo, un Servicio de Windows es lo correcto.

---

## Requisitos

- **Node.js** instalado en el servidor (en el PATH del sistema). Verifique: `node --version`.
- Cada dashboard copiado **completo** a su carpeta (incluyendo `node_modules` y `dist`). Si no copió `dist`/`node_modules`, en cada carpeta ejecute una vez: `npm install` y `npm run build`.
- Cada dashboard con su archivo **`.env`** (config de SQL/FTP) en su carpeta.

---

## Paso 1 — Unificar carpetas en `C:`

```
C:\apps\dashboards\
├── promociones\   (server.js, dist, node_modules, .env)
├── rrhh\
└── finanzas\
```

## Paso 2 — Asignar un puerto distinto a cada uno

Los puertos los define el **servicio** (variable `PORT`), y tiene prioridad sobre el `PORT` del `.env`. Sugerencia:

| Dashboard | Puerto |
|---|---|
| promociones | 3005 |
| rrhh | 3006 |
| finanzas | 3007 |

(Pueden ser los que ya usan; solo deben ser únicos.)

## Paso 3 — Editar la lista en `install-all.ps1`

Abra `install-all.ps1` y ajuste el bloque `$dashboards` con sus nombres, rutas y puertos reales.

## Paso 4 — Instalar (en el servidor, PowerShell como Administrador)

```powershell
cd C:\apps\portal\deploy\dashboards     # o donde haya copiado esta carpeta
.\install-all.ps1
```

El script: instala `node-windows`, abre el firewall de cada puerto y crea+inicia un servicio por dashboard.

Verifique:

```powershell
Get-Service Dash-*
```

Pruebe cada uno desde **otra PC**: `http://10.0.0.118:3005`, `:3006`, `:3007`.

## Paso 5 — Registrar en el portal

En el portal (**Administración → Dashboards → + Nuevo**), cree cada dashboard con su **puerto**. La URL queda `http://10.0.0.118:3005`, etc.

---

## Administración

| Acción | Comando |
|---|---|
| Estado | `Get-Service Dash-*` |
| Reiniciar | `Restart-Service Dash-Promociones` |
| Detener | `Stop-Service Dash-Promociones` |
| Desinstalar uno | `node uninstall-dashboard-service.js "Dash-Promociones" "C:\apps\dashboards\promociones"` |

- Los servicios corren como **LocalSystem**; la conexión a SQL Server usa las credenciales del `.env` (autenticación SQL), así que funciona sin problemas.
- Logs: cada servicio genera un `*.out.log` / `*.err.log` en la carpeta del dashboard (los crea node-windows), y aparece en *Visor de eventos → Aplicación*.
