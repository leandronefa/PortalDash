# Virtualizar la lista de "Ver en detalle" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que abrir "Ver en detalle", cambiar el orden, o filtrar por Estado deje de reconstruir e insertar miles de nodos DOM en cada click — solo se pintan las filas realmente visibles en pantalla.

**Architecture:** Se agrega una capa de "renderizado virtual" 100% vanilla dentro del `<script>` de `tablero_motor_quiebre.html`: una función pura que calcula qué rango de índices de un array ya ordenado hay que pintar dado el scroll actual, más el cableado dentro de `renderVerDetalle()` que la usa para pintar solo esa porción y reacciona a eventos de scroll. Los clicks dentro de la lista (favorito, artículo, propuesta de compra, filtro de estado) pasan de bindearse fila por fila a un único listener delegado en el contenedor, porque ahora las filas se crean y destruyen dinámicamente.

**Tech Stack:** JavaScript vanilla, sin librerías ni build step (archivo único servido por Express `express.static`, ver `server.js`).

**Spec:** `docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md` (sección 1)

## Global Constraints

- Sin librerías externas, sin CDN, sin build step — el archivo sigue siendo HTML+CSS+JS vanilla en un único `<script>`.
- Este proyecto NO tiene test runner (`package.json` solo tiene `dotenv`/`express`/`mssql`; no hay `npm test` ni carpeta `tests/`, ver `CLAUDE.md`). La función pura (Task 1) se verifica con un script Node descartable con `assert` (mismo patrón que ya usa `scripts/precalc/*.js`), NO con Jest/Mocha. Todo lo que toca el DOM real se verifica manualmente en el navegador contra datos reales, corriendo el servidor local (`npm start`, puerto 3050).
- No se cambia ningún cálculo/agrupado/orden existente (`agruparPorArticuloColor`, `ordenarBarras`, `aplicarFiltrosCategoria`, `conCurvaRota`) — solo CUÁNTO DOM se genera por render.
- No se toca `exportarDetalleCSV` (ya lee de `detalleData()`, no del DOM).
- No se toca "Atención Prioritaria" ni ninguna otra lista — el alcance es solo la lista dentro de `renderVerDetalle()` (`#det-lista-scroll`).
- Cambios "quirúrgicos": no reordenar ni renombrar código fuera de lo que este plan pide tocar (regla ya establecida del proyecto, ver `CLAUDE.md`).

---

### Task 1: Función pura de cálculo de ventana virtual

**Files:**
- Modify: `public/tablero_motor_quiebre.html` (agregar la función cerca de `ordenarBarras`, alrededor de la línea 2239 — después de esa función, antes de la sección de favoritos)
- Test: `C:\Users\ClaudiaM\MotorReposicion-GitHub\scripts\precalc\_verificar_rango_virtual.js` (descartable — borrar al final de este task, ver Step 5)

**Interfaces:**
- Produces: `calcularRangoVirtual({ scrollTop, altoViewport, altoFila, totalFilas, overscan })` → `{ desde, hasta, paddingArriba, paddingAbajo }`. `desde`/`hasta` son índices tipo `slice` (desde inclusive, hasta exclusive). Usada por Task 3.

- [ ] **Step 1: Escribir la función**

Insertar en `public/tablero_motor_quiebre.html`, justo después de `ordenarBarras` (después de la línea 2239):

```js
// Calcula que rango de INDICES de un array ya ordenado hay que pintar como HTML real, dado el
// scroll actual -- pura (sin tocar el DOM), para poder probarla aislada. overscan = filas extra
// arriba/abajo del viewport, para no ver un instante en blanco al scrollear rapido.
// paddingArriba/paddingAbajo simulan el alto de las filas NO pintadas, para que la scrollbar se
// comporte igual que si estuvieran todas las filas reales en el DOM.
function calcularRangoVirtual({ scrollTop, altoViewport, altoFila, totalFilas, overscan = 6 }) {
  if (totalFilas <= 0 || altoFila <= 0) return { desde: 0, hasta: 0, paddingArriba: 0, paddingAbajo: 0 };
  const primeraVisible = Math.floor(scrollTop / altoFila);
  const filasVisibles = Math.ceil(altoViewport / altoFila) + 1; // +1: la fila parcialmente visible al fondo
  const desde = Math.max(0, primeraVisible - overscan);
  const hasta = Math.min(totalFilas, primeraVisible + filasVisibles + overscan);
  return {
    desde,
    hasta,
    paddingArriba: desde * altoFila,
    paddingAbajo: (totalFilas - hasta) * altoFila,
  };
}
```

- [ ] **Step 2: Escribir el script de verificación descartable**

Crear `C:\Users\ClaudiaM\MotorReposicion-GitHub\scripts\precalc\_verificar_rango_virtual.js`:

```js
const assert = require('assert');
const fs = require('fs');

// Extrae el cuerpo de calcularRangoVirtual directamente del HTML para probar la version REAL
// (no una copia que se puede desincronizar) -- mismo espiritu que un test de integracion chico.
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'public', 'tablero_motor_quiebre.html'), 'utf8');
const match = html.match(/function calcularRangoVirtual\([\s\S]*?\n}\n/);
assert(match, 'No se encontro calcularRangoVirtual en el HTML');
eval(match[0]);

// Caso 1: arriba del todo
let r = calcularRangoVirtual({ scrollTop: 0, altoViewport: 600, altoFila: 60, totalFilas: 9000, overscan: 6 });
assert.strictEqual(r.desde, 0, 'desde debe clampear a 0 arriba del todo');
assert.strictEqual(r.paddingArriba, 0);
assert(r.hasta > 10 && r.hasta < 9000, 'hasta debe cubrir el viewport + overscan, sin llegar al final');

// Caso 2: en el medio
r = calcularRangoVirtual({ scrollTop: 60 * 500, altoViewport: 600, altoFila: 60, totalFilas: 9000, overscan: 6 });
assert.strictEqual(r.desde, 500 - 6);
assert.strictEqual(r.paddingArriba, (500 - 6) * 60);

// Caso 3: cerca del final -- hasta debe clampear a totalFilas, no pasarse
r = calcularRangoVirtual({ scrollTop: 60 * 8990, altoViewport: 600, altoFila: 60, totalFilas: 9000, overscan: 6 });
assert.strictEqual(r.hasta, 9000);
assert.strictEqual(r.paddingAbajo, 0);

// Caso 4: lista vacia
r = calcularRangoVirtual({ scrollTop: 0, altoViewport: 600, altoFila: 60, totalFilas: 0, overscan: 6 });
assert.deepStrictEqual(r, { desde: 0, hasta: 0, paddingArriba: 0, paddingAbajo: 0 });

// Caso 5: overscan mas grande que la lista entera -- no debe romper (desde/hasta clampeados)
r = calcularRangoVirtual({ scrollTop: 0, altoViewport: 600, altoFila: 60, totalFilas: 3, overscan: 100 });
assert.strictEqual(r.desde, 0);
assert.strictEqual(r.hasta, 3);

console.log('OK: calcularRangoVirtual pasa los 5 casos');
```

- [ ] **Step 2b: Correr el script y confirmar que pasa**

Run: `node "C:\Users\ClaudiaM\MotorReposicion-GitHub\scripts\precalc\_verificar_rango_virtual.js"`
Expected: `OK: calcularRangoVirtual pasa los 5 casos` (si la función todavía no existe en el HTML en el momento de correr esto, va a fallar el `assert(match, ...)` — confirmar que Step 1 ya se guardó antes de correr esto).

- [ ] **Step 3: Borrar el script descartable**

```bash
rm "C:\Users\ClaudiaM\MotorReposicion-GitHub\scripts\precalc\_verificar_rango_virtual.js"
```

(Es un chequeo de una sola vez para esta tarea, no un script reusable del proyecto — no se commitea.)

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add public/tablero_motor_quiebre.html
git commit -m "feat(motor-reposicion): agregar calcularRangoVirtual (base de la virtualizacion de Ver en detalle)"
```

(Nota: esta carpeta no tiene git local — ver Task final del plan de backend/índices para el mecanismo real de commit+push contra `PortalDash`. Si se está ejecutando este plan de forma aislada, dejar el cambio sin commitear y avisar al usuario.)

---

### Task 2: Medir el alto real de una fila (una vez por apertura del modal)

**Files:**
- Modify: `public/tablero_motor_quiebre.html` (agregar junto a `renderVerDetalle`, antes de la línea 3409)

**Interfaces:**
- Consumes: `filaBarraHtml(r, estado)` (ya existente, línea 2301) — sin cambios de firma.
- Produces: `altoFilaDetalleCache` (variable module-level, número en píxeles o `null`), `medirAltoFilaDetalle(primeraFila, listaEl)` — función que mide y cachea. Usada por Task 3. `abrirVerDetalle()` (línea 2799) resetea `altoFilaDetalleCache = null` al abrir, para remedir por si cambió el zoom/fuente del navegador entre aperturas.

- [ ] **Step 1: Agregar la variable y la función de medición**

Insertar antes de `function renderVerDetalle(){` (línea 3409):

```js
// Alto real de una fila de "Ver en detalle", medido EN VIVO (nunca adivinado -- mismo criterio ya
// usado para --modal-hd-alto/--tpv-detheader-alto en otras partes de este archivo). Es constante
// mientras dure la apertura del modal (mismo CSS/contenido de fila siempre, sin wrap de texto) --
// se remide solo al reabrir el modal (ver abrirVerDetalle), por si cambio el zoom/fuente entre
// aperturas.
let altoFilaDetalleCache = null;
function medirAltoFilaDetalle(primeraFila, listaEl) {
  if (altoFilaDetalleCache != null) return altoFilaDetalleCache;
  if (!primeraFila) return 0;
  listaEl.innerHTML = filaBarraHtml(primeraFila, primeraFila.estadoFinal);
  altoFilaDetalleCache = listaEl.firstElementChild.getBoundingClientRect().height;
  return altoFilaDetalleCache;
}
```

- [ ] **Step 2: Resetear la caché al abrir el modal**

En `abrirVerDetalle()` (línea 2799), agregar la primera línea del cuerpo:

```js
function abrirVerDetalle(){
  altoFilaDetalleCache = null; // remedir -- puede haber cambiado el zoom/fuente desde la ultima apertura
  detState = DET_STATE_INICIAL();
  ...
```

- [ ] **Step 3: Verificación manual**

Con el servidor local corriendo (`npm start` en `C:\Users\ClaudiaM\MotorReposicion-GitHub`, puerto 3050) y datos reales:
1. Abrir `http://localhost:3050/tablero_motor_quiebre.html` en el navegador.
2. Abrir la consola del navegador (F12), pegar `altoFilaDetalleCache` DESPUÉS de abrir "Ver en detalle" al menos una vez.
3. Confirmar que el valor es un número razonable (entre 30 y 100, no `null`, no `0`).

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add public/tablero_motor_quiebre.html
git commit -m "feat(motor-reposicion): medir alto real de fila para Ver en detalle (base virtualizacion)"
```

---

### Task 3: Cablear el renderizado virtual + delegación de clicks en `renderVerDetalle`

**Files:**
- Modify: `public/tablero_motor_quiebre.html:3450-3473` (reemplaza el bloque final de `renderVerDetalle`, desde `document.getElementById('m-body').innerHTML = ...` hasta el final de la función, línea 3473 inclusive)

**Interfaces:**
- Consumes: `calcularRangoVirtual` (Task 1), `medirAltoFilaDetalle` (Task 2), `filaBarraHtml`, `favSku`/`favModelo`, `registrarActividad`, `renderTodoTrasFavoritos`, `verPropuestaCompra`, `abrirCoberturaArticulo`, `cerrarEstadoPopover`, `detState` — todas ya existentes, sin cambios de firma.
- Produces: nada nuevo hacia afuera — este task solo cambia el CÓMO interno de `renderVerDetalle()`. El resto de la función (armado de `agrupado`/`agrupadoFiltrado`/`ordenado`, controles, header, medición de `topLista`) queda intacto.

- [ ] **Step 1: Reemplazar el bloque de pintado de la lista**

Reemplazar exactamente estas líneas (3450-3473 del archivo actual):

```js
  document.getElementById('m-body').innerHTML = controles
    + `<div style="margin-top:14px">${filaBarraHeaderHtml(true)}</div>`
    + `<div id="det-lista-scroll" class="prio-grid det-lista-scroll"></div>`;
  const listaEl = document.getElementById('det-lista-scroll');
  const topLista = listaEl.getBoundingClientRect().top;
  listaEl.style.maxHeight = Math.max(200, window.innerHeight - topLista - 20) + 'px';
  listaEl.innerHTML = filas;
  document.getElementById('det-orden').onchange = e=>{ detState.orden=e.target.value; registrarActividad("Cambió orden: Ver en detalle", e.target.value); renderVerDetalle(); };
  document.getElementById('det-csv').onclick = exportarDetalleCSV;
  document.getElementById('det-estado-th').onclick = (e)=>{ e.stopPropagation(); abrirEstadoPopover(e.currentTarget); };
  document.querySelectorAll('#m-body .pcg-estado-click').forEach(el=>el.onclick=(e)=>{
    e.stopPropagation();
    cerrarEstadoPopover();
    detState.estadoFiltro = new Set([el.dataset.estado]);
    registrarActividad("Filtró Ver en detalle por Estado", el.dataset.estado);
    renderVerDetalle();
  });
  document.querySelectorAll('#m-body .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, null, c.dataset.color));
  document.querySelectorAll('#m-body .pcg-repo').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); verPropuestaCompra(b.dataset.mod, b.dataset.color); });
  bindFavStars(renderVerDetalle, document.getElementById('m-body'));
}
```

con:

```js
  document.getElementById('m-body').innerHTML = controles
    + `<div style="margin-top:14px">${filaBarraHeaderHtml(true)}</div>`
    + `<div id="det-lista-scroll" class="prio-grid det-lista-scroll"></div>`;
  const listaEl = document.getElementById('det-lista-scroll');
  const topLista = listaEl.getBoundingClientRect().top;
  listaEl.style.maxHeight = Math.max(200, window.innerHeight - topLista - 20) + 'px';
  document.getElementById('det-orden').onchange = e=>{ detState.orden=e.target.value; registrarActividad("Cambió orden: Ver en detalle", e.target.value); renderVerDetalle(); };
  document.getElementById('det-csv').onclick = exportarDetalleCSV;
  document.getElementById('det-estado-th').onclick = (e)=>{ e.stopPropagation(); abrirEstadoPopover(e.currentTarget); };

  // Virtualizacion: con miles de filas agrupadas (casos reales de ~9000+), pintar TODAS como HTML
  // real en cada click de orden/filtro tardaba varios segundos (medido, ver spec). Solo se pintan
  // las filas que caen en el rango visible del scroll (+ colchon de overscan), el resto del alto se
  // simula con padding para que la scrollbar se comporte igual que con todas las filas reales.
  const altoFila = medirAltoFilaDetalle(ordenado[0], listaEl);
  function repintarVentana(){
    const { desde, hasta, paddingArriba, paddingAbajo } = calcularRangoVirtual({
      scrollTop: listaEl.scrollTop,
      altoViewport: listaEl.clientHeight,
      altoFila,
      totalFilas: ordenado.length,
    });
    listaEl.style.paddingTop = paddingArriba + 'px';
    listaEl.style.paddingBottom = paddingAbajo + 'px';
    listaEl.innerHTML = ordenado.slice(desde, hasta).map(r=>filaBarraHtml(r, r.estadoFinal)).join("")
      || `<div style="padding:28px;text-align:center;color:#9aa7ad">Sin artículos ${sinFiltroTxt}.</div>`;
  }
  repintarVentana();
  // requestAnimationFrame: evita repintar mas de una vez por frame si el navegador dispara varios
  // eventos de scroll seguidos (scroll rapido con rueda/trackpad).
  let _repintarPendiente = false;
  listaEl.onscroll = () => {
    if (_repintarPendiente) return;
    _repintarPendiente = true;
    requestAnimationFrame(() => { repintarVentana(); _repintarPendiente = false; });
  };

  // Clicks delegados en el contenedor (no por fila): con virtualizacion las filas se crean y
  // destruyen al scrollear, asi que bindear onclick fila por fila (como antes) perderia los
  // handlers de filas que ya se pintaron y volvieron a pintarse. Un solo listener en el contenedor,
  // que nunca se destruye entre repintados de ventana (solo se reemplaza entero en cada
  // renderVerDetalle(), ver mas abajo).
  listaEl.onclick = (e) => {
    const favEl = e.target.closest('.fav-star');
    if (favEl) {
      e.stopPropagation();
      const tipo = favEl.dataset.favTipo, id = favEl.dataset.favId;
      const set = tipo==='sku' ? favSku : favModelo;
      if(set.has(id)){ set.delete(id); registrarActividad("Desmarcó favorito", `${tipo==='sku'?'SKU':'Artículo'}: ${id}`); }
      else { set.add(id); registrarActividad("Marcó favorito", `${tipo==='sku'?'SKU':'Artículo'}: ${id}`); }
      renderTodoTrasFavoritos();
      return;
    }
    const repoEl = e.target.closest('.pcg-repo');
    if (repoEl) { e.stopPropagation(); verPropuestaCompra(repoEl.dataset.mod, repoEl.dataset.color); return; }
    const estadoEl = e.target.closest('.pcg-estado-click');
    if (estadoEl) {
      e.stopPropagation();
      cerrarEstadoPopover();
      detState.estadoFiltro = new Set([estadoEl.dataset.estado]);
      registrarActividad("Filtró Ver en detalle por Estado", estadoEl.dataset.estado);
      renderVerDetalle();
      return;
    }
    const card = e.target.closest('.pcard');
    if (card) abrirCoberturaArticulo(card.dataset.mod, null, card.dataset.color);
  };
}
```

**Nota sobre `bindFavStars`:** esta función (línea 2255) sigue existiendo sin cambios — la siguen usando `renderPrio` y otras pantallas que no se tocan en este plan. Solo se deja de invocar en `renderVerDetalle` (reemplazada por la delegación de arriba).

- [ ] **Step 2: Verificación manual — funcionalidad**

Con el servidor local corriendo y datos reales:
1. Abrir "Ver en detalle". Confirmar que la lista se ve completa al hacer scroll hasta el final (sin huecos en blanco, sin filas repetidas).
2. Click en una fila (no en la estrella/carrito/estado) → debe abrir la Cobertura de ese artículo.
3. Click en la estrella (☆/★) de una fila → debe marcar/desmarcar favorito y refrescar la lista.
4. Click en el ícono de carrito (🛒) → debe abrir "Ver propuesta de recompra" de ESE artículo, sin abrir también la Cobertura.
5. Click en la pastilla de Estado (Quiebre/Riesgo) de una fila → debe filtrar la lista a ese estado.
6. Cambiar el selector de orden → la lista se reordena, sin lag perceptible.
7. Exportar CSV → confirmar que sigue exportando TODAS las filas (no solo las visibles en pantalla).

- [ ] **Step 3: Verificación manual — rendimiento**

Con datos reales (buscar un escenario con muchas filas, idealmente >5000 tras agrupar):
1. Abrir la consola del navegador (F12).
2. Antes de hacer click en "Ver en detalle", correr: `console.time('verdetalle')`.
3. Click en "Ver en detalle".
4. Inmediatamente después de que se vea la lista, correr: `console.timeEnd('verdetalle')`.
5. Repetir para un cambio de orden (`console.time`/`console.timeEnd` alrededor del click en el selector de orden).
6. Confirmar que ambos tiempos bajaron de "varios segundos" (el problema original) a menos de ~300ms.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add public/tablero_motor_quiebre.html
git commit -m "feat(motor-reposicion): virtualizar lista de Ver en detalle (solo pinta filas visibles)"
```

---

## Self-Review (completado durante la escritura de este plan)

- **Cobertura del spec:** Sección 1 del spec ("Virtualización de la lista de Ver en detalle") — cubierta por Tasks 1-3. No se tocan `exportarDetalleCSV`, `agruparPorArticuloColor`, `ordenarBarras`, `aplicarFiltrosCategoria`, "Atención Prioritaria" — confirmado, ningún task los modifica.
- **Placeholders:** ninguno — todos los steps tienen código completo o instrucciones de verificación concretas.
- **Consistencia de tipos/nombres:** `calcularRangoVirtual` (Task 1) se usa en Task 3 con las mismas keys (`scrollTop`, `altoViewport`, `altoFila`, `totalFilas`, `overscan`) y mismo shape de retorno (`desde`, `hasta`, `paddingArriba`, `paddingAbajo`). `medirAltoFilaDetalle` (Task 2) se usa en Task 3 con la misma firma (`primeraFila`, `listaEl`).
