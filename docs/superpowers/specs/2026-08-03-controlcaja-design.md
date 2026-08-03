# ControlCaja — Diseño

**Fecha:** 2026-08-03
**Estado:** aprobado para planificar

## Qué es

Dashboard **ControlCaja**: control del cierre diario de caja por sucursal, a partir de los
reportes que SAP deja en `\\10.0.0.115\Cegid`. Responde una sola pregunta: *¿qué sucursales
tuvieron diferencias de caja, en qué días, y por cuánto?*

A diferencia de EstadoResultado, **este tablero solo visualiza**: no descarga archivos, no
recibe uploads, no guarda estado en disco y no conserva ajustes manuales. La fuente de verdad
es el archivo de la red, siempre.

## Fuente de datos

Dos archivos, uno por empresa, en `\\10.0.0.115\Cegid` (share **read-only**: nunca se escribe
ni se borra nada ahí):

| Empresa | Archivo | Sucursales observadas |
|---|---|---|
| TESI | `SAP_REPORTE_Z.TXT` | 003, 005, 008, 009, 010, 011, 012, 017, 018, 019, 020, 022, 023, 024, 025, 027, 039, 080, 111 |
| PUEBLO | `SAP_PU_REPORTE_Z.TXT` | 002, 004, 013, 015, 016, 021, 026, 028, 030, 031, 033, 034, 035, 036, 038, 081, 102 |

INDO **no tiene exportación todavía**. El usuario planea agregarla; el diseño reserva el lugar
(ver *Registro de empresas*) pero no la implementa.

### Formato

Pipe-delimited, sin encabezado, 6 campos, siempre 6 campos por línea:

```
fecha|sucursal|cuenta|debe|haber|saldo
03/06/2026 0:00:00|003|1.1.001.01.009 - Caja Recaudadora Suc 3|270000.00|270000.00|.00
03/06/2026 0:00:00|020|4.2.002.01.050 - Diferencias de Caja|23200.00|.00|23200.00
03/06/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|.00|20500.00|-20500.00
```

Particularidades verificadas sobre los archivos reales el 03/08/2026:

- **Fin de línea distinto entre los dos archivos**: `SAP_REPORTE_Z.TXT` usa CRLF,
  `SAP_PU_REPORTE_Z.TXT` usa LF. El parser tolera ambos.
- **Importes** con formato SAP: `.00` en lugar de `0.00`, negativos como `-11570411.16`.
- **Campo 3** es `<código> - <nombre>` de la cuenta; se parte en el primer ` - `.
- `saldo = debe - haber` en todas las líneas.
- **`debe = haber` exacto por fecha+sucursal**: la partida doble ya viene cuadrada (TESI 850
  grupos, PUEBLO 744, cero descuadres). Por eso el criterio de control **no** puede ser
  "suma de saldos ≠ 0".
- **Una sola línea por cuenta+fecha+sucursal**: no hay repeticiones en ninguno de los dos
  archivos (verificado). Pero una misma línea puede traer debe y haber a la vez.
- **Ventana rodante** de ~61 fechas (jun–ago 2026 al momento del análisis); los archivos se
  reescriben a diario, no una vez por mes.
- **Líneas sin sucursal**: en ~600 líneas el campo 2 trae una fecha en lugar del código de
  sucursal, siempre en cuentas de compras (`1.1.003.06.007 - IVA - Credito Fiscal 21%`,
  `1.1.004.01.001 - Mercaderia de Reventa`, `2.1.001.01.001 - Proveedores Mercadería`).
  **Decisión del usuario: ignorarlas** — piensa corregir el reporte en origen para que no
  vengan o vengan con el dato correcto. Se apartan en una lista `descartadas` y el tablero
  informa el conteo, para que se note cuando dejen de aparecer o cuando el formato cambie.

## Criterio de control

**Un día-sucursal "no cierra" cuando la cuenta `4.2.002.01.050 - Diferencias de Caja` tiene
importe.** Decisión explícita del usuario, sobre las dos alternativas evaluadas (la otra era el
saldo de `Caja Recaudadora Suc N` ≠ 0, que queda como dato del asiento pero no genera alerta).

La celda es la **suma del `saldo`** de las líneas de esa cuenta en el grupo fecha+sucursal.
Hoy siempre hay a lo sumo una línea por grupo (841 en TESI, 737 en PUEBLO, sin repeticiones), así
que la suma equivale al saldo de esa línea; se implementa como suma para que una línea duplicada
en un archivo futuro no produzca un número mal en silencio.

Lo que **no** se puede usar es el `debe` ni el `haber` por separado: una misma línea trae los dos
(ej. `20/06/2026|017` con debe 567.453,02 y haber 4.085.803,00 → saldo −3.518.349,98). El valor
de la celda es el saldo.

Signo, con la etiqueta visible en la UI para que no haya ambigüedad:

- `saldo > 0` (debe) → **faltante** (590 casos en los datos analizados)
- `saldo < 0` (haber) → **sobrante** (986 casos)
- `saldo = 0` → la celda queda vacía, igual que si la cuenta no apareciera

## Arquitectura

Servicio nuevo, siguiendo las convenciones de `C:\apps\dashboards\CLAUDE.md`:

| Ítem | Valor |
|---|---|
| Carpeta | `C:\apps\dashboards\ControlCaja` |
| Servicio (name real) | `dashcontrolcaja.exe` |
| Puerto | **3014** (verificado libre; 3015 ya está ocupado por otro proceso) |
| Proxy del portal | `/d/16/` |
| Bind | `127.0.0.1` (env `HOST`, default loopback) |
| Entrada | `server.js` |
| Stack | React 19 + Vite + TypeScript / Express **ESM** |

Sin `mssql` (no hay base de datos) y sin `multer` (no hay uploads).

### Flujo

```
\\10.0.0.115\Cegid\SAP_REPORTE_Z.TXT      ─┐
\\10.0.0.115\Cegid\SAP_PU_REPORTE_Z.TXT   ─┤→ reporte-source.js  (stat + readFile)
                                            → reporte-parse.js   (texto → registros)
                                            → caché en memoria por mtime+size
                                            → control-caja.js    (agregación)
                                            → /api/... → React
```

### Módulos del backend

Cada uno con un propósito único y testeable en aislamiento:

- **`server/reporte-source.js`** — resuelve la ruta del archivo de una empresa, hace `stat` +
  `readFile`, devuelve `{contenido, mtime, size}`. Tipifica los errores: `ENOENT` → "SAP no dejó
  el archivo", `EACCES`/`EPERM` → "el servicio no tiene permiso al share", error de red →
  "la ruta de red no responde". No conoce el formato del archivo.
- **`server/reporte-parse.js`** — texto → `{fecha, sucursal, cuentaCodigo, cuentaNombre, debe,
  haber, saldo}[]` más `descartadas[{linea, motivo}]`. Tolera CRLF y LF; parsea
  `dd/mm/yyyy hh:mm:ss` como fecha local (sin pasar por UTC, para no correr días); parsea
  importes en formato SAP. Aparta las líneas cuyo campo 2 no es un código de sucursal. No
  conoce el concepto de caja.
- **`server/control-caja.js`** — de los registros arma (a) la matriz mes × sucursal de
  Diferencias de Caja con totales de fila y de columna, y (b) el asiento de un día+sucursal.
  Es el **único** módulo que conoce la cuenta `4.2.002.01.050` y el criterio de "no cierra".
  No lee archivos.
- **`server/empresas.js`** — registro `EMPRESAS`:
  `{ TESI: {archivo: 'SAP_REPORTE_Z.TXT', label: 'TESI'}, PUEBLO: {archivo: 'SAP_PU_REPORTE_Z.TXT', label: 'PUEBLO'} }`.
  Agregar INDO cuando exista la exportación es **una línea acá**: `/api/empresas` publica el
  registro y el frontend arma el selector con eso, sin tocar la UI.
- **`server.js`** — Express: rutas, montaje de `dist/`, manejo de errores.

### Datos auxiliares

`data/sucursales.json` — mapeo editable `{"003": "Nombre", …}` con todos los códigos observados,
valor vacío donde el nombre no se conoce todavía. Un código ausente del mapeo se rotula con el
código solo; nunca rompe la vista. Los archivos de SAP no traen el nombre de la sucursal y se
descartó consultarlo por SQL para no agregar una dependencia (decisión del usuario).

### Caché

En memoria, clave = empresa, invalidada cuando `mtime` o `size` del archivo cambian. Como SAP
reescribe a diario, el primer request posterior a la reescritura reparsea (~decenas de ms para
13k líneas) y el resto se sirve de memoria. Sin scheduler y sin persistencia: reiniciar el
servicio no pierde nada porque no hay nada propio que perder.

### Errores

- UNC inaccesible → **503** con el motivo tipificado; el frontend muestra ese texto y un botón
  Reintentar. Nunca datos viejos presentados como frescos, nunca pantalla en blanco.
- Archivo presente pero ninguna línea parseable → **200** con `registros: 0` y un aviso. Es un
  caso distinto de "no hay archivo" y hay que poder distinguirlos.
- Empresa o período inexistente → **400**.

## API

Todos GET; el tablero no tiene endpoints de escritura.

| Ruta | Devuelve |
|---|---|
| `/api/empresas` | `{empresas: [{clave, label}]}` del registro. |
| `/api/periodos?empresa=TESI` | `{periodos: ["2026-06","2026-07","2026-08"], archivo: {mtime, size}, descartadas: N}` |
| `/api/matriz?empresa=TESI&periodo=2026-08` | `{sucursales: [{codigo, nombre, dias: {"01": importe, …}, total}], dias: [], totalesPorDia: {}, granTotal, resumen: {faltantes, sobrantes, neto, diasConDiferencia, diasTotales}}` |
| `/api/asiento?empresa=TESI&fecha=2026-08-03&sucursal=010` | `{lineas: [{cuentaCodigo, cuentaNombre, debe, haber, saldo, esDiferenciaCaja}], totales: {debe, haber}}` |

La matriz es ~20 sucursales × 31 días: payload chico, no hace falta paginar.

## Interfaz

Una sola vista, sin pestañas.

**Header** — selector de empresa · selector de mes (default el más reciente) · leyenda de
frescura (`SAP al 03/08/2026 11:36`, tomada del `mtime` del archivo) · botón Refrescar, que
vuelve a hacer `stat` y reparsea solo si el archivo cambió; si no cambió, actualiza la leyenda de
frescura y no toca la vista ·
si `descartadas > 0`, texto discreto `N líneas sin sucursal ignoradas`.

**Tarjetas de resumen** (4) — total de faltantes del mes, total de sobrantes, neto, y cantidad
de días-sucursal con diferencia sobre el total. Faltantes y sobrantes van **separados a
propósito**: un neto cercano a cero puede esconder un faltante grande compensado por un sobrante
grande, que es justo el caso que interesa detectar.

**Matriz** — filas = sucursales (`010 — Nombre`), columnas = **solo los días que aparecen en el
archivo** para ese mes (`dias` del response, zero-padded `"01"`…`"31"`). Un mes incompleto —
porque la ventana rodante lo cortó o porque hubo días sin actividad — muestra menos de 31
columnas, y eso es correcto: no se inventan columnas vacías.

- Columna de sucursal **sticky** al hacer scroll horizontal.
- Celda vacía = sin diferencia. Con importe = coloreada por signo (faltante / sobrante) e
  intensidad según magnitud.
- Última columna: total de la sucursal en el mes. Última fila: total por día.
- **Clic en celda → panel lateral** con el asiento completo de ese día+sucursal (panel, no
  modal: permite seguir navegando la matriz con el detalle abierto). Las líneas de Diferencias
  de Caja van destacadas; el saldo de `Caja Recaudadora Suc N` se muestra como dato.
- Clic en totales de fila o columna no abre nada.
- **Orden de filas** por defecto: total absoluto de diferencias descendente — las sucursales
  problemáticas arriba. Toggle para ordenar por código.

**Paleta**: al implementar se usa el skill `dataviz` para la escala del semáforo, de modo que
faltante y sobrante se distingan también en escala de grises y en modo oscuro, no solo por
matiz.

## Tests

Runner de Node (`node --test "tests/*.test.js"`, glob entre comillas), sin dependencias nuevas.

**`reporte-parse`** — fixtures con líneas reales de ambos archivos:
- CRLF (TESI) y LF (PUEBLO) parsean igual.
- Importe `.00` → 0; negativo `-11570411.16`; `saldo = debe - haber`.
- Cuenta partida en código y nombre en el primer ` - `.
- Fecha `03/06/2026 0:00:00` → 2026-06-03 local (no 06-02 por UTC).
- Línea con fecha en el campo 2 → va a `descartadas` con su motivo, no a los registros.

**`control-caja`** — con un mes armado a mano:
- Línea de Diferencias de Caja con debe y haber a la vez → la celda toma el saldo.
- Dos líneas de Diferencias de Caja en el mismo grupo (caso que hoy no ocurre) → se suman.
- Día sin diferencia → celda ausente, no un cero.
- Sucursal sin `Caja Recaudadora` (080, 111, 081, 102) → aparece igual si tiene diferencias.
- Totales de fila, de columna, y `resumen` (faltantes y sobrantes por separado).
- Asiento de un día+sucursal: incluye todas las cuentas del grupo y `totales.debe = totales.haber`.

**`reporte-source`** — ruta inexistente y sin permiso → error tipificado; caché no reparsea si
`mtime` y `size` no cambiaron, sí reparsea si cambian.

## Fuera de alcance

Explícitamente **no** se implementa:

- Descarga ni upload de archivos, `data-store`, `manifest.json`, `sap-inbox`, scheduler.
- INDO (no existe la exportación; queda a una línea de distancia en `empresas.js`).
- Alerta por saldo de `Caja Recaudadora` ≠ 0 (se muestra como dato en el asiento, sin semáforo).
- Consulta a SQL Server para nombres de sucursal.
- Gráficos de tendencia, comparativa entre sucursales, evolución por cuenta.
- Notificaciones, exportación a Excel, historial de resoluciones.

## Pendientes de deploy

Al terminar la implementación:

1. Instalar el servicio con `C:\apps\portal\deploy\dashboards\install-dashboard-service.js`
   (`"Dash-ControlCaja"`, carpeta, `3014`, `server.js`) — **pedir confirmación antes**, por la
   regla de `C:\apps\dashboards\CLAUDE.md`.
2. Registrar el dashboard en el portal (Administración → Dashboards) con el puerto 3014.
3. Sumar la fila a la tabla de `C:\apps\dashboards\CLAUDE.md` y a `C:\apps\CLAUDE.md`.
4. Actualizar `C:\apps\portal-src\deploy\OPERATIONS-10.0.0.118.md`.
5. Completar `data/sucursales.json` con los nombres reales (lo hace el usuario).
