# Manual de uso integrado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar a ComisionesINDO un manual de uso consultable desde el sidebar, cuyo texto vive en `docs/MANUAL.md` y se corrige sin rebuild ni reinicio del servicio.

**Architecture:** El texto es un archivo Markdown en el repo. Un servicio de backend lo lee del disco y un router lo expone como `GET /api/manual`. El frontend lo pide con el `api` client existente y lo renderiza con un mini-parser Markdown propio (sin dependencias nuevas), armando el índice en runtime a partir de los `##`.

**Tech Stack:** Node.js v24 + ES Modules, Express 4, Vite 6, SPA vanilla JS (sin framework), `node --test` para los tests.

**Spec:** `docs/superpowers/specs/2026-07-30-manual-uso-design.md`

## Global Constraints

- Directorio de trabajo: `C:\apps\dashboards\ComisionesINDO`. Rutas locales, nunca UNC.
- **Cero dependencias nuevas.** No instalar paquetes: ni renderer de Markdown, ni supertest, ni jsdom. El repo tiene solo `bcryptjs`, `cors`, `dotenv`, `express`, `jsonwebtoken`, `mssql` (+ dev: `concurrently`, `exceljs`, `vite`, `xlsx`).
- ES Modules en todo el repo (`"type": "module"`): usar `import`/`export`, nunca `require`.
- Tests: `node --test <archivo>`. Convención de nombre existente: `<modulo>.test.js` junto al módulo (ej. `server/services/calcEngine.supervisores.test.js`). No hay script `npm test`: se invoca `node --test` directo. Solo se testean módulos puros o de filesystem — **no** hay forma de testear rutas HTTP sin agregar dependencias, así que los routers se mantienen finos y se verifican a mano.
- **Módulos blindados: no tocar.** Dashboard, Total, Cajeros, Operadores Retail/Millón, Encargados Retail/Millón, resultado de Supervisores, ABM de Supervisores y todos los visores de DATOS. Este trabajo solo agrega archivos nuevos y hace 3 ediciones puntuales (`server/index.js`, `src/app.js`, `src/components/sidebar.js`) más estilos y documentación.
- Archivos UTF-8 sin BOM: editarlos con las herramientas Write/Edit. **Nunca** con `Get-Content`/`Set-Content` de PowerShell (corrompe los acentos).
- Idioma de todo el contenido visible y de los comentarios de código: español, con acentos correctos.
- Estilos: usar exclusivamente las variables CSS existentes (`--color-surface`, `--color-border`, `--color-text`, `--color-muted`, `--color-primary`, `--color-bg`, `--radius`, `--shadow`, `--sem-yellow`, `--sem-yellow-t`, `--badge-e-bg`, `--badge-e-t`) para que claro/oscuro funcione sin trabajo extra.
- Deploy al final: `npm run build` **y** `Restart-Service dashcomisionesindo.exe`. Los cambios en `src/` no se ven sin build.
- Commits frecuentes, uno por tarea, en español, con prefijo `feat(comisiones-indo):` / `docs(comisiones-indo):` / `style(comisiones-indo):`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `server/services/manualDoc.js` (nuevo) | Leer `docs/MANUAL.md` del disco y devolver `{ markdown, actualizado }`. Toda la lógica de error vive acá → es lo que se testea. |
| `server/services/manualDoc.test.js` (nuevo) | Tests de `leerManual()`: archivo presente, archivo ausente. |
| `server/routes/manual.js` (nuevo) | Router fino: `authMiddleware` + `GET /` que delega en `leerManual()`. Sin lógica propia. |
| `src/components/markdown.js` (nuevo) | Mini-parser: `mdToHtml(md)` → HTML, y `extraerSecciones(md)` → índice. Función pura, sin DOM. Vive en `components/` como los otros helpers compartidos (`exportExcel.js`, `dataTable.js`). |
| `src/components/markdown.test.js` (nuevo) | Tests del parser: encabezados, tablas, listas, código, escape de HTML, slugs duplicados, markdown roto. |
| `src/pages/manual.js` (nuevo) | Página: pide el manual, renderiza índice + contenido, buscador, botón de imprimir, estados de carga/error. |
| `docs/MANUAL.md` (nuevo) | El contenido del manual. |
| `server/index.js` (modificar) | Registrar el router. |
| `src/app.js` (modificar) | Import + ruta `manual`. |
| `src/components/sidebar.js` (modificar) | Sección `AYUDA` + entrada `📖 Manual`. |
| `src/styles/components.css` (modificar) | Clases `.manual-*` + `@media print`. |
| `CONTEXT.md` (modificar) | Nota de mantenimiento del manual. |

---

## Task 1: Servicio y endpoint del manual

Deja funcionando `GET /api/manual` contra un `docs/MANUAL.md` mínimo. El contenido real del manual llega en la Task 5.

**Files:**
- Create: `server/services/manualDoc.js`
- Test: `server/services/manualDoc.test.js`
- Create: `server/routes/manual.js`
- Create: `docs/MANUAL.md` (esqueleto provisional)
- Modify: `server/index.js` (imports en las líneas 10-22, `app.use` en las líneas 28-38)

**Interfaces:**
- Consumes: `authMiddleware` de `server/middleware/auth.js` (ya existe, se usa igual que en `server/routes/objetivos.js:9`).
- Produces:
  - `leerManual(rutaOverride?: string) => Promise<{ markdown: string, actualizado: string|null, ok: boolean }>` — `actualizado` es ISO string o `null`; `ok` es `false` cuando se devolvió el markdown de fallback. El parámetro opcional existe solo para los tests.
  - Endpoint `GET /api/manual` → `200 { markdown, actualizado }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `server/services/manualDoc.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { leerManual } from './manualDoc.js';

test('leerManual devuelve el contenido y la fecha de modificación', async () => {
  const dir  = await mkdtemp(path.join(tmpdir(), 'manual-test-'));
  const ruta = path.join(dir, 'MANUAL.md');
  await writeFile(ruta, '# Manual\n\n## Sección\n\nTexto con acentós.', 'utf8');

  const res = await leerManual(ruta);

  assert.equal(res.ok, true);
  assert.match(res.markdown, /## Sección/);
  assert.match(res.markdown, /acentós/);
  assert.ok(!Number.isNaN(Date.parse(res.actualizado)), 'actualizado debe ser una fecha ISO válida');

  await rm(dir, { recursive: true, force: true });
});

test('leerManual devuelve markdown de fallback si el archivo no existe', async () => {
  const res = await leerManual(path.join(tmpdir(), 'no-existe-jamas-12345.md'));

  assert.equal(res.ok, false);
  assert.equal(res.actualizado, null);
  assert.match(res.markdown, /Manual no disponible/);
  assert.match(res.markdown, /no-existe-jamas-12345\.md/, 'el fallback informa la ruta esperada');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test server/services/manualDoc.test.js`
Expected: FAIL — `Cannot find module '.../server/services/manualDoc.js'`.

- [ ] **Step 3: Implementar el servicio**

Crear `server/services/manualDoc.js`:

```js
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/services/ → ../../docs/MANUAL.md . Se resuelve contra este archivo,
// no contra el cwd: el servicio de Windows arranca desde otra carpeta.
export const RUTA_MANUAL = path.join(__dirname, '..', '..', 'docs', 'MANUAL.md');

function fallback(ruta) {
  return {
    ok: false,
    actualizado: null,
    markdown: [
      '# Manual no disponible',
      '',
      'No se pudo leer el archivo del manual. Avisale al equipo técnico.',
      '',
      '**Ruta esperada:** `' + ruta + '`'
    ].join('\n')
  };
}

/**
 * Lee el manual del disco en cada llamada (sin cache, a propósito: así editar
 * el .md se ve al recargar la página, sin rebuild ni reinicio del servicio).
 * Nunca lanza: si el archivo falta o no se puede leer, devuelve un markdown
 * que explica el problema — una página de ayuda caída no debe mostrar un 500.
 */
export async function leerManual(rutaOverride) {
  const ruta = rutaOverride || RUTA_MANUAL;
  try {
    const [markdown, info] = await Promise.all([readFile(ruta, 'utf8'), stat(ruta)]);
    return { ok: true, markdown, actualizado: info.mtime.toISOString() };
  } catch (err) {
    console.error('[manualDoc]', err.message);
    return fallback(ruta);
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test server/services/manualDoc.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Crear el esqueleto de `docs/MANUAL.md`**

Contenido provisional (la Task 5 lo reemplaza completo):

```markdown
# Manual de uso — Comisiones INDO

## Contenido en preparación

El contenido completo del manual se carga en la tarea 5 del plan.
```

- [ ] **Step 6: Crear el router**

Crear `server/routes/manual.js`:

```js
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { leerManual } from '../services/manualDoc.js';

const router = Router();
router.use(authMiddleware);

// Sin attachScope ni blockWriteIfSupervisor: el manual no tiene datos de
// sucursal que filtrar y el router no expone escritura. Perfil 8 (supervisor,
// solo lectura) ve exactamente el mismo contenido que cualquier otro usuario.
router.get('/', async (_req, res) => {
  const { markdown, actualizado } = await leerManual();
  res.json({ markdown, actualizado });
});

export default router;
```

- [ ] **Step 7: Registrar el router en `server/index.js`**

Agregar el import junto a los demás routers (después de `import operadoresRoutes from './routes/operadores.js';`):

```js
import manualRoutes from './routes/manual.js';
```

Y el `app.use` después de `app.use('/api/operadores', operadoresRoutes);`:

```js
app.use('/api/manual',       manualRoutes);
```

Debe quedar **antes** de `app.use(express.static(distPath))` y del `app.get('*')`, que ya están más abajo en el archivo.

- [ ] **Step 8: Verificar el endpoint a mano**

Arrancar el backend en un puerto libre para no chocar con el servicio (que ocupa el 3011):

```powershell
$env:PORT=3099 ; node server/index.js
```

En otra terminal, generar un token y pedir el manual (reemplazar `<JWT_SECRET>` por el valor del `.env`):

```powershell
$t = node -e "import('jsonwebtoken').then(m=>console.log(m.default.sign({usuario:'test',perfil:1},'<JWT_SECRET>')))"
(Invoke-WebRequest -Uri http://localhost:3099/api/manual -Headers @{Authorization="Bearer $t"}).Content
```

Expected: JSON con `markdown` conteniendo "Manual de uso — Comisiones INDO" y `actualizado` con una fecha ISO. Sin token → 401. Cortar el server con Ctrl+C.

- [ ] **Step 9: Commit**

```bash
git add server/services/manualDoc.js server/services/manualDoc.test.js server/routes/manual.js server/index.js docs/MANUAL.md
git commit -m "feat(comisiones-indo): endpoint GET /api/manual que sirve docs/MANUAL.md"
```

---

## Task 2: Mini-parser de Markdown

Función pura, sin DOM y sin dependencias. Es la pieza con más casos borde, así que va con tests antes que la página.

**Files:**
- Create: `src/components/markdown.js`
- Test: `src/components/markdown.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `mdToHtml(md: string) => string` — HTML del contenido completo. Los `##` salen como `<h2 id="<slug>">`.
  - `extraerSecciones(md: string) => Array<{ id: string, titulo: string }>` — una entrada por `##`, en orden de aparición, con el mismo `id` que emite `mdToHtml` (los slugs duplicados se desduplican con sufijo `-2`, `-3`, …).
  - `slugify(texto: string) => string` — usada internamente por las dos anteriores; se exporta para los tests.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/components/markdown.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml, extraerSecciones, slugify } from './markdown.js';

test('slugify normaliza acentos, espacios y símbolos', () => {
  assert.equal(slugify('2. Período y flujo'), '2-periodo-y-flujo');
  assert.equal(slugify('Reglas: Cajeros (Retail)'), 'reglas-cajeros-retail');
});

test('encabezados h1/h2/h3, con id solo en h2', () => {
  const html = mdToHtml('# Título\n\n## Sección Uno\n\n### Sub');
  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /<h2 id="seccion-uno">Sección Uno<\/h2>/);
  assert.match(html, /<h3>Sub<\/h3>/);
});

test('párrafos, negrita, itálica y código inline', () => {
  const html = mdToHtml('Texto **fuerte** y *suave* con `codigo()`.');
  assert.match(html, /<p>/);
  assert.match(html, /<strong>fuerte<\/strong>/);
  assert.match(html, /<em>suave<\/em>/);
  assert.match(html, /<code>codigo\(\)<\/code>/);
});

test('lista con guiones y lista numerada', () => {
  const ul = mdToHtml('- uno\n- dos');
  assert.match(ul, /<ul>\s*<li>uno<\/li>\s*<li>dos<\/li>\s*<\/ul>/);
  const ol = mdToHtml('1. uno\n2. dos');
  assert.match(ol, /<ol>\s*<li>uno<\/li>\s*<li>dos<\/li>\s*<\/ol>/);
});

test('tabla GFM con encabezado', () => {
  const html = mdToHtml('| Rol | Monto |\n|---|---|\n| A | $10.000 |');
  assert.match(html, /<table class="manual-table">/);
  assert.match(html, /<th>Rol<\/th>/);
  assert.match(html, /<td>\$10\.000<\/td>/);
});

test('bloque de código y blockquote', () => {
  const code = mdToHtml('```\nDELETE FROM tabla\n```');
  assert.match(code, /<pre><code>DELETE FROM tabla\n<\/code><\/pre>/);
  const quote = mdToHtml('> Ojo con esto');
  assert.match(quote, /<blockquote>/);
  assert.match(quote, /Ojo con esto/);
});

test('regla horizontal', () => {
  assert.match(mdToHtml('a\n\n---\n\nb'), /<hr>/);
});

test('escapa HTML del contenido', () => {
  const html = mdToHtml('Texto con <script>alert(1)</script> adentro');
  assert.ok(!html.includes('<script>'), 'no debe emitir <script> crudo');
  assert.match(html, /&lt;script&gt;/);
});

test('el markdown dentro de un bloque de código no se interpreta', () => {
  const html = mdToHtml('```\n## no es un titulo\n**ni negrita**\n```');
  assert.ok(!html.includes('<h2'), 'dentro de ``` no hay encabezados');
  assert.ok(!html.includes('<strong>'), 'dentro de ``` no hay negrita');
});

test('extraerSecciones lista los h2 en orden con sus ids', () => {
  const md = '# T\n\n## Uno\n\ntexto\n\n### sub\n\n## Dos\n';
  assert.deepEqual(extraerSecciones(md), [
    { id: 'uno', titulo: 'Uno' },
    { id: 'dos', titulo: 'Dos' }
  ]);
});

test('h2 con el mismo título recibe id desduplicado, igual en html e índice', () => {
  const md = '## Reglas\n\n## Reglas\n';
  assert.deepEqual(extraerSecciones(md), [
    { id: 'reglas',   titulo: 'Reglas' },
    { id: 'reglas-2', titulo: 'Reglas' }
  ]);
  const html = mdToHtml(md);
  assert.match(html, /id="reglas"/);
  assert.match(html, /id="reglas-2"/);
});

test('markdown mal formado no lanza y no devuelve vacío', () => {
  const roto = '| a | b\n|--\n**sin cerrar\n```\nsin fin';
  const html = mdToHtml(roto);
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0);
});

test('entrada vacía devuelve string vacío', () => {
  assert.equal(mdToHtml(''), '');
  assert.deepEqual(extraerSecciones(''), []);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test src/components/markdown.test.js`
Expected: FAIL — `Cannot find module '.../src/components/markdown.js'`.

- [ ] **Step 3: Implementar el parser**

Crear `src/components/markdown.js`:

```js
/**
 * Mini-parser Markdown para el manual de uso. Sin dependencias.
 *
 * Soporta: # / ## / ###, párrafos, listas (- y numeradas), tablas GFM,
 * bloques ```, blockquotes >, ---, y en línea **negrita**, *itálica*, `código`.
 *
 * Regla de robustez: lo que no reconoce sale como párrafo plano. Nunca lanza:
 * un manual mal formado tiene que verse feo, no dejar la página en blanco.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function slugify(texto) {
  return String(texto)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // saca acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'seccion';
}

// Contador de slugs para desduplicar títulos repetidos.
function nuevoDedup() {
  const vistos = new Map();
  return (titulo) => {
    const base = slugify(titulo);
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

// Inline: se aplica sobre texto YA escapado.
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function esFilaTabla(l)      { return /^\s*\|/.test(l); }
function esSeparadorTabla(l) { return /^\s*\|?[\s:-]*-[\s:|-]*$/.test(l) && l.includes('-'); }
function celdas(l) {
  return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => inline(c.trim()));
}

export function extraerSecciones(md) {
  if (!md) return [];
  const dedup = nuevoDedup();
  const out = [];
  let enCodigo = false;
  for (const linea of String(md).split(/\r?\n/)) {
    if (/^```/.test(linea)) { enCodigo = !enCodigo; continue; }
    if (enCodigo) continue;
    const m = /^##\s+(.*)$/.exec(linea);
    if (m) {
      const titulo = m[1].trim();
      out.push({ id: dedup(titulo), titulo });
    }
  }
  return out;
}

export function mdToHtml(md) {
  if (!md) return '';
  const lineas = String(md).split(/\r?\n/);
  const dedup = nuevoDedup();
  const out = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i];

    // Bloque de código: nada de adentro se interpreta.
    if (/^```/.test(linea)) {
      i++;
      const buf = [];
      while (i < lineas.length && !/^```/.test(lineas[i])) { buf.push(lineas[i]); i++; }
      i++; // cierre (si falta, ya estamos al final del array)
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}\n</code></pre>`);
      continue;
    }

    if (!linea.trim())               { i++; continue; }
    if (/^\s*---+\s*$/.test(linea))  { out.push('<hr>'); i++; continue; }

    let m;
    if ((m = /^###\s+(.*)$/.exec(linea))) {
      out.push(`<h3>${inline(escapeHtml(m[1].trim()))}</h3>`); i++; continue;
    }
    if ((m = /^##\s+(.*)$/.exec(linea))) {
      const titulo = m[1].trim();
      out.push(`<h2 id="${dedup(titulo)}">${inline(escapeHtml(titulo))}</h2>`); i++; continue;
    }
    if ((m = /^#\s+(.*)$/.exec(linea))) {
      out.push(`<h1>${inline(escapeHtml(m[1].trim()))}</h1>`); i++; continue;
    }

    // Tabla: fila de encabezado + separador + filas.
    if (esFilaTabla(linea) && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1])) {
      const head = celdas(escapeHtml(linea));
      i += 2;
      const body = [];
      while (i < lineas.length && esFilaTabla(lineas[i])) { body.push(celdas(escapeHtml(lineas[i]))); i++; }
      out.push(
        '<table class="manual-table"><thead><tr>' +
        head.map(c => `<th>${c}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map(f => '<tr>' + f.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>'
      );
      continue;
    }

    // Blockquote (líneas consecutivas).
    if (/^\s*>\s?/.test(linea)) {
      const buf = [];
      while (i < lineas.length && /^\s*>\s?/.test(lineas[i])) { buf.push(lineas[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(escapeHtml(buf.join(' ')))}</blockquote>`);
      continue;
    }

    // Listas (- / * / numeradas). Las líneas indentadas que siguen a un item
    // se pegan a ese item: alcanza para las sublíneas del manual.
    const esItem = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
    if (esItem(linea)) {
      const ordenada = /^\s*\d+\.\s+/.test(linea);
      const items = [];
      while (i < lineas.length && (esItem(lineas[i]) || (/^\s{2,}\S/.test(lineas[i]) && items.length))) {
        if (esItem(lineas[i])) {
          items.push(lineas[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        } else {
          items[items.length - 1] += ' ' + lineas[i].trim();
        }
        i++;
      }
      const tag = ordenada ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(t => `<li>${inline(escapeHtml(t))}</li>`).join('') + `</${tag}>`);
      continue;
    }

    // Párrafo: líneas consecutivas hasta un blanco o el inicio de otro bloque.
    const buf = [];
    while (
      i < lineas.length && lineas[i].trim() &&
      !/^(#{1,3}\s|```|\s*>|\s*---+\s*$)/.test(lineas[i]) &&
      !esItem(lineas[i]) && !esFilaTabla(lineas[i])
    ) { buf.push(lineas[i].trim()); i++; }
    if (buf.length) out.push(`<p>${inline(escapeHtml(buf.join(' ')))}</p>`);
    else i++;  // salvaguarda: nunca dejar de avanzar
  }

  return out.join('\n');
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test src/components/markdown.test.js`
Expected: PASS — 13 tests. Si algún test de espaciado en listas falla por los `\s*` de los regex del test, ajustar el **test** para que compare el HTML real (no relajar el parser).

- [ ] **Step 5: Commit**

```bash
git add src/components/markdown.js src/components/markdown.test.js
git commit -m "feat(comisiones-indo): mini-parser de Markdown para el manual (sin dependencias)"
```

---

## Task 3: Página del manual, ruta y entrada en el sidebar

**Files:**
- Create: `src/pages/manual.js`
- Modify: `src/app.js` (imports líneas 1-18, objeto `ROUTES` líneas 20-36)
- Modify: `src/components/sidebar.js` (array `MENU`, líneas 3-24)

**Interfaces:**
- Consumes: `api` de `src/api/client.js` (`api.get('/manual')` — el cliente agrega `/api` solo, no incluirlo en el path); `mdToHtml` y `extraerSecciones` de `src/components/markdown.js` (Task 2).
- Produces: `renderManual(container)` — el router la invoca como `fn(root, periodoActual)` igual que a las demás páginas, pero la función declara solo `container`: el manual no depende del período activo y el segundo argumento se ignora.

- [ ] **Step 1: Crear la página**

Crear `src/pages/manual.js`:

```js
import { api } from '../api/client.js';
import { mdToHtml, extraerSecciones } from '../components/markdown.js';

function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

// Resalta el término buscado dentro de los nodos de texto de un contenedor,
// sin tocar el HTML ya renderizado (no romper tablas ni <code>).
function resaltar(root, termino) {
  const t = termino.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodos = [];
  while (walker.nextNode()) nodos.push(walker.currentNode);

  for (const nodo of nodos) {
    const txt = nodo.nodeValue;
    if (!txt.toLowerCase().includes(t)) continue;
    const frag = document.createDocumentFragment();
    let resto = txt;
    let pos = resto.toLowerCase().indexOf(t);
    while (pos !== -1) {
      frag.appendChild(document.createTextNode(resto.slice(0, pos)));
      const mark = document.createElement('mark');
      mark.className = 'manual-hit';
      mark.textContent = resto.slice(pos, pos + t.length);
      frag.appendChild(mark);
      resto = resto.slice(pos + t.length);
      pos = resto.toLowerCase().indexOf(t);
    }
    frag.appendChild(document.createTextNode(resto));
    nodo.parentNode.replaceChild(frag, nodo);
  }
}

export async function renderManual(container) {
  container.innerHTML = `
    <div class="manual-wrap">
      <div class="manual-toolbar">
        <h2 class="manual-h2">📖 Manual de uso</h2>
        <input id="manual-search" class="manual-search" type="text"
               placeholder="🔍 Buscar en el manual…" autocomplete="off">
        <button id="manual-print" class="btn btn-secondary btn-sm">🖨 Imprimir / PDF</button>
      </div>
      <div class="manual-cols">
        <nav id="manual-index" class="manual-index"></nav>
        <div id="manual-content" class="manual-content">
          <div class="manual-msg">
            <div style="font-size:32px;margin-bottom:12px">⏳</div>
            <p>Cargando manual…</p>
          </div>
        </div>
      </div>
      <div id="manual-foot" class="manual-foot"></div>
    </div>
  `;

  const $index   = container.querySelector('#manual-index');
  const $content = container.querySelector('#manual-content');
  const $foot    = container.querySelector('#manual-foot');
  const $search  = container.querySelector('#manual-search');

  container.querySelector('#manual-print').addEventListener('click', () => window.print());

  let data;
  try {
    data = await api.get('/manual');
  } catch (err) {
    // El 401 lo maneja client.js (evento unauthorized). Acá solo red/500.
    $content.innerHTML = `
      <div class="manual-msg">
        <div style="font-size:32px;margin-bottom:12px">📭</div>
        <p style="font-weight:600">No se pudo cargar el manual</p>
        <p style="font-size:12px;color:var(--color-muted)">${err.message}</p>
        <button id="manual-retry" class="btn btn-primary btn-sm" style="margin-top:12px">Reintentar</button>
      </div>`;
    $content.querySelector('#manual-retry')
      .addEventListener('click', () => renderManual(container));
    return;
  }

  const md = data.markdown || '';
  $content.innerHTML = mdToHtml(md);
  $foot.textContent = `Última actualización del manual: ${fmtFecha(data.actualizado)}`;

  const secciones = extraerSecciones(md);
  $index.innerHTML = secciones.length
    ? `<div class="manual-index-title">Contenido</div>` +
      secciones.map(s => `<a class="manual-index-link" href="#${s.id}" data-id="${s.id}">${s.titulo}</a>`).join('')
    : '';

  // Scroll manual: el contenedor scrolleable es .manual-content, no la ventana,
  // así que href="#id" no alcanza.
  $index.querySelectorAll('.manual-index-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const dest = $content.querySelector(`[id="${a.dataset.id}"]`);
      if (dest) dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $index.querySelectorAll('.manual-index-link').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
    });
  });

  // Buscador: re-renderiza desde el markdown original y deja visibles solo las
  // secciones con coincidencias (una "sección" = un h2 y todo lo que le sigue).
  function aplicarBusqueda(q) {
    const termino = q.trim();
    $content.innerHTML = mdToHtml(md);
    if (!termino) return;

    const nodos = Array.from($content.children);
    const grupos = [];
    for (const n of nodos) {
      if (n.tagName === 'H2' || !grupos.length) grupos.push([]);
      grupos[grupos.length - 1].push(n);
    }
    const t = termino.toLowerCase();
    let encontrados = 0;
    for (const grupo of grupos) {
      const hit = grupo.some(n => (n.textContent || '').toLowerCase().includes(t));
      if (hit) encontrados++;
      grupo.forEach(n => { n.style.display = hit ? '' : 'none'; });
    }
    if (!encontrados) {
      $content.innerHTML = `
        <div class="manual-msg">
          <div style="font-size:32px;margin-bottom:12px">🔍</div>
          <p>Sin coincidencias para «${termino}»</p>
        </div>`;
      return;
    }
    resaltar($content, termino);
  }

  let timer;
  $search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => aplicarBusqueda($search.value), 150);
  });
}
```

- [ ] **Step 2: Registrar la ruta en `src/app.js`**

Agregar el import después de `import { renderVisorVentas } from './pages/visor-ventas.js';`:

```js
import { renderManual } from './pages/manual.js';
```

Y la entrada al final del objeto `ROUTES`, después de `'visor-ventas': renderVisorVentas,`:

```js
  manual:                 renderManual,
```

- [ ] **Step 3: Agregar la entrada al sidebar**

En `src/components/sidebar.js`, al final del array `MENU` (después de la línea de `resultado-supervisores`):

```js
  { section: 'AYUDA' },
  { route: 'manual',       icon: '📖', label: 'Manual' },
```

- [ ] **Step 4: Verificar en el navegador**

```powershell
npm run dev
```

Abrir `http://localhost:5173`, loguearse, y en el sidebar entrar a **AYUDA → 📖 Manual**.
Expected: se ve el título del esqueleto, el índice con la única sección, el pie con la fecha, y no hay errores en la consola. Los estilos todavía se ven crudos: los agrega la Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/pages/manual.js src/app.js src/components/sidebar.js
git commit -m "feat(comisiones-indo): pagina Manual con indice, buscador e impresion"
```

---

## Task 4: Estilos del manual (claro/oscuro + impresión)

**Files:**
- Modify: `src/styles/components.css` (agregar al final del archivo)

**Interfaces:**
- Consumes: las clases que emite `src/pages/manual.js` (`.manual-wrap`, `.manual-toolbar`, `.manual-h2`, `.manual-search`, `.manual-cols`, `.manual-index`, `.manual-index-title`, `.manual-index-link`, `.manual-content`, `.manual-msg`, `.manual-foot`, `.manual-hit`) y la clase `.manual-table` que emite `src/components/markdown.js`.
- Produces: nada consumido por otras tareas.

- [ ] **Step 1: Agregar los estilos al final de `src/styles/components.css`**

```css
/* ── Manual de uso ───────────────────────────────────────────────── */
.manual-wrap { display: flex; flex-direction: column; height: calc(100vh - 48px); }

.manual-toolbar {
  flex-shrink: 0; display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap; margin-bottom: 12px;
}
.manual-h2 { font-size: 20px; font-weight: 700; margin: 0; flex: 1; }
.manual-search {
  padding: 6px 10px; border: 1px solid var(--color-border); border-radius: 6px;
  font-size: 13px; width: 240px;
  background: var(--color-surface); color: var(--color-text);
}
.manual-search:focus { outline: none; border-color: var(--color-primary); }

.manual-cols { flex: 1; display: flex; gap: 18px; min-height: 0; }

.manual-index {
  flex: 0 0 240px; overflow-y: auto; padding-right: 8px;
  border-right: 1px solid var(--color-border);
}
.manual-index-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .5px; color: var(--color-muted); margin-bottom: 8px;
}
.manual-index-link {
  display: block; padding: 5px 8px; margin-bottom: 2px;
  font-size: 13px; color: var(--color-text); text-decoration: none;
  border-radius: 6px; border-left: 3px solid transparent;
  transition: all var(--transition);
}
.manual-index-link:hover { background: var(--color-row-hover); }
.manual-index-link.active {
  border-left-color: var(--color-primary); color: var(--color-primary); font-weight: 600;
}

.manual-content {
  flex: 1; overflow-y: auto; min-width: 0; padding-right: 8px;
  font-size: 14px; line-height: 1.65; color: var(--color-text);
}
.manual-content h1 { font-size: 22px; font-weight: 700; margin: 0 0 14px; }
.manual-content h2 {
  font-size: 18px; font-weight: 700; margin: 26px 0 10px;
  padding-bottom: 6px; border-bottom: 1px solid var(--color-border);
  scroll-margin-top: 8px;
}
.manual-content h2:first-child { margin-top: 0; }
.manual-content h3 { font-size: 15px; font-weight: 700; margin: 18px 0 6px; }
.manual-content p  { margin: 0 0 10px; }
.manual-content ul, .manual-content ol { margin: 0 0 12px; padding-left: 22px; }
.manual-content li { margin-bottom: 5px; }
.manual-content hr { border: none; border-top: 1px solid var(--color-border); margin: 20px 0; }
.manual-content code {
  background: var(--color-bg); border: 1px solid var(--color-border);
  border-radius: 4px; padding: 1px 5px; font-size: 12.5px;
}
.manual-content pre {
  background: var(--color-bg); border: 1px solid var(--color-border);
  border-radius: var(--radius); padding: 10px 12px;
  overflow-x: auto; margin: 0 0 12px;
}
.manual-content pre code { background: none; border: none; padding: 0; }
.manual-content blockquote {
  margin: 0 0 12px; padding: 8px 14px;
  background: var(--sem-yellow); color: var(--sem-yellow-t);
  border-left: 3px solid var(--sem-yellow-t); border-radius: 0 6px 6px 0;
}

.manual-table {
  width: 100%; border-collapse: collapse; margin: 0 0 14px; font-size: 13px;
  background: var(--color-surface);
}
.manual-table th, .manual-table td {
  border: 1px solid var(--color-border); padding: 6px 10px;
  text-align: left; vertical-align: top;
}
.manual-table th { background: var(--color-bg); font-weight: 700; }
.manual-table tbody tr:hover { background: var(--color-row-hover); }

.manual-msg { text-align: center; padding: 60px 20px; color: var(--color-muted); }
.manual-foot {
  flex-shrink: 0; margin-top: 10px; padding-top: 8px;
  border-top: 1px solid var(--color-border);
  font-size: 11px; color: var(--color-muted);
}
.manual-hit { background: var(--badge-e-bg); color: var(--badge-e-t); border-radius: 2px; }

/* Pantallas angostas: el índice pasa arriba del contenido */
@media (max-width: 900px) {
  .manual-cols { flex-direction: column; }
  .manual-index {
    flex: 0 0 auto; max-height: 160px;
    border-right: none; border-bottom: 1px solid var(--color-border);
    padding-right: 0; padding-bottom: 8px;
  }
  .manual-search { width: 100%; }
}

/* ── Impresión del manual ────────────────────────────────────────── */
@media print {
  #sidebar, .manual-toolbar, .manual-index, .manual-foot { display: none !important; }
  #main-content, .page-body { overflow: visible !important; margin: 0 !important; padding: 0 !important; }
  .manual-wrap, .manual-cols { display: block !important; height: auto !important; }
  .manual-content {
    overflow: visible !important; height: auto !important;
    font-size: 11pt; color: #000; padding: 0 !important;
  }
  .manual-content h2, .manual-content h3 { break-after: avoid; }
  .manual-table, .manual-content pre, .manual-content blockquote { break-inside: avoid; }
  .manual-table th { background: #eee !important; }
  .manual-hit { background: none !important; color: #000 !important; }
}
```

- [ ] **Step 2: Verificar claro, oscuro e impresión**

Con `npm run dev` corriendo, en la página del Manual:
1. Modo claro y modo oscuro (botón 🌙/☀️ del sidebar): texto, tablas, bloques de código y blockquote legibles en ambos.
2. `Ctrl+P` → la vista previa **no** muestra sidebar, ni barra de herramientas, ni índice, ni pie, y el contenido no queda cortado.
3. Angostar la ventana a menos de 900 px → el índice pasa arriba del contenido.

- [ ] **Step 3: Commit**

```bash
git add src/styles/components.css
git commit -m "style(comisiones-indo): estilos del manual (claro/oscuro, responsive e impresion)"
```

---

## Task 5: Escribir el contenido del manual

Reemplaza el esqueleto de la Task 1 por el manual completo. Todo el contenido sale de la sección 5 del spec; los datos concretos hay que tomarlos de `CONTEXT.md` y `RETOMAR.md`, que son la fuente autorizada de las reglas vigentes.

**Files:**
- Modify: `docs/MANUAL.md` (reemplazo completo)

**Interfaces:**
- Consumes: el parser de la Task 2 — usar solo la sintaxis que soporta (`#`, `##`, `###`, párrafos, listas, tablas GFM, ```` ``` ````, `>`, `---`, `**negrita**`, `*itálica*`, `` `código` ``). **No usar** links `[texto](url)`, imágenes, listas anidadas de más de un nivel ni HTML crudo: no están soportados y saldrían como texto plano.
- Produces: el índice de la página (un `##` = una entrada).

- [ ] **Step 1: Escribir la estructura de secciones**

Un `#` de título y estos 17 `##` en este orden (el índice sale de acá):

```
# Manual de uso — Comisiones INDO
## 1. Qué hace esta aplicación (y qué no)
## 2. Período activo
## 3. Cómo se liquida un período, paso a paso
## 4. Pantallas de DATOS
## 5. Pantallas de Cálculos
## 6. Exportar a CSV
## 7. Retail y Millón: dos mundos distintos
## 8. Categorías de sucursal y ranking
## 9. Escalones y la tolerancia del 4%
## 10. Multiplicador de categoría: se aplica una sola vez
## 11. Reglas de Cajeros
## 12. Reglas de Operadores
## 13. Reglas de Encargados
## 14. Reglas de Supervisores
## 15. Montos congelados por período
## 16. Usuarios supervisores: acceso de solo lectura
## 17. Limitaciones conocidas
## 18. Problemas frecuentes
```

- [ ] **Step 2: Redactar las secciones 1 a 6 (Parte A — uso)**

Requisitos de contenido, en tono directo y en segunda persona:

- **§1**: calcula y liquida comisiones de cajeros, operadores, encargados y supervisores de sucursales Retail y Millón. Deja claro que **no** paga, no emite recibos y no manda nada a sueldos: produce el cálculo y sus exportaciones.
- **§2**: el selector del sidebar, formato `YYYY-MM`, se recuerda entre sesiones, y es lo primero a fijar porque **todas** las pantallas leen ese período.
- **§3**: los 4 pasos, en lista numerada: (1) revisar datos maestros del período — Sucursales, Montos, Objetivos, Supervisores y sus sucursales asignadas; (2) **Cálculos → Total → ▶ Ejecutar cálculo**, que sincroniza objetivos desde BeClever, recalcula el ranking A/B/C y corre el motor completo (Total, Operadores Retail y Millón, Encargados Retail y Millón, Supervisores) guardando el resultado; (3) **Cajeros** con su botón propio, porque necesita los overrides de jornada que se cargan en esa pantalla; (4) leer los resultados por rol y exportar los CSV. Aclarar que el botón de Total es hoy el **único** disparador del cálculo completo.
- **§4**: una tabla con las 7 pantallas de DATOS (Sucursales Retail — con el toggle Habilitada/Deshabilitada —, Sucursales Millón, Montos, Ranking, Objetivos, Ventas, Supervisores) y por cada una: qué muestra y qué se puede editar.
- **§5**: una tabla con las 7 pantallas de Cálculos (Total, Cajeros, Operadores Retail, Operadores Millón, Encargados Retail, Encargados Millón, Supervisores) y por cada una: qué muestra y si tiene botón de cálculo propio. Aclarar que Encargados muestra resultado **por sucursal**, sin nombres de personas.
- **§6**: el botón `↓ CSV` de cada pantalla de resultado. Formato: separador `;` y BOM UTF-8, así abre directo en Excel en español. Aclarar que en Ventas → Originaciones el CSV baja **solo las filas filtradas**.

- [ ] **Step 3: Redactar las secciones 7 a 16 (Parte B — reglas)**

Valores exactos, sin redondear ni reinterpretar:

- **§7**: Retail = id < 100. Millón = id ≥ 100 (originación de créditos). Reglas distintas por tipo, y Retail y Millón forman **plazas separadas** aunque compartan provincia.
- **§8**: categorías A/B/C asignadas por sucursal y período; el ranking se recalcula solo al ejecutar el cálculo desde Total.
- **§9**: E1 = 100%, E2 = 110%, E3 = 126,5% (110% × 1,15). **Tolerancia 4%**: un faltante menor al 4% del umbral cuenta como alcanzado. Aplica en todo el sistema.
- **§10**: A = 1,30 · B = 1,15 · C = 1,00. Al editar el valor de categoría C en el ABM de Montos, el sistema graba **ya multiplicados** los de B y A; por eso el motor no vuelve a multiplicar. Los cajeros **nunca** llevan multiplicador.
- **§11**: comisiona si `VTA/VTATOT ≥ objetivo de participación` (ambos en % directo, con la misma tolerancia del 4%). Si comisiona: monto completo de su categoría; part-time cobra el 50% redondeado a múltiplos de 1.000. La jornada viene del sistema y se puede sobreescribir a mano en la pantalla.
- **§12**: dos subsecciones `###`. Retail: indicadores G / O / R, y **G es puerta** de O y R (sin G no cobra los otros). Millón: solo efectivo; el objetivo de la sucursal se divide en full-equivalentes (full = 1, part-time = 0,5); el part-time compara su venta × 2 contra ese objetivo y cobra el 50% del monto.
- **§13**: dos subsecciones `###`. Retail: escalón de consumo + participación (indicador G), **componentes independientes** (uno puede cobrarse sin el otro). Millón: solo escalón de efectivo, **sin** participación.
- **§14**: las reglas vigentes desde 2026-07-16.
  - Retail (solo consumo), dos indicadores por sucursal: pesos (escalón de consumo ≥ 1) y participación (G > −4%).
  - Tabla de pago por sucursal Retail:

    | Pesos | Participación | Paga |
    |---|---|---|
    | Sí | Sí | Monto completo de la categoría: A $10.000 · B $9.000 · C $8.000 |
    | Sí | No | La mitad, redondeada a miles: A $5.000 · B $5.000 · C $4.000 |
    | No | — | $0 — los pesos son condición necesaria |

  - Sin objetivo de participación cargado → no llega a participación.
  - Plus por plaza Retail (plaza = provincia): si **todas** las Retail asignadas de esa provincia llegan a participación (sin importar pesos) → plus = suma de lo efectivamente pagado por esas sucursales × 0,5, redondeado a miles. Si una falla, no hay plus.
  - Millón (solo efectivo): no paga por sucursal. Si **todas** las Millón asignadas de la provincia llegaron por efectivo → la plaza paga **$23.000 una sola vez**.
- **§15**: la primera vez que se calcula un período se guarda una foto de los montos vigentes en ese momento. Reprocesar ese mismo período **siempre** usa esa foto, sin importar qué se edite después en el ABM de Montos. El ABM sigue editando el valor vivo, que se usa para los períodos nuevos. Sirve para que recalcular un mes cerrado no cambie lo ya liquidado.
- **§16**: los usuarios supervisores ven el tablero completo pero **solo lectura** — sin controles de edición ni botones de cálculo — y solo con los datos de sus sucursales asignadas. En el resultado de Supervisores ven únicamente su propio registro.

- [ ] **Step 4: Redactar las secciones 17 y 18 (Parte C — limitaciones y problemas)**

- **§17 Limitaciones conocidas**, los 5 puntos del spec:
  1. Cajeros no se recalcula con el botón de Total (necesita los overrides de jornada de su pantalla).
  2. Descongelar un período no tiene interfaz, es deliberado: si un período se calculó antes de terminar de cargar los montos correctos, hay que pedirle al equipo técnico que borre su foto para que el próximo cálculo tome los valores nuevos. **No incluir la sentencia SQL**: el manual lo leen usuarios finales.
  3. El aviso amarillo "los datos guardados son del formato anterior" significa que el resultado se generó con reglas viejas; se resuelve re-ejecutando el cálculo del período desde Total.
  4. E1 en ámbar puede mostrarse en verde en períodos que no se recalcularon con la versión actual.
  5. Operadores Retail reconstruye el monto desde la fila de categoría C multiplicada, en lugar de leer las filas A/B cargadas en Montos. Es una inconsistencia conocida frente al resto del motor y puede dar diferencias en sucursales A y B.
- **§18 Problemas frecuentes**: tabla síntoma → causa probable → qué hacer, con al menos estos casos: pantalla de resultado vacía (no se ejecutó el cálculo del período → Total → ▶ Ejecutar cálculo); un cambio de montos que no se refleja (montos congelados del período → §15); un supervisor sin plus de plaza (alguna sucursal de la provincia no llegó a participación → §14); una sucursal que no aparece (está deshabilitada); "Sin autorización" o vuelta al login (sesión vencida → volver a entrar).

- [ ] **Step 5: Verificar el render completo**

Con `npm run dev`, abrir el Manual:
1. El índice lista las 18 secciones y cada link salta a la sección correcta.
2. Las tablas se ven como tablas (si alguna sale como párrafo, le falta la fila separadora `|---|---|`).
3. Buscar `23.000` → deja visible solo la sección de Supervisores, con el número resaltado.
4. Buscar `zzz` → mensaje "Sin coincidencias".
5. Vaciar el buscador → vuelve el manual completo.
6. `Ctrl+P` → el manual completo entra en la vista previa, sin sidebar ni índice.

- [ ] **Step 6: Verificar que se corrige sin rebuild**

Editar una línea cualquiera de `docs/MANUAL.md`, guardar, y **recargar la página** (sin `npm run build`, sin reiniciar nada).
Expected: el cambio se ve, y el pie muestra la fecha/hora nueva. Esto es lo que valida la decisión de arquitectura entera.

- [ ] **Step 7: Commit**

```bash
git add docs/MANUAL.md
git commit -m "docs(comisiones-indo): contenido del manual de uso (uso, reglas y limitaciones)"
```

---

## Task 6: Deploy, verificación en producción y nota de mantenimiento

**Files:**
- Modify: `CONTEXT.md` (agregar a la sección "Páginas (`src/pages/`) y sidebar" y a "Build / deploy")
- Modify: `RETOMAR.md` (registrar la sesión)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Correr todos los tests del repo**

```bash
node --test server/services/manualDoc.test.js src/components/markdown.test.js server/services/calcEngine.supervisores.test.js
```

Expected: PASS en todos (2 + 13 + 10 = 25 tests). Los de `calcEngine.supervisores` se corren para confirmar que no hubo regresión — este trabajo no toca el motor, así que si fallan, el problema es previo y hay que avisarlo, no arreglarlo acá.

- [ ] **Step 2: Build y reinicio del servicio**

```powershell
npm run build
Restart-Service dashcomisionesindo.exe
Get-Service dashcomisionesindo.exe | Format-Table Name,Status
```

Expected: `Running`. Si falla, ver `server\daemon\dashcomisionesindo.err.log`.

- [ ] **Step 3: Smoke test local del endpoint**

```powershell
(Invoke-WebRequest -Uri http://localhost:3011/api/manual -UseBasicParsing).StatusCode
```

Expected: **401** sin token (el endpoint existe y pide auth; un 404 significaría que el router no quedó registrado).

- [ ] **Step 4: Verificar el fallback de archivo ausente**

```powershell
Rename-Item C:\apps\dashboards\ComisionesINDO\docs\MANUAL.md MANUAL.md.bak
```

Recargar la página del Manual en el navegador.
Expected: se ve "Manual no disponible" con la ruta esperada — **no** un error de red ni una pantalla en blanco. Después restaurar:

```powershell
Rename-Item C:\apps\dashboards\ComisionesINDO\docs\MANUAL.md.bak MANUAL.md
```

Recargar: el manual vuelve completo.

- [ ] **Step 5: Verificar por el portal con los dos perfiles**

Entrar por `http://10.0.0.118/d/8/` (el acceso real de los usuarios, vía proxy):
1. Con un usuario de perfil normal → AYUDA → 📖 Manual: se ve completo, el índice navega, el buscador filtra.
2. Con el usuario supervisor `EVIDABLE` (perfil 8) → el Manual se ve **igual**, sin 403 ni contenido recortado.
3. En ambos casos, verificar que el resto del sidebar sigue navegando como antes (chequeo de no-regresión: entrar a Total, Cajeros y Supervisores y confirmar que cargan).

- [ ] **Step 6: Nota de mantenimiento en `CONTEXT.md`**

En la tabla de la sección "Páginas (`src/pages/`) y sidebar", agregar la fila:

```markdown
| AYUDA | `manual` | Manual de uso. El texto vive en `docs/MANUAL.md` y lo sirve `GET /api/manual` — editar el `.md` y recargar la página alcanza, **sin** `npm run build` ni reinicio del servicio |
```

Y al final de la sección "Build / deploy", agregar:

```markdown
> **Al cambiar una regla del motor de cálculo, actualizar `docs/MANUAL.md`.** Es el manual que ven los usuarios desde la app (sección AYUDA); no requiere build ni deploy, solo editar el archivo.
```

- [ ] **Step 7: Registrar la sesión en `RETOMAR.md`**

Agregar una sección nueva al principio del archivo (arriba de la última sesión registrada) con: fecha 2026-07-30, qué se implementó, los archivos nuevos, la decisión de que el `.md` se edita sin rebuild, el resultado de los tests (25 pasando), y la verificación con perfil normal y con EVIDABLE. Referenciar el spec y este plan.

- [ ] **Step 8: Commit**

```bash
git add CONTEXT.md RETOMAR.md
git commit -m "docs(comisiones-indo): documentar el manual de uso y su mantenimiento"
```

---

## Notas para quien implemente

- **El backend no necesita build.** Cambios en `server/` solo requieren reiniciar el servicio. Cambios en `src/` **sí** requieren `npm run build` antes de reiniciar, o la página sigue mostrando la versión vieja. Es el error más común en este repo.
- **`api.get('/manual')`, no `api.get('/api/manual')`.** El cliente (`src/api/client.js:1`) agrega `/api` solo.
- **El puerto es 3011, nunca 3005** — el 3005 lo ocupa el conector ODBC de QlikView.
- Para probar el backend en paralelo al servicio, usar otro puerto (`$env:PORT=3099`) en vez de detener el servicio.
- Si un test del parser falla por espacios en el HTML esperado, ajustar el test, no relajar el parser.
