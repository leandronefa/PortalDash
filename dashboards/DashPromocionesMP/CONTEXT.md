# CONTEXT.md — DashPromocionesMP

## Propósito
Cruce de **ventas vs liquidaciones de MercadoPago** (TESI y PUEBLO). Muestra promociones, medios de pago, desglose por sucursal, cuotas y emisores. Conciliación entre lo vendido y lo acreditado por MP.

## Stack
- **Frontend**: React 19 + Vite 6.2.3 + TypeScript + Recharts + PapaParse
- **Backend**: Express (`server.js`) — ESM (`import/export`)
- **Puerto**: 3002
- **Servicio Windows**: `dashpromociones.exe`

## Fuentes de datos
- **SQL Server**: `10.0.0.115` / base `db_Cegid` — ventas
- **FTP**: `c2490045.ferozo.com` — archivos de liquidación MercadoPago (descarga automática)
- **Credenciales**: en `.env` (no commitear)

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
