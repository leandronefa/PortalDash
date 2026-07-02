# CONTEXT.md — EstadoResultado

## Propósito
Estado de Resultado (**P&L mensual**) para TESI y PUEBLO. Lee archivos exportados desde SAP, los procesa y muestra desglose por sucursal con comparación entre empresas.

## Stack
- **Frontend**: React 19 + Vite 6.2.3 + TypeScript
- **Backend**: Express (`server.js`) — ESM (`import/export`)
- **Puerto**: 3008
- **Servicio Windows**: pendiente de registrar

## Fuentes de datos
- **Archivos SAP** en ruta de red `\\10.0.0.115\Cegid`:
  - `SAP_RESULT.txt` → TESI
  - `SAP_PU_RESULT.txt` → PUEBLO
  - Formato: pipe-delimited
- Los archivos se archivan en `SAPResultProcesado/` tras la lectura
- **Caché local**: `data-cache/latest.json`

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/data?empresa=TESI\|PUEBLO` | Datos con caché |
| GET | `/api/status` | Estado del último chequeo |
| POST | `/api/refresh` | Forzar chequeo inmediato de archivos SAP |

## Refresh automático
- Chequeo diario automático a las **01:00 AM** (configurable con `CHECK_HOUR` en `.env`)
- Si el archivo SAP está presente, lo procesa y actualiza el caché
- Si no hay archivo nuevo, sirve el caché anterior

## Build
```powershell
npm run build        # genera dist/
```

## Archivos clave
- `server.js` — servidor Express (ESM)
- `src/` — frontend React
- `data-cache/latest.json` — caché de último procesamiento
- `SAPResultProcesado/` — archivos SAP ya procesados (archivo histórico)
- `.env` — `SAP_SOURCE_PATH`, `CHECK_HOUR`

## Gotchas
- El servicio corre como SYSTEM → no puede acceder rutas UNC directamente. La ruta `SAP_SOURCE_PATH` debe ser accesible para SYSTEM o usar una unidad mapeada de forma persistente.
- Los archivos SAP se **mueven** a `SAPResultProcesado/` tras procesarse; si hay que reprocesar, moverlos de vuelta.
- Módulo ESM: no usar `require()`.
