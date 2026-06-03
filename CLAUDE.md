# CLAUDE.md — Raíz de operación (servidor 10.0.0.118)

> COPIAR ESTE ARCHIVO A:  `C:\apps\CLAUDE.md`
> Es el contexto raíz. Claude Code lo lee al iniciar y toma los `CLAUDE.md` anidados (`portal-src\`, `dashboards\`) al entrar en cada carpeta.

Estás operando **en el servidor 10.0.0.118** (host SERVERAPP). Esta carpeta `C:\apps` se comparte como `\\10.0.0.118\apps`, pero **acá siempre usá rutas locales `C:\apps\...`** (los servicios no deben referenciar rutas UNC).

## Árbol

```
C:\apps\
├── CLAUDE.md            ← este archivo (raíz)
├── portal\              Portal de Dashboards desplegado (.NET 9). Servicio "DashboardPortal", puerto 80.
│   └── deploy\          scripts de instalación (portal y dashboards)
├── portal-src\          CÓDIGO FUENTE + documentación del portal (CLAUDE.md, CONTEXT.md, OPERATIONS, etc.)
└── dashboards\          Dashboards Node.js (ver su propio CLAUDE.md). Servicios dashcomisiones/promociones/sucursal.
```

## Leer primero (contexto profundo)

- `C:\apps\portal-src\deploy\OPERATIONS-10.0.0.118.md` → **estado real de la instalación** (servicios, puertos, problemas resueltos).
- `C:\apps\portal-src\CLAUDE.md` → guía del proyecto portal (build/run, gotchas).
- `C:\apps\portal-src\CONTEXT.md` → contexto completo del portal.
- `C:\apps\dashboards\CLAUDE.md` → operación y particularidades de cada dashboard.

## Servicios (resumen)

| Servicio (Name real) | Puerto | Carpeta |
|---|---|---|
| `DashboardPortal` | 80 | `C:\apps\portal` |
| `dashcomisiones.exe` | 3001 | `C:\apps\dashboards\comisiones-app` |
| `dashpromociones.exe` | 3002 | `C:\apps\dashboards\DashPromocionesMP` |
| `dashsucursal.exe` | 3003 | `C:\apps\dashboards\sucursal-user-visualizer` |

```powershell
Get-Service | Where-Object DisplayName -like 'Dash-*' | ft Name,DisplayName,Status
Get-Service DashboardPortal
Get-NetTCPConnection -State Listen | ? LocalPort -in 80,3001,3002,3003 | ft LocalPort,OwningProcess
```

## Reglas de oro

- **Pedir confirmación antes de cualquier operación destructiva** (borrar/reinstalar servicios, `sc.exe delete`, borrar `App_Data`, sobrescribir `.env`).
- Rutas **locales** `C:\apps\...`, nunca UNC.
- Los nombres reales de servicio (node-windows) llevan sufijo `.exe`: `dashcomisiones.exe`, `dashpromociones.exe`, `dashsucursal.exe`. `Get-Service Dash-*` NO los encuentra; usar `Get-Service dash*` o el nombre completo.
- No exponer/commitear secretos: `C:\apps\portal\appsettings.json` (clave de SQL) y los `.env` de cada dashboard.
- Tras cambios en la instalación, actualizar `portal-src\deploy\OPERATIONS-10.0.0.118.md`.
