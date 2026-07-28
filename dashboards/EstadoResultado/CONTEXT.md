# CONTEXT.md — EstadoResultado

## Propósito
Estado de Resultado (**P&L mensual**) para TESI y PUEBLO. Lee archivos exportados desde SAP, los procesa y muestra desglose por sucursal con comparación entre empresas.

## Stack
- **Frontend**: React 19 + Vite 6.2.3 + TypeScript
- **Backend**: Express (`server.js`) — ESM (`import/export`)
- **Puerto**: 3008
- **Servicio Windows**: `dashestadoresultado.exe`, puerto 3008

## Fuentes de datos
- **Archivos SAP** en ruta de red `\\10.0.0.115\Cegid` (read-only, `SAP_NETWORK_PATH`):
  - `SAP_RESULT.txt` → TESI
  - `SAP_PU_RESULT.txt` → PUEBLO
  - Formato: pipe-delimited
- Los archivos leídos se archivan en `sap-inbox\SAPResultProcesado\` con timestamp
- **Estado vigente**: `data-store\SAP_RESULT.txt`, `SAP_PU_RESULT.txt` y `manifest.json`

## Modelo de datos: el mes, no el archivo

Los archivos SAP son **acumulativos** (un solo `.txt` trae varios meses en bloques contiguos
ordenados). Cada período de cada empresa tiene un origen registrado en
`data-store\manifest.json`: `sap` (vino de la red) o `manual` (lo subió un usuario con
ajustes contables).

Regla central: **una lectura de red nunca sobrescribe un período `manual`.** Solo otro upload
lo reemplaza. Así el circuito descargar → ajustar → subir no pierde el trabajo manual cuando
alguien aprieta Actualizar, y los meses nuevos de SAP entran igual.

No se implementó "restaurar un mes desde SAP" (decisión explícita): si hiciera falta, los
originales están en `sap-inbox\SAPResultProcesado\`.

`readManifest()` falla de forma ruidosa a propósito si: el `manifest.json` existe pero no
parsea; falta el manifest pero hay archivos vigentes; o el JSON parsea pero no es un objeto
plano. Devolver un manifest vacío en esos casos sería indistinguible de una primera corrida, y
la siguiente lectura de red pisaría todos los meses con ajustes manuales sin ningún aviso. El
único caso legítimo de manifest vacío es no tener manifest **ni** vigentes. Cuando el manifest
queda en ese estado de error, `GET /api/status` responde `200` con `manifest: null` y
`manifestError`, y el refresh se aborta en vez de avanzar.

`checkAndLoad` (refresh de red) y el procesamiento de `/api/upload` comparten un mutex de
escritura: si un upload llega mientras corre un refresh, se rechaza con **409** y el archivo se
borra del inbox, para que el usuario reintente sin restos. `isRefreshing` en `/api/status`
refleja solo el refresh de red.

El archivado a `sap-inbox\SAPResultProcesado\` usa el nombre
`<timestamp>_<origen>_<archivo>.txt` (`<origen>` = `sap` o `manual`) — esa marca es la que evita
que la migración del primer arranque resiembre un ajuste manual como si fuera de SAP. Además se
saltea el archivado si el contenido no cambió respecto del último de esa empresa (evita cientos
de copias idénticas al año).

## Igualdad byte a byte

`data-store\SAP_RESULT.txt` / `SAP_PU_RESULT.txt` son el estado vigente y también lo que
entrega `GET /api/download`. Se reconstruyen concatenando **líneas textuales** por período
(`server/sap-format.js`), con CRLF y CRLF final, sin BOM. Los importes de SAP vienen como
`.00` y `-107029809.47`: regenerarlos desde `parseFloat` daría `0.00` y rompería el circuito,
porque el usuario edita ese mismo archivo y lo devuelve.

## Vistas (tabs)
- **Resumen** (default): P&L por sucursal estilo Excel contable, **sucursales como filas** ordenadas por ventas desc. Columnas: Ventas / % participación / Costo de Ventas / Margen Bruto / Mg % / Gastos Directos / Contribución (negativa resaltada en rojo) / % / **G/V %** (gastos directos sobre ventas, con semáforo verde→rojo relativo al rango del mes). Fila TOTAL + cuadro de totales abajo (ventas, costo, margen, gastos directos/indirectos, utilidad neta).
  - Criterio de asignación (`buildMatrixPL` en `src/lib/data-processing.ts`): filas = sucursales con ventas ≠ 0. **Gastos indirectos** = gastos de centros de costo (sucursales sin ventas) + registros sin sucursal + servicios centrales (4.2.002.02/03) + resultados financieros (4.2.004), **prorrateados por participación en ventas**. La suma de utilidades por sucursal cierra exacto con el resultado global.
  - Referencia visual: `new.jpeg` (Excel de contabilidad, jul 2026; reemplaza el layout transpuesto de `foto.jpeg`). Los números del Excel no coinciden 1:1 porque contabilidad aplica ajustes manuales. Las columnas **stock $ / Contr/Stock** del Excel NO están implementadas: el stock no viene en los archivos SAP (haría falta otra fuente de datos).
- **Estado de Resultado**: P&L por grupos de cuentas (colapsable).
- **Por Sucursal**: resumen por sucursal con desglose expandible.
- **Gráficos**: top gastos + ingresos vs gastos.

**Selector de mes**: en el header, control índigo con flechas `‹ mes ›` + desplegable. Los archivos SAP traen varios períodos (campo 5 `YYYY-MM`); siempre se visualiza **un mes a la vez** (default: el más reciente) y aplica a todas las pestañas.

> ⚠️ Tras cambiar `src/`, correr `npm run build` — el servicio sirve `dist/` desde disco (no hace falta reiniciar), pero un `dist` viejo hace que el navegador muestre features desactualizadas. Pedir Ctrl+F5 al usuario tras un deploy.

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/data?empresa=TESI\|PUEBLO` | Datos con caché |
| GET | `/api/status` | Estado del último chequeo (`networkPath`, `manifest`, `manifestError`) |
| POST | `/api/refresh` | Forzar chequeo inmediato; lee la red y devuelve `{ok, empresas:{tesi,pueblo}}` con `traidos`/`preservados` |
| POST | `/api/upload` | Sube un archivo manual (marca sus períodos `manual`; 409 si hay un refresh en curso) |
| GET | `/api/download?empresa=TESI\|PUEBLO` | Descarga el vigente byte a byte con su nombre original; 404 si no hay datos |

## Refresh

- Botón **Actualizar** → `POST /api/refresh`: lee `\\10.0.0.115\Cegid` (read-only), mergea por
  período y devuelve qué trajo y qué preservó. La UI lo muestra en el banner.
- Chequeo automático diario a las **01:00** (`CHECK_HOUR`), con la misma regla.
- Si la red falla, el tablero sigue sirviendo `data-store\` y la UI informa el error
  (`ENOENT` = SAP no dejó el archivo; `EACCES`/`EPERM` = permisos sobre el share).

## Build
```powershell
npm run build        # genera dist/
```

## Archivos clave
- `server.js` — servidor Express (ESM), rutas y scheduler
- `server/sap-network.js` — lectura de la UNC con errores tipificados
- `server/sap-store.js` — manifest, merge por período, mutex de escritura
- `server/sap-format.js` — partición/serialización byte-exacta de los `.txt`
- `src/` — frontend React
- `data-store/` — `SAP_RESULT.txt`, `SAP_PU_RESULT.txt`, `manifest.json` (estado vigente)
- `sap-inbox/SAPResultProcesado/` — archivos SAP ya procesados (archivo histórico, con `<origen>` en el nombre)
- `tests/` — 28 tests con el runner de Node
- `.env` — `PORT`, `CHECK_HOUR`, `SAP_NETWORK_PATH`, `SAP_SOURCE_PATH`

## Gotchas
- Verificado el 28/07/2026: el servicio, con su cuenta normal, lee `SAP_NETWORK_PATH` (la UNC)
  sin problemas. Si algún día el log muestra `EACCES`/`EPERM` sobre esa ruta, es permisos del
  share — no un bug del código.
- `SAP_SOURCE_PATH` es solo el inbox de uploads manuales, no "la fuente" (el nombre es
  heredado); la fuente real es `SAP_NETWORK_PATH`.
- Tests: `node --test "tests/*.test.js"` (glob entre comillas: sin comillas falla en git-bash
  con `MODULE_NOT_FOUND`). El test de round-trip de `sap-format` valida igualdad byte a byte
  contra los archivos reales de `SAPResultProcesado\`; si falla, el formato cambió — no
  ajustarlo sin entender el diff.
- **Pendiente del usuario**: verificación visual en navegador (descargas simultáneas de TESI y
  PUEBLO, punto ámbar de mes ajustado, consola sin errores) — no se hizo porque la extensión de
  Chrome no está instalada en este entorno.
- Módulo ESM: no usar `require()`.
