# ControlCaja — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Goal:** Dashboard de solo lectura que muestra, por empresa y por mes, una matriz sucursal × día con las Diferencias de Caja que SAP reporta en `\\10.0.0.115\Cegid`, con drill-down al asiento del día.

**Architecture:** Express ESM lee los dos `.txt` de la UNC bajo demanda, cachea el parseo en memoria invalidado por `mtime`+`size`, y expone cuatro endpoints GET. React 19 + Vite consume esos endpoints y renderiza una sola vista. Cero estado en disco: sin `data-store`, sin manifest, sin uploads, sin scheduler.

**Tech Stack:** Node 20+ ESM, Express 4, React 19, Vite 6, TypeScript 5.8, Tailwind CSS 4 (plugin `@tailwindcss/vite`), `lucide-react` para iconos, runner de tests nativo de Node (`node --test`). Sin `mssql`, sin `multer`, sin `recharts`.

**Spec:** `docs/superpowers/specs/2026-08-03-controlcaja-design.md` — leerlo antes de empezar.

## Global Constraints

- Carpeta del proyecto: `C:\apps\dashboards\ControlCaja`. Rutas **locales** siempre, nunca UNC para archivos del proyecto (la única UNC es la fuente de datos read-only).
- Puerto **3014**. Bind `const HOST = process.env.HOST || '127.0.0.1'` — solo loopback.
- `package.json` lleva `"type": "module"`. Todo el backend es **ESM**: `import`, nunca `require()`.
- La UNC `\\10.0.0.115\Cegid` es **READ-ONLY**: el código nunca escribe, mueve ni borra nada ahí. No hay una sola llamada a `fs.writeFile`/`unlink`/`rename` sobre esa ruta en todo el proyecto.
- Nada de `new Date(...)` para parsear fechas del archivo. Las fechas se manejan como **strings** `'YYYY-MM-DD'`, `'YYYY-MM'` y `'DD'`. Esto elimina de raíz el corrimiento de día por zona horaria.
- Cuenta de control: `4.2.002.01.050`, exportada como constante `CUENTA_DIFERENCIAS_CAJA`. Ningún módulo fuera de `control-caja.js` la menciona literalmente.
- Signo: `saldo > 0` = **faltante**; `saldo < 0` = **sobrante**. Tolerancia de cero: `Math.abs(x) < 0.005`.
- Idioma de la UI: español, con acentos correctos. Importes en formato `es-AR`.
- Los archivos de código se escriben con la herramienta Write/Edit, **nunca** con `Set-Content`/`Get-Content` de PowerShell (corrompe UTF-8 sin BOM).
- Tests: `node --test "tests/*.test.js"` — **el glob va entre comillas**, si no falla en git-bash con `MODULE_NOT_FOUND`.
- No commitear `.env`. Sí commitear `.env.example`.
- **No instalar el servicio de Windows ni tocar el portal sin confirmación explícita del usuario** (regla de `C:\apps\dashboards\CLAUDE.md`). Eso es la Tarea 10 y arranca pidiendo permiso.

## Estructura de archivos

```
C:\apps\dashboards\ControlCaja\
├── package.json                    deps y scripts
├── tsconfig.json                   config TS (copiada de EstadoResultado)
├── vite.config.ts                  React + Tailwind + proxy /api a 3014
├── index.html                      entrada de Vite
├── .env / .env.example             PORT, SAP_NETWORK_PATH
├── CLAUDE.md                       guía del dashboard (Tarea 10)
├── data/
│   └── sucursales.json             mapeo código → nombre, editable a mano
├── server/
│   ├── reporte-source.js           stat + readFile de la UNC, errores tipificados
│   ├── reporte-parse.js            texto → registros + descartadas
│   ├── empresas.js                 registro EMPRESAS + helpers
│   ├── control-caja.js             matriz, resumen y asiento (la lógica de negocio)
│   ├── reporte-cache.js            compone source+parse, cachea por mtime+size
│   └── app.js                      crearApp(): rutas Express, sin listen()
├── server.js                       lee .env, arma la cache, app.listen()
├── src/
│   ├── main.tsx                    bootstrap React
│   ├── index.css                   Tailwind + variables de la paleta
│   ├── App.tsx                     composición y estado de la vista
│   ├── lib/
│   │   ├── utils.ts                cn()
│   │   ├── api.ts                  tipos + llamadas a /api
│   │   └── formato.ts              formato de importes y escala de color
│   └── components/
│       ├── ui/card.tsx             Card (copiado de EstadoResultado)
│       ├── Encabezado.tsx          selectores, frescura, refrescar, aviso
│       ├── TarjetasResumen.tsx     4 tarjetas
│       ├── MatrizDiferencias.tsx   la matriz sucursal × día
│       └── PanelAsiento.tsx        panel lateral con el asiento del día
└── tests/
    ├── fixtures/
    │   ├── tesi-crlf.txt           líneas reales de SAP_REPORTE_Z (CRLF)
    │   └── pueblo-lf.txt           líneas reales de SAP_PU_REPORTE_Z (LF)
    ├── reporte-parse.test.js
    ├── reporte-source.test.js
    ├── control-caja.test.js
    ├── reporte-cache.test.js
    └── app.test.js
```

**Por qué `app.js` separado de `server.js`:** `crearApp()` devuelve la app Express sin escuchar, así los tests de API la levantan en un puerto efímero sin arrancar el servicio real ni depender de la UNC (le inyectan una cache falsa).

---

### Task 1: Scaffolding + `reporte-source.js`

Primer entregable testeable: el proyecto arranca y sabe leer la UNC informando errores útiles.

**Files:**
- Create: `C:\apps\dashboards\ControlCaja\package.json`
- Create: `C:\apps\dashboards\ControlCaja\tsconfig.json`
- Create: `C:\apps\dashboards\ControlCaja\.env.example`
- Create: `C:\apps\dashboards\ControlCaja\.env`
- Create: `C:\apps\dashboards\ControlCaja\.gitignore`
- Create: `C:\apps\dashboards\ControlCaja\server\reporte-source.js`
- Test: `C:\apps\dashboards\ControlCaja\tests\reporte-source.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `statArchivo(networkPath: string, filename: string): {ok: true, mtimeMs: number, size: number} | {ok: false, code: string, message: string}`
  - `leerArchivo(networkPath: string, filename: string): {ok: true, texto: string} | {ok: false, code: string, message: string}`
  - `descripcionDeError(code: string): string`

- [ ] **Step 1: Crear el scaffolding del proyecto**

`package.json`:

```json
{
  "name": "control-caja",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port=3100 --host=127.0.0.1",
    "build": "vite build",
    "serve": "node server.js",
    "test": "node --test \"tests/*.test.js\""
  },
  "dependencies": {
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "dotenv": "^16.6.1",
    "express": "^4.21.2",
    "lucide-react": "^0.546.0",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "vite": "^6.2.3"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.8.3"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": { "@/*": ["./*"] },
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true
  }
}
```

`.env.example` (y `.env` con el mismo contenido):

```
PORT=3014
SAP_NETWORK_PATH=\\10.0.0.115\Cegid
```

`.gitignore`:

```
node_modules/
dist/
daemon/
.env
```

- [ ] **Step 2: Instalar dependencias**

Run: `cd C:\apps\dashboards\ControlCaja; npm install`
Expected: `node_modules/` creado, sin errores de resolución.

- [ ] **Step 3: Escribir el test que falla**

`tests/reporte-source.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { statArchivo, leerArchivo, descripcionDeError } from '../server/reporte-source.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-source-'))
fs.writeFileSync(path.join(tmp, 'OK.TXT'), 'hola', 'utf8')

test('leerArchivo devuelve el texto de un archivo existente', () => {
  const r = leerArchivo(tmp, 'OK.TXT')
  assert.equal(r.ok, true)
  assert.equal(r.texto, 'hola')
})

test('statArchivo devuelve mtimeMs y size', () => {
  const r = statArchivo(tmp, 'OK.TXT')
  assert.equal(r.ok, true)
  assert.equal(r.size, 4)
  assert.equal(typeof r.mtimeMs, 'number')
})

test('leerArchivo tipifica ENOENT en lugar de lanzar', () => {
  const r = leerArchivo(tmp, 'NO_EXISTE.TXT')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
})

test('statArchivo tipifica ENOENT en lugar de lanzar', () => {
  const r = statArchivo(tmp, 'NO_EXISTE.TXT')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
})

test('descripcionDeError da un mensaje distinto por causa', () => {
  assert.match(descripcionDeError('ENOENT'), /no dejó el archivo/)
  assert.match(descripcionDeError('EACCES'), /permiso/)
  assert.match(descripcionDeError('EPERM'), /permiso/)
  assert.match(descripcionDeError('ETIMEDOUT'), /no responde/)
  assert.match(descripcionDeError('LO_QUE_SEA'), /No se pudo leer/)
})
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/reporte-source.test.js"`
Expected: FAIL — `Cannot find module '../server/reporte-source.js'`

- [ ] **Step 5: Implementar `server/reporte-source.js`**

```js
import fs from 'node:fs'
import path from 'node:path'

/**
 * Acceso de SOLO LECTURA a la ruta de red de SAP. Este modulo nunca escribe,
 * mueve ni borra nada: el share \\10.0.0.115\Cegid es read-only.
 *
 * Devuelve el error tipificado en lugar de lanzar. Distinguir "SAP todavia no
 * dejo el archivo" (ENOENT) de "el servicio no tiene permiso" (EACCES/EPERM) es
 * clave para diagnosticar, porque el servicio se presenta en la red con su
 * propia cuenta y los dos casos se ven igual desde el navegador.
 */
export function statArchivo(networkPath, filename) {
  try {
    const s = fs.statSync(path.join(networkPath, filename))
    return { ok: true, mtimeMs: s.mtimeMs, size: s.size }
  } catch (e) {
    return { ok: false, code: e.code || 'UNKNOWN', message: e.message }
  }
}

export function leerArchivo(networkPath, filename) {
  try {
    return { ok: true, texto: fs.readFileSync(path.join(networkPath, filename), 'utf8') }
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
      return 'Sin permiso para leer la ruta de red'
    case 'ETIMEDOUT':
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
      return 'La ruta de red no responde'
    default:
      return 'No se pudo leer la ruta de red'
  }
}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/reporte-source.test.js"`
Expected: PASS — 5 tests.

- [ ] **Step 7: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): scaffolding y lectura read-only de la UNC de SAP"
```

---

### Task 2: `reporte-parse.js`

**Files:**
- Create: `C:\apps\dashboards\ControlCaja\server\reporte-parse.js`
- Create: `C:\apps\dashboards\ControlCaja\tests\fixtures\tesi-crlf.txt`
- Create: `C:\apps\dashboards\ControlCaja\tests\fixtures\pueblo-lf.txt`
- Test: `C:\apps\dashboards\ControlCaja\tests\reporte-parse.test.js`

**Interfaces:**
- Consumes: nada (módulo puro).
- Produces:
  - `parsearReporte(texto: string): {registros: Registro[], descartadas: {linea: string, motivo: string}[]}`
  - `Registro = {fechaISO: string, periodo: string, dia: string, sucursal: string, cuentaCodigo: string, cuentaNombre: string, debe: number, haber: number, saldo: number}`
  - `fechaISO` = `'2026-06-03'`, `periodo` = `'2026-06'`, `dia` = `'03'` — todo string, sin `Date`.

- [ ] **Step 1: Crear los fixtures con líneas reales**

`tests/fixtures/tesi-crlf.txt` — **debe guardarse con CRLF**. Contenido (7 líneas, todas reales del archivo de producción):

```
03/06/2026 0:00:00|003|1.1.001.01.009 - Caja Recaudadora Suc 3|270000.00|270000.00|.00
03/06/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|.00|20500.00|-20500.00
03/06/2026 0:00:00|020|4.2.002.01.050 - Diferencias de Caja|23200.00|.00|23200.00
03/06/2026 0:00:00|020|1.1.001.01.024 - Caja Recaudadora Suc 20|400050.00|423250.00|-23200.00
20/06/2026 0:00:00|017|4.2.002.01.050 - Diferencias de Caja|567453.02|4085803.00|-3518349.98
03/06/2026 0:00:00|03/06/2026|1.1.003.06.007 - IVA - Credito Fiscal 21%|2007921.94|.00|2007921.94
03/06/2026 0:00:00|03/06/2026|2.1.001.01.001 - Proveedores Mercadería|.00|11570411.16|-11570411.16
```

Para garantizar el CRLF, generarlo con Node en lugar de a mano:

```bash
cd /c/apps/dashboards/ControlCaja && node -e "
const fs=require('node:fs');
const l=[
'03/06/2026 0:00:00|003|1.1.001.01.009 - Caja Recaudadora Suc 3|270000.00|270000.00|.00',
'03/06/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|.00|20500.00|-20500.00',
'03/06/2026 0:00:00|020|4.2.002.01.050 - Diferencias de Caja|23200.00|.00|23200.00',
'03/06/2026 0:00:00|020|1.1.001.01.024 - Caja Recaudadora Suc 20|400050.00|423250.00|-23200.00',
'20/06/2026 0:00:00|017|4.2.002.01.050 - Diferencias de Caja|567453.02|4085803.00|-3518349.98',
'03/06/2026 0:00:00|03/06/2026|1.1.003.06.007 - IVA - Credito Fiscal 21%|2007921.94|.00|2007921.94',
'03/06/2026 0:00:00|03/06/2026|2.1.001.01.001 - Proveedores Mercadería|.00|11570411.16|-11570411.16'
];
fs.mkdirSync('tests/fixtures',{recursive:true});
fs.writeFileSync('tests/fixtures/tesi-crlf.txt', l.join('\r\n')+'\r\n','utf8');
"
```

**Ojo:** ese snippet usa `require` a propósito — corre bajo `node -e`, que es CJS por defecto y no está afectado por `"type":"module"` del package.json.

`tests/fixtures/pueblo-lf.txt` — **con LF**, mismas dos primeras líneas del archivo real de PUEBLO:

```bash
cd /c/apps/dashboards/ControlCaja && node -e "
const fs=require('node:fs');
const l=[
'03/06/2026 0:00:00|002|1.1.001.01.008 - Caja Recaudadora Suc 2|58800.00|58700.00|100.00',
'03/06/2026 0:00:00|002|4.2.002.01.050 - Diferencias de Caja|100.00|.00|100.00'
];
fs.writeFileSync('tests/fixtures/pueblo-lf.txt', l.join('\n')+'\n','utf8');
"
```

Verificar los fines de línea:
Run: `cd /c/apps/dashboards/ControlCaja && file tests/fixtures/*.txt`
Expected: `tesi-crlf.txt` menciona CRLF; `pueblo-lf.txt` no.

- [ ] **Step 2: Escribir el test que falla**

`tests/reporte-parse.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parsearReporte } from '../server/reporte-parse.js'

const tesi = fs.readFileSync('tests/fixtures/tesi-crlf.txt', 'utf8')
const pueblo = fs.readFileSync('tests/fixtures/pueblo-lf.txt', 'utf8')

test('parsea CRLF (TESI) sin dejar \\r en los campos', () => {
  const { registros } = parsearReporte(tesi)
  assert.equal(registros.length, 5)   // 7 lineas - 2 sin sucursal
  for (const r of registros) {
    assert.ok(!JSON.stringify(r).includes('\\r'), `quedo un \\r en ${JSON.stringify(r)}`)
  }
})

test('parsea LF (PUEBLO) igual que CRLF', () => {
  const { registros, descartadas } = parsearReporte(pueblo)
  assert.equal(registros.length, 2)
  assert.equal(descartadas.length, 0)
  assert.equal(registros[0].sucursal, '002')
})

test('la fecha se parte en strings sin usar Date', () => {
  const { registros } = parsearReporte(tesi)
  const r = registros[0]
  assert.equal(r.fechaISO, '2026-06-03')
  assert.equal(r.periodo, '2026-06')
  assert.equal(r.dia, '03')
})

test('el importe ".00" es 0 y el negativo se respeta', () => {
  const { registros } = parsearReporte(tesi)
  const dif003 = registros.find(r => r.sucursal === '003' && r.cuentaCodigo === '4.2.002.01.050')
  assert.equal(dif003.debe, 0)
  assert.equal(dif003.haber, 20500)
  assert.equal(dif003.saldo, -20500)
})

test('saldo = debe - haber en una linea con debe y haber a la vez', () => {
  const { registros } = parsearReporte(tesi)
  const r = registros.find(r => r.sucursal === '017')
  assert.equal(r.debe, 567453.02)
  assert.equal(r.haber, 4085803)
  assert.ok(Math.abs(r.saldo - (r.debe - r.haber)) < 0.005)
  assert.equal(r.saldo, -3518349.98)
})

test('la cuenta se parte en codigo y nombre en el primer " - "', () => {
  const { registros } = parsearReporte(tesi)
  const r = registros[0]
  assert.equal(r.cuentaCodigo, '1.1.001.01.009')
  assert.equal(r.cuentaNombre, 'Caja Recaudadora Suc 3')
})

test('un nombre de cuenta con " - " adentro no se trunca', () => {
  // "IVA - Credito Fiscal 21%": el segundo " - " es parte del nombre.
  // Se prueba con sucursal valida para que no caiga en descartadas.
  const linea = '03/06/2026 0:00:00|003|1.1.003.06.007 - IVA - Credito Fiscal 21%|1.00|.00|1.00'
  const { registros } = parsearReporte(linea)
  assert.equal(registros[0].cuentaCodigo, '1.1.003.06.007')
  assert.equal(registros[0].cuentaNombre, 'IVA - Credito Fiscal 21%')
})

test('las lineas con fecha en el campo 2 van a descartadas, no a registros', () => {
  const { registros, descartadas } = parsearReporte(tesi)
  assert.equal(descartadas.length, 2)
  assert.ok(descartadas.every(d => /sucursal/i.test(d.motivo)))
  assert.ok(registros.every(r => /^\d{3}$/.test(r.sucursal)))
})

test('lineas vacias y sin pipes se ignoran sin contarlas como descartadas', () => {
  const { registros, descartadas } = parsearReporte('\n   \n\n')
  assert.equal(registros.length, 0)
  assert.equal(descartadas.length, 0)
})

test('una linea con importe no numerico va a descartadas', () => {
  const linea = '03/06/2026 0:00:00|003|1.1.001.01.009 - Caja|N/D|.00|.00'
  const { registros, descartadas } = parsearReporte(linea)
  assert.equal(registros.length, 0)
  assert.equal(descartadas.length, 1)
  assert.match(descartadas[0].motivo, /importe/i)
})

test('una linea con menos de 6 campos va a descartadas', () => {
  const { registros, descartadas } = parsearReporte('03/06/2026 0:00:00|003|Caja|1.00')
  assert.equal(registros.length, 0)
  assert.equal(descartadas.length, 1)
  assert.match(descartadas[0].motivo, /campos/i)
})

test('una fecha con formato invalido va a descartadas', () => {
  const linea = '2026-06-03|003|1.1.001.01.009 - Caja|1.00|.00|1.00'
  const { registros, descartadas } = parsearReporte(linea)
  assert.equal(registros.length, 0)
  assert.match(descartadas[0].motivo, /fecha/i)
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/reporte-parse.test.js"`
Expected: FAIL — `Cannot find module '../server/reporte-parse.js'`

- [ ] **Step 4: Implementar `server/reporte-parse.js`**

```js
/**
 * Parseo del reporte Z de SAP: pipe-delimited, sin encabezado, 6 campos.
 *
 *   fecha|sucursal|cuenta|debe|haber|saldo
 *   03/06/2026 0:00:00|003|1.1.001.01.009 - Caja Recaudadora Suc 3|270000.00|270000.00|.00
 *
 * Dos particularidades de los archivos reales que este modulo absorbe:
 *
 *  1. Los dos archivos NO usan el mismo fin de linea: SAP_REPORTE_Z.TXT viene
 *     con CRLF y SAP_PU_REPORTE_Z.TXT con LF. Se normaliza antes de partir.
 *  2. En ~600 lineas el campo 2 trae una FECHA en lugar del codigo de sucursal
 *     (siempre en cuentas de compras). No pertenecen a ninguna sucursal, asi
 *     que no pueden entrar en un control de caja por sucursal: van a
 *     `descartadas` con su motivo. Se cuentan y se informan en la UI a
 *     proposito — el reporte se va a corregir en origen, y cuando eso pase el
 *     contador tiene que bajar a cero de forma visible en vez de que el cambio
 *     ocurra en silencio.
 *
 * Las fechas se devuelven como STRINGS ('2026-06-03', '2026-06', '03'), nunca
 * como Date: construir un Date desde 'dd/mm/yyyy' y despues formatearlo es la
 * via clasica a que un movimiento del dia 1 aparezca el ultimo dia del mes
 * anterior por zona horaria.
 */

const RE_SUCURSAL = /^\d{3}$/
const RE_FECHA = /^(\d{2})\/(\d{2})\/(\d{4})\b/
const RE_IMPORTE = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/

function parsearImporte(raw) {
  const s = raw.trim()
  if (!RE_IMPORTE.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function parsearReporte(texto) {
  const registros = []
  const descartadas = []

  const lineas = String(texto ?? '').replace(/\r\n?/g, '\n').split('\n')

  for (const linea of lineas) {
    // Linea vacia o sin separadores: ruido de formato, no un dato perdido.
    // No cuenta como descartada para que el contador de la UI signifique
    // "datos que SAP mando mal", no "el archivo termina en un salto de linea".
    if (!linea.trim() || !linea.includes('|')) continue

    const campos = linea.split('|')
    if (campos.length < 6) {
      descartadas.push({ linea, motivo: `Se esperaban 6 campos y llegaron ${campos.length}` })
      continue
    }

    const [rawFecha, rawSucursal, rawCuenta, rawDebe, rawHaber, rawSaldo] = campos

    const mf = RE_FECHA.exec(rawFecha.trim())
    if (!mf) {
      descartadas.push({ linea, motivo: `Fecha con formato inesperado: "${rawFecha.trim()}"` })
      continue
    }
    const [, dia, mes, anio] = mf

    const sucursal = rawSucursal.trim()
    if (!RE_SUCURSAL.test(sucursal)) {
      descartadas.push({ linea, motivo: `El campo de sucursal no es un código de 3 dígitos: "${sucursal}"` })
      continue
    }

    const debe = parsearImporte(rawDebe)
    const haber = parsearImporte(rawHaber)
    const saldo = parsearImporte(rawSaldo)
    if (debe === null || haber === null || saldo === null) {
      descartadas.push({ linea, motivo: 'Importe no numérico' })
      continue
    }

    // Primer " - ": el codigo nunca lo contiene, pero el nombre si
    // ("IVA - Credito Fiscal 21%"), asi que partir por todas las ocurrencias
    // truncaria el nombre.
    const cuenta = rawCuenta.trim()
    const sep = cuenta.indexOf(' - ')
    const cuentaCodigo = sep === -1 ? cuenta : cuenta.slice(0, sep).trim()
    const cuentaNombre = sep === -1 ? '' : cuenta.slice(sep + 3).trim()

    registros.push({
      fechaISO: `${anio}-${mes}-${dia}`,
      periodo: `${anio}-${mes}`,
      dia,
      sucursal,
      cuentaCodigo,
      cuentaNombre,
      debe,
      haber,
      saldo
    })
  }

  return { registros, descartadas }
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/reporte-parse.test.js"`
Expected: PASS — 12 tests.

- [ ] **Step 6: Verificar contra los archivos reales de producción**

Este chequeo no es un test automatizado (depende de la red), es una verificación manual una sola vez:

```bash
cd /c/apps/dashboards/ControlCaja && node -e "
import('./server/reporte-parse.js').then(async m => {
  const fs = await import('node:fs');
  for (const f of ['SAP_REPORTE_Z.TXT','SAP_PU_REPORTE_Z.TXT']) {
    const t = fs.readFileSync('//10.0.0.115/Cegid/'+f,'utf8');
    const r = m.parsearReporte(t);
    const motivos = {};
    for (const d of r.descartadas) { const k = d.motivo.replace(/\".*\"/,'\"…\"'); motivos[k]=(motivos[k]||0)+1 }
    console.log(f, 'registros:', r.registros.length, 'descartadas:', r.descartadas.length, motivos);
  }
})
"
```

Expected (**actualizado el 03/08/2026 a las 17:00**): `SAP_REPORTE_Z.TXT` ≈ 3.400 registros y **0 descartadas**; `SAP_PU_REPORTE_Z.TXT` ≈ 3.400 y 0. El usuario corrigió el reporte en origen a las 12:47 y las ~600 líneas con fecha en el campo de sucursal **ya no vienen**. Cero descartadas es hoy el resultado correcto, no un parser que no detecta nada — los tests unitarios cubren el caso con fixtures.

Si aparece **cualquier** motivo de descarte (sucursal, campos, fecha, importe), el formato trae un caso nuevo: **detenerse e investigarlo**, no ajustar el test.

- [ ] **Step 7: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): parser del reporte Z con CRLF/LF y lineas sin sucursal"
```

---

### Task 3: `empresas.js` + `data/sucursales.json`

**Files:**
- Create: `C:\apps\dashboards\ControlCaja\server\empresas.js`
- Create: `C:\apps\dashboards\ControlCaja\data\sucursales.json`
- Test: `C:\apps\dashboards\ControlCaja\tests\empresas.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `EMPRESAS: Record<string, {archivo: string, label: string}>` — claves `'TESI'`, `'PUEBLO'`.
  - `listaDeEmpresas(): {clave: string, label: string}[]`
  - `empresaValida(clave: string): boolean`
  - `normalizarClave(raw: string): string | null` — case-insensitive, devuelve la clave canónica o `null`.
  - `cargarNombresSucursal(rutaJson: string): Record<string, string>`

- [ ] **Step 1: Escribir el test que falla**

`tests/empresas.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EMPRESAS, listaDeEmpresas, empresaValida, normalizarClave, cargarNombresSucursal } from '../server/empresas.js'

test('el registro tiene TESI y PUEBLO apuntando a los archivos de SAP', () => {
  assert.equal(EMPRESAS.TESI.archivo, 'SAP_REPORTE_Z.TXT')
  assert.equal(EMPRESAS.PUEBLO.archivo, 'SAP_PU_REPORTE_Z.TXT')
})

test('INDO todavia no esta en el registro', () => {
  // El spec lo deja explicitamente fuera: no existe la exportacion.
  assert.equal(EMPRESAS.INDO, undefined)
})

test('listaDeEmpresas devuelve clave y label para el selector', () => {
  const l = listaDeEmpresas()
  assert.deepEqual(l, [{ clave: 'TESI', label: 'TESI' }, { clave: 'PUEBLO', label: 'PUEBLO' }])
})

test('normalizarClave acepta minusculas y rechaza lo desconocido', () => {
  assert.equal(normalizarClave('tesi'), 'TESI')
  assert.equal(normalizarClave('PUEBLO'), 'PUEBLO')
  assert.equal(normalizarClave('INDO'), null)
  assert.equal(normalizarClave(''), null)
  assert.equal(normalizarClave(undefined), null)
})

test('empresaValida coincide con el registro', () => {
  assert.equal(empresaValida('TESI'), true)
  assert.equal(empresaValida('INDO'), false)
})

test('cargarNombresSucursal lee el json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-suc-'))
  const p = path.join(tmp, 's.json')
  fs.writeFileSync(p, JSON.stringify({ '003': 'Centro' }), 'utf8')
  assert.deepEqual(cargarNombresSucursal(p), { '003': 'Centro' })
})

test('cargarNombresSucursal devuelve {} si el archivo no existe o esta corrupto', () => {
  // El mapeo es cosmetico: si falta, la matriz se rotula con el codigo. Nunca
  // debe tumbar el arranque del dashboard por un json mal editado a mano.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-suc-'))
  assert.deepEqual(cargarNombresSucursal(path.join(tmp, 'no-existe.json')), {})
  const roto = path.join(tmp, 'roto.json')
  fs.writeFileSync(roto, '{ esto no es json', 'utf8')
  assert.deepEqual(cargarNombresSucursal(roto), {})
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/empresas.test.js"`
Expected: FAIL — `Cannot find module '../server/empresas.js'`

- [ ] **Step 3: Implementar `server/empresas.js`**

```js
import fs from 'node:fs'

/**
 * Registro de empresas: clave canonica -> archivo en la UNC + label de UI.
 *
 * SUMAR UNA EMPRESA ES UNA LINEA ACA. /api/empresas publica este registro y el
 * frontend arma el selector con eso, asi que no hay que tocar la UI. INDO esta
 * pendiente: el usuario planea generar la exportacion, y cuando exista alcanza
 * con agregar { INDO: { archivo: '...', label: 'INDO' } }.
 */
export const EMPRESAS = {
  TESI: { archivo: 'SAP_REPORTE_Z.TXT', label: 'TESI' },
  PUEBLO: { archivo: 'SAP_PU_REPORTE_Z.TXT', label: 'PUEBLO' }
}

export function listaDeEmpresas() {
  return Object.entries(EMPRESAS).map(([clave, { label }]) => ({ clave, label }))
}

export function empresaValida(clave) {
  return Object.hasOwn(EMPRESAS, clave)
}

/**
 * Empresa desconocida devuelve null y el llamador responde 400. NUNCA un
 * fallback silencioso a TESI: mostrar los numeros de una empresa bajo el
 * nombre de otra es peor que un error visible.
 */
export function normalizarClave(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const clave = raw.trim().toUpperCase()
  return empresaValida(clave) ? clave : null
}

/**
 * Mapeo codigo -> nombre de sucursal. Es cosmetico: los archivos de SAP solo
 * traen el codigo, y un codigo ausente del mapeo se rotula con el codigo solo.
 * Por eso cualquier problema de lectura o de JSON devuelve {} en vez de lanzar:
 * un json mal editado a mano no puede dejar el dashboard sin arrancar.
 */
export function cargarNombresSucursal(rutaJson) {
  try {
    const obj = JSON.parse(fs.readFileSync(rutaJson, 'utf8'))
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch {
    return {}
  }
}
```

- [ ] **Step 4: Crear `data/sucursales.json`**

Todos los códigos observados en los archivos reales, con nombre vacío donde no se conoce. El usuario los completa después (es un pendiente declarado del spec).

```json
{
  "002": "",
  "003": "",
  "004": "",
  "005": "",
  "008": "",
  "009": "",
  "010": "",
  "011": "",
  "012": "",
  "013": "",
  "015": "",
  "016": "",
  "017": "",
  "018": "",
  "019": "",
  "020": "",
  "021": "",
  "022": "",
  "023": "",
  "024": "",
  "025": "",
  "026": "",
  "027": "",
  "028": "",
  "030": "",
  "031": "",
  "033": "",
  "034": "",
  "035": "",
  "036": "",
  "038": "",
  "039": "",
  "080": "",
  "081": "",
  "102": "",
  "111": ""
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/empresas.test.js"`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): registro de empresas y mapeo de sucursales"
```

---

### Task 4: `control-caja.js` — matriz y resumen

El corazón del tablero. Único módulo que conoce la cuenta de control.

**Files:**
- Create: `C:\apps\dashboards\ControlCaja\server\control-caja.js`
- Test: `C:\apps\dashboards\ControlCaja\tests\control-caja.test.js`

**Interfaces:**
- Consumes: `Registro` de `reporte-parse.js` (Tarea 2).
- Produces:
  - `CUENTA_DIFERENCIAS_CAJA: '4.2.002.01.050'`
  - `periodosDisponibles(registros: Registro[]): string[]` — ordenados ascendente.
  - `construirMatriz(registros: Registro[], periodo: string, nombres: Record<string,string>): Matriz`
  - ```
    Matriz = {
      periodo: string,
      dias: string[],                        // '01'..'31', solo los presentes, ascendente
      sucursales: {
        codigo: string,
        nombre: string,                      // '' si no esta en el mapeo
        dias: Record<string, number>,        // solo los dias con diferencia != 0
        total: number
      }[],
      totalesPorDia: Record<string, number>,
      granTotal: number,
      resumen: {
        faltantes: number,                   // suma de celdas > 0 (positivo)
        sobrantes: number,                   // suma de celdas < 0 (negativo)
        neto: number,
        diasConDiferencia: number,
        diasTotales: number                  // pares (sucursal, dia) con actividad
      }
    }
    ```

- [ ] **Step 1: Escribir el test que falla**

`tests/control-caja.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CUENTA_DIFERENCIAS_CAJA, periodosDisponibles, construirMatriz } from '../server/control-caja.js'

// Helper: arma un registro con los campos que la matriz mira.
function reg(fechaISO, sucursal, cuentaCodigo, saldo, extra = {}) {
  const [anio, mes, dia] = fechaISO.split('-')
  return {
    fechaISO, periodo: `${anio}-${mes}`, dia, sucursal,
    cuentaCodigo, cuentaNombre: 'x',
    debe: saldo > 0 ? saldo : 0, haber: saldo < 0 ? -saldo : 0, saldo,
    ...extra
  }
}

const DIF = CUENTA_DIFERENCIAS_CAJA
const VENTA = '4.1.001.01.001'

test('la cuenta de control es la del spec', () => {
  assert.equal(CUENTA_DIFERENCIAS_CAJA, '4.2.002.01.050')
})

test('periodosDisponibles devuelve los meses presentes, ordenados y sin repetir', () => {
  const rs = [
    reg('2026-07-01', '003', VENTA, 1),
    reg('2026-06-03', '003', VENTA, 1),
    reg('2026-06-04', '003', VENTA, 1)
  ]
  assert.deepEqual(periodosDisponibles(rs), ['2026-06', '2026-07'])
})

test('una celda toma el saldo de la cuenta de diferencias', () => {
  const rs = [reg('2026-06-03', '020', DIF, 23200)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales[0].codigo, '020')
  assert.equal(m.sucursales[0].dias['03'], 23200)
})

test('dos lineas de diferencias en el mismo grupo se suman', () => {
  // Hoy no ocurre (verificado sobre los archivos reales), pero se suma para que
  // una linea duplicada en un archivo futuro no de un numero mal en silencio.
  const rs = [reg('2026-06-03', '020', DIF, 100), reg('2026-06-03', '020', DIF, 50)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales[0].dias['03'], 150)
})

test('una sucursal sin ninguna diferencia aparece con la fila vacia', () => {
  // Decidido por el usuario el 03/08/2026: es confirmacion positiva. La
  // ausencia de fila seria indistinguible de "no opero" o "no vino en el
  // archivo"; una fila vacia dice "opero y cerro bien todos los dias".
  const rs = [reg('2026-06-03', '003', VENTA, 5000)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales.length, 1)
  assert.equal(m.sucursales[0].codigo, '003')
  assert.deepEqual(m.sucursales[0].dias, {})
  assert.equal(m.sucursales[0].total, 0)
})

test('una diferencia que suma cero no genera celda', () => {
  const rs = [reg('2026-06-03', '003', DIF, 500), reg('2026-06-03', '003', DIF, -500)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.sucursales[0].dias, {})
  assert.equal(m.sucursales[0].total, 0)
})

test('las columnas son solo los dias presentes en el periodo, ordenados', () => {
  const rs = [
    reg('2026-06-10', '003', VENTA, 1),
    reg('2026-06-03', '003', VENTA, 1),
    reg('2026-07-05', '003', VENTA, 1)   // otro periodo, no debe aparecer
  ]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.dias, ['03', '10'])
})

test('los dias con actividad cuentan aunque no haya diferencias', () => {
  // Una columna sin ninguna diferencia sigue siendo un dia operado: sacarla
  // haria que "5 de 20 dias con diferencia" se convirtiera en "5 de 5".
  const rs = [reg('2026-06-03', '003', VENTA, 1), reg('2026-06-04', '003', DIF, 100)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.dias, ['03', '04'])
  assert.equal(m.resumen.diasTotales, 2)
  assert.equal(m.resumen.diasConDiferencia, 1)
})

test('el nombre viene del mapeo y cae al vacio si falta', () => {
  const rs = [reg('2026-06-03', '003', DIF, 1), reg('2026-06-03', '080', DIF, 1)]
  const m = construirMatriz(rs, '2026-06', { '003': 'Centro' })
  const porCodigo = Object.fromEntries(m.sucursales.map(s => [s.codigo, s.nombre]))
  assert.equal(porCodigo['003'], 'Centro')
  assert.equal(porCodigo['080'], '')
})

test('una sucursal sin Caja Recaudadora aparece igual si tiene diferencias', () => {
  // El criterio de control es la cuenta de diferencias, no la de caja, asi que
  // una sucursal sin cuenta de Caja Recaudadora no puede quedar fuera de la
  // matriz. (En los archivos de hoy no hay ninguna asi: las cuatro que estaban
  // en ese estado -080, 111, 081, 102- dejaron de venir cuando el usuario
  // corrigio el reporte el 03/08/2026. El caso se cubre igual: es una
  // propiedad del criterio, no un accidente de los datos de un dia.)
  const rs = [reg('2026-06-03', '111', DIF, -900)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales.length, 1)
  assert.equal(m.sucursales[0].codigo, '111')
  assert.equal(m.sucursales[0].dias['03'], -900)
})

test('totales de fila, de columna y gran total', () => {
  const rs = [
    reg('2026-06-03', '003', DIF, 100),
    reg('2026-06-04', '003', DIF, -30),
    reg('2026-06-03', '020', DIF, 500)
  ]
  const m = construirMatriz(rs, '2026-06', {})
  const s003 = m.sucursales.find(s => s.codigo === '003')
  assert.equal(s003.total, 70)
  assert.equal(m.totalesPorDia['03'], 600)
  assert.equal(m.totalesPorDia['04'], -30)
  assert.equal(m.granTotal, 570)
})

test('el resumen separa faltantes de sobrantes', () => {
  // Un neto de 0 puede esconder un faltante grande compensado por un sobrante
  // grande: ese es justo el caso que el tablero tiene que dejar ver.
  const rs = [
    reg('2026-06-03', '003', DIF, 1000),
    reg('2026-06-04', '020', DIF, -1000)
  ]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.resumen.faltantes, 1000)
  assert.equal(m.resumen.sobrantes, -1000)
  assert.equal(m.resumen.neto, 0)
  assert.equal(m.resumen.diasConDiferencia, 2)
})

test('las filas se ordenan por total absoluto descendente', () => {
  const rs = [
    reg('2026-06-03', '003', DIF, 100),
    reg('2026-06-03', '020', DIF, -5000),
    reg('2026-06-03', '010', DIF, 800)
  ]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.sucursales.map(s => s.codigo), ['020', '010', '003'])
})

test('a igual total absoluto el orden es por codigo, para que sea estable', () => {
  const rs = [reg('2026-06-03', '020', DIF, 100), reg('2026-06-03', '003', DIF, -100)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.sucursales.map(s => s.codigo), ['003', '020'])
})

test('un periodo sin registros da una matriz vacia, no un error', () => {
  const m = construirMatriz([reg('2026-06-03', '003', DIF, 1)], '2026-08', {})
  assert.deepEqual(m.dias, [])
  assert.deepEqual(m.sucursales, [])
  assert.equal(m.granTotal, 0)
  assert.equal(m.resumen.diasTotales, 0)
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/control-caja.test.js"`
Expected: FAIL — `Cannot find module '../server/control-caja.js'`

- [ ] **Step 3: Implementar `construirMatriz` en `server/control-caja.js`**

```js
/**
 * Logica de negocio del control de caja. Unico modulo que conoce la cuenta de
 * control y el criterio de "no cierra"; no lee archivos ni sabe de HTTP.
 */

/**
 * La partida doble ya viene cuadrada por fecha+sucursal en los archivos de SAP
 * (verificado: 850 grupos en TESI y 744 en PUEBLO, cero descuadres), asi que
 * "suma de saldos != 0" NO sirve como criterio de control: siempre da 0. El
 * indicador real es lo que SAP imputa a esta cuenta.
 */
export const CUENTA_DIFERENCIAS_CAJA = '4.2.002.01.050'

// Debajo de medio centavo es cero: evita que un error de punto flotante
// convierta un dia que cerro en una celda pintada.
const EPS = 0.005
const esCero = n => Math.abs(n) < EPS

export function periodosDisponibles(registros) {
  return [...new Set(registros.map(r => r.periodo))].sort()
}

export function construirMatriz(registros, periodo, nombres = {}) {
  const delPeriodo = registros.filter(r => r.periodo === periodo)

  // Dias y pares (sucursal, dia) con ACTIVIDAD: se derivan de todos los
  // registros del periodo, no solo de los de la cuenta de diferencias. Un dia
  // operado sin diferencias es una columna vacia legitima, y es el denominador
  // de "N de M dias con diferencia" — si solo contaramos los dias con
  // diferencia, el ratio seria siempre 100%.
  const dias = [...new Set(delPeriodo.map(r => r.dia))].sort()
  const paresConActividad = new Set(delPeriodo.map(r => `${r.sucursal}|${r.dia}`))

  // Suma de saldos de la cuenta de control por sucursal+dia.
  const porSucursal = new Map()
  for (const r of delPeriodo) {
    if (r.cuentaCodigo !== CUENTA_DIFERENCIAS_CAJA) continue
    if (!porSucursal.has(r.sucursal)) porSucursal.set(r.sucursal, new Map())
    const m = porSucursal.get(r.sucursal)
    m.set(r.dia, (m.get(r.dia) ?? 0) + r.saldo)
  }

  const totalesPorDia = {}
  let faltantes = 0
  let sobrantes = 0
  let diasConDiferencia = 0

  // TODAS las sucursales con actividad en el periodo entran en la matriz,
  // incluso las que no tuvieron ninguna diferencia: su fila queda vacia con
  // total 0. Es confirmacion positiva — el usuario ve que la sucursal cerro
  // bien todos los dias, en vez de tener que deducirlo de una ausencia (que
  // seria indistinguible de "no opero" o "no vino en el archivo"). Decidido por
  // el usuario el 03/08/2026.
  const todasLasSucursales = [...new Set(delPeriodo.map(r => r.sucursal))]

  const sucursales = []
  for (const codigo of todasLasSucursales) {
    const porDia = porSucursal.get(codigo) ?? new Map()
    const celdas = {}
    let total = 0
    for (const [dia, valor] of porDia) {
      if (esCero(valor)) continue   // un dia que cerro no deja celda pintada
      celdas[dia] = valor
      total += valor
      totalesPorDia[dia] = (totalesPorDia[dia] ?? 0) + valor
      diasConDiferencia++
      if (valor > 0) faltantes += valor
      else sobrantes += valor
    }
    sucursales.push({ codigo, nombre: nombres[codigo] ?? '', dias: celdas, total })
  }

  // Las problematicas arriba (por magnitud, sin importar el signo). El
  // desempate por codigo mantiene el orden estable entre requests: sin el, dos
  // sucursales con el mismo total podrian alternar posicion y la tabla
  // "saltaria" al refrescar.
  sucursales.sort((a, b) =>
    Math.abs(b.total) - Math.abs(a.total) || a.codigo.localeCompare(b.codigo))

  const granTotal = Object.values(totalesPorDia).reduce((a, b) => a + b, 0)

  return {
    periodo,
    dias,
    sucursales,
    totalesPorDia,
    granTotal,
    resumen: {
      faltantes,
      sobrantes,
      neto: faltantes + sobrantes,
      diasConDiferencia,
      diasTotales: paresConActividad.size
    }
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/control-caja.test.js"`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): matriz sucursal x dia de diferencias de caja"
```

---

### Task 5: `control-caja.js` — asiento del día

**Files:**
- Modify: `C:\apps\dashboards\ControlCaja\server\control-caja.js` (agregar `construirAsiento`)
- Modify: `C:\apps\dashboards\ControlCaja\tests\control-caja.test.js` (agregar tests)

**Interfaces:**
- Consumes: `Registro` de `reporte-parse.js`, `CUENTA_DIFERENCIAS_CAJA` de la Tarea 4.
- Produces:
  - `construirAsiento(registros: Registro[], fechaISO: string, sucursal: string): Asiento`
  - ```
    Asiento = {
      fechaISO: string,
      sucursal: string,
      lineas: {cuentaCodigo, cuentaNombre, debe, haber, saldo, esDiferenciaCaja: boolean}[],
      totales: {debe: number, haber: number},
      cuadra: boolean
    }
    ```

- [ ] **Step 1: Agregar los tests que fallan**

Al final de `tests/control-caja.test.js`:

```js
import { construirAsiento } from '../server/control-caja.js'

test('el asiento trae todas las cuentas del dia+sucursal, ordenadas por codigo', () => {
  const rs = [
    reg('2026-06-03', '020', DIF, 23200),
    reg('2026-06-03', '020', '1.1.001.01.024', -23200),
    reg('2026-06-03', '003', DIF, 999),          // otra sucursal
    reg('2026-06-04', '020', DIF, 111)           // otro dia
  ]
  const a = construirAsiento(rs, '2026-06-03', '020')
  assert.deepEqual(a.lineas.map(l => l.cuentaCodigo), ['1.1.001.01.024', '4.2.002.01.050'])
})

test('el asiento marca las lineas de diferencias de caja', () => {
  const rs = [reg('2026-06-03', '020', DIF, 100), reg('2026-06-03', '020', VENTA, -100)]
  const a = construirAsiento(rs, '2026-06-03', '020')
  const dif = a.lineas.find(l => l.cuentaCodigo === DIF)
  const venta = a.lineas.find(l => l.cuentaCodigo === VENTA)
  assert.equal(dif.esDiferenciaCaja, true)
  assert.equal(venta.esDiferenciaCaja, false)
})

test('los totales del asiento son la suma de debe y de haber, y cuadran', () => {
  const rs = [
    { ...reg('2026-06-03', '020', DIF, 0), debe: 300, haber: 300 },
    { ...reg('2026-06-03', '020', VENTA, 0), debe: 700, haber: 700 }
  ]
  const a = construirAsiento(rs, '2026-06-03', '020')
  assert.equal(a.totales.debe, 1000)
  assert.equal(a.totales.haber, 1000)
  assert.equal(a.cuadra, true)
})

test('cuadra es false si debe != haber', () => {
  // No deberia pasar con datos de SAP, pero si pasa hay que verlo, no taparlo.
  const rs = [{ ...reg('2026-06-03', '020', DIF, 0), debe: 300, haber: 100 }]
  const a = construirAsiento(rs, '2026-06-03', '020')
  assert.equal(a.cuadra, false)
})

test('un dia+sucursal sin movimientos da un asiento vacio, no un error', () => {
  const a = construirAsiento([], '2026-06-03', '020')
  assert.deepEqual(a.lineas, [])
  assert.equal(a.totales.debe, 0)
  assert.equal(a.cuadra, true)
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/control-caja.test.js"`
Expected: FAIL — `construirAsiento is not a function` / `not exported`

- [ ] **Step 3: Implementar `construirAsiento`**

Agregar al final de `server/control-caja.js`:

```js
/**
 * Asiento completo de un dia+sucursal: es el drill-down de una celda de la
 * matriz. Incluye TODAS las cuentas del grupo (no solo la de diferencias)
 * porque el sentido del panel es entender de donde salio la diferencia; el
 * saldo de la Caja Recaudadora se ve aca como dato, sin generar alerta.
 */
export function construirAsiento(registros, fechaISO, sucursal) {
  const lineas = registros
    .filter(r => r.fechaISO === fechaISO && r.sucursal === sucursal)
    .map(r => ({
      cuentaCodigo: r.cuentaCodigo,
      cuentaNombre: r.cuentaNombre,
      debe: r.debe,
      haber: r.haber,
      saldo: r.saldo,
      esDiferenciaCaja: r.cuentaCodigo === CUENTA_DIFERENCIAS_CAJA
    }))
    .sort((a, b) => a.cuentaCodigo.localeCompare(b.cuentaCodigo))

  const totales = lineas.reduce(
    (acc, l) => ({ debe: acc.debe + l.debe, haber: acc.haber + l.haber }),
    { debe: 0, haber: 0 }
  )

  return {
    fechaISO,
    sucursal,
    lineas,
    totales,
    // Con datos de SAP siempre da true. Se expone igual para que un dia en que
    // no cuadre se vea en pantalla en vez de pasar inadvertido.
    cuadra: esCero(totales.debe - totales.haber)
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/control-caja.test.js"`
Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): asiento del dia como drill-down de la celda"
```

---

### Task 6: `reporte-cache.js`

**Files:**
- Create: `C:\apps\dashboards\ControlCaja\server\reporte-cache.js`
- Test: `C:\apps\dashboards\ControlCaja\tests\reporte-cache.test.js`

**Interfaces:**
- Consumes: `statArchivo`/`leerArchivo`/`descripcionDeError` (Tarea 1), `parsearReporte` (Tarea 2), `EMPRESAS` (Tarea 3).
- Produces:
  - `crearCache({networkPath, stat?, leer?, parsear?}): Cache`
  - `cache.obtener(claveEmpresa: string): {ok: true, registros, descartadas, archivo: {mtimeMs, size}, parseos: number} | {ok: false, code: string, message: string}`
  - `stat`, `leer` y `parsear` son inyectables solo para los tests; en producción se usan los reales.

- [ ] **Step 1: Escribir el test que falla**

`tests/reporte-cache.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearCache } from '../server/reporte-cache.js'

// Doble de la UNC: controla mtime/size y cuenta lecturas.
function fakeUNC(inicial) {
  const estado = { ...inicial, lecturas: 0 }
  return {
    estado,
    stat: () => estado.error
      ? { ok: false, code: estado.error, message: 'x' }
      : { ok: true, mtimeMs: estado.mtimeMs, size: estado.texto.length },
    leer: () => {
      if (estado.error) return { ok: false, code: estado.error, message: 'x' }
      estado.lecturas++
      return { ok: true, texto: estado.texto }
    }
  }
}

const LINEA = '03/06/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|100.00|.00|100.00'

test('el primer obtener lee y parsea', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  const r = cache.obtener('TESI')
  assert.equal(r.ok, true)
  assert.equal(r.registros.length, 1)
  assert.equal(unc.estado.lecturas, 1)
})

test('un segundo obtener con el mismo mtime y size no vuelve a leer', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  cache.obtener('TESI')
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 1)
  assert.equal(r.parseos, 1)
})

test('si cambia el mtime, reparsea', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  cache.obtener('TESI')
  unc.estado.mtimeMs = 2000
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 2)
  assert.equal(r.parseos, 2)
})

test('si cambia el size con el mismo mtime, reparsea', () => {
  // Una reescritura rapida puede dejar el mismo mtime segun el sistema de
  // archivos; el size lo detecta.
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  cache.obtener('TESI')
  unc.estado.texto = LINEA + '\n' + LINEA
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 2)
  assert.equal(r.registros.length, 2)
})

test('cada empresa tiene su propia entrada', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  cache.obtener('TESI')
  cache.obtener('PUEBLO')
  assert.equal(unc.estado.lecturas, 2)
})

test('un error de la UNC se devuelve tipificado y con mensaje legible', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA, error: 'ENOENT' })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  const r = cache.obtener('TESI')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
  assert.match(r.message, /no dejó el archivo/)
})

test('un error NO deja cacheado el fallo: el proximo intento reintenta', () => {
  // Si cacheara el error, un corte momentaneo de red dejaria el dashboard
  // roto hasta reiniciar el servicio.
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA, error: 'ETIMEDOUT' })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  assert.equal(cache.obtener('TESI').ok, false)
  unc.estado.error = null
  assert.equal(cache.obtener('TESI').ok, true)
})

test('una empresa desconocida lanza (es un bug del llamador, no un caso de datos)', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  assert.throws(() => cache.obtener('INDO'), /INDO/)
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/reporte-cache.test.js"`
Expected: FAIL — `Cannot find module '../server/reporte-cache.js'`

- [ ] **Step 3: Implementar `server/reporte-cache.js`**

```js
import { statArchivo, leerArchivo, descripcionDeError } from './reporte-source.js'
import { parsearReporte } from './reporte-parse.js'
import { EMPRESAS, empresaValida } from './empresas.js'

/**
 * Cache en memoria del parseo, invalidada por mtime+size del archivo de red.
 *
 * SAP reescribe los archivos a diario, asi que el primer request posterior a la
 * reescritura reparsea (~decenas de ms para 13k lineas) y el resto se sirve de
 * memoria. No hay scheduler ni persistencia a proposito: la fuente de verdad es
 * el archivo de la red, y reiniciar el servicio no pierde nada porque no hay
 * nada propio que perder.
 *
 * stat/leer/parsear son inyectables SOLO para los tests.
 */
export function crearCache({ networkPath, stat = statArchivo, leer = leerArchivo, parsear = parsearReporte }) {
  const entradas = new Map()   // claveEmpresa -> { mtimeMs, size, registros, descartadas, parseos }

  function obtener(claveEmpresa) {
    if (!empresaValida(claveEmpresa)) {
      // El llamador ya valido la empresa (normalizarClave) antes de llegar aca:
      // si igual llega una desconocida es un bug de programacion, no un caso de
      // datos, y tiene que doler en vez de devolver una respuesta vacia.
      throw new Error(`Empresa desconocida: ${claveEmpresa}`)
    }
    const { archivo } = EMPRESAS[claveEmpresa]

    const s = stat(networkPath, archivo)
    if (!s.ok) return { ok: false, code: s.code, message: descripcionDeError(s.code) }

    const previa = entradas.get(claveEmpresa)
    if (previa && previa.mtimeMs === s.mtimeMs && previa.size === s.size) {
      return { ok: true, registros: previa.registros, descartadas: previa.descartadas,
               archivo: { mtimeMs: previa.mtimeMs, size: previa.size }, parseos: previa.parseos }
    }

    const l = leer(networkPath, archivo)
    if (!l.ok) return { ok: false, code: l.code, message: descripcionDeError(l.code) }

    const { registros, descartadas } = parsear(l.texto)
    // El error NO se cachea (solo el exito): un corte momentaneo de red no
    // puede dejar el dashboard roto hasta que alguien reinicie el servicio.
    const entrada = {
      mtimeMs: s.mtimeMs,
      size: s.size,
      registros,
      descartadas,
      parseos: (previa?.parseos ?? 0) + 1
    }
    entradas.set(claveEmpresa, entrada)
    return { ok: true, registros, descartadas,
             archivo: { mtimeMs: s.mtimeMs, size: s.size }, parseos: entrada.parseos }
  }

  return { obtener }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/reporte-cache.test.js"`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): cache en memoria invalidada por mtime+size"
```

---

### Task 7: `app.js` + `server.js` — los cuatro endpoints

**Files:**
- Create: `C:\apps\dashboards\ControlCaja\server\app.js`
- Create: `C:\apps\dashboards\ControlCaja\server.js`
- Test: `C:\apps\dashboards\ControlCaja\tests\app.test.js`

**Interfaces:**
- Consumes: `crearCache` (Tarea 6), `construirMatriz`/`construirAsiento`/`periodosDisponibles` (Tareas 4-5), `EMPRESAS`/`listaDeEmpresas`/`normalizarClave`/`cargarNombresSucursal` (Tarea 3).
- Produces: `crearApp({cache, nombres, dirname}): express.Application` — sin `listen()`.

- [ ] **Step 1: Escribir el test que falla**

`tests/app.test.js`:

```js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { crearApp } from '../server/app.js'
import { parsearReporte } from '../server/reporte-parse.js'

const LINEAS = [
  '03/06/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|100.00|.00|100.00',
  '03/06/2026 0:00:00|003|4.1.001.01.001 - Venta|.00|100.00|-100.00',
  '04/06/2026 0:00:00|020|4.2.002.01.050 - Diferencias de Caja|.00|500.00|-500.00',
  '01/07/2026 0:00:00|003|4.1.001.01.001 - Venta|.00|50.00|-50.00'
].join('\n')

// Cache falsa: los tests de API no deben depender de la UNC.
function cacheFake({ falla = null } = {}) {
  return {
    obtener: () => {
      if (falla) return { ok: false, code: falla, message: 'la red no responde' }
      const { registros, descartadas } = parsearReporte(LINEAS)
      return { ok: true, registros, descartadas, archivo: { mtimeMs: 1717430000000, size: 123 }, parseos: 1 }
    }
  }
}

let server, base

before(async () => {
  const app = crearApp({ cache: cacheFake(), nombres: { '003': 'Centro' }, dirname: process.cwd() })
  server = app.listen(0)
  await new Promise(r => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => server?.close())

test('GET /api/empresas devuelve el registro', async () => {
  const r = await fetch(`${base}/api/empresas`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.empresas.map(e => e.clave), ['TESI', 'PUEBLO'])
})

test('GET /api/periodos devuelve meses, frescura y descartadas', async () => {
  const r = await fetch(`${base}/api/periodos?empresa=TESI`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.periodos, ['2026-06', '2026-07'])
  assert.equal(j.archivo.mtimeMs, 1717430000000)
  assert.equal(j.descartadas, 0)
})

test('GET /api/matriz devuelve la matriz del periodo con nombres', async () => {
  const r = await fetch(`${base}/api/matriz?empresa=TESI&periodo=2026-06`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.dias, ['03', '04'])
  const s003 = j.sucursales.find(s => s.codigo === '003')
  assert.equal(s003.nombre, 'Centro')
  assert.equal(s003.dias['03'], 100)
  assert.equal(j.resumen.faltantes, 100)
  assert.equal(j.resumen.sobrantes, -500)
})

test('GET /api/asiento devuelve las lineas del dia+sucursal', async () => {
  const r = await fetch(`${base}/api/asiento?empresa=TESI&fecha=2026-06-03&sucursal=003`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.lineas.length, 2)
  assert.equal(j.cuadra, true)
  assert.equal(j.lineas.find(l => l.esDiferenciaCaja).cuentaCodigo, '4.2.002.01.050')
})

test('empresa desconocida da 400, nunca un fallback silencioso a TESI', async () => {
  for (const ruta of ['/api/periodos?empresa=INDO', '/api/matriz?empresa=INDO&periodo=2026-06',
                      '/api/asiento?empresa=INDO&fecha=2026-06-03&sucursal=003']) {
    const r = await fetch(`${base}${ruta}`)
    assert.equal(r.status, 400, ruta)
    assert.match((await r.json()).message, /INDO/)
  }
})

test('falta el parametro empresa: 400', async () => {
  const r = await fetch(`${base}/api/matriz?periodo=2026-06`)
  assert.equal(r.status, 400)
})

test('periodo con formato invalido da 400', async () => {
  const r = await fetch(`${base}/api/matriz?empresa=TESI&periodo=junio`)
  assert.equal(r.status, 400)
  assert.match((await r.json()).message, /per[ií]odo/i)
})

test('fecha con formato invalido en asiento da 400', async () => {
  const r = await fetch(`${base}/api/asiento?empresa=TESI&fecha=03/06/2026&sucursal=003`)
  assert.equal(r.status, 400)
  assert.match((await r.json()).message, /fecha/i)
})

test('un periodo sin datos da 200 con matriz vacia, no 404', async () => {
  // Distinguir "no hay datos para este mes" de "no se pudo leer" importa: son
  // dos problemas distintos con dos acciones distintas.
  const r = await fetch(`${base}/api/matriz?empresa=TESI&periodo=2026-01`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.sucursales, [])
  assert.equal(j.resumen.diasTotales, 0)
})

test('si la UNC falla, la API responde 503 con el motivo', async () => {
  const app = crearApp({ cache: cacheFake({ falla: 'ETIMEDOUT' }), nombres: {}, dirname: process.cwd() })
  const s = app.listen(0)
  await new Promise(r => s.once('listening', r))
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/periodos?empresa=TESI`)
    assert.equal(r.status, 503)
    const j = await r.json()
    assert.equal(j.code, 'ETIMEDOUT')
    assert.match(j.message, /no responde/)
  } finally {
    s.close()
  }
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/app.test.js"`
Expected: FAIL — `Cannot find module '../server/app.js'`

- [ ] **Step 3: Implementar `server/app.js`**

```js
import express from 'express'
import path from 'node:path'
import { listaDeEmpresas, normalizarClave } from './empresas.js'
import { construirMatriz, construirAsiento, periodosDisponibles } from './control-caja.js'

const RE_PERIODO = /^\d{4}-\d{2}$/
const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/
const RE_SUCURSAL = /^\d{3}$/

/**
 * Rutas del dashboard. Todas GET: este tablero no escribe nada, ni en la red ni
 * en disco. Se separa de server.js (que hace el listen) para que los tests
 * levanten la app en un puerto efimero con una cache inyectada, sin depender de
 * la UNC ni del servicio real.
 */
export function crearApp({ cache, nombres = {}, dirname }) {
  const app = express()
  app.use(express.static(path.join(dirname, 'dist')))

  // Resuelve empresa + datos, o responde el error y devuelve null. Concentra
  // aca las dos respuestas de error (400 empresa / 503 red) para que las tres
  // rutas de datos no las repitan y no se desalineen entre si.
  function datosDe(req, res) {
    const clave = normalizarClave(req.query.empresa)
    if (!clave) {
      res.status(400).json({ ok: false, message: `Empresa desconocida: ${req.query.empresa ?? '(sin especificar)'}` })
      return null
    }
    const r = cache.obtener(clave)
    if (!r.ok) {
      // 503, no 500: el dashboard esta bien, la fuente no esta disponible.
      res.status(503).json({ ok: false, code: r.code, message: r.message })
      return null
    }
    return { clave, ...r }
  }

  app.get('/api/empresas', (req, res) => {
    res.json({ empresas: listaDeEmpresas() })
  })

  app.get('/api/periodos', (req, res) => {
    const d = datosDe(req, res)
    if (!d) return
    res.json({
      empresa: d.clave,
      periodos: periodosDisponibles(d.registros),
      archivo: d.archivo,
      descartadas: d.descartadas.length
    })
  })

  app.get('/api/matriz', (req, res) => {
    const d = datosDe(req, res)
    if (!d) return
    const periodo = String(req.query.periodo ?? '')
    if (!RE_PERIODO.test(periodo)) {
      return res.status(400).json({ ok: false, message: `Período inválido: "${periodo}" (se espera YYYY-MM)` })
    }
    res.json({
      empresa: d.clave,
      archivo: d.archivo,
      descartadas: d.descartadas.length,
      ...construirMatriz(d.registros, periodo, nombres)
    })
  })

  app.get('/api/asiento', (req, res) => {
    const d = datosDe(req, res)
    if (!d) return
    const fecha = String(req.query.fecha ?? '')
    if (!RE_FECHA_ISO.test(fecha)) {
      return res.status(400).json({ ok: false, message: `Fecha inválida: "${fecha}" (se espera YYYY-MM-DD)` })
    }
    const sucursal = String(req.query.sucursal ?? '')
    if (!RE_SUCURSAL.test(sucursal)) {
      return res.status(400).json({ ok: false, message: `Sucursal inválida: "${sucursal}" (se esperan 3 dígitos)` })
    }
    res.json({ empresa: d.clave, ...construirAsiento(d.registros, fecha, sucursal) })
  })

  // SPA: cualquier otra ruta sirve el index para que /d/16/ y los refrescos
  // dentro del iframe del portal no den 404.
  app.get('*', (req, res) => {
    res.sendFile(path.join(dirname, 'dist', 'index.html'))
  })

  return app
}
```

- [ ] **Step 4: Implementar `server.js`**

```js
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crearApp } from './server/app.js'
import { crearCache } from './server/reporte-cache.js'
import { cargarNombresSucursal } from './server/empresas.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT || '3014')
// Ruta de red READ-ONLY donde SAP deja los reportes Z. Este dashboard solo lee.
const SAP_NETWORK_PATH = process.env.SAP_NETWORK_PATH || '\\\\10.0.0.115\\Cegid'

const cache = crearCache({ networkPath: SAP_NETWORK_PATH })
const nombres = cargarNombresSucursal(path.join(__dirname, 'data', 'sucursales.json'))

const app = crearApp({ cache, nombres, dirname: __dirname })

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80).
const HOST = process.env.HOST || '127.0.0.1'
app.listen(PORT, HOST, () => {
  console.log(`[ControlCaja] Escuchando en http://${HOST}:${PORT}`)
  console.log(`[ControlCaja] Fuente SAP (red, solo lectura): ${SAP_NETWORK_PATH}`)
  console.log(`[ControlCaja] Sucursales con nombre en el mapeo: ${Object.values(nombres).filter(Boolean).length}`)
})
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/app.test.js"`
Expected: PASS — 10 tests.

- [ ] **Step 6: Correr la suite completa**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/*.test.js"`
Expected: PASS — 62 tests en total (5 + 12 + 7 + 20 + 8 + 10).

- [ ] **Step 7: Verificar la API contra los datos reales**

En una terminal:

```bash
cd /c/apps/dashboards/ControlCaja && mkdir -p dist && echo '<!doctype html><title>tmp</title>' > dist/index.html && PORT=3014 node server.js
```

En otra:

```bash
curl -s "http://127.0.0.1:3014/api/empresas"
curl -s "http://127.0.0.1:3014/api/periodos?empresa=TESI"
curl -s "http://127.0.0.1:3014/api/matriz?empresa=TESI&periodo=2026-07" | head -c 600
curl -s "http://127.0.0.1:3014/api/asiento?empresa=TESI&fecha=2026-06-03&sucursal=020"
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3014/api/matriz?empresa=INDO&periodo=2026-07"
```

Expected: `periodos` con 2026-06/07/08; la matriz de TESI con **17 sucursales** (003…039); `400` para INDO.

Para el asiento, **no hay un valor esperado fijo**: el reporte se regenera y los importes cambian (el 03/08/2026 a las 12:47 cambiaron todos). Derivar el valor esperado del archivo en el momento y comparar:

```bash
awk -F'|' '{gsub(/\r/,"")} $1 ~ /^03\/06\/2026/ && $2=="020"' "//10.0.0.115/Cegid/SAP_REPORTE_Z.TXT"
```

El asiento que devuelve la API tiene que traer **exactamente esas líneas**, con `totales.debe == totales.haber` y `esDiferenciaCaja` marcado solo en `4.2.002.01.050`.

- [ ] **Step 8: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): endpoints de empresas, periodos, matriz y asiento"
```

---

### Task 8: Frontend — shell, cliente de API y encabezado

**Files:**
- Create: `index.html`, `src/main.tsx`, `src/index.css`, `src/lib/utils.ts`, `src/lib/api.ts`, `src/lib/formato.ts`, `src/components/ui/card.tsx`, `src/components/Encabezado.tsx`, `src/components/TarjetasResumen.tsx`, `src/App.tsx`, `vite.config.ts` (todos bajo `C:\apps\dashboards\ControlCaja\`)

**Interfaces:**
- Consumes: los cuatro endpoints de la Tarea 7.
- Produces (para las Tareas 9 y 10):
  - `src/lib/api.ts`: tipos `Empresa`, `Periodos`, `Matriz`, `SucursalFila`, `Asiento`, `LineaAsiento`, `ApiError`; funciones `getEmpresas()`, `getPeriodos(empresa)`, `getMatriz(empresa, periodo)`, `getAsiento(empresa, fecha, sucursal)`.
  - `src/lib/formato.ts`: `formatoImporte(n)`, `formatoImporteCorto(n)`, `formatoFechaLarga(fechaISO)`, `formatoMes(periodo)`, `formatoFrescura(mtimeMs)`, `calcularEscala(valores)`, `nivelDeCelda(valor, escala)`, `estiloDeCelda(valor, escala)`, tipo `Escala`.

- [ ] **Step 1: Crear `vite.config.ts`, `index.html`, `main.tsx`, `utils.ts`, `card.tsx`**

`vite.config.ts` — **sin `base`**: el proxy del portal rutea `/assets` y `/api` absolutos por la cookie `DashboardPortal.ActiveDash`, igual que en los otros dashboards.

```ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, '.') } },
    server: {
      proxy: {
        '/api': { target: `http://127.0.0.1:${env.PORT || '3014'}`, changeOrigin: true }
      }
    }
  }
})
```

`index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Control de Caja</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

`src/lib/utils.ts`:

```ts
export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ')
}
```

`src/components/ui/card.tsx`:

```tsx
import * as React from 'react'
import { cn } from '@/src/lib/utils'

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-950 dark:text-slate-100 shadow-sm', className)} {...props} />
  )
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-4', className)} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
  )
)
CardTitle.displayName = 'CardTitle'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

export { Card, CardHeader, CardTitle, CardContent }
```

- [ ] **Step 2: Crear `src/index.css` con la paleta validada**

La paleta divergente sale del skill `dataviz`: par **azul ↔ rojo** con gris neutro en el cero. Los pasos de abajo **ya fueron validados** con `scripts/validate_palette.js`: CVD separation PASS en ambos modos (peor par ΔE 11,5 light / 10,6 dark, umbral ≥8). El WARN de contraste de los pasos suaves obliga a labels visibles — el importe va escrito en cada celda, que es exactamente ese relevo. **No cambiar estos hexes sin re-correr el validador.**

Decisión de asignación: **faltante → rojo** (la plata que falta es lo malo), **sobrante → azul**, cero → sin fill.

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

:root {
  /* Diverging pair validado (dataviz): faltante = rojo, sobrante = azul.
     3 escalones por brazo; el "casi cero" NO es un cuarto escalon casi-blanco
     porque los pasos mas claros de los dos brazos resultaban indistinguibles
     entre si (normal-vision ΔE 7.4, protan 5.2): un faltante chico y un
     sobrante chico se veian iguales. El cero es celda vacia. */
  --falt-1: #f19a9a;  --falt-2: #e34948;  --falt-3: #b02a2a;
  --sobr-1: #86b6ef;  --sobr-2: #3987e5;  --sobr-3: #1c5cab;
  --neutro: #f0efec;
  /* Tinta sobre la celda: el escalon 3 es oscuro y pide texto claro. */
  --ink-sobre-1: #0b0b0b;  --ink-sobre-2: #0b0b0b;  --ink-sobre-3: #ffffff;
}

.dark {
  /* Mismos brazos, escalonados para la superficie oscura: aca el escalon alto
     es el mas CLARO, asi que la tinta se invierte. */
  --falt-1: #8f2222;  --falt-2: #c93a3a;  --falt-3: #e66767;
  --sobr-1: #1c5cab;  --sobr-2: #3987e5;  --sobr-3: #86b6ef;
  --neutro: #383835;
  --ink-sobre-1: #ffffff;  --ink-sobre-2: #ffffff;  --ink-sobre-3: #0b0b0b;
}
```

- [ ] **Step 3: Crear `src/lib/api.ts`**

```ts
export type Empresa = { clave: string; label: string }
export type ArchivoInfo = { mtimeMs: number; size: number }

export type Periodos = {
  empresa: string
  periodos: string[]
  archivo: ArchivoInfo
  descartadas: number
}

export type SucursalFila = {
  codigo: string
  nombre: string
  dias: Record<string, number>
  total: number
}

export type Matriz = {
  empresa: string
  periodo: string
  archivo: ArchivoInfo
  descartadas: number
  dias: string[]
  sucursales: SucursalFila[]
  totalesPorDia: Record<string, number>
  granTotal: number
  resumen: {
    faltantes: number
    sobrantes: number
    neto: number
    diasConDiferencia: number
    diasTotales: number
  }
}

export type LineaAsiento = {
  cuentaCodigo: string
  cuentaNombre: string
  debe: number
  haber: number
  saldo: number
  esDiferenciaCaja: boolean
}

export type Asiento = {
  empresa: string
  fechaISO: string
  sucursal: string
  lineas: LineaAsiento[]
  totales: { debe: number; haber: number }
  cuadra: boolean
}

/** Error con el mensaje que el backend ya redacto para el usuario. */
export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    // El backend manda { message, code } tanto en 400 como en 503. Si por algo
    // no viniera JSON, no tapamos el problema con un mensaje generico mudo.
    let message = `Error ${res.status}`
    let code: string | undefined
    try {
      const j = await res.json()
      if (j?.message) message = j.message
      code = j?.code
    } catch { /* respuesta sin JSON: queda el mensaje con el status */ }
    throw new ApiError(res.status, message, code)
  }
  return res.json() as Promise<T>
}

export const getEmpresas = () => get<{ empresas: Empresa[] }>('/api/empresas')
export const getPeriodos = (empresa: string) =>
  get<Periodos>(`/api/periodos?empresa=${encodeURIComponent(empresa)}`)
export const getMatriz = (empresa: string, periodo: string) =>
  get<Matriz>(`/api/matriz?empresa=${encodeURIComponent(empresa)}&periodo=${encodeURIComponent(periodo)}`)
export const getAsiento = (empresa: string, fecha: string, sucursal: string) =>
  get<Asiento>(`/api/asiento?empresa=${encodeURIComponent(empresa)}&fecha=${encodeURIComponent(fecha)}&sucursal=${encodeURIComponent(sucursal)}`)
```

- [ ] **Step 4: Crear `src/lib/formato.ts`**

```ts
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const fmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatoImporte = (n: number) => fmt.format(n)

/** Para las celdas de la matriz, donde no entra un importe completo. */
export function formatoImporteCorto(n: number): string {
  const abs = Math.abs(n)
  const signo = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${signo}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${signo}${Math.round(abs / 1_000)}k`
  // Una diferencia de centavos existe (el umbral de cero es medio centavo), y
  // redondeada daria "0": una celda pintada que dice cero se lee como un bug.
  if (abs < 1) return `${signo}<1`
  return `${signo}${Math.round(abs)}`
}

/** 'YYYY-MM' -> 'julio 2026'. Sin Date: el string ya trae todo. */
export function formatoMes(periodo: string): string {
  const [anio, mes] = periodo.split('-')
  return `${MESES[Number(mes) - 1] ?? mes} ${anio}`
}

/** 'YYYY-MM-DD' -> '3 de julio de 2026'. Sin Date, por lo mismo. */
export function formatoFechaLarga(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split('-')
  return `${Number(dia)} de ${MESES[Number(mes) - 1] ?? mes} de ${anio}`
}

/**
 * Frescura del archivo. Aca SI se usa Date: mtimeMs es un instante real
 * (epoch), no una fecha de negocio parseada de un string, asi que no hay riesgo
 * de corrimiento por zona horaria.
 */
export function formatoFrescura(mtimeMs: number): string {
  return new Date(mtimeMs).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

export type Escala = { p50: number; p90: number }

/**
 * Escala de intensidad por percentiles del mes en curso, no por umbrales
 * fijos en pesos: las diferencias reales van de $100 a $3.5M y con cortes
 * fijos casi todas las celdas caerian en el mismo escalon. Los percentiles se
 * calculan sobre el VALOR ABSOLUTO, para que los dos brazos compartan la misma
 * nocion de "grande".
 */
export function calcularEscala(valores: number[]): Escala {
  const abs = valores.map(Math.abs).filter(v => v > 0).sort((a, b) => a - b)
  if (abs.length === 0) return { p50: 0, p90: 0 }
  const at = (p: number) => abs[Math.min(abs.length - 1, Math.floor(abs.length * p))]
  return { p50: at(0.5), p90: at(0.9) }
}

export function nivelDeCelda(valor: number, escala: Escala): 1 | 2 | 3 {
  const abs = Math.abs(valor)
  if (abs >= escala.p90) return 3
  if (abs >= escala.p50) return 2
  return 1
}

/** Estilos inline de la celda, tomados de las variables CSS de index.css. */
export function estiloDeCelda(valor: number, escala: Escala): React.CSSProperties {
  const nivel = nivelDeCelda(valor, escala)
  const brazo = valor > 0 ? 'falt' : 'sobr'
  return {
    backgroundColor: `var(--${brazo}-${nivel})`,
    color: `var(--ink-sobre-${nivel})`
  }
}
```

Nota: `estiloDeCelda` necesita `import type React from 'react'` al tope del archivo.

- [ ] **Step 5: Crear `src/components/Encabezado.tsx`**

```tsx
import { RefreshCw, AlertTriangle } from 'lucide-react'
import type { Empresa } from '@/src/lib/api'
import { formatoFrescura, formatoMes } from '@/src/lib/formato'

type Props = {
  empresas: Empresa[]
  empresa: string
  onEmpresa: (e: string) => void
  periodos: string[]
  periodo: string
  onPeriodo: (p: string) => void
  mtimeMs?: number
  descartadas: number
  cargando: boolean
  onRefrescar: () => void
}

export function Encabezado(p: Props) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
      <h1 className="text-xl font-semibold mr-auto">Control de Caja</h1>

      <label className="text-sm">
        <span className="sr-only">Empresa</span>
        <select value={p.empresa} onChange={e => p.onEmpresa(e.target.value)}
                className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1">
          {p.empresas.map(e => <option key={e.clave} value={e.clave}>{e.label}</option>)}
        </select>
      </label>

      <label className="text-sm">
        <span className="sr-only">Mes</span>
        <select value={p.periodo} onChange={e => p.onPeriodo(e.target.value)}
                className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1">
          {p.periodos.map(x => <option key={x} value={x}>{formatoMes(x)}</option>)}
        </select>
      </label>

      {p.mtimeMs != null && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          SAP al {formatoFrescura(p.mtimeMs)}
        </span>
      )}

      {p.descartadas > 0 && (
        // Se informa a proposito: el reporte se va a corregir en origen para
        // que estas lineas no vengan, y cuando eso pase el contador tiene que
        // bajar a cero de forma visible.
        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
              title="Líneas cuyo campo de sucursal trae una fecha en lugar del código. Son de cuentas de compras y no corresponden a ninguna sucursal.">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
          {p.descartadas} líneas sin sucursal ignoradas
        </span>
      )}

      <button onClick={p.onRefrescar} disabled={p.cargando}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-sm disabled:opacity-50">
        <RefreshCw className={`w-4 h-4 ${p.cargando ? 'animate-spin' : ''}`} aria-hidden />
        Refrescar
      </button>
    </header>
  )
}
```

- [ ] **Step 6: Crear `src/components/TarjetasResumen.tsx`**

```tsx
import { Card, CardContent } from '@/src/components/ui/card'
import { formatoImporte } from '@/src/lib/formato'
import type { Matriz } from '@/src/lib/api'

/**
 * Faltantes y sobrantes van SEPARADOS a proposito: un neto cercano a cero puede
 * esconder un faltante grande compensado por un sobrante grande, que es justo el
 * caso que hay que poder ver.
 */
export function TarjetasResumen({ resumen }: { resumen: Matriz['resumen'] }) {
  const items = [
    { rotulo: 'Faltantes', valor: formatoImporte(resumen.faltantes), color: 'var(--falt-2)' },
    { rotulo: 'Sobrantes', valor: formatoImporte(Math.abs(resumen.sobrantes)), color: 'var(--sobr-2)' },
    { rotulo: 'Neto', valor: formatoImporte(resumen.neto), color: undefined },
    {
      rotulo: 'Días con diferencia',
      valor: `${resumen.diasConDiferencia} de ${resumen.diasTotales}`,
      color: undefined
    }
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {items.map(i => (
        <Card key={i.rotulo}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {i.color && <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: i.color }} aria-hidden />}
              {i.rotulo}
            </div>
            <div className="text-xl font-semibold tabular-nums mt-1">{i.valor}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Crear `src/App.tsx` con el estado y el manejo de errores**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ApiError, getEmpresas, getMatriz, getPeriodos, type Empresa, type Matriz } from '@/src/lib/api'
import { Encabezado } from '@/src/components/Encabezado'
import { TarjetasResumen } from '@/src/components/TarjetasResumen'

export default function App() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresa, setEmpresa] = useState('')
  const [periodos, setPeriodos] = useState<string[]>([])
  // A que empresa corresponden los periodos ya cargados. Sin este dato, cambiar
  // de empresa dispara el efecto de la matriz en el mismo render con el periodo
  // de la empresa ANTERIOR (el efecto de periodos solo arranca un fetch async y
  // no alcanza a corregirlo), y se ve un error espurio o el mes equivocado antes
  // de que se acomode.
  const [periodosDe, setPeriodosDe] = useState('')
  const [periodo, setPeriodo] = useState('')
  const [matriz, setMatriz] = useState<Matriz | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 1) Empresas (una sola vez).
  useEffect(() => {
    getEmpresas()
      .then(r => { setEmpresas(r.empresas); setEmpresa(r.empresas[0]?.clave ?? '') })
      .catch((e: ApiError) => { setError(e.message); setCargando(false) })
  }, [])

  // 2) Periodos de la empresa elegida. Default: el mas reciente.
  const cargarPeriodos = useCallback(async (emp: string) => {
    if (!emp) return
    setCargando(true); setError(null)
    try {
      const r = await getPeriodos(emp)
      setPeriodos(r.periodos)
      // Si el periodo elegido sigue existiendo en la empresa nueva se conserva;
      // si no, se cae al mas reciente. Cambiar de empresa no deberia sacarte del
      // mes que estabas mirando cuando ese mes existe en las dos.
      setPeriodo(prev => (prev && r.periodos.includes(prev) ? prev : r.periodos[r.periodos.length - 1] ?? ''))
      // Recien ahora el par (empresa, periodo) es coherente y el efecto de la
      // matriz puede correr. Va DESPUES de setPeriodo a proposito.
      setPeriodosDe(emp)
      if (r.periodos.length === 0) { setMatriz(null); setCargando(false) }
    } catch (e) {
      setError((e as ApiError).message); setMatriz(null); setCargando(false)
    }
  }, [])

  useEffect(() => { void cargarPeriodos(empresa) }, [empresa, cargarPeriodos])

  // 3) Matriz del par empresa+periodo.
  const cargarMatriz = useCallback(async (emp: string, per: string) => {
    if (!emp || !per) return
    setCargando(true); setError(null)
    try {
      setMatriz(await getMatriz(emp, per))
    } catch (e) {
      setError((e as ApiError).message); setMatriz(null)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    // Guarda contra la carrera: mientras los periodos cargados sigan siendo de
    // otra empresa, el `periodo` de este render no le corresponde y pedir la
    // matriz con ese par daria un 400 o el mes equivocado.
    if (periodosDe !== empresa) return
    void cargarMatriz(empresa, periodo)
  }, [empresa, periodo, periodosDe, cargarMatriz])

  // Refrescar: vuelve a pedir periodos y matriz. El backend hace stat de la UNC
  // y reparsea solo si el archivo cambio, asi que esto es barato.
  const refrescar = useCallback(() => {
    void cargarPeriodos(empresa).then(() => cargarMatriz(empresa, periodo))
  }, [empresa, periodo, cargarPeriodos, cargarMatriz])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4">
      <Encabezado
        empresas={empresas} empresa={empresa} onEmpresa={setEmpresa}
        periodos={periodos} periodo={periodo} onPeriodo={setPeriodo}
        mtimeMs={matriz?.archivo.mtimeMs} descartadas={matriz?.descartadas ?? 0}
        cargando={cargando} onRefrescar={refrescar}
      />

      {error && (
        // El mensaje viene del backend ya redactado (ENOENT / permisos / red).
        // Nunca una pantalla en blanco ni datos viejos disfrazados de frescos.
        <div className="rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 p-4 mb-4">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4" aria-hidden /> No se pudieron traer los datos
          </div>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={refrescar} className="mt-3 rounded border border-amber-400 px-2.5 py-1 text-sm">
            Reintentar
          </button>
        </div>
      )}

      {!error && matriz && <TarjetasResumen resumen={matriz.resumen} />}

      {!error && matriz && matriz.sucursales.length === 0 && !cargando && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No hay diferencias de caja registradas en este mes.
        </p>
      )}

      {/* La matriz y el panel del asiento se agregan en la Tarea 9. */}
    </div>
  )
}
```

- [ ] **Step 8: Buildear y verificar que compila**

Run: `cd C:\apps\dashboards\ControlCaja; npx tsc --noEmit; npm run build`
Expected: `tsc` sin errores; `dist/` generado con `index.html` y `assets/`.

- [ ] **Step 9: Ver la pantalla funcionando**

Run en una terminal: `cd C:\apps\dashboards\ControlCaja; $env:PORT=3014; node server.js`
Abrir `http://localhost:3014/` y verificar: selector con TESI y PUEBLO, selector de mes con jun/jul/ago 2026 (agosto por default), leyenda `SAP al …`, el aviso de líneas ignoradas, y las 4 tarjetas con números. Cortar con Ctrl+C.

- [ ] **Step 10: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): shell del frontend, cliente de API y tarjetas de resumen"
```

---

### Task 9: Frontend — matriz y panel del asiento

**Files:**
- Create: `C:\apps\dashboards\ControlCaja\src\components\MatrizDiferencias.tsx`
- Create: `C:\apps\dashboards\ControlCaja\src\components\PanelAsiento.tsx`
- Modify: `C:\apps\dashboards\ControlCaja\src\App.tsx` (montar los dos)

**Interfaces:**
- Consumes: `Matriz`, `SucursalFila`, `Asiento`, `getAsiento` (Tarea 8); `calcularEscala`, `estiloDeCelda`, `formatoImporte`, `formatoImporteCorto`, `formatoFechaLarga` (Tarea 8).
- Produces: nada para tareas posteriores.

- [ ] **Step 1: Crear `src/components/MatrizDiferencias.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { cn } from '@/src/lib/utils'
import { calcularEscala, estiloDeCelda, formatoImporte, formatoImporteCorto } from '@/src/lib/formato'
import type { Matriz } from '@/src/lib/api'

type Props = {
  matriz: Matriz
  onCelda: (fechaISO: string, sucursal: string) => void
  seleccion: { fechaISO: string; sucursal: string } | null
}

export function MatrizDiferencias({ matriz, onCelda, seleccion }: Props) {
  // Por defecto las problematicas arriba (el backend ya las manda asi).
  const [ordenPorCodigo, setOrdenPorCodigo] = useState(false)

  const filas = useMemo(() => {
    if (!ordenPorCodigo) return matriz.sucursales
    return [...matriz.sucursales].sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [matriz.sucursales, ordenPorCodigo])

  // La escala se calcula sobre TODAS las celdas del mes para que la intensidad
  // sea comparable entre filas (si fuera por fila, un $500 de una sucursal
  // tranquila se veria igual que un $3M de otra).
  const escala = useMemo(
    () => calcularEscala(matriz.sucursales.flatMap(s => Object.values(s.dias))),
    [matriz.sucursales]
  )

  const th = 'sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs font-medium'
  const sucursalCol = 'sticky left-0 z-10 bg-white dark:bg-slate-900 px-2 py-1 text-left whitespace-nowrap'

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <span className="text-sm font-medium mr-auto">Diferencias de caja por día</span>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={ordenPorCodigo} onChange={e => setOrdenPorCodigo(e.target.checked)} />
          Ordenar por código
        </label>
        {/* Leyenda: la identidad nunca depende solo del color. */}
        <span className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--falt-2)' }} aria-hidden /> Faltante
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--sobr-2)' }} aria-hidden /> Sobrante
          </span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm tabular-nums">
          <caption className="sr-only">
            Diferencias de caja por sucursal y día. Valores positivos son faltantes, negativos sobrantes.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={cn(th, 'sticky left-0 z-30 text-left')}>Sucursal</th>
              {matriz.dias.map(d => <th scope="col" key={d} className={th}>{d}</th>)}
              <th scope="col" className={cn(th, 'text-right')}>Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(s => (
              <tr key={s.codigo} className="border-t border-slate-100 dark:border-slate-800">
                <th scope="row" className={cn(sucursalCol, 'font-normal')}>
                  <span className="font-medium">{s.codigo}</span>
                  {s.nombre && <span className="text-slate-500 dark:text-slate-400"> — {s.nombre}</span>}
                </th>
                {matriz.dias.map(d => {
                  const v = s.dias[d]
                  if (v == null) return <td key={d} className="px-1 py-0.5" />
                  const activa = seleccion?.fechaISO === `${matriz.periodo}-${d}` && seleccion?.sucursal === s.codigo
                  return (
                    <td key={d} className="p-0.5">
                      <button
                        onClick={() => onCelda(`${matriz.periodo}-${d}`, s.codigo)}
                        style={estiloDeCelda(v, escala)}
                        // 2px de aire entre celdas y anillo en la seleccionada:
                        // los fills no se tocan y la celda activa se distingue
                        // sin depender del color de fondo.
                        className={cn('w-full min-w-16 rounded px-1.5 py-1 text-xs text-right',
                                      activa && 'ring-2 ring-offset-1 ring-slate-900 dark:ring-white')}
                        title={`${s.codigo} · día ${d} · ${v > 0 ? 'faltante' : 'sobrante'} ${formatoImporte(Math.abs(v))} — clic para ver el asiento`}
                      >
                        {formatoImporteCorto(v)}
                      </button>
                    </td>
                  )
                })}
                <td className="px-2 py-1 text-right font-medium whitespace-nowrap">{formatoImporte(s.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 dark:border-slate-600">
              <th scope="row" className={cn(sucursalCol, 'font-medium')}>Total por día</th>
              {matriz.dias.map(d => (
                <td key={d} className="px-1.5 py-1 text-right text-xs whitespace-nowrap">
                  {matriz.totalesPorDia[d] != null ? formatoImporteCorto(matriz.totalesPorDia[d]) : ''}
                </td>
              ))}
              <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">{formatoImporte(matriz.granTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Crear `src/components/PanelAsiento.tsx`**

```tsx
import { X, AlertTriangle } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import { formatoFechaLarga, formatoImporte } from '@/src/lib/formato'
import type { Asiento } from '@/src/lib/api'

type Props = {
  asiento: Asiento | null
  cargando: boolean
  error: string | null
  onCerrar: () => void
}

/**
 * Panel lateral, NO modal: se puede seguir navegando la matriz con el detalle
 * abierto y comparar dias sin abrir y cerrar todo el tiempo.
 */
export function PanelAsiento({ asiento, cargando, error, onCerrar }: Props) {
  return (
    <aside className="w-full lg:w-[28rem] shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 h-fit lg:sticky lg:top-4">
      <div className="flex items-start gap-2 mb-2">
        <div className="mr-auto">
          <h2 className="font-semibold text-sm">Asiento del día</h2>
          {asiento && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sucursal {asiento.sucursal} · {formatoFechaLarga(asiento.fechaISO)}
            </p>
          )}
        </div>
        <button onClick={onCerrar} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Cerrar el panel">
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {cargando && <p className="text-sm text-slate-500 dark:text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}

      {asiento && !cargando && !error && (
        <>
          {!asiento.cuadra && (
            // Con datos de SAP no deberia pasar nunca; si pasa hay que verlo.
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 mb-2">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> El asiento no cuadra: debe ≠ haber
            </p>
          )}
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 text-left">
                <th scope="col" className="py-1 font-medium">Cuenta</th>
                <th scope="col" className="py-1 font-medium text-right">Debe</th>
                <th scope="col" className="py-1 font-medium text-right">Haber</th>
              </tr>
            </thead>
            <tbody>
              {asiento.lineas.map(l => (
                <tr key={l.cuentaCodigo}
                    className={cn('border-t border-slate-100 dark:border-slate-700',
                                  l.esDiferenciaCaja && 'font-semibold')}>
                  <td className="py-1 pr-2">
                    {l.esDiferenciaCaja && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                            style={{ backgroundColor: l.saldo > 0 ? 'var(--falt-2)' : 'var(--sobr-2)' }} aria-hidden />
                    )}
                    <span className="text-slate-500 dark:text-slate-400">{l.cuentaCodigo}</span>{' '}
                    {l.cuentaNombre}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">{l.debe ? formatoImporte(l.debe) : ''}</td>
                  <td className="py-1 text-right whitespace-nowrap">{l.haber ? formatoImporte(l.haber) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-semibold">
                <td className="py-1">Totales</td>
                <td className="py-1 text-right whitespace-nowrap">{formatoImporte(asiento.totales.debe)}</td>
                <td className="py-1 text-right whitespace-nowrap">{formatoImporte(asiento.totales.haber)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}

      {!asiento && !cargando && !error && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Hacé clic en una celda de la matriz para ver el asiento de ese día.
        </p>
      )}
    </aside>
  )
}
```

- [ ] **Step 3: Montar los dos en `src/App.tsx`**

Agregar los dos componentes a los imports, sumar `useRef` al import de React, y **fusionar** `getAsiento` y `type Asiento` en el `import` de `@/src/lib/api` que ya existe (no agregar un segundo `import` del mismo módulo):

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { MatrizDiferencias } from '@/src/components/MatrizDiferencias'
import { PanelAsiento } from '@/src/components/PanelAsiento'
// el import existente queda:
import { ApiError, getAsiento, getEmpresas, getMatriz, getPeriodos,
         type Asiento, type Empresa, type Matriz } from '@/src/lib/api'
```

Agregar el estado del panel, después del estado de `error`:

```tsx
  const [seleccion, setSeleccion] = useState<{ fechaISO: string; sucursal: string } | null>(null)
  const [asiento, setAsiento] = useState<Asiento | null>(null)
  const [asientoCargando, setAsientoCargando] = useState(false)
  const [asientoError, setAsientoError] = useState<string | null>(null)
  // Numero del ultimo pedido de asiento. Sin esto, un pedido lento de la empresa
  // X que resuelve DESPUES de uno de la empresa Y pisa los datos de Y: el panel
  // muestra el asiento de otra empresa bajo un encabezado que dice la correcta.
  // Falla en silencio, y en un tablero contable eso es peor que un error visible.
  const pedidoAsiento = useRef(0)

  const abrirAsiento = useCallback(async (fechaISO: string, sucursal: string) => {
    const pedido = ++pedidoAsiento.current
    setSeleccion({ fechaISO, sucursal })
    setAsientoCargando(true); setAsientoError(null)
    try {
      const a = await getAsiento(empresa, fechaISO, sucursal)
      if (pedido !== pedidoAsiento.current) return   // llego tarde: ya hay otro pedido
      setAsiento(a)
    } catch (e) {
      if (pedido !== pedidoAsiento.current) return
      setAsientoError((e as ApiError).message); setAsiento(null)
    } finally {
      if (pedido === pedidoAsiento.current) setAsientoCargando(false)
    }
  }, [empresa])

  const cerrarAsiento = useCallback(() => {
    // Invalida cualquier pedido en vuelo: si uno resuelve despues de cerrar, su
    // resultado ya no corresponde a nada de lo que se esta viendo.
    pedidoAsiento.current++
    setSeleccion(null); setAsiento(null); setAsientoError(null); setAsientoCargando(false)
  }, [])

  // Al cambiar de empresa o de mes, el asiento abierto pertenece a otro
  // contexto: dejarlo abierto mostraria el detalle de un dia que ya no esta en
  // la matriz de al lado.
  useEffect(() => { cerrarAsiento() }, [empresa, periodo, cerrarAsiento])
```

Reemplazar el comentario `{/* La matriz y el panel del asiento se agregan en la Tarea 9. */}` por:

```tsx
      {!error && matriz && matriz.sucursales.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="min-w-0 flex-1">
            <MatrizDiferencias matriz={matriz} onCelda={abrirAsiento} seleccion={seleccion} />
          </div>
          {seleccion && (
            <PanelAsiento asiento={asiento} cargando={asientoCargando} error={asientoError} onCerrar={cerrarAsiento} />
          )}
        </div>
      )}
```

- [ ] **Step 4: Buildear y verificar que compila**

Run: `cd C:\apps\dashboards\ControlCaja; npx tsc --noEmit; npm run build`
Expected: sin errores de TS; `dist/` regenerado.

- [ ] **Step 5: Verificar en el navegador con datos reales**

Run: `cd C:\apps\dashboards\ControlCaja; $env:PORT=3014; node server.js`

Abrir `http://localhost:3014/` y confirmar cada punto:

1. La matriz muestra sucursales ordenadas por magnitud descendente; el toggle "Ordenar por código" las reordena.
2. Con scroll horizontal, la columna Sucursal y la fila de encabezado quedan fijas.
3. Las celdas de faltante son rojas y las de sobrante azules, con el importe **escrito** en cada una (el relevo obligatorio por el WARN de contraste).
4. Clic en una celda abre el panel a la derecha con el asiento; los totales debe/haber coinciden; la línea de Diferencias de Caja está en negrita con su punto de color.
5. Con el panel abierto se puede clickear otra celda y el panel cambia sin cerrarse.
6. Cambiar de empresa o de mes cierra el panel.
7. `TESI` → jun 2026 → sucursal 020 día 03: la celda y el asiento tienen que coincidir con lo que trae el archivo **en ese momento** (los importes se regeneran, no hay valor fijo). Derivarlo con:
   ```bash
   awk -F'|' '{gsub(/\r/,"")} $1 ~ /^03\/06\/2026/ && $2=="020"' "//10.0.0.115/Cegid/SAP_REPORTE_Z.TXT"
   ```
   La celda muestra el saldo de la línea `4.2.002.01.050` de esa salida, y el panel las líneas restantes con sus debe/haber.
8. Consola del navegador sin errores ni warnings de React.
9. Probar en modo oscuro (el `<html>` con clase `dark`, o el toggle del portal): los brazos siguen distinguiéndose y el texto de las celdas se lee.

Cortar con Ctrl+C.

- [ ] **Step 6: Commit**

```bash
cd /c/apps && git add dashboards/ControlCaja && git commit -m "feat(controlcaja): matriz con semaforo divergente y panel del asiento"
```

---

### Task 10: Deploy, servicio y documentación

**Files:**
- Create: `C:\apps\dashboards\ControlCaja\CLAUDE.md`
- Modify: `C:\apps\dashboards\CLAUDE.md` (fila en la tabla del mapa)
- Modify: `C:\apps\CLAUDE.md` (fila en la tabla de servicios)
- Modify: `C:\apps\portal-src\deploy\OPERATIONS-10.0.0.118.md` (sección del dashboard nuevo)
- Modify: `C:\apps\portal-src\deploy\server-context\dashboards-CLAUDE.md` y `apps-CLAUDE.md` (copias de contexto, si están sincronizadas con las de arriba)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el dashboard corriendo como servicio y accesible por el portal.

- [ ] **Step 1: PEDIR CONFIRMACIÓN AL USUARIO**

**No avanzar sin respuesta.** Instalar un servicio de Windows y registrar el dashboard en el portal son operaciones sobre la instalación productiva, y la regla de `C:\apps\dashboards\CLAUDE.md` exige confirmación. Preguntar textualmente:

> Está listo para instalar. Voy a: (1) instalar el servicio `dashcontrolcaja.exe` en el puerto 3014 con `install-dashboard-service.js`, y (2) registrarlo en el portal para que quede en `/d/16/`. ¿Confirmás?

- [ ] **Step 2: Verificar el estado previo**

Run:
```powershell
Get-Service dashcontrolcaja.exe -ErrorAction SilentlyContinue
Test-Path C:\apps\dashboards\ControlCaja\daemon
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 3014
```
Expected: los tres vacíos/False. Si el servicio o `daemon\` existen, limpiar primero (con confirmación aparte, es destructivo):
```powershell
sc.exe delete dashcontrolcaja.exe
Remove-Item C:\apps\dashboards\ControlCaja\daemon -Recurse -Force
```

- [ ] **Step 3: Asegurar el build de producción**

Run: `cd C:\apps\dashboards\ControlCaja; npm run build`
Expected: `dist/index.html` y `dist/assets/` presentes. Sin `dist` el dashboard sirve una pantalla en blanco.

- [ ] **Step 4: Instalar el servicio**

Run:
```powershell
cd C:\apps\portal\deploy\dashboards
node install-dashboard-service.js "Dash-ControlCaja" "C:\apps\dashboards\ControlCaja" 3014 "server.js"
```
Expected: el servicio queda instalado y arrancado.

- [ ] **Step 5: Verificar que el servicio levantó y escucha en loopback**

Run:
```powershell
Get-Service dashcontrolcaja.exe | Format-Table Name,Status
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 3014 | Format-Table LocalAddress,LocalPort
Get-Content C:\apps\dashboards\ControlCaja\daemon\dashcontrolcaja.out.log -Tail 20
```
Expected: `Running`; `LocalAddress` = **127.0.0.1** (no `0.0.0.0`); en el log las tres líneas de arranque, incluida `Fuente SAP (red, solo lectura)`.

Si el log muestra `EACCES`/`EPERM` al leer la UNC, es permisos del share: el servicio necesita una cuenta con acceso a `Cegid`. Pedir al usuario la cuenta antes de tocar nada — EstadoResultado lee esa misma ruta sin problema, así que comparar con su configuración de servicio.

- [ ] **Step 6: Registrar en el portal**

Manual, en el navegador: `http://10.0.0.118/` → Administración → Dashboards → nuevo dashboard apuntando al puerto **3014**. Anotar el ID que asigna el portal; si no es 16, usar el real en la documentación de los pasos siguientes en lugar de `/d/16/`.

- [ ] **Step 7: Verificar vía el portal**

Abrir `http://10.0.0.118/d/<id>/` y confirmar: carga dentro del iframe, los assets no dan 404 (el proxy los rutea por cookie), los selectores traen datos y una celda abre el panel. Este es el único chequeo que prueba el camino real del usuario.

- [ ] **Step 8: Escribir `C:\apps\dashboards\ControlCaja\CLAUDE.md`**

```markdown
# CLAUDE.md — ControlCaja

## Qué es
Dashboard **Control de Caja**: matriz sucursal × día con las Diferencias de Caja que SAP reporta,
por empresa y por mes, con drill-down al asiento del día. Frontend React 19 + Vite + TypeScript;
backend Express en `server.js` (**ESM**, no usar `require()`).

## Servicio y acceso
- Servicio de Windows: **`dashcontrolcaja.exe`** (node-windows), puerto **3014**, entrada `server.js`.
- **Los usuarios acceden SOLO vía el portal**: `http://10.0.0.118/d/<id>/`. El puerto 3014 directo
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

400 si la empresa/período/fecha son inválidos; **503** si la UNC no responde (con el motivo).

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
- El `PORT` que inyecta el servicio pisa al del `.env`; mantener 3014 único.
- **Las fechas del archivo se manejan como strings** (`'2026-06-03'`), nunca con `Date`: parsear
  `dd/mm/yyyy` a `Date` y reformatear es la vía clásica a que el día 1 aparezca en el mes anterior.
- ~600 líneas por archivo traen una **fecha en el campo de sucursal** (cuentas de compras). Se
  ignoran y el tablero muestra el conteo. El usuario va a corregir el reporte en origen: cuando el
  contador llegue a cero, es que se corrigió. Si aparece un motivo de descarte **distinto**, el
  formato cambió — investigar, no ajustar el parser a ciegas.
- La paleta del semáforo está **validada** con el skill `dataviz` (CVD ΔE 11,5 light / 10,6 dark).
  No cambiar los hexes de `src/index.css` sin re-correr `scripts/validate_palette.js`.
- Tests: `node --test "tests/*.test.js"` (**el glob entre comillas**: sin comillas falla en git-bash
  con `MODULE_NOT_FOUND`).
- No commitear `.env`. Pedir confirmación antes de reinstalar el servicio o tocar `.env`.
```

- [ ] **Step 9: Sumar la fila a las tablas de contexto**

En `C:\apps\dashboards\CLAUDE.md`, después de la fila de `ControlAcceso`:

```
| `ControlCaja` | `dashcontrolcaja.exe` | 3014 | `/d/<id>/` | `server.js` | Solo lectura de `SAP_REPORTE_Z` / `SAP_PU_REPORTE_Z` en `\\10.0.0.115\Cegid`: matriz sucursal × día de Diferencias de Caja. Sin uploads ni store. |
```

En `C:\apps\CLAUDE.md`, en la tabla de servicios:

```
| `dashcontrolcaja.exe` | 3014 | `C:\apps\dashboards\ControlCaja` |
```

y agregar `3014` a la lista de puertos del `Get-NetTCPConnection` de ese archivo.

Usar el ID real del portal en lugar de `<id>`.

- [ ] **Step 10: Actualizar `OPERATIONS-10.0.0.118.md`**

Agregar una sección con: puerto 3014, servicio `dashcontrolcaja.exe`, URL `/d/<id>/`, que lee la UNC read-only, y la fecha de instalación (03/08/2026). Seguir el formato de las secciones existentes (mirar la de PassReset como modelo).

- [ ] **Step 11: Correr la suite completa una última vez**

Run: `cd C:\apps\dashboards\ControlCaja; node --test "tests/*.test.js"`
Expected: PASS — 62 tests, 0 fallos. **Pegar la salida real en el reporte final**: no afirmar que pasan sin haberlo corrido.

- [ ] **Step 12: Commit**

```bash
cd /c/apps && git add -A && git commit -m "docs(controlcaja): CLAUDE.md del dashboard y registro en el contexto del server"
```

---

## Pendientes que quedan del usuario

Declarados en el spec, no son parte de la implementación:

1. Completar `data/sucursales.json` con los nombres reales de las 36 sucursales.
2. Corregir en origen el reporte Z para que el campo 2 no traiga fechas (o que traiga el código correcto).
3. Generar la exportación de INDO. Cuando exista: una línea en `server/empresas.js`, nada más.
