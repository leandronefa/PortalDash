# CLAUDE.md — DashPromocionesMP (Promociones VS Medios Pago)

## Qué es
Dashboard de cruce **ventas vs liquidaciones de MercadoPago** (TESI y PUEBLO): promociones, medios de pago, desglose por sucursal, cuotas y emisores. Frontend React 19 + Vite + TypeScript (Recharts, PapaParse); backend Express en `server.js` (**ESM**, usa `import`) que sirve `dist/` y expone `/api/*`.

## Servicio y acceso
- Servicio de Windows: **`dashpromociones.exe`** (node-windows), puerto **3002**, entrada `server.js`.
- **Los usuarios acceden SOLO vía el portal**: `http://10.0.0.118/d/4/` (proxy inverso con sesión y permisos). El puerto 3002 directo es solo para diagnóstico local en el server.
- Operación:
  ```powershell
  Restart-Service dashpromociones.exe
  Get-Content C:\apps\dashboards\DashPromocionesMP\daemon\dashpromociones.err.log -Tail 30
  # Diagnóstico en primer plano (Ctrl+C para cortar):
  cd C:\apps\dashboards\DashPromocionesMP; $env:PORT=3002; node server.js
  ```

## Fuentes de datos
- **SQL Server** `10.0.0.115` / base `db_Cegid` (ventas) vía `mssql`. SP `sp_GrillaPromosMP` sobre `CGD_CONDCOM_OPERACION`. Desde 2026-07-23 incluye `DNI_CLIENTE`/`APE_CLIENTE`/`NOM_CLIENTE` (cargados por `spCapturaCSVcegid` en `dw_vallejo` desde `CONDCOMER_OPERACIONES.CSV`); se muestran como columna "Cliente" en la pestaña "cruce" del frontend.
- `sp_ReporteVentasHistorico` (endpoint `/api/reporte-ventas-historico`, sobre `dw_vallejo.f_vta_cabecera`) también expone desde 2026-07-24 `DNI_CLIENTE`/`APE_CLIENTE`/`NOM_CLIENTE`, cruzando por sucursal+ticket contra `CGD_CONDCOM_OPERACION` (solo ventas con promo) y `Vta_cab_HORA` (fallback de nombre para el resto). Ver detalle de los joins en `CONTEXT.md`.
- **FTP** `c2490045.ferozo.com` (FTPS): archivos CSV de liquidación MP; descarga automática con caché local; `POST /api/refresh` fuerza la rebaja.
- Endpoints: `GET /api/ventas`, `/api/tesi`, `/api/pueblo`, `/api/status`; `POST /api/refresh`.
- Credenciales en `.env` (NO commitear ni mostrar valores). Variables: `PORT`, `SQL_HOST`, `SQL_USER`, `SQL_PASS`, `SQL_DB`, `FTP_HOST`, `FTP_USER`, `FTP_PASS`, `FTP_PATH`, `CACHE_TTL_MS`, `REFRESH_HOUR`.

## Desarrollo / build
```powershell
npm run build   # genera dist/ (frontend); luego Restart-Service dashpromociones.exe
npm run lint    # tsc --noEmit
```

## Estructura
- `server.js` — servidor Express (ESM): API, SQL, FTP, caché en memoria.
- `src/` — frontend React; `dist/` — build servido por Express.
- `import_local_csv.mjs` — importar CSVs locales a mano.
- `daemon/` — logs y wrapper de node-windows.
- `.env` / `.env.example` — configuración (secretos en `.env`).

## Gotchas
- ESM puro: `import`, no `require`. No agregar `"type":"commonjs"` ni quitar `"type":"module"` del package.json.
- El `PORT` que fija el servicio pisa al del `.env`; el default en código es 3005 → en producción debe correr con `PORT=3002`.
- Falta `dist/` → pantalla en blanco: correr `npm run build`.
- El README.md es plantilla de AI Studio, no describe este proyecto; el contexto real está en `CONTEXT.md`.
