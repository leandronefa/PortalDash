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
- Logs del servicio: `daemon\dashestadoresultado.out.log` (y `.err.log`).
- `.env` (solo nombres, no exponer valores): `PORT`, `CHECK_HOUR`, `SAP_NETWORK_PATH`, `SAP_SOURCE_PATH`.

## Flujo de datos SAP (MUY IMPORTANTE)

SAP deja los `.txt` en `\\10.0.0.115\Cegid` una vez por mes. El botón **Actualizar** del
tablero (y el chequeo diario de las 01:00) los lee **directo de esa ruta de red**, que es
**read-only**: nunca se borra ni mueve nada ahí. Ya no hay que copiar archivos a mano.

- `SAP_NETWORK_PATH=\\10.0.0.115\Cegid` — fuente real, read-only.
- `SAP_SOURCE_PATH=...\sap-inbox` — pese al nombre, **ya no es "la fuente"**: es el inbox local
  donde caen los uploads manuales del botón **Subir files**. Default local a propósito: si
  apuntara a la red, un upload intentaría escribir en un share read-only.

Verificado el 28/07/2026: el servicio, con su cuenta normal, lee la UNC sin problemas (log:
`TESI desde red — traidos: [2026-01..2026-06] preservados: []`, ídem PUEBLO). Si alguna vez
aparece `EACCES`/`EPERM` en el log, es permisos del share — hay que darle al servicio una
cuenta con acceso a `Cegid`.

**La unidad de datos es el mes, no el archivo.** `data-store\manifest.json` guarda el origen
de cada período por empresa (`sap` o `manual`):

- **Actualizar** trae de la red solo los períodos con origen `sap` o inexistentes; nunca pisa
  un período `manual`.
- **Subir files** marca como `manual` los períodos del archivo subido. Solo otro upload los
  reemplaza — no existe "restaurar desde SAP" (decisión de diseño); si hiciera falta, los
  originales quedan en `sap-inbox\SAPResultProcesado\`.

Circuito operativo: SAP deja los archivos → Actualizar los carga → **Descargar files** baja
los vigentes (byte a byte iguales, con su nombre original) → el usuario ajusta importes a mano
→ **Subir files** los devuelve → el tablero muestra los datos ajustados y los conserva.
Verificado end-to-end el 28/07/2026 con TESI: descarga con hash idéntico al de la red, edición
de un importe de 2026-06, upload, los 6 períodos pasaron a `manual`, y un refresh posterior dio
`traidos: []` / `preservados: [los 6 meses]` (mientras PUEBLO sí se actualizó desde la red).

`data-store\SAP_RESULT.txt` y `SAP_PU_RESULT.txt` son el estado vigente y lo que sirve la
descarga: **lo que se ve en pantalla es exactamente lo que se baja**. Se reconstruyen copiando
líneas textuales — nunca reformatear importes (SAP escribe `.00`, no `0.00`).
`sap-inbox\SAPResultProcesado\` es el histórico, con archivado por `<timestamp>_<origen>_<archivo>.txt`
(`<origen>` es `sap` o `manual`); se saltea si el contenido no cambió respecto del último de esa
empresa.

`readManifest()` falla ruidoso a propósito (manifest corrupto, o ausente con vigentes ya
cargados, o JSON que no es un objeto): un manifest vacío ahí sería indistinguible de una
primera corrida, y la siguiente lectura de red pisaría todos los ajustes manuales sin aviso. En
ese estado `/api/status` responde `200` con `manifest: null` y `manifestError`, y el refresh se
aborta.

Mutex de escritura: `checkAndLoad` (refresh de red) y el procesamiento de uploads comparten un
flag. Si se sube un archivo mientras corre un refresh, el upload se rechaza con **409** y se
borra del inbox (para reintentar sin restos). `isRefreshing` en `/api/status` refleja solo el
refresh de red, no los uploads.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/data?empresa=TESI\|PUEBLO` | Datos con caché |
| GET | `/api/status` | Estado del último chequeo (`networkPath`, `manifest`, `manifestError`) |
| POST | `/api/refresh` | Forzar chequeo inmediato (`{ok, empresas:{tesi,pueblo}}` con `traidos`/`preservados`) |
| POST | `/api/upload` | Subir un archivo manual (marca sus períodos `manual`; puede dar 409 si hay un refresh en curso) |
| GET | `/api/download?empresa=TESI\|PUEBLO` | Descarga el vigente byte a byte con su nombre original; 404 si no hay datos |

## Estructura
- `server.js` — Express (ESM); rutas, scheduler y orquestación.
- `server/sap-network.js` — lectura de la UNC con errores tipificados.
- `server/sap-store.js` — manifest, merge por período, mutex de escritura.
- `server/sap-format.js` — partición/serialización byte-exacta de los `.txt`.
- `src/` — frontend React (vistas Resumen, Estado de Resultado, Por Sucursal, Gráficos; `src/lib/data-processing.ts` con `buildMatrixPL`).
- `dist/` — build servido por el servicio (`npm run build`).
- `data-store\` — `SAP_RESULT.txt`, `SAP_PU_RESULT.txt`, `manifest.json` (estado vigente).
- `sap-inbox\` — inbox local de uploads; `sap-inbox\SAPResultProcesado\` archivo histórico.
- `tests/` — 28 tests con el runner de Node.
- `.env` / `.env.example`.

## Gotchas
- Tras cambiar `src/`, correr `npm run build`: el servicio sirve `dist/` desde disco (no hace falta reiniciar), pero un `dist` viejo muestra features desactualizadas → pedir Ctrl+F5 al usuario tras un deploy.
- El `PORT` que inyecta el servicio pisa al del `.env`; mantener 3008 único.
- Los archivos SAP traen varios períodos (campo 5 `YYYY-MM`); la UI muestra un mes a la vez (selector en el header, default el más reciente).
- Tests: `node --test "tests/*.test.js"` desde la carpeta del dashboard (**el glob va entre comillas**: sin comillas falla en git-bash con `MODULE_NOT_FOUND`). El test de round-trip de `sap-format` valida igualdad byte a byte contra los archivos reales de `sap-inbox\SAPResultProcesado\`; si falla, el formato cambió — no ajustarlo sin entender el diff.
- **Pendiente del usuario**: falta la verificación visual en navegador (dos descargas simultáneas, punto ámbar de un mes ajustado, consola sin errores) — no se pudo hacer porque la extensión de Chrome no está instalada en este entorno.
- No commitear `.env` ni exponer sus valores.
- Pedir confirmación antes de reinstalar el servicio o tocar `.env` (regla de `C:\apps\dashboards\CLAUDE.md`).
