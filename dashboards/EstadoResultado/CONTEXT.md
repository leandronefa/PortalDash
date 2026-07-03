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

## Vistas (tabs)
- **Resumen** (default): matriz P&L por sucursal estilo Excel contable — Ventas / Costo de Ventas / Margen Bruto / Gastos Directos / Contribución / Gastos Indirectos / Utilidad Neta, con filas de % y cuadro de totales.
  - Criterio de asignación (`buildMatrixPL` en `src/lib/data-processing.ts`): columnas = sucursales con ventas ≠ 0. **Gastos indirectos** = gastos de centros de costo (sucursales sin ventas) + registros sin sucursal + servicios centrales (4.2.002.02/03) + resultados financieros (4.2.004), **prorrateados por participación en ventas**. La suma de utilidades por sucursal cierra exacto con el resultado global.
  - Referencia visual: `foto.jpeg` (Excel de contabilidad). Los números del Excel no coinciden 1:1 porque contabilidad aplica ajustes manuales.
- **Estado de Resultado**: P&L por grupos de cuentas (colapsable).
- **Por Sucursal**: resumen por sucursal con desglose expandible.
- **Gráficos**: top gastos + ingresos vs gastos.

**Selector de mes**: en el header, control índigo con flechas `‹ mes ›` + desplegable. Los archivos SAP traen varios períodos (campo 5 `YYYY-MM`); siempre se visualiza **un mes a la vez** (default: el más reciente) y aplica a todas las pestañas.

> ⚠️ Tras cambiar `src/`, correr `npm run build` — el servicio sirve `dist/` desde disco (no hace falta reiniciar), pero un `dist` viejo hace que el navegador muestre features desactualizadas. Pedir Ctrl+F5 al usuario tras un deploy.

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
