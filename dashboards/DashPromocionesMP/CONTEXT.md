# CONTEXT.md — DashPromocionesMP

## Propósito
Cruce de **ventas vs liquidaciones de MercadoPago** (TESI y PUEBLO). Muestra promociones, medios de pago, desglose por sucursal, cuotas y emisores. Conciliación entre lo vendido y lo acreditado por MP.

## Stack
- **Frontend**: React 19 + Vite 6.2.3 + TypeScript + Recharts + PapaParse
- **Backend**: Express (`server.js`) — ESM (`import/export`)
- **Puerto**: 3002
- **Servicio Windows**: `dashpromociones.exe`

## Fuentes de datos
- **SQL Server**: `10.0.0.115` / base `db_Cegid` — ventas (SP `sp_GrillaPromosMP`, sobre tabla `CGD_CONDCOM_OPERACION`)
- **FTP**: `c2490045.ferozo.com` — archivos de liquidación MercadoPago (descarga automática)
- **Credenciales**: en `.env` (no commitear)

## Datos de cliente en ventas (2026-07-23)
El CSV `CONDCOMER_OPERACIONES.CSV` (cargado por el SP `spCapturaCSVcegid` en la base `dw_vallejo`, server `10.0.0.115`) sumó 3 columnas: `DNI_CLIENTE`, `APE_CLIENTE`, `NOM_CLIENTE`. Se agregaron a:
- `tmpCGD_CONDCOM_OPERACION` y `CGD_CONDCOM_OPERACION` (ALTER TABLE, varchar nullable) — `spCapturaCSVcegid` usa `SELECT *` así que no necesitó cambios.
- `sp_GrillaPromosMP` (ALTER PROC) — ahora expone `DNI_CLIENTE`, `APE_CLIENTE`, `NOM_CLIENTE` al final del recordset.
- Frontend (`src/lib/data-processing.ts`): `Venta.dniCliente/apeCliente/nomCliente`, parseados en `parseVentas`.
- `App.tsx`: columna **"Cliente"** en la tabla de cruce (pestaña "cruce") y en el CSV exportable (`downloadCruceCsv`).

`server.js` no necesitó cambios: `/api/ventas` vuelca `Object.keys(rows[0])` dinámicamente, así que cualquier columna nueva del SP pasa sola al CSV.

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/ventas` | CSV de ventas desde SQL |
| GET | `/api/tesi` | CSV de MP TESI (descargado de FTP) |
| GET | `/api/pueblo` | CSV de MP PUEBLO (descargado de FTP) |
| GET | `/api/status` | Timestamps de última actualización |
| POST | `/api/refresh` | Forzar descarga de archivos FTP |

## Build
```powershell
npm run build        # genera dist/ (frontend)
```
El `server.js` sirve `dist/` y expone `/api/*`.

## Archivos clave
- `server.js` — servidor Express (ESM)
- `src/` — frontend React
- `.env` — credenciales SQL + FTP
- `import_local_csv.mjs` — utilidad para importar CSVs locales (uso manual)

## Gotchas
- Módulo ESM: usa `import`, no `require`. No agregar `"type":"commonjs"` al package.json.
- Los archivos descargados del FTP se cachean localmente; `/api/refresh` los fuerza a rebajar.
