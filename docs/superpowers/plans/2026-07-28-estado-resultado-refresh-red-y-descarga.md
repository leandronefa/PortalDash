# EstadoResultado — Refresh desde la red + descarga de files SAP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el botón **Actualizar** lea siempre los `.txt` de SAP desde `\\10.0.0.115\Cegid`, y agregar **Descargar files** para cerrar el circuito SAP → tablero → ajuste manual → subida, sin que una lectura de red pise nunca un mes ajustado a mano.

**Architecture:** La unidad de datos pasa a ser el **mes**, no el archivo. Cada período de cada empresa tiene origen `sap` o `manual` en un `manifest.json`. Los archivos vigentes viven en `data-store\` conservando **líneas textuales** (nunca se reformatean importes, porque SAP escribe `.00` y `-107029809.47`), de modo que lo que se ve en pantalla es byte por byte lo que se descarga. La lógica de partición/merge por período se aísla en dos módulos puros y testeables; `server.js` solo orquesta.

**Tech Stack:** Node 24 ESM + Express 4 + multer, React 19 + Vite 6 + Tailwind 4, `node:test` + `node:assert` (built-in, sin dependencias nuevas).

**Spec:** `docs/superpowers/specs/2026-07-28-estado-resultado-refresh-red-y-descarga-design.md`

## Global Constraints

- Carpeta de trabajo: `C:\apps\dashboards\EstadoResultado`. Rutas **locales** `C:\apps\...`, nunca UNC en configuración de servicios.
- **ESM obligatorio**: el `package.json` tiene `"type": "module"`. Nunca usar `require()`.
- Nombres de archivo SAP exactos: `SAP_RESULT.txt` → TESI, `SAP_PU_RESULT.txt` → PUEBLO.
- Formato SAP verificado y **no negociable**: 5 campos pipe-delimited `CUENTA|DESCRIPCION|SUCURSAL|VALOR|PERIODO`, **sin BOM**, **sin encabezado**, fin de línea **CRLF** (`\r\n`) incluido al final del archivo, encoding **UTF-8**.
- **Jamás reformatear un importe.** Toda reconstrucción de archivos copia líneas textuales. Regenerar desde `parseFloat` produciría `0.00` donde SAP escribe `.00` y rompería la igualdad byte a byte.
- `SAP_NETWORK_PATH` es **read-only**: nunca borrar, mover ni escribir en `\\10.0.0.115\Cegid`.
- Los uploads (multer) siempre van al inbox local, nunca a la red.
- No commitear `.env` ni exponer sus valores.
- Pedir confirmación al usuario antes de reinstalar el servicio o cambiar su cuenta de ejecución.
- Tras cambiar `src/`, correr `npm run build` (el servicio sirve `dist/` desde disco).

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `server/sap-format.js` (crear) | **Puro, sin IO.** Partir texto SAP en bloques por período y volver a serializarlo con CRLF. Round-trip byte-exacto. |
| `server/sap-store.js` (crear) | Estado vigente: `data-store\` + `manifest.json`. Merge por período con la regla `manual` gana sobre `sap`. IO inyectable vía `dir`. |
| `server/sap-network.js` (crear) | Leer los `.txt` desde la UNC con errores **tipificados** (`ENOENT` vs `EACCES`/`EPERM`). |
| `tests/sap-format.test.js` (crear) | Round-trip exacto contra el archivo SAP real + casos borde. |
| `tests/sap-store.test.js` (crear) | La regla de negocio central: `manual` nunca se pisa por red. |
| `tests/sap-network.test.js` (crear) | Tipificación de errores de acceso. |
| `server.js` (modificar) | Orquestación: refresh red→store, migración inicial, endpoints. Adelgaza: la lógica sale a los módulos. |
| `src/App.tsx` (modificar) | Botón "Descargar files", badge de mes ajustado, banner con resultado real del refresh. |
| `.env` (modificar) | Agregar `SAP_NETWORK_PATH`. |
| `.gitignore` (modificar) | Ignorar `data-store/`. |

`data-store\` se genera en runtime. `sap-inbox\` sigue siendo la zona de llegada de uploads; `sap-inbox\SAPResultProcesado\` el histórico con timestamp.

> **Simplificación respecto del spec:** el spec describía copiar el archivo de red al inbox y leerlo de ahí. Ese paso intermedio es innecesario una vez que el estado vigente vive en `data-store\`: el refresh lee el texto de la red, lo mergea al store y archiva una copia en `SAPResultProcesado\`. El inbox queda solo como destino de los uploads de multer. Mismo resultado observable, un movimiento de archivo menos.

---

### Task 1: Partición y serialización por período (`sap-format.js`)

**Files:**
- Create: `C:\apps\dashboards\EstadoResultado\server\sap-format.js`
- Test: `C:\apps\dashboards\EstadoResultado\tests\sap-format.test.js`

**Interfaces:**
- Consumes: nada (primer módulo).
- Produces:
  - `EOL = '\r\n'`
  - `periodoDeLinea(line: string): string` — 5º campo trimmeado, o `''` si falta.
  - `splitIntoPeriodBlocks(text: string): Map<string, string[]>` — clave = período, valor = líneas textuales de ese período, en orden de aparición. Las líneas sin período van a la clave `''`.
  - `serializeBlocks(blocks: Map<string, string[]>): string` — períodos ordenados ascendente (lexicográfico sobre `YYYY-MM`), líneas unidas con CRLF, **CRLF final**.

- [ ] **Step 1: Write the failing test**

Crear `tests/sap-format.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { periodoDeLinea, splitIntoPeriodBlocks, serializeBlocks, EOL } from '../server/sap-format.js'

const L1 = '4.1.000.00.000|INGRESOS||.00|2026-01'
const L2 = '4.1.001.01.001|Venta|011 - Sportotal 11|-107029809.47|2026-01'
const L3 = '4.2.002.01.001|Sueldos|020 - Sportotal 20|58200.10|2026-02'

test('periodoDeLinea extrae el 5o campo', () => {
  assert.equal(periodoDeLinea(L1), '2026-01')
  assert.equal(periodoDeLinea(L3), '2026-02')
})

test('periodoDeLinea devuelve cadena vacia si falta el periodo', () => {
  assert.equal(periodoDeLinea('4.1.000.00.000|INGRESOS||.00'), '')
})

test('splitIntoPeriodBlocks agrupa por periodo preservando las lineas textuales', () => {
  const text = [L1, L2, L3].join(EOL) + EOL
  const blocks = splitIntoPeriodBlocks(text)
  assert.deepEqual([...blocks.keys()], ['2026-01', '2026-02'])
  assert.deepEqual(blocks.get('2026-01'), [L1, L2])
  assert.deepEqual(blocks.get('2026-02'), [L3])
})

test('splitIntoPeriodBlocks ignora lineas vacias', () => {
  const text = [L1, '', L3, ''].join(EOL)
  const blocks = splitIntoPeriodBlocks(text)
  assert.deepEqual(blocks.get('2026-01'), [L1])
  assert.deepEqual(blocks.get('2026-02'), [L3])
})

test('splitIntoPeriodBlocks agrupa las lineas sin periodo bajo la clave vacia', () => {
  const sinPeriodo = '4.1.000.00.000|INGRESOS||.00'
  const blocks = splitIntoPeriodBlocks([sinPeriodo, L3].join(EOL) + EOL)
  assert.deepEqual(blocks.get(''), [sinPeriodo])
})

test('serializeBlocks ordena periodos ascendente y cierra con CRLF', () => {
  const blocks = new Map([['2026-02', [L3]], ['2026-01', [L1, L2]]])
  assert.equal(serializeBlocks(blocks), [L1, L2, L3].join(EOL) + EOL)
})

test('serializeBlocks de un mapa vacio devuelve cadena vacia', () => {
  assert.equal(serializeBlocks(new Map()), '')
})

// EL test que garantiza la igualdad byte a byte del circuito completo.
// Solo valida archivos con el formato que emite SAP (CRLF y CRLF final): en
// SAPResultProcesado\ tambien se archivan los que sube un usuario, que pueden venir
// con LF si los editó con otra herramienta. Esos se saltean en lugar de dar falso positivo.
test('round-trip byte-exacto contra los archivos SAP reales', () => {
  const dir = path.join(import.meta.dirname, '..', 'sap-inbox', 'SAPResultProcesado')
  const candidatos = fs.readdirSync(dir).filter(f => f.endsWith('.txt'))
  let validados = 0
  for (const f of candidatos) {
    const original = fs.readFileSync(path.join(dir, f), 'utf8')
    const formatoSAP = original.endsWith('\r\n') && !/(^|[^\r])\n/.test(original)
    if (!formatoSAP) continue
    assert.equal(serializeBlocks(splitIntoPeriodBlocks(original)), original, `round-trip no exacto para ${f}`)
    validados++
  }
  assert.ok(validados > 0, 'no se encontro ningun archivo en formato SAP para validar el round-trip')
})
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd C:\apps\dashboards\EstadoResultado; node --test tests/sap-format.test.js
```

Expected: FAIL — `Cannot find module '.../server/sap-format.js'`.

- [ ] **Step 3: Write minimal implementation**

Crear `server/sap-format.js`:

```js
// Formato de los archivos SAP (verificado el 28/07/2026):
// pipe-delimited CUENTA|DESCRIPCION|SUCURSAL|VALOR|PERIODO, sin BOM, sin encabezado,
// CRLF (incluido al final del archivo), UTF-8, periodos en bloques contiguos ascendentes.
//
// Las lineas se tratan SIEMPRE como texto: los importes vienen como ".00" y
// "-107029809.47", asi que regenerarlos desde parseFloat rompe la igualdad byte a byte
// que necesita el circuito descargar -> editar -> subir.

export const EOL = '\r\n'

export function periodoDeLinea(line) {
  const parts = line.split('|')
  return (parts[4] ?? '').trim()
}

/**
 * Agrupa las lineas del texto por periodo, preservando cada linea textual.
 * Las lineas sin periodo caen en la clave ''. Descarta lineas vacias.
 * @returns {Map<string, string[]>} periodo -> lineas, en orden de aparicion
 */
export function splitIntoPeriodBlocks(text) {
  const blocks = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const periodo = periodoDeLinea(line)
    if (!blocks.has(periodo)) blocks.set(periodo, [])
    blocks.get(periodo).push(line)
  }
  return blocks
}

/**
 * Reconstruye el archivo: periodos ordenados ascendente, lineas unidas con CRLF
 * y CRLF final (como lo emite SAP).
 */
export function serializeBlocks(blocks) {
  const periodos = [...blocks.keys()].sort()
  const lines = periodos.flatMap(p => blocks.get(p))
  return lines.length === 0 ? '' : lines.join(EOL) + EOL
}
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
cd C:\apps\dashboards\EstadoResultado; node --test tests/sap-format.test.js
```

Expected: PASS, 8/8. El round-trip debe pasar contra los 4 archivos reales de `SAPResultProcesado\`. **Si el round-trip falla, parar**: significa que el formato tiene una variante no contemplada — inspeccionar el diff antes de seguir.

- [ ] **Step 5: Commit**

```bash
cd C:/apps && git add dashboards/EstadoResultado/server/sap-format.js dashboards/EstadoResultado/tests/sap-format.test.js && git commit -m "feat(estado-resultado): particion por periodo con round-trip byte-exacto"
```

---

### Task 2: Estado vigente y merge por período (`sap-store.js`)

Corazón del plan: acá vive la regla *un mes `manual` nunca se pisa por una lectura de red*.

**Files:**
- Create: `C:\apps\dashboards\EstadoResultado\server\sap-store.js`
- Test: `C:\apps\dashboards\EstadoResultado\tests\sap-store.test.js`

**Interfaces:**
- Consumes de Task 1: `splitIntoPeriodBlocks`, `serializeBlocks`, `EOL`.
- Produces:
  - `EMPRESAS = { tesi: 'SAP_RESULT.txt', pueblo: 'SAP_PU_RESULT.txt' }`
  - `createStore({ dir }): Store` — `dir` es la carpeta `data-store` (inyectable para tests).
  - `Store.vigentePath(empresaKey: 'tesi'|'pueblo'): string`
  - `Store.readVigente(empresaKey): string | null` — texto del archivo vigente, o `null` si no existe.
  - `Store.readManifest(): { tesi: Record<string, {origen, cargadoEn}>, pueblo: ... }`
  - `Store.merge({ empresaKey, texto, origen: 'sap'|'manual' }): { traidos: string[], preservados: string[], periodos: string[] }`
    - `traidos`: períodos efectivamente escritos. `preservados`: períodos del entrante que se dejaron intactos por ser `manual`. `periodos`: todos los períodos del vigente después del merge.

- [ ] **Step 1: Write the failing test**

Crear `tests/sap-store.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createStore, EMPRESAS } from '../server/sap-store.js'
import { EOL } from '../server/sap-format.js'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapstore-'))
  return createStore({ dir })
}

const ENE_SAP = '4.1.001.01.001|Venta|011|-100.00|2026-01'
const FEB_SAP = '4.1.001.01.001|Venta|011|-200.00|2026-02'
const MAR_SAP = '4.1.001.01.001|Venta|011|-300.00|2026-03'
const FEB_AJUSTADO = '4.1.001.01.001|Venta|011|-999.99|2026-02'

const txt = (...lines) => lines.join(EOL) + EOL

test('EMPRESAS mapea las claves a los nombres de archivo de SAP', () => {
  assert.equal(EMPRESAS.tesi, 'SAP_RESULT.txt')
  assert.equal(EMPRESAS.pueblo, 'SAP_PU_RESULT.txt')
})

test('merge inicial desde sap guarda el vigente igual al entrante', () => {
  const store = tmpStore()
  const entrante = txt(ENE_SAP, FEB_SAP)
  const r = store.merge({ empresaKey: 'tesi', texto: entrante, origen: 'sap' })
  assert.deepEqual(r.traidos, ['2026-01', '2026-02'])
  assert.deepEqual(r.preservados, [])
  assert.equal(store.readVigente('tesi'), entrante)
})

test('readVigente devuelve null si no hay nada cargado', () => {
  assert.equal(tmpStore().readVigente('pueblo'), null)
})

test('el manifest registra el origen de cada periodo', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP), origen: 'sap' })
  const m = store.readManifest()
  assert.equal(m.tesi['2026-01'].origen, 'sap')
  assert.ok(m.tesi['2026-01'].cargadoEn, 'falta cargadoEn')
})

test('un upload manual pisa el periodo y lo marca manual', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  const r = store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })
  assert.deepEqual(r.traidos, ['2026-02'])
  assert.equal(store.readManifest().tesi['2026-02'].origen, 'manual')
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP, FEB_AJUSTADO))
})

// LA regla de negocio central del spec.
test('una lectura de red NO pisa un periodo manual, pero si trae los nuevos', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })

  const r = store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP, MAR_SAP), origen: 'sap' })

  assert.deepEqual(r.preservados, ['2026-02'], 'febrero ajustado debia preservarse')
  assert.deepEqual(r.traidos, ['2026-01', '2026-03'])
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP, FEB_AJUSTADO, MAR_SAP))
  assert.equal(store.readManifest().tesi['2026-02'].origen, 'manual')
  assert.equal(store.readManifest().tesi['2026-03'].origen, 'sap')
})

test('refrescar dos veces desde sap es idempotente', () => {
  const store = tmpStore()
  const entrante = txt(ENE_SAP, FEB_SAP)
  store.merge({ empresaKey: 'tesi', texto: entrante, origen: 'sap' })
  store.merge({ empresaKey: 'tesi', texto: entrante, origen: 'sap' })
  assert.equal(store.readVigente('tesi'), entrante)
})

test('un upload manual reemplaza un periodo ya ajustado', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })
  const otro = '4.1.001.01.001|Venta|011|-111.11|2026-02'
  store.merge({ empresaKey: 'tesi', texto: txt(otro), origen: 'manual' })
  assert.equal(store.readVigente('tesi'), txt(otro))
})

test('las empresas no se contaminan entre si', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'pueblo', texto: txt(FEB_SAP), origen: 'manual' })
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP))
  assert.equal(store.readVigente('pueblo'), txt(FEB_SAP))
  assert.equal(store.readManifest().tesi['2026-02'], undefined)
})
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd C:\apps\dashboards\EstadoResultado; node --test tests/sap-store.test.js
```

Expected: FAIL — `Cannot find module '.../server/sap-store.js'`.

- [ ] **Step 3: Write minimal implementation**

Crear `server/sap-store.js`:

```js
import fs from 'fs'
import path from 'path'
import { splitIntoPeriodBlocks, serializeBlocks } from './sap-format.js'

export const EMPRESAS = { tesi: 'SAP_RESULT.txt', pueblo: 'SAP_PU_RESULT.txt' }

const MANIFEST = 'manifest.json'

/**
 * Estado vigente del tablero: un archivo por empresa (texto tal cual, byte-fiel)
 * mas un manifest con el origen de cada periodo.
 *
 * Regla central: un periodo con origen 'manual' solo puede reemplazarse con
 * otro upload manual. Una lectura de red ('sap') nunca lo toca.
 */
export function createStore({ dir }) {
  function ensureDir() {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  function vigentePath(empresaKey) {
    return path.join(dir, EMPRESAS[empresaKey])
  }

  function readVigente(empresaKey) {
    const p = vigentePath(empresaKey)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  }

  function readManifest() {
    const p = path.join(dir, MANIFEST)
    const vacio = { tesi: {}, pueblo: {} }
    if (!fs.existsSync(p)) return vacio
    try {
      const m = JSON.parse(fs.readFileSync(p, 'utf8'))
      return { tesi: m.tesi ?? {}, pueblo: m.pueblo ?? {} }
    } catch {
      return vacio
    }
  }

  function saveManifest(m) {
    ensureDir()
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m, null, 2))
  }

  function merge({ empresaKey, texto, origen }) {
    if (!EMPRESAS[empresaKey]) throw new Error(`Empresa desconocida: ${empresaKey}`)
    if (origen !== 'sap' && origen !== 'manual') throw new Error(`Origen invalido: ${origen}`)

    const manifest = readManifest()
    const meta = manifest[empresaKey]
    const vigente = readVigente(empresaKey)
    const blocks = vigente ? splitIntoPeriodBlocks(vigente) : new Map()
    const entrantes = splitIntoPeriodBlocks(texto)

    const traidos = []
    const preservados = []
    const cargadoEn = new Date().toISOString()

    for (const [periodo, lines] of entrantes) {
      const esManual = meta[periodo]?.origen === 'manual'
      if (origen === 'sap' && esManual) {
        preservados.push(periodo)
        continue
      }
      blocks.set(periodo, lines)
      meta[periodo] = { origen, cargadoEn }
      traidos.push(periodo)
    }

    ensureDir()
    fs.writeFileSync(vigentePath(empresaKey), serializeBlocks(blocks), 'utf8')
    saveManifest(manifest)

    return {
      traidos: traidos.sort(),
      preservados: preservados.sort(),
      periodos: [...blocks.keys()].sort()
    }
  }

  return { dir, vigentePath, readVigente, readManifest, merge }
}
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
cd C:\apps\dashboards\EstadoResultado; node --test tests/sap-store.test.js
```

Expected: PASS, 10/10.

- [ ] **Step 5: Commit**

```bash
cd C:/apps && git add dashboards/EstadoResultado/server/sap-store.js dashboards/EstadoResultado/tests/sap-store.test.js && git commit -m "feat(estado-resultado): store por periodo, los meses ajustados no se pisan con la red"
```

---

### Task 3: Lectura de la UNC con errores tipificados (`sap-network.js`)

**Files:**
- Create: `C:\apps\dashboards\EstadoResultado\server\sap-network.js`
- Test: `C:\apps\dashboards\EstadoResultado\tests\sap-network.test.js`

**Interfaces:**
- Consumes de Task 2: `EMPRESAS`.
- Produces:
  - `leerArchivoDeRed(networkPath: string, filename: string): { ok: true, texto: string } | { ok: false, code: string, message: string }`
    - `code`: `'ENOENT'` (SAP no dejó el archivo todavía) | `'EACCES'` | `'EPERM'` (permisos: el servicio corre como SYSTEM) | otro código de `fs`.
  - `descripcionDeError(code: string): string` — mensaje en castellano para la UI.

- [ ] **Step 1: Write the failing test**

Crear `tests/sap-network.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { leerArchivoDeRed, descripcionDeError } from '../server/sap-network.js'

test('lee un archivo existente y devuelve el texto tal cual', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapnet-'))
  const contenido = '4.1.001.01.001|Venta|011|-100.00|2026-01\r\n'
  fs.writeFileSync(path.join(dir, 'SAP_RESULT.txt'), contenido, 'utf8')
  const r = leerArchivoDeRed(dir, 'SAP_RESULT.txt')
  assert.equal(r.ok, true)
  assert.equal(r.texto, contenido)
})

test('archivo inexistente devuelve ENOENT sin lanzar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapnet-'))
  const r = leerArchivoDeRed(dir, 'SAP_RESULT.txt')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
})

test('ruta de red inexistente devuelve error sin lanzar', () => {
  const r = leerArchivoDeRed('\\\\10.255.255.255\\NoExiste', 'SAP_RESULT.txt')
  assert.equal(r.ok, false)
  assert.ok(r.code, 'deberia traer un code')
})

test('descripcionDeError distingue permisos de archivo ausente', () => {
  assert.match(descripcionDeError('ENOENT'), /no dej[oó]|no est[aá]/i)
  assert.match(descripcionDeError('EACCES'), /permis/i)
  assert.match(descripcionDeError('EPERM'), /permis/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
cd C:\apps\dashboards\EstadoResultado; node --test tests/sap-network.test.js
```

Expected: FAIL — `Cannot find module '.../server/sap-network.js'`.

- [ ] **Step 3: Write minimal implementation**

Crear `server/sap-network.js`:

```js
import fs from 'fs'
import path from 'path'

/**
 * Lee un .txt de SAP desde la ruta de red. NUNCA escribe ni borra en la red.
 * Devuelve el error tipificado en lugar de lanzar: distinguir "SAP todavia no
 * dejo el archivo" (ENOENT) de "el servicio no tiene permiso" (EACCES/EPERM) es
 * clave para diagnosticar, porque el servicio corre como SYSTEM y se presenta en
 * la red con la cuenta de maquina.
 */
export function leerArchivoDeRed(networkPath, filename) {
  try {
    const texto = fs.readFileSync(path.join(networkPath, filename), 'utf8')
    return { ok: true, texto }
  } catch (e) {
    return { ok: false, code: e.code || 'UNKNOWN', message: e.message }
  }
}

export function descripcionDeError(code) {
  switch (code) {
    case 'ENOENT':
      return 'SAP todavía no dejó el archivo en la ruta de red'
    case 'EACCES':
    case 'EPERM':
      return 'Sin permiso para leer la ruta de red (el servicio corre como SYSTEM)'
    case 'ETIMEDOUT':
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
      return 'La ruta de red no responde'
    default:
      return 'No se pudo leer la ruta de red'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
cd C:\apps\dashboards\EstadoResultado; node --test tests/sap-network.test.js
```

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
cd C:/apps && git add dashboards/EstadoResultado/server/sap-network.js dashboards/EstadoResultado/tests/sap-network.test.js && git commit -m "feat(estado-resultado): lectura de la UNC con errores tipificados"
```

---

### Task 4: Orquestación en `server.js` (refresh de red, migración, endpoints)

**Files:**
- Modify: `C:\apps\dashboards\EstadoResultado\server.js` (reescritura de la mitad superior: constantes, `checkAndLoad`, endpoints)
- Modify: `C:\apps\dashboards\EstadoResultado\.env` (agregar `SAP_NETWORK_PATH`)
- Modify: `C:\apps\dashboards\EstadoResultado\.gitignore` (agregar `data-store/`)

**Interfaces:**
- Consumes: `createStore`, `EMPRESAS` (Task 2); `leerArchivoDeRed`, `descripcionDeError` (Task 3); `splitIntoPeriodBlocks` (Task 1).
- Produces (contratos HTTP que consume Task 5):
  - `POST /api/refresh` → `{ ok: boolean, empresas: { tesi: R, pueblo: R } }` donde
    `R = { ok: boolean, origen: 'red'|null, traidos: string[], preservados: string[], error?: string }`
  - `GET /api/download?empresa=TESI|PUEBLO` → el archivo vigente, `Content-Disposition: attachment; filename="SAP_RESULT.txt"`, o `404 { ok: false, message }`.
  - `GET /api/status` → lo de antes + `manifest: { tesi: {...}, pueblo: {...} }` + `networkPath`.
  - `GET /api/data?empresa=` → sin cambios de contrato.

- [ ] **Step 1: Agregar `SAP_NETWORK_PATH` al `.env`**

Agregar al final de `.env` (no tocar las claves existentes: `PORT`, `SAP_SOURCE_PATH`, `CHECK_HOUR`):

```
SAP_NETWORK_PATH=\\10.0.0.115\Cegid
```

> El `.gitignore` **ya está resuelto** en el commit de setup de la rama:
> `dashboards/EstadoResultado/data-store/` está ignorado junto a `sap-inbox/` en el
> `.gitignore` raíz (sección "Datos de negocio"). No crear un `.gitignore` local ni
> volver a tocarlo.

- [ ] **Step 2: Reescribir la carga en `server.js`**

Reemplazar el bloque de constantes y las funciones `moveToProcessed` / `checkAndLoad` por lo siguiente. `parseFile`, `extractPeriodo`, `loadCache`, `saveCache` y `scheduleDailyCheck` quedan como están.

```js
import { createStore, EMPRESAS } from './server/sap-store.js'
import { leerArchivoDeRed, descripcionDeError } from './server/sap-network.js'
```

Constantes (junto a las existentes):

```js
// Ruta de red READ-ONLY donde SAP deja los archivos una vez por mes.
const SAP_NETWORK_PATH = process.env.SAP_NETWORK_PATH || '\\\\10.0.0.115\\Cegid'
const store = createStore({ dir: path.join(__dirname, 'data-store') })
```

Archivado del histórico (reemplaza `moveToProcessed`, que movía archivos y ahora nunca debe tocar la red):

```js
function archivarTexto(texto, filename) {
  try {
    const destDir = path.join(SAP_SOURCE_PATH, PROCESSED_SUBDIR)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    fs.writeFileSync(path.join(destDir, `${ts}_${filename}`), texto, 'utf8')
  } catch (e) {
    console.error(`[EstadoResultado] Error archivando ${filename}:`, e.message)
  }
}
```

Reparseo del estado en memoria desde el vigente (única fuente de verdad):

```js
function recargarEstadoDesdeStore() {
  for (const key of Object.keys(EMPRESAS)) {
    const texto = store.readVigente(key)
    if (!texto) continue
    const records = parseFile(texto)
    if (records.length > 0) state[key] = records
  }
  state.periodo = extractPeriodo(state.tesi ?? state.pueblo ?? [])
  state.lastUpdate = new Date().toISOString()
  saveCache()
}
```

Migración al primer arranque (si `data-store\` está vacío, sembrar con el archivo más reciente de cada empresa en `SAPResultProcesado\`, todo como origen `sap`):

```js
function migrarSiHaceFalta() {
  const destDir = path.join(SAP_SOURCE_PATH, PROCESSED_SUBDIR)
  if (!fs.existsSync(destDir)) return
  for (const [key, filename] of Object.entries(EMPRESAS)) {
    if (store.readVigente(key)) continue
    const candidatos = fs.readdirSync(destDir).filter(f => f.endsWith(`_${filename}`)).sort()
    const ultimo = candidatos[candidatos.length - 1]
    if (!ultimo) continue
    const texto = fs.readFileSync(path.join(destDir, ultimo), 'utf8')
    const r = store.merge({ empresaKey: key, texto, origen: 'sap' })
    console.log(`[EstadoResultado] Migrado ${key.toUpperCase()} desde ${ultimo}: ${r.traidos.length} periodos`)
  }
}
```

Refresh desde la red (reemplaza `checkAndLoad`), con el inbox local como respaldo para los uploads:

```js
async function checkAndLoad() {
  if (state.isRefreshing) return { ok: false, empresas: {} }
  state.isRefreshing = true
  state.lastCheckAt = new Date().toISOString()
  const empresas = {}

  try {
    for (const [key, filename] of Object.entries(EMPRESAS)) {
      const leido = leerArchivoDeRed(SAP_NETWORK_PATH, filename)
      if (!leido.ok) {
        console.error(`[EstadoResultado] ${filename}: ${leido.code} — ${descripcionDeError(leido.code)}`)
        empresas[key] = { ok: false, origen: null, traidos: [], preservados: [], error: descripcionDeError(leido.code) }
        continue
      }
      const r = store.merge({ empresaKey: key, texto: leido.texto, origen: 'sap' })
      archivarTexto(leido.texto, filename)
      console.log(`[EstadoResultado] ${key.toUpperCase()} desde red — traidos: [${r.traidos}] preservados: [${r.preservados}]`)
      empresas[key] = { ok: true, origen: 'red', traidos: r.traidos, preservados: r.preservados }
    }
    recargarEstadoDesdeStore()
  } finally {
    state.isRefreshing = false
  }

  return { ok: Object.values(empresas).some(e => e.ok), empresas }
}
```

Procesar uploads del inbox (los períodos que traen pasan a `manual`):

```js
async function procesarUploads(nombres) {
  const empresas = {}
  for (const [key, filename] of Object.entries(EMPRESAS)) {
    if (!nombres.includes(filename)) continue
    const p = path.join(SAP_SOURCE_PATH, filename)
    if (!fs.existsSync(p)) continue
    const texto = fs.readFileSync(p, 'utf8')
    const r = store.merge({ empresaKey: key, texto, origen: 'manual' })
    archivarTexto(texto, filename)
    fs.unlinkSync(p)   // el inbox es zona de paso; el vigente ya vive en data-store
    empresas[key] = { ok: true, origen: 'manual', traidos: r.traidos, preservados: [] }
    console.log(`[EstadoResultado] ${key.toUpperCase()} manual — periodos marcados: [${r.traidos}]`)
  }
  recargarEstadoDesdeStore()
  return empresas
}
```

- [ ] **Step 3: Actualizar los endpoints**

`POST /api/refresh` — ahora espera el resultado real:

```js
app.post('/api/refresh', async (req, res) => {
  if (state.isRefreshing) return res.json({ ok: false, message: 'Actualización ya en curso', empresas: {} })
  const r = await checkAndLoad()
  res.json(r)
})
```

`GET /api/download` — sirve el vigente con su nombre original, sin transformar nada:

```js
app.get('/api/download', (req, res) => {
  const empresa = String(req.query.empresa || 'TESI').toUpperCase()
  const key = empresa === 'PUEBLO' ? 'pueblo' : 'tesi'
  const filename = EMPRESAS[key]
  const p = store.vigentePath(key)
  if (!fs.existsSync(p)) {
    return res.status(404).json({ ok: false, message: `Todavía no hay datos cargados para ${empresa}` })
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  fs.createReadStream(p).pipe(res)
})
```

`GET /api/status` — agrega el manifest y la ruta de red:

```js
app.get('/api/status', (req, res) => {
  res.json({
    lastUpdate: state.lastUpdate,
    lastCheckAt: state.lastCheckAt,
    isRefreshing: state.isRefreshing,
    pueblo: { loaded: !!state.pueblo, count: state.pueblo?.length ?? 0 },
    tesi: { loaded: !!state.tesi, count: state.tesi?.length ?? 0 },
    sourcePath: SAP_SOURCE_PATH,
    networkPath: SAP_NETWORK_PATH,
    manifest: store.readManifest()
  })
})
```

`POST /api/upload` — usa `procesarUploads` y responde qué períodos quedaron marcados:

```js
app.post('/api/upload', (req, res) => {
  upload.array('files', 2)(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, message: err.message })
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ ok: false, message: 'No se recibieron archivos' })
    }
    const nombres = req.files.map(f => f.originalname)
    const empresas = await procesarUploads(nombres)
    const periodos = [...new Set(Object.values(empresas).flatMap(e => e.traidos))].sort()
    res.json({ ok: true, message: `Cargado con ajustes manuales: ${nombres.join(', ')} (${periodos.join(', ')})`, empresas })
  })
})
```

Y el arranque, reemplazando el `loadCache()` + `await checkAndLoad()` actual:

```js
loadCache()
migrarSiHaceFalta()
recargarEstadoDesdeStore()
await checkAndLoad()
scheduleDailyCheck()
```

- [ ] **Step 4: Verificar en primer plano**

Detener el servicio para liberar el puerto y correr a mano:

```powershell
Stop-Service dashestadoresultado.exe
cd C:\apps\dashboards\EstadoResultado; $env:PORT=3008; node server.js
```

Expected en consola: la migración desde `SAPResultProcesado\`, y para cada empresa **o bien** `desde red — traidos: [2026-01,...]` **o bien** un error tipificado.

> **PUNTO DE CONTROL — riesgo del spec.** Si el error es `EACCES`/`EPERM` corriendo como Administrador, el problema es de permisos del share. Si corre bien acá pero falla al reiniciar el servicio, el problema es que **SYSTEM** no alcanza la UNC: **parar y avisar al usuario** — hay que decidir cuenta de servicio, y eso requiere su confirmación explícita. No reinstalar el servicio por cuenta propia.

En otra terminal, verificar los tres contratos:

```powershell
curl.exe -s http://localhost:3008/api/status
curl.exe -s -X POST http://localhost:3008/api/refresh
curl.exe -s -o C:\Users\ADMINI~1\AppData\Local\Temp\2\claude\C--apps\4aff3a12-0eae-49ad-ac50-ef1fd5ddd39f\scratchpad\bajado.txt -D - "http://localhost:3008/api/download?empresa=TESI"
```

Expected: `status` trae `manifest` con los períodos en `origen: "sap"`; `refresh` devuelve `traidos`/`preservados`; la descarga responde `Content-Disposition: attachment; filename="SAP_RESULT.txt"`.

- [ ] **Step 5: Verificar la igualdad byte a byte de la descarga**

```powershell
$a = (Get-FileHash C:\apps\dashboards\EstadoResultado\data-store\SAP_RESULT.txt).Hash
$b = (Get-FileHash C:\Users\ADMINI~1\AppData\Local\Temp\2\claude\C--apps\4aff3a12-0eae-49ad-ac50-ef1fd5ddd39f\scratchpad\bajado.txt).Hash
$c = (Get-FileHash \\10.0.0.115\Cegid\SAP_RESULT.txt).Hash
"vigente : $a"; "bajado  : $b"; "de SAP  : $c"
```

Expected: los tres hashes **idénticos** (criterio de aceptación 3 del spec; el tercero coincide solo mientras no haya ajustes manuales cargados).

- [ ] **Step 6: Correr toda la suite y commitear**

```powershell
cd C:\apps\dashboards\EstadoResultado; node --test tests/
```

Expected: PASS en los 3 archivos de test.

```bash
cd C:/apps && git add dashboards/EstadoResultado/server.js dashboards/EstadoResultado/.gitignore && git commit -m "feat(estado-resultado): Actualizar lee de la red y GET /api/download sirve el vigente"
```

---

### Task 5: Frontend — botón Descargar files, badge de mes ajustado, banner real

**Files:**
- Modify: `C:\apps\dashboards\EstadoResultado\src\App.tsx`
  - línea 2: imports de `lucide-react`
  - `handleRefresh` (≈480-490), `handleUpload` (≈492-511)
  - selector de mes (≈559-594), botonera del header (≈596-622)

**Interfaces:**
- Consumes de Task 4: `POST /api/refresh` → `{ ok, empresas: { tesi, pueblo } }`; `GET /api/download?empresa=`; `GET /api/status` → `manifest`.
- Produces: nada (capa final).

- [ ] **Step 1: Agregar el icono `Download` al import de lucide-react**

En la línea 2, agregar `Download` a la lista existente:

```tsx
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevronRightNav, Moon, Sun, Upload, Download } from 'lucide-react'
```

- [ ] **Step 2: Traer el manifest en el estado**

Junto a los `useState` del componente principal (donde ya viven `lastUpdate` y `sourcePath`), agregar el tipo y el estado:

```tsx
type OrigenPeriodo = { origen: 'sap' | 'manual'; cargadoEn: string }
type Manifest = { tesi: Record<string, OrigenPeriodo>; pueblo: Record<string, OrigenPeriodo> }

const [manifest, setManifest] = useState<Manifest | null>(null)
```

En el `useEffect`/función que ya consulta `/api/status` para `sourcePath`, guardar también el manifest:

```tsx
const st = await (await fetch('/api/status')).json()
setSourcePath(st.sourcePath ?? null)
setManifest(st.manifest ?? null)
```

Y un helper para saber si el mes visible tiene ajustes:

```tsx
const ajusteDelPeriodo = useMemo<OrigenPeriodo | null>(() => {
  if (!manifest || !selectedPeriodo) return null
  const m = empresa === 'PUEBLO' ? manifest.pueblo : manifest.tesi
  const info = m?.[selectedPeriodo]
  return info?.origen === 'manual' ? info : null
}, [manifest, empresa, selectedPeriodo])
```

- [ ] **Step 3: `handleRefresh` usa la respuesta real, sin el sleep a ciegas**

Reemplazar la función completa (ya no espera 1500 ms al azar):

```tsx
async function handleRefresh() {
  if (refreshing) return
  setRefreshing(true)
  setUploadMsg(null)
  try {
    const r = await (await fetch('/api/refresh', { method: 'POST' })).json()
    const partes: string[] = []
    for (const [key, label] of [['tesi', 'TESI'], ['pueblo', 'PUEBLO']] as const) {
      const e = r.empresas?.[key]
      if (!e) continue
      if (!e.ok) { partes.push(`${label}: ${e.error}`); continue }
      const traidos = e.traidos?.length ? `${e.traidos.length} mes(es) de SAP` : 'sin cambios'
      const preservados = e.preservados?.length ? `, preservados con ajustes: ${e.preservados.join(', ')}` : ''
      partes.push(`${label}: ${traidos}${preservados}`)
    }
    setUploadMsg({ ok: !!r.ok, text: partes.join(' · ') || 'No se pudo actualizar' })
    await fetchData(empresa)
    const st = await (await fetch('/api/status')).json()
    setManifest(st.manifest ?? null)
  } catch {
    setUploadMsg({ ok: false, text: 'Error al actualizar desde la red' })
  } finally {
    setRefreshing(false)
    setTimeout(() => setUploadMsg(null), 8000)
  }
}
```

- [ ] **Step 4: `handleDownload` baja los dos archivos**

Agregar junto a `handleUpload`:

```tsx
function handleDownload() {
  // Dos descargas separadas, con los nombres originales de SAP intactos.
  for (const [i, emp] of (['TESI', 'PUEBLO'] as const).entries()) {
    setTimeout(() => {
      const a = document.createElement('a')
      a.href = `/api/download?empresa=${emp}`
      a.download = ''
      document.body.appendChild(a)
      a.click()
      a.remove()
    }, i * 400)   // separadas, si no el navegador descarta la segunda
  }
}
```

Y refrescar el manifest tras un upload exitoso — dentro de `handleUpload`, donde dice `if (json.ok) await fetchData(empresa)`:

```tsx
if (json.ok) {
  await fetchData(empresa)
  const st = await (await fetch('/api/status')).json()
  setManifest(st.manifest ?? null)
}
```

- [ ] **Step 5: Botón "Descargar files" en el header**

Insertar **antes** del botón "Subir files" (después del `<input type="file" hidden>`):

```tsx
<button
  onClick={handleDownload}
  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
  title="Descargar SAP_RESULT.txt y SAP_PU_RESULT.txt tal como están cargados, para ajustarlos y volver a subirlos"
>
  <Download className="w-4 h-4" />
  Descargar files
</button>
```

- [ ] **Step 6: Badge ámbar en el selector de mes**

Insertar dentro del contenedor del selector de mes, después del `<select>` y antes del botón de mes siguiente:

```tsx
{ajusteDelPeriodo && (
  <span
    className="w-2 h-2 mr-1 rounded-full bg-amber-500 shrink-0"
    title={`Mes con ajustes manuales, cargado el ${new Date(ajusteDelPeriodo.cargadoEn).toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Actualizar no lo va a sobrescribir.`}
  />
)}
```

- [ ] **Step 7: Build y verificación en el navegador**

```powershell
cd C:\apps\dashboards\EstadoResultado; npm run build
```

Expected: build sin errores de TypeScript.

Con el server corriendo (`node server.js`), abrir `http://localhost:3008` y verificar el circuito completo del spec:

1. **Descargar files** baja los dos `.txt` con sus nombres originales.
2. Editar un importe de un mes en `SAP_RESULT.txt` (p. ej. cambiar un `-107029809.47`), guardar como UTF-8 sin BOM.
3. **Subir files** con ese archivo → el banner informa los períodos marcados y el tablero muestra el valor editado.
4. El mes editado muestra el **punto ámbar** en el selector.
5. Apretar **Actualizar** → el banner dice `preservados con ajustes: <mes>` y **el valor editado sigue ahí** (criterio de aceptación 5).
6. Apretar **Actualizar** de nuevo → mismo resultado (idempotente).

- [ ] **Step 8: Commit**

```bash
cd C:/apps && git add dashboards/EstadoResultado/src/App.tsx && git commit -m "feat(estado-resultado): boton Descargar files, badge de mes ajustado y banner de refresh"
```

> **No commitear `dist/`**: está git-ignored en el repo (`dashboards/**/dist/`). Se
> genera con `npm run build` en el servidor y el servicio lo sirve desde disco.

---

### Task 6: Deploy del servicio y documentación

**Files:**
- Modify: `C:\apps\dashboards\EstadoResultado\CLAUDE.md`
- Modify: `C:\apps\dashboards\EstadoResultado\CONTEXT.md`
- Modify: `C:\apps\portal-src\deploy\OPERATIONS-10.0.0.118.md`

- [ ] **Step 1: Reiniciar el servicio y confirmar que SYSTEM alcanza la UNC**

```powershell
Restart-Service dashestadoresultado.exe
Start-Sleep -Seconds 5
Get-Content C:\apps\dashboards\EstadoResultado\daemon\dashestadoresultado.out.log -Tail 20
```

Expected: `TESI desde red — traidos: [...]` y lo mismo para PUEBLO.

> **PUNTO DE CONTROL.** Si aparece `EACCES`/`EPERM`, **SYSTEM no alcanza el share**. No inventar workarounds: **parar y reportar al usuario** con el código de error exacto, y proponer las opciones (cuenta de servicio de dominio con permisos en `Cegid`, o sesión SMB autenticada). Cambiar la cuenta del servicio requiere su confirmación explícita. El tablero sigue operativo mientras tanto: los archivos vigentes están en `data-store\` y "Subir files" no depende de la red.

- [ ] **Step 2: Verificar por el proxy del portal**

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3008/api/status
```

Expected: `200`. Después, en el navegador, `http://10.0.0.118/d/11/` con **Ctrl+F5** (el `dist` cambió).

- [ ] **Step 3: Actualizar `CLAUDE.md` de EstadoResultado**

En la sección "Flujo de datos SAP", reemplazar el flujo manual de 3 pasos por el nuevo:

```markdown
## Flujo de datos SAP (MUY IMPORTANTE)

SAP deja los `.txt` en `\\10.0.0.115\Cegid` una vez por mes. El botón **Actualizar** del
tablero (y el chequeo diario de las 01:00) los lee **directo de esa ruta de red**, que es
**read-only**: nunca se borra ni mueve nada ahí. Ya no hay que copiar archivos a mano.

- `SAP_NETWORK_PATH=\\10.0.0.115\Cegid` — fuente read-only.
- `SAP_SOURCE_PATH=...\sap-inbox` — inbox local: destino de los uploads manuales.

**La unidad de datos es el mes, no el archivo.** `data-store\manifest.json` guarda el origen
de cada período por empresa (`sap` o `manual`):

- **Actualizar** trae de la red solo los períodos con origen `sap` o inexistentes.
- **Subir files** marca como `manual` los períodos del archivo subido; una lectura de red
  **nunca** los pisa. Solo otro upload los reemplaza.

Circuito operativo: SAP deja los archivos → Actualizar los carga → **Descargar files** baja
los vigentes (byte a byte iguales) → el usuario ajusta importes a mano → **Subir files** los
devuelve → el tablero muestra los datos ajustados y los conserva.

`data-store\SAP_RESULT.txt` y `SAP_PU_RESULT.txt` son el estado vigente y lo que sirve la
descarga: **lo que se ve en pantalla es exactamente lo que se baja**. Se reconstruyen copiando
líneas textuales — nunca reformatear importes (SAP escribe `.00`, no `0.00`).
`sap-inbox\SAPResultProcesado\` es el histórico con timestamp.
```

Agregar `GET /api/download` a la tabla de endpoints y, en Gotchas:

```markdown
- Los tests corren con el runner de Node, sin dependencias: `node --test tests/`. El test de
  round-trip de `sap-format` valida la igualdad byte a byte contra los archivos SAP reales;
  si falla, el formato cambió — no seguir sin entender el diff.
- El servicio corre como SYSTEM: si el log muestra `EACCES`/`EPERM` sobre la ruta de red,
  es permisos del share, no un bug del código.
```

- [ ] **Step 4: Actualizar `CONTEXT.md`**

Reemplazar la sección "Refresh automático" y agregar el modelo de datos:

```markdown
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

## Igualdad byte a byte

`data-store\SAP_RESULT.txt` / `SAP_PU_RESULT.txt` son el estado vigente y también lo que
entrega `GET /api/download`. Se reconstruyen concatenando **líneas textuales** por período
(`server/sap-format.js`), con CRLF y CRLF final, sin BOM. Los importes de SAP vienen como
`.00` y `-107029809.47`: regenerarlos desde `parseFloat` daría `0.00` y rompería el circuito,
porque el usuario edita ese mismo archivo y lo devuelve.

## Refresh

- Botón **Actualizar** → `POST /api/refresh`: lee `\\10.0.0.115\Cegid` (read-only), mergea por
  período y devuelve qué trajo y qué preservó. La UI lo muestra en el banner.
- Chequeo automático diario a las **01:00** (`CHECK_HOUR`), con la misma regla.
- Si la red falla, el tablero sigue sirviendo `data-store\` y la UI informa el error
  (`ENOENT` = SAP no dejó el archivo; `EACCES`/`EPERM` = permisos de SYSTEM sobre el share).
```

Actualizar la tabla de endpoints con `GET /api/download?empresa=` y la de archivos clave con
`server/sap-format.js`, `server/sap-store.js`, `server/sap-network.js`, `data-store/`, `tests/`.

- [ ] **Step 5: Anotar en `OPERATIONS-10.0.0.118.md`**

Agregar en la sección de EstadoResultado (o al final, siguiendo el formato del archivo):

```markdown
### EstadoResultado (3008) — jul 2026: refresh desde la red

El botón Actualizar lee `\\10.0.0.115\Cegid` directo (read-only); ya no hace falta copiar
archivos al inbox a mano. Nueva variable en el `.env`: `SAP_NETWORK_PATH`.

El estado vigente vive en `data-store\` con un `manifest.json` que marca cada período como
`sap` o `manual`; los meses con ajustes manuales no se pisan con la red. Nuevo endpoint
`GET /api/download?empresa=` (sirve el archivo vigente byte a byte, para el circuito
descargar → ajustar → subir).

El servicio corre como **SYSTEM**: si el log `daemon\dashestadoresultado.out.log` muestra
`EACCES`/`EPERM` sobre la ruta de red, es permisos del share — hay que darle al servicio una
cuenta con acceso a `Cegid`. Mientras tanto "Subir files" funciona igual.
```

- [ ] **Step 6: Commit final**

```bash
cd C:/apps && git add dashboards/EstadoResultado/CLAUDE.md dashboards/EstadoResultado/CONTEXT.md portal-src/deploy/OPERATIONS-10.0.0.118.md && git commit -m "docs(estado-resultado): refresh desde la red, descarga byte-exacta y merge por periodo"
```

---

## Verificación final (criterios de aceptación del spec)

Correr después de la Task 6, con el servicio activo:

- [ ] 1. Los `.txt` **siguen en** `\\10.0.0.115\Cegid` después de varios Actualizar:
  `Get-ChildItem \\10.0.0.115\Cegid\SAP*RESULT.txt | ft Name,Length,LastWriteTime`
- [ ] 2. Idempotencia: apretar Actualizar 3 veces → el hash de `data-store\SAP_RESULT.txt` no cambia.
- [ ] 3. Descarga byte-exacta: hash de lo bajado = hash del vigente = hash del de SAP (sin ajustes cargados).
- [ ] 4. Descargar → editar un importe → Subir → el tablero muestra el valor editado.
- [ ] 5. Después de (4), Actualizar **no** revierte el valor y el banner informa el mes preservado.
- [ ] 6. Un mes nuevo de SAP entra por Actualizar aunque haya meses en `manual`.
- [ ] 7. Con la red caída (probar con `SAP_NETWORK_PATH` apuntando a una ruta inexistente en primer plano), el tablero sigue mostrando datos y la UI informa el error.
- [ ] 8. `node --test tests/` en verde.
