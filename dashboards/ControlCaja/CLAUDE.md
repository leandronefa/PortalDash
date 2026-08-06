# CLAUDE.md — ControlCaja

## Qué es
Dashboard **Control de Caja**: matriz sucursal × día con las Diferencias de Caja que SAP reporta,
por empresa y por mes, con drill-down al asiento del día. Frontend React 19 + Vite + TypeScript;
backend Express en `server.js` (**ESM**, no usar `require()`).

## Servicio y acceso
- Servicio de Windows: **`dashcontrolcaja.exe`** (node-windows), puerto **3014**, entrada `server.js`.
- **Los usuarios acceden SOLO vía el portal**: `http://10.0.0.118/d/16/`. El puerto 3014 directo
  queda solo para diagnóstico local (`http://localhost:3014`).
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\ControlCaja; $env:PORT=3014; node server.js
  ```
- Logs: `daemon\dashcontrolcaja.out.log` (y `.err.log`).
- `.env` (solo nombres): `PORT`, `SAP_NETWORK_PATH`.

## Flujo de datos (SOLO LECTURA)
Lee `\\10.0.0.115\Cegid\SAP_REPORTE_Z.TXT` (TESI) y `SAP_PU_REPORTE_Z.TXT` (PUEBLO) **directo de la
red, read-only**. A diferencia de EstadoResultado **no hay descarga, ni upload, ni `data-store`, ni
manifest, ni scheduler**: la fuente de verdad es siempre el archivo de la red. La caché en memoria
se invalida por `mtime`+`size`, así que el primer request posterior a la reescritura diaria de SAP
reparsea y el resto se sirve de memoria. Reiniciar el servicio no pierde nada.

## Criterio de control
Un día-sucursal "no cierra" cuando la cuenta **`4.2.002.01.050 - Diferencias de Caja`** tiene
importe. `saldo > 0` = **faltante**, `saldo < 0` = **sobrante**. La partida doble ya viene cuadrada
por fecha+sucursal en los archivos de SAP, así que "suma de saldos ≠ 0" **no** sirve como criterio
(siempre da 0). El saldo de `Caja Recaudadora Suc N` se muestra en el asiento como dato, sin alerta.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/empresas` | Registro de empresas para el selector |
| GET | `/api/periodos?empresa=TESI\|PUEBLO` | Meses presentes, `mtime` del archivo, conteo de descartadas |
| GET | `/api/matriz?empresa=…&periodo=YYYY-MM` | Matriz, totales y resumen |
| GET | `/api/asiento?empresa=…&fecha=YYYY-MM-DD&sucursal=NNN` | Asiento completo del día |

Tres respuestas distintas, y la diferencia importa:

- **400** — empresa, período, fecha o sucursal inválidos. Una empresa desconocida **nunca** cae por
  defecto a TESI: mostrar los números de una empresa bajo el nombre de otra es peor que un error.
- **503** (no 500) — la UNC no responde, con el motivo tipificado. El tablero está bien; la fuente
  no está disponible.
- **200 con matriz vacía** — el mes no tiene datos. **No es un 404**: "no hay datos de este mes" y
  "no se pudo leer" son dos problemas distintos con dos acciones distintas, y la UI los muestra
  diferente (cartel de reintento vs. "no hay diferencias registradas en este mes").

## Estructura
- `server/reporte-source.js` — `stat`+`readFile` de la UNC con errores tipificados.
- `server/reporte-parse.js` — texto → registros; tolera CRLF (TESI) y LF (PUEBLO).
- `server/control-caja.js` — matriz, resumen y asiento. **Único** módulo que conoce la cuenta de control.
- `server/empresas.js` — registro `EMPRESAS`. **Sumar INDO es una línea acá** (falta la exportación).
- `server/reporte-cache.js` — caché por `mtime`+`size`; no cachea errores.
- `server/app.js` — rutas Express (sin `listen`, para poder testear).
- `data/sucursales.json` — mapeo código → nombre, editable a mano.

## Gotchas
- Tras cambiar `src/`, correr `npm run build`: el servicio sirve `dist/` desde disco (no hace falta
  reiniciar), pero un `dist` viejo muestra features desactualizadas → pedir Ctrl+F5 tras un deploy.
  **Cambios en `server/` sí necesitan `Restart-Service dashcontrolcaja.exe`** — el proceso de Node
  tiene el código viejo cargado en memoria hasta que se reinicia.
- El `PORT` que inyecta el servicio pisa al del `.env`; mantener 3014 único.
- **Las fechas del archivo se manejan como strings** (`'2026-06-03'`), nunca con `Date`: parsear
  `dd/mm/yyyy` a `Date` y reformatear es la vía clásica a que el día 1 aparezca en el mes anterior.
- Hasta el 03/08/2026 llegaban ~600 líneas por archivo con una **fecha en el campo de sucursal**
  (cuentas de compras); se ignoraban y el tablero mostraba el conteo. El usuario corrigió el
  reporte en origen esa fecha y el contador está en cero. Si vuelve a subir, o aparece un motivo de
  descarte **distinto** al de la sucursal, el formato cambió — investigar, no ajustar el parser a
  ciegas para volver a poner el contador en verde.
- La paleta del semáforo está **validada** con el skill `dataviz` (CVD ΔE 11,5 light / 10,6 dark,
  contra un umbral ≥8). El validador (`scripts/validate_palette.js`) no está vendorizado en este
  repo — vive en el skill. No cambiar los hexes de `src/index.css` sin volver a correr esa
  validación desde el skill `dataviz`.
- Tests: `node --test "tests/*.test.js"` (**el glob entre comillas**: sin comillas falla en git-bash
  con `MODULE_NOT_FOUND`).
- No commitear `.env`. Pedir confirmación antes de reinstalar el servicio o tocar `.env`.
