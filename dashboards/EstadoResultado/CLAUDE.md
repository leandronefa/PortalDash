# CLAUDE.md — EstadoResultado

## Qué es
Dashboard **Estado de Resultado**: P&L mensual de TESI y PUEBLO a partir de archivos exportados desde SAP (pipe-delimited). Frontend React 19 + Vite + TypeScript; backend Express en `server.js` (**ESM**, no usar `require()`). Contexto profundo: `CONTEXT.md`.

## Servicio y acceso
- Servicio de Windows: **`dashestadoresultado.exe`** (node-windows), puerto **3008**, entrada `server.js`.
- **Los usuarios acceden SOLO vía el portal**: `http://10.0.0.118/d/11/` (proxy inverso con sesión y permisos). El puerto 3008 directo queda solo para diagnóstico local.
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\EstadoResultado; $env:PORT=3008; node server.js
  ```
- Logs del servicio: `daemon\dashestadoresultado.err.log`.
- `.env` (solo nombres, no exponer valores): `PORT`, `SAP_SOURCE_PATH`, `CHECK_HOUR`.

## Flujo de datos SAP (MUY IMPORTANTE)
El servicio corre como **SYSTEM y NO accede a rutas UNC**. Por eso usa un inbox local:
`SAP_SOURCE_PATH=C:\apps\dashboards\EstadoResultado\sap-inbox`

Flujo mensual:
1. Copiar `SAP_PU_RESULT.txt` (PUEBLO) y `SAP_RESULT.txt` (TESI) desde `\\10.0.0.115\Cegid\` al inbox.
2. `POST http://localhost:3008/api/refresh` para forzar el procesamiento.
3. Verificar con `GET /api/status`.

Los archivos procesados se **mueven** a `sap-inbox\SAPResultProcesado\` (para reprocesar, moverlos de vuelta al inbox). Además hay un chequeo automático diario a la **01:00** (`CHECK_HOUR`). Si no hay archivo nuevo, sirve el caché `data-cache/latest.json`.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/data?empresa=TESI\|PUEBLO` | Datos con caché |
| GET | `/api/status` | Estado del último chequeo |
| POST | `/api/refresh` | Forzar chequeo inmediato |

## Estructura
- `server.js` — Express (ESM); lectura del inbox, parseo, caché y scheduler.
- `src/` — frontend React (vistas Resumen, Estado de Resultado, Por Sucursal, Gráficos; `src/lib/data-processing.ts` con `buildMatrixPL`).
- `dist/` — build servido por el servicio (`npm run build`).
- `data-cache/latest.json` — caché del último procesamiento.
- `sap-inbox\` — inbox local; `sap-inbox\SAPResultProcesado\` archivo histórico.
- `.env` / `.env.example`.

## Gotchas
- Tras cambiar `src/`, correr `npm run build`: el servicio sirve `dist/` desde disco (no hace falta reiniciar), pero un `dist` viejo muestra features desactualizadas → pedir Ctrl+F5 al usuario tras un deploy.
- El `PORT` que inyecta el servicio pisa al del `.env`; mantener 3008 único.
- Los archivos SAP traen varios períodos (campo 5 `YYYY-MM`); la UI muestra un mes a la vez (selector en el header, default el más reciente).
- No commitear `.env` ni exponer sus valores.
- Pedir confirmación antes de reinstalar el servicio o tocar `.env` (regla de `C:\apps\dashboards\CLAUDE.md`).
