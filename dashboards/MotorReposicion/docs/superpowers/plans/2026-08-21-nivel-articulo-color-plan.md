# Nivel artículo+color en listados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bajar el nivel de listado/control de las 5 pantallas de artículos (Atención Prioritaria,
Ver quiebres, Ver riesgos, Favoritos, Reposición/Edición de recompra) de una mezcla
artículo+color+talla a un nivel uniforme artículo+color, sin tocar la grilla de detalle (que sigue
bajando hasta la talla, sin cambios).

**Architecture:** Todo el cambio vive en `public/tablero_motor_quiebre.html` (frontend puro, sin
build step). Se agrega una función de agrupación nueva (`agruparPorArticuloColor`) en paralelo a
la existente (`agruparPorSku`, que se deja intacta), y se actualizan las plantillas/estado de cada
pantalla para agrupar por `modelo+color` en vez de por `modelo+color+talla` (Atención
Prioritaria/Quiebres/Riesgos) o por `modelo` solo (Reposición/Favoritos).

**Tech Stack:** HTML+CSS+JS vanilla (sin frameworks, sin build step), servido por Express
(`server.js`, sin cambios en este plan).

## Global Constraints

- **No hay test suite ni framework de testing para el frontend.** La verificación de cada tarea es:
  (1) chequeo de sintaxis con el mismo patrón usado en todo este proyecto —
  `node -e "new Function(fs.readFileSync(...).match(/<script>([\s\S]*?)<\/script>/)[1])"` — y
  (2) verificación visual/funcional contra el servidor real corriendo (`localhost:3050`) con datos
  reales, usando Playwright (ya instalado en el scratchpad de esta sesión — si no está disponible,
  instalarlo ahí, nunca como dependencia del proyecto). Nunca declarar una tarea terminada solo por
  el chequeo de sintaxis.
- **Cambios quirúrgicos**: tocar solo las líneas que cada tarea pide. No renombrar, reordenar ni
  "mejorar de paso" código no relacionado, aunque se vea la oportunidad.
- **No se toca `server.js` ni el backend** — este cambio es 100% frontend, sobre datos que el
  backend ya entrega a nivel SKU×sucursal (ver spec, sección "No-objetivos"). No hace falta
  reiniciar el servidor Node salvo que se edite `server.js` (no debería pasar en este plan).
- **`agruparPorSku` NO se toca** — se usa todavía en Registro de alertas (pantalla fuera de
  alcance de este cambio, ver spec). La función nueva (`agruparPorArticuloColor`) vive al lado,
  sin reemplazarla.
- **Commit frecuente**: un commit por tarea (ver mensaje sugerido en cada una). Este repo es local,
  sin remoto — no hace falta push.
- **Backup/checkpoint ya existente antes de este plan**: commit `ed61ff2` (2026-08-20) y carpeta
  `backups/2026-08-20_antes-cambio-grande/`. Si algo sale mal a mitad de una tarea, `git diff` /
  `git checkout -- public/tablero_motor_quiebre.html` vuelven a ese punto.
- **Spec de referencia**: `docs/superpowers/specs/2026-08-20-nivel-articulo-color-design.md` — todas
  las decisiones de producto ya están tomadas ahí; este plan no vuelve a decidirlas, solo las
  implementa.

---

### Task 1: `agruparPorArticuloColor` — nueva función de agrupación

**Files:**
- Modify: `public/tablero_motor_quiebre.html` (función nueva, al lado de `agruparPorSku`, líneas
  ~1448-1464 actuales)

**Interfaces:**
- Consumes: nada nuevo — recibe un array de items ya filtrados por estado (QUIEBRE o RIESGO) y ya
  pasados por `conCurvaRota()` (así llegan `_curvaRota`/`_curvaTotal` en cada item), igual que ya
  recibe `agruparPorSku`.
- Produces: `agruparPorArticuloColor(items)` → array de objetos
  `{modelo, color, nombre, sim, pvp, impacto, diasVida, vd, nSucursales, tallas, _curvaRota, _curvaTotal}`
  — `tallas` es un array de strings ordenado (ej. `["7","8","8.5"]` o `["U"]`). Task 2 consume
  exactamente esta forma.

- [ ] **Step 1: Ubicar el punto de inserción**

Leer `public/tablero_motor_quiebre.html` alrededor de la línea 1448 y confirmar que el texto
actual es:

```js
// Agrupa barras (SKU × sucursal) por SKU único: un mismo artículo-color-talle roto en varias
// sucursales pasa a ser UNA sola fila, con el margen total sumado y la cantidad de sucursales afectadas.
function agruparPorSku(items){
  const porSku = {};
  items.forEach(x=>{
    if(!porSku[x.sku]) porSku[x.sku] = {
      sku:x.sku, modelo:x.modelo, nombre:x.nombre, sim:x.sim, color:x.color, talle:x.talle, pvp:x.pvp,
      impacto:0, diasVida:null, vdSum:0, nSucursales:0, _curvaRota:x._curvaRota, _curvaTotal:x._curvaTotal,
    };
    const g = porSku[x.sku];
    g.impacto += x.impacto;
    g.vdSum += x.vd;
    g.nSucursales += 1;
    if(x.diasVida!=null) g.diasVida = (g.diasVida==null) ? x.diasVida : Math.min(g.diasVida, x.diasVida);
  });
  return Object.values(porSku).map(g=>({...g, vd: g.vdSum/g.nSucursales}));
}
```

- [ ] **Step 2: Agregar la función nueva inmediatamente después**

Insertar, justo después del `}` que cierra `agruparPorSku` (antes de la línea
`// Ordena un array de barras/grupos según el criterio ESTANDARIZADO...`):

```js
// Agrupa barras (SKU × sucursal) por ARTÍCULO+COLOR (sin la talla): todas las tallas rotas de un
// mismo color pasan a ser UNA sola fila. A diferencia de agruparPorSku (que suma sucursales por
// cada talla), acá "sucursales" son las DISTINTAS sucursales donde ese color está roto -- si una
// sucursal tiene 3 tallas rotas del mismo color, cuenta una sola vez, no tres. La velocidad (vd)
// es la suma de las velocidades de todas las barras fusionadas dividida por esas sucursales
// distintas -- no se diluye si una sucursal aporta varias tallas rotas. `tallas` guarda el detalle
// que se pierde al fusionar (ver filaBarraHtml). agruparPorSku() se deja intacta -- la sigue
// usando Registro de alertas (fuera de alcance de este cambio, ver spec 2026-08-20).
function agruparPorArticuloColor(items){
  const porArticuloColor = {};
  items.forEach(x=>{
    const key = x.modelo+"|"+x.color;
    if(!porArticuloColor[key]) porArticuloColor[key] = {
      modelo:x.modelo, color:x.color, nombre:x.nombre, sim:x.sim, pvp:x.pvp,
      impacto:0, diasVida:null, vdSum:0, sucursales:new Set(), tallasSet:new Set(),
      _curvaRota:x._curvaRota, _curvaTotal:x._curvaTotal,
    };
    const g = porArticuloColor[key];
    g.impacto += x.impacto;
    g.vdSum += x.vd;
    g.sucursales.add(x.suc);
    g.tallasSet.add(x.talle);
    if(x.diasVida!=null) g.diasVida = (g.diasVida==null) ? x.diasVida : Math.min(g.diasVida, x.diasVida);
  });
  return Object.values(porArticuloColor).map(g=>({
    modelo:g.modelo, color:g.color, nombre:g.nombre, sim:g.sim, pvp:g.pvp,
    impacto:g.impacto, diasVida:g.diasVida, _curvaRota:g._curvaRota, _curvaTotal:g._curvaTotal,
    nSucursales: g.sucursales.size,
    vd: g.vdSum / g.sucursales.size,
    tallas: [...g.tallasSet].sort((a,b)=>(Number(a)||0)-(Number(b)||0)),
  }));
}
```

- [ ] **Step 3: Chequeo de sintaxis**

```bash
cd "C:\Users\ClaudiaM\Motor Reposicion Nuevo" && node -e "
const fs = require('fs');
const html = fs.readFileSync('public/tablero_motor_quiebre.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
scripts.forEach((s,i)=>{ try { new Function(s); } catch(e){ console.log('ERROR', i, e.message); process.exitCode=1; } });
console.log('checked', scripts.length);
"
```
Expected: `checked 1` (sin `ERROR`).

- [ ] **Step 4: Verificar el comportamiento con datos sintéticos (aislado, sin navegador)**

Escribir un script descartable en el scratchpad de la sesión (NO en el repo) que extrae la función
nueva del archivo real y la ejecuta con datos de prueba, para confirmar la deduplicación de
sucursales y el ordenamiento de tallas:

```js
// scratchpad/_test_agrupar_articulo_color.js
const fs = require('fs');
const html = fs.readFileSync('C:/Users/ClaudiaM/Motor Reposicion Nuevo/public/tablero_motor_quiebre.html', 'utf8');
const match = html.match(/function agruparPorArticuloColor[\s\S]*?\n}\n/);
if (!match) { console.error('No se encontro la funcion'); process.exit(1); }
eval(match[0]);

const items = [
  {modelo:'ABC-1', color:'NEGRO', suc:'Sportotal 05', talle:'8', nombre:'Zapatilla X', sim:false, pvp:100, impacto:50, diasVida:10, vd:1, _curvaRota:5, _curvaTotal:8},
  {modelo:'ABC-1', color:'NEGRO', suc:'Sportotal 05', talle:'9', nombre:'Zapatilla X', sim:false, pvp:100, impacto:30, diasVida:5, vd:2, _curvaRota:5, _curvaTotal:8},
  {modelo:'ABC-1', color:'NEGRO', suc:'Sportotal 08', talle:'8', nombre:'Zapatilla X', sim:false, pvp:100, impacto:20, diasVida:20, vd:1, _curvaRota:5, _curvaTotal:8},
  {modelo:'ABC-1', color:'BLANCO', suc:'Sportotal 05', talle:'9', nombre:'Zapatilla X', sim:false, pvp:100, impacto:15, diasVida:8, vd:1, _curvaRota:5, _curvaTotal:8},
];
const resultado = agruparPorArticuloColor(items);
console.log(JSON.stringify(resultado, null, 2));

const negro = resultado.find(r=>r.color==='NEGRO');
console.assert(negro.nSucursales===2, 'FALLO: nSucursales deberia ser 2 (Sportotal 05 y 08, no 3)');
console.assert(negro.impacto===100, 'FALLO: impacto deberia sumar 50+30+20=100');
console.assert(negro.diasVida===5, 'FALLO: diasVida deberia ser el minimo (5)');
console.assert(JSON.stringify(negro.tallas)===JSON.stringify(['8','9']), 'FALLO: tallas deberia ser ["8","9"] ordenado');
console.assert(Math.abs(negro.vd - (1+2+1)/2) < 1e-9, 'FALLO: vd deberia ser sum(vd)/sucursales distintas = 4/2=2');
const blanco = resultado.find(r=>r.color==='BLANCO');
console.assert(blanco.nSucursales===1 && blanco.tallas.length===1, 'FALLO: BLANCO deberia tener 1 sucursal y 1 talla');
console.log('OK: todas las verificaciones pasaron');
```

Ejecutar: `node scratchpad/_test_agrupar_articulo_color.js` (ruta real: usar el scratchpad de la
sesión). Expected output: el JSON del resultado + `OK: todas las verificaciones pasaron`, sin
ningún `FALLO` en la salida ni excepción de `console.assert` (Node imprime a stderr pero no aborta
por defecto — revisar la salida a ojo, no solo el exit code).

- [ ] **Step 5: Borrar el script de prueba** (es descartable, no forma parte del repo)

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\ClaudiaM\Motor Reposicion Nuevo" && git add public/tablero_motor_quiebre.html && git commit -m "$(cat <<'EOF'
Agregar agruparPorArticuloColor (agrupacion por articulo+color)

Nueva funcion en paralelo a agruparPorSku (que se deja intacta, la sigue
usando Registro de alertas). Primer paso del cambio de nivel de listado
aprobado en docs/superpowers/specs/2026-08-20-nivel-articulo-color-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Atención Prioritaria, Ver quiebres, Ver riesgos — nivel artículo+color con click-through por color

**Files:**
- Modify: `public/tablero_motor_quiebre.html` (múltiples funciones, ver steps)

**Interfaces:**
- Consumes: `agruparPorArticuloColor` (Task 1).
- Produces: `abrirCoberturaArticulo(modelo, backFn, colorResaltado)` — mismo nombre, pero el
  tercer parámetro ahora es un **color** (string) en vez de una talla. Tasks 3, 4 y 5 (Reposición,
  Edición, Favoritos) van a llamar a esta misma función con un color al hacer clic en una fila.

- [ ] **Step 1: `filaBarraHtml`/`filaBarraHeaderHtml` — mostrar color+tallas, estrella a nivel artículo**

Ubicar (línea ~1503-1533 actual):

```js
const PC_GRID_COLS = "18px 160px minmax(90px,1fr) 40px 64px 62px 112px 126px 100px 20px 26px";
function filaBarraHeaderHtml(){
  return `<div class="pcg pcg-head" style="grid-template-columns:${PC_GRID_COLS}">
    <div></div><div>Código</div><div>Artículo</div><div></div><div>Sucursales</div><div>Días</div><div>Rotación</div><div>Cantidad</div><div style="text-align:right">Margen/día</div><div></div><div></div>
  </div>`;
}
function filaBarraHtml(r){
  const ct = ` — <b>${r.color==='—'?'Único':r.color}</b> · T${r.talle==='U'?'Único':r.talle}`;
  return `<div class="pc mid pcard pcg" data-mod="${r.modelo}" data-talle="${r.talle}" data-sku="${r.sku}" style="grid-template-columns:${PC_GRID_COLS}">
    <div class="pcg-fav">${favStarHtml('sku', r.sku)}</div>
    <div class="pcg-cd">${r.modelo}</div>
    <div class="pcg-desc"><span class="pcg-desc-nombre">${r.nombre.replace(" (SIM)","")}</span><span class="pcg-desc-ct">${ct}</span></div>
    <div class="pcg-sim">${r.sim?'<span class="sim">SIM</span>':''}</div>
    <div class="pcg-suc">🏬 ${r.nSucursales}</div>
    <div class="pcg-dias">🔥 mín ${r.diasVida==null?'—':r.diasVida+'d'}</div>
    <div class="pcg-rot">⟳ ${r.vd.toLocaleString('es-AR',{maximumFractionDigits:2})} unidades/día</div>
    <div class="pcg-cant">⚠ ${r._curvaRota}/${r._curvaTotal} SKU rotos</div>
    <div class="pcg-margen">${money(r.impacto)}/día</div>
    <div class="pcg-lupa">🔍</div>
    <div class="pcg-repo" data-mod="${r.modelo}" title="Ver propuesta de recompra">🛒</div>
  </div>`;
}
```

Reemplazar por:

```js
const PC_GRID_COLS = "18px 160px minmax(90px,1fr) 40px 64px 62px 112px 126px 100px 20px 26px";
function filaBarraHeaderHtml(){
  return `<div class="pcg pcg-head" style="grid-template-columns:${PC_GRID_COLS}">
    <div></div><div>Código</div><div>Artículo</div><div></div><div>Sucursales</div><div>Días</div><div>Rotación</div><div>Cantidad</div><div style="text-align:right">Margen/día</div><div></div><div></div>
  </div>`;
}
// r ahora es un grupo por ARTÍCULO+COLOR (ver agruparPorArticuloColor) -- r.tallas es la lista de
// tallas de ESE color en quiebre/riesgo (antes la fila era por talla individual, con una sola).
function filaBarraHtml(r){
  const tallasFmt = r.tallas.map(t=>t==='U'?'Único':t);
  const tallasTxt = tallasFmt.length<=6 ? tallasFmt.join(', ') : tallasFmt.slice(0,6).join(', ')+` +${tallasFmt.length-6}`;
  const ct = ` — <b>${r.color==='—'?'Único':r.color}</b> · ${r.tallas.length} talla${r.tallas.length!==1?'s':''} rota${r.tallas.length!==1?'s':''}: ${tallasTxt}`;
  return `<div class="pc mid pcard pcg" data-mod="${r.modelo}" data-color="${r.color}" style="grid-template-columns:${PC_GRID_COLS}">
    <div class="pcg-fav">${favStarHtml('modelo', r.modelo)}</div>
    <div class="pcg-cd">${r.modelo}</div>
    <div class="pcg-desc"><span class="pcg-desc-nombre">${r.nombre.replace(" (SIM)","")}</span><span class="pcg-desc-ct" title="${tallasFmt.join(', ')}">${ct}</span></div>
    <div class="pcg-sim">${r.sim?'<span class="sim">SIM</span>':''}</div>
    <div class="pcg-suc">🏬 ${r.nSucursales}</div>
    <div class="pcg-dias">🔥 mín ${r.diasVida==null?'—':r.diasVida+'d'}</div>
    <div class="pcg-rot">⟳ ${r.vd.toLocaleString('es-AR',{maximumFractionDigits:2})} unidades/día</div>
    <div class="pcg-cant">⚠ ${r._curvaRota}/${r._curvaTotal} SKU rotos</div>
    <div class="pcg-margen">${money(r.impacto)}/día</div>
    <div class="pcg-lupa">🔍</div>
    <div class="pcg-repo" data-mod="${r.modelo}" data-color="${r.color}" title="Ver propuesta de recompra">🛒</div>
  </div>`;
}
```

Nota: `favStarHtml('sku', r.sku)` pasó a `favStarHtml('modelo', r.modelo)` — decisión de la spec,
sección "6b" (la estrella de estas filas marca el artículo completo, ya no un SKU exacto).

- [ ] **Step 2: `rapidosConTier` (Atención Prioritaria) — usar el agrupador nuevo**

Ubicar (línea ~1535-1543 actual):

```js
function rapidosConTier(){
  // sinFavoritos: Atención Prioritaria muestra lo más urgente de toda la red, marcada o no como
  // favorita -- a pedido explícito, es la única lista que no se acota por favoritos.
  const rap = base({sinFavoritos:true}).filter(x=>x.estado==="QUIEBRE" && (prioEmpresa==="TOTAL"||x.empresa===prioEmpresa));
  if(!rap.length) return [];
  conCurvaRota(rap);
  const agrupado = agruparPorSku(rap);
  return ordenarBarras(agrupado, prioOrden);
}
```

Cambiar la línea `const agrupado = agruparPorSku(rap);` a
`const agrupado = agruparPorArticuloColor(rap);` (única línea que cambia en esta función).

- [ ] **Step 3: `renderPrio` — bindings de clic con color en vez de talla**

Ubicar (línea ~1597-1598 actual):

```js
  document.querySelectorAll('#prio .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, null, c.dataset.talle));
  document.querySelectorAll('#prio .pcg-repo').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); verPropuestaCompra(b.dataset.mod); });
```

Reemplazar por:

```js
  document.querySelectorAll('#prio .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, null, c.dataset.color));
  document.querySelectorAll('#prio .pcg-repo').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); verPropuestaCompra(b.dataset.mod, b.dataset.color); });
```

- [ ] **Step 4: `renderQuiebresEmpresa` — mismo cambio de agrupador, texto del subtítulo y bindings**

Ubicar (línea ~1911-1935 actual):

```js
function renderQuiebresEmpresa(){
  const b = conCurvaRota(quiebresEmpresaData());
  const impTot = b.reduce((a,x)=>a+x.impacto,0);
  const agrupado = agruparPorSku(b);
  document.getElementById('m-sub').innerHTML = `${agrupado.length} SKU único${agrupado.length!==1?'s':''} en quiebre (${b.length} barra${b.length!==1?'s':''} · 100% de los artículos) · ${money(impTot)}/día de margen en juego`;
```

Cambiar esas dos líneas a:

```js
function renderQuiebresEmpresa(){
  const b = conCurvaRota(quiebresEmpresaData());
  const impTot = b.reduce((a,x)=>a+x.impacto,0);
  const agrupado = agruparPorArticuloColor(b);
  document.getElementById('m-sub').innerHTML = `${agrupado.length} artículo${agrupado.length!==1?'s':''}+color en quiebre (${b.length} barra${b.length!==1?'s':''} · 100% de los artículos) · ${money(impTot)}/día de margen en juego`;
```

Más abajo, en la misma función, ubicar:

```js
  document.querySelectorAll('#m-body .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, ()=>openQuiebresEmpresa(empActual), c.dataset.talle));
  document.querySelectorAll('#m-body .pcg-repo').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); verPropuestaCompra(b.dataset.mod); });
```

Reemplazar por:

```js
  document.querySelectorAll('#m-body .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, ()=>openQuiebresEmpresa(empActual), c.dataset.color));
  document.querySelectorAll('#m-body .pcg-repo').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); verPropuestaCompra(b.dataset.mod, b.dataset.color); });
```

- [ ] **Step 5: `renderRiesgosEmpresa` — mismos cuatro cambios que Step 4**

Ubicar (línea ~2015-2038 actual):

```js
function renderRiesgosEmpresa(){
  const b = conCurvaRota(riesgosEmpresaData());
  const impTot = b.reduce((a,x)=>a+x.impacto,0);
  const agrupado = agruparPorSku(b);
  document.getElementById('m-sub').innerHTML = `${agrupado.length} SKU único${agrupado.length!==1?'s':''} en riesgo (${b.length} barra${b.length!==1?'s':''} · 100% de los artículos) · ${money(impTot)}/día de margen en juego`;
```

Cambiar a:

```js
function renderRiesgosEmpresa(){
  const b = conCurvaRota(riesgosEmpresaData());
  const impTot = b.reduce((a,x)=>a+x.impacto,0);
  const agrupado = agruparPorArticuloColor(b);
  document.getElementById('m-sub').innerHTML = `${agrupado.length} artículo${agrupado.length!==1?'s':''}+color en riesgo (${b.length} barra${b.length!==1?'s':''} · 100% de los artículos) · ${money(impTot)}/día de margen en juego`;
```

Y más abajo:

```js
  document.querySelectorAll('#m-body .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, ()=>openRiesgosEmpresa(empActual), c.dataset.talle));
  document.querySelectorAll('#m-body .pcg-repo').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); verPropuestaCompra(b.dataset.mod); });
```

Reemplazar por:

```js
  document.querySelectorAll('#m-body .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, ()=>openRiesgosEmpresa(empActual), c.dataset.color));
  document.querySelectorAll('#m-body .pcg-repo').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); verPropuestaCompra(b.dataset.mod, b.dataset.color); });
```

- [ ] **Step 6: `abrirCoberturaArticulo`/`coberturaItemHtml` — renombrar el parámetro y resaltar por color**

Ubicar (línea ~1834-1863 actual, `coberturaItemHtml`):

```js
function coberturaItemHtml(g, talleResaltado, itemsCompletos){
  const itemsRed = ALL.filter(x=>x.modelo===g.modelo);
  if(!itemsRed.length) return '';
  const itemsStock = (itemsCompletos && itemsCompletos.length) ? itemsCompletos : itemsRed;
  const talles = [...new Set(itemsStock.map(x=>x.talle))].sort((a,b)=>(Number(a)||0)-(Number(b)||0));
  const cols = `90px repeat(${talles.length},1fr) 100px`;
  const stockPorTalle = talles.map(t=>itemsStock.filter(x=>x.talle===t).reduce((a,x)=>a+x.stock,0));
  const granTotal = stockPorTalle.reduce((a,v)=>a+v,0);
  const headerCells = talles.map(t=>`<div class="tpv-th${t===talleResaltado?' tpv-col-resaltada':''}">${t==='U'?'Único':t}</div>`).join("");
  const valCells = stockPorTalle.map((v,i)=>`<div class="tpv-val${talles[i]===talleResaltado?' tpv-col-resaltada':''}">${fmt(v)}</div>`).join("");
  const expanded = talleResaltado ? true : !!tpvExpanded[g.modelo];
  if(talleResaltado) tpvExpanded[g.modelo] = true;
  const matrixHtml = expanded ? renderMatrix({modelo:g.modelo,items:itemsStock}, talles, cols, true, talleResaltado) : '';
  return `<div class="tpv-item">
    <div class="tpv-nmrow">
      <div>${favStarHtml('modelo', g.modelo)} ${g.nombre.replace(" (SIM)","")}${g.sim?' <span class="sim">SIM</span>':''}<span class="tpv-cd">${g.modelo}</span></div>
      <div class="tpv-nmrow-info"><span class="tpv-margin-loss">▲ ${money(g.imp)}/día</span><span class="tpv-cant-info">⚠ ${g.curvaRota}/${g.curvaTotal} SKU en quiebre/riesgo</span><span class="tpv-rot-info">⟳ ${g.rotProm.toFixed(2)} unidades/día prom.</span>
        <button class="tpv-repo-btn" data-mod="${g.modelo}">🛒 Ver propuesta de recompra de toda la curva →</button>
        ${miniImgHtml(g.modelo, itemsStock[0]?.color)}
      </div>
    </div>
    ${talleResaltado?`<div class="tpv-resaltada-nota">🔲 Se resalta la talla <b>${talleResaltado==='U'?'Único':talleResaltado}</b> — la que disparó la alerta en Atención Prioritaria</div>`:''}
    <div class="tpv-grilla-caption">📦 Stock actual disponible por sucursal y talle — no es la propuesta de compra</div>
    <div class="tpv-hdrow" style="grid-template-columns:${cols}"><div></div>${headerCells}<div class="tpv-th tpv-total-th">Gran Total</div></div>
    <div class="tpv-stockrow tpv-click" data-mod="${g.modelo}" style="grid-template-columns:${cols}">
      <div class="tpv-arrow">${expanded?'▼':'▶'} 📦 STOCK RED</div>${valCells}<div class="tpv-val tpv-total">${fmt(granTotal)}</div>
    </div>
    <div class="tpv-detail" style="display:${expanded?'block':'none'}">${matrixHtml}</div>
  </div>`;
}
```

Reemplazar por (cambios: parámetro renombrado a `colorResaltado`, el resaltado de la fila STOCK RED
combinada se saca ya que combina todos los colores — el resaltado real ahora vive dentro de
`renderMatrix`, por color — y se calculan las tallas rotas de ese color para la nota):

```js
function coberturaItemHtml(g, colorResaltado, itemsCompletos){
  const itemsRed = ALL.filter(x=>x.modelo===g.modelo);
  if(!itemsRed.length) return '';
  const itemsStock = (itemsCompletos && itemsCompletos.length) ? itemsCompletos : itemsRed;
  const talles = [...new Set(itemsStock.map(x=>x.talle))].sort((a,b)=>(Number(a)||0)-(Number(b)||0));
  const cols = `90px repeat(${talles.length},1fr) 100px`;
  const stockPorTalle = talles.map(t=>itemsStock.filter(x=>x.talle===t).reduce((a,x)=>a+x.stock,0));
  const granTotal = stockPorTalle.reduce((a,v)=>a+v,0);
  const headerCells = talles.map(t=>`<div class="tpv-th">${t==='U'?'Único':t}</div>`).join("");
  const valCells = stockPorTalle.map(v=>`<div class="tpv-val">${fmt(v)}</div>`).join("");
  const expanded = colorResaltado ? true : !!tpvExpanded[g.modelo];
  if(colorResaltado) tpvExpanded[g.modelo] = true;
  // Tallas de ESE color puntual que estan en quiebre/riesgo -- para la nota y para que renderMatrix
  // sepa exactamente que columnas resaltar dentro del bloque de ese color (ver Step 7).
  const tallasRotasDelColor = colorResaltado
    ? [...new Set(itemsRed.filter(x=>x.color===colorResaltado && (x.estado==="QUIEBRE"||x.estado==="RIESGO")).map(x=>x.talle))]
    : [];
  const matrixHtml = expanded ? renderMatrix({modelo:g.modelo,items:itemsStock}, talles, cols, true, colorResaltado, tallasRotasDelColor) : '';
  return `<div class="tpv-item">
    <div class="tpv-nmrow">
      <div>${favStarHtml('modelo', g.modelo)} ${g.nombre.replace(" (SIM)","")}${g.sim?' <span class="sim">SIM</span>':''}<span class="tpv-cd">${g.modelo}</span></div>
      <div class="tpv-nmrow-info"><span class="tpv-margin-loss">▲ ${money(g.imp)}/día</span><span class="tpv-cant-info">⚠ ${g.curvaRota}/${g.curvaTotal} SKU en quiebre/riesgo</span><span class="tpv-rot-info">⟳ ${g.rotProm.toFixed(2)} unidades/día prom.</span>
        <button class="tpv-repo-btn" data-mod="${g.modelo}">🛒 Ver propuesta de recompra de toda la curva →</button>
        ${miniImgHtml(g.modelo, itemsStock[0]?.color)}
      </div>
    </div>
    ${colorResaltado?`<div class="tpv-resaltada-nota">🔲 Se resalta el color <b>${colorResaltado==='—'?'Único':colorResaltado}</b> — el que disparó la alerta</div>`:''}
    <div class="tpv-grilla-caption">📦 Stock actual disponible por sucursal y talle — no es la propuesta de compra</div>
    <div class="tpv-hdrow" style="grid-template-columns:${cols}"><div></div>${headerCells}<div class="tpv-th tpv-total-th">Gran Total</div></div>
    <div class="tpv-stockrow tpv-click" data-mod="${g.modelo}" style="grid-template-columns:${cols}">
      <div class="tpv-arrow">${expanded?'▼':'▶'} 📦 STOCK RED</div>${valCells}<div class="tpv-val tpv-total">${fmt(granTotal)}</div>
    </div>
    <div class="tpv-detail" style="display:${expanded?'block':'none'}">${matrixHtml}</div>
  </div>`;
}
```

- [ ] **Step 7: `renderMatrix` — resaltar por color+talla en vez de solo talla**

Ubicar (línea ~2114-2178 actual, función completa `renderMatrix`) y localizar estas líneas
puntuales dentro de ella:

```js
function renderMatrix(m, talles, cols, mostrarDeposito, talleResaltado){
```

y, más abajo dentro de la misma función:

```js
  const rc = t => t===talleResaltado ? ' tpv-col-resaltada' : '';
  const headerCells = talles.map(t=>`<div class="tpv-th${rc(t)}">${t==='U'?'Único':t}</div>`).join("");

  const bloques = colores.map(color=>{
```

Reemplazar esas líneas por (firma con dos parámetros nuevos, y `rc` ahora depende también del
color del bloque en el que se está parado):

```js
function renderMatrix(m, talles, cols, mostrarDeposito, colorResaltado, tallasResaltadas){
```

y

```js
  const bloques = colores.map(color=>{
    // Solo resalta talles DENTRO del bloque del color que disparó la alerta -- otro color con la
    // misma talla no se marca (antes se resaltaba la columna en TODOS los colores por igual).
    const rc = t => (color===colorResaltado && tallasResaltadas && tallasResaltadas.includes(t)) ? ' tpv-col-resaltada' : '';
    // headerCells ahora se calcula ACA ADENTRO (antes vivía afuera de colores.map, calculado una
    // sola vez): el resaltado depende del color de este bloque puntual, así que tiene que
    // recalcularse por cada color, no compartirse entre todos.
    const headerCells = talles.map(t=>`<div class="tpv-th${rc(t)}">${t==='U'?'Único':t}</div>`).join("");
```

Nota: dentro de `bloques`, más abajo, el `return` de cada color ya usa esta misma variable
`headerCells` en su fila `tpv-detheader` (`<div class="tpv-detrow tpv-detheader" ...>${headerCells}...`)
— como ahora está definida adentro de `colores.map` en vez de afuera, esa línea del `return` no
necesita ningún cambio de texto, simplemente pasa a leer la versión recién calculada de este color.

- [ ] **Step 8: Actualizar los llamadores de `abrirCoberturaArticulo`/`coberturaItemHtml` que pasan el 3er argumento**

Ubicar (línea ~1878-1906 actual, función `abrirCoberturaArticulo`) y agregar el scroll automático
al bloque del color al final de la función. Texto actual relevante:

```js
async function abrirCoberturaArticulo(modelo, backFn, talleResaltado){
  setBack(backFn||null);
```

y, dentro de la misma función, las dos líneas donde se llama a `coberturaItemHtml`:

```js
  const html = coberturaItemHtml(g, talleResaltado);
```
```js
      const htmlCompleto = coberturaItemHtml(g, talleResaltado, itemsCompletos);
```

y el final de la función (después de que se actualiza `m-body` con `htmlCompleto`, cierre del
`if` y de la función `abrirCoberturaArticulo`).

Cambios:
1. Renombrar el parámetro `talleResaltado` a `colorResaltado` en la firma y en las dos llamadas a
   `coberturaItemHtml` (son simples renombres de variable, mismo comportamiento).
2. Agregar, justo antes del cierre de `abrirCoberturaArticulo` (después del bloque `if(itemsCompletos...)`
   que actualiza `m-body` con `htmlCompleto`), el scroll automático:

```js
  if(colorResaltado){
    // Mismo patron ya probado en ejecutarVolverACobertura: espera un tick a que el color-lbl este
    // en el DOM (la matriz se renderiza sincronicamente arriba, pero por las dudas si el fetch de
    // itemsCompletos todavia esta en curso, se repite tras esa actualizacion tambien).
    setTimeout(()=>{
      const sel = window.CSS && CSS.escape ? CSS.escape(colorResaltado) : colorResaltado;
      const el = document.querySelector(`#m-body .tpv-color-lbl[data-color="${sel}"]`);
      if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'start'});
    }, 50);
  }
```

- [ ] **Step 9: Chequeo de sintaxis**

```bash
cd "C:\Users\ClaudiaM\Motor Reposicion Nuevo" && node -e "
const fs = require('fs');
const html = fs.readFileSync('public/tablero_motor_quiebre.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
scripts.forEach((s,i)=>{ try { new Function(s); } catch(e){ console.log('ERROR', i, e.message); process.exitCode=1; } });
console.log('checked', scripts.length);
"
```
Expected: `checked 1`.

- [ ] **Step 10: Verificación con Playwright contra datos reales**

Con el servidor corriendo (`node server.js`, puerto 3050 — no hace falta reiniciarlo, no se tocó
`server.js`), escribir un script descartable en el scratchpad:

```js
// scratchpad/_verificar_task2.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto('http://localhost:3050', { waitUntil: 'networkidle' });
  await page.evaluate(() => { usuarioActual = { nombre: 'Test QA' }; renderUserWidget(); });
  await page.waitForTimeout(500);

  // 1) Atencion Prioritaria: confirmar que las filas ya no repiten el mismo articulo+color con
  // distintas tallas por separado (deberia haber a lo sumo 1 fila por combinacion modelo+color
  // visible entre las primeras N).
  const filas = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#prio .pcard')];
    return cards.map(c => ({ mod: c.dataset.mod, color: c.dataset.color }));
  });
  const claves = filas.map(f => f.mod + '|' + f.color);
  const repetidas = claves.filter((c, i) => claves.indexOf(c) !== i);
  console.log('filas en Atencion Prioritaria:', filas.length, '| claves repetidas (deberia ser 0):', repetidas.length);

  // 2) Click en la primera fila -> abre cobertura, debe hacer scroll/resaltar ese color
  if (filas.length) {
    await page.evaluate(() => document.querySelector('#prio .pcard').click());
    await page.waitForTimeout(1200);
    const resaltado = await page.evaluate(() => {
      const nota = document.querySelector('.tpv-resaltada-nota');
      const colCount = document.querySelectorAll('.tpv-col-resaltada').length;
      return { notaTexto: nota ? nota.textContent : null, columnasResaltadas: colCount };
    });
    console.log('nota de resaltado:', resaltado.notaTexto, '| columnas resaltadas:', resaltado.columnasResaltadas);
  }

  await browser.close();
})();
```

Ejecutar y revisar: `filas repetidas` debe ser `0`; `columnasResaltadas` debe ser mayor a `0` (si
el artículo clickeado tiene más de una talla rota de ese color, debería ser más de 1). Repetir el
mismo patrón abriendo "Ver quiebres" (`openQuiebresEmpresa('TESI')`) y "Ver riesgos"
(`openRiesgosEmpresa('TESI')`) en vez de leer `#prio`, confirmando lo mismo en `#m-body .pcard`.

Borrar el script al terminar.

- [ ] **Step 11: Commit**

```bash
cd "C:\Users\ClaudiaM\Motor Reposicion Nuevo" && git add public/tablero_motor_quiebre.html && git commit -m "$(cat <<'EOF'
Atencion Prioritaria/Ver quiebres/Ver riesgos a nivel articulo+color

Las filas fusionan todas las tallas rotas de un mismo color (antes: una fila
por talla). Estrella pasa a marcar el articulo completo (antes: SKU exacto).
Click-through resalta TODAS las tallas rotas de ese color dentro del modal
de Cobertura (antes: una sola columna, compartida entre todos los colores)
y hace scroll directo a su bloque.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reposición — una tarjeta por artículo+color

**Files:**
- Modify: `public/tablero_motor_quiebre.html`

**Interfaces:**
- Consumes: `abrirCoberturaArticulo(modelo, backFn, colorResaltado)` (Task 2).
- Produces: `repoDetalleHtml(modelo, diasObjetivo, color)` — nuevo tercer parámetro obligatorio
  (antes solo tomaba `modelo`, mostraba TODOS los colores adentro). `repoExpandido` pasa a estar
  keyed por `"modelo|color"` en vez de por `modelo` solo — Task 4 (Edición de recompra) no lee
  `repoExpandido` directamente, así que este cambio de clave queda contenido en esta tarea.

- [ ] **Step 1: `renderReposicion` — agrupar por modelo+color en vez de por modelo**

Ubicar (línea ~2865-2911 actual) el bloque que arma `porModelo`:

```js
  const filtrados = repoEmpresa==="TOTAL" ? items : items.filter(x=>x.empresa===repoEmpresa);
  const porModelo = {};
  filtrados.forEach(x=>{
    if(!porModelo[x.modelo]) porModelo[x.modelo] = {modelo:x.modelo, nombre:x.nombre, sim:x.sim, items:[], comprarTotal:0, costoTotal:0};
    const g = porModelo[x.modelo];
    g.items.push(x); g.comprarTotal += x.comprar; g.costoTotal += x.comprar*x.costo;
  });
  const grupos = Object.values(porModelo).sort((a,b)=>b.costoTotal-a.costoTotal);
  const totalModelos = new Set(ALL.map(x=>x.modelo)).size;
```

Reemplazar por:

```js
  const filtrados = repoEmpresa==="TOTAL" ? items : items.filter(x=>x.empresa===repoEmpresa);
  const porArticuloColor = {};
  filtrados.forEach(x=>{
    const key = x.modelo+"|"+x.color;
    if(!porArticuloColor[key]) porArticuloColor[key] = {modelo:x.modelo, color:x.color, nombre:x.nombre, sim:x.sim, items:[], comprarTotal:0, costoTotal:0};
    const g = porArticuloColor[key];
    g.items.push(x); g.comprarTotal += x.comprar; g.costoTotal += x.comprar*x.costo;
  });
  const grupos = Object.values(porArticuloColor).sort((a,b)=>b.costoTotal-a.costoTotal);
  const totalModelos = new Set(ALL.map(x=>x.modelo)).size;
```

- [ ] **Step 2: la tarjeta en sí — clave compuesta, título con color, detalle scoped**

Ubicar, en la misma función, el `filas = grupos.map(g=>{...})`:

```js
  const filas = grupos.map(g=>{
    const nSuc = new Set(g.items.map(x=>x.suc)).size;
    const expanded = !!repoExpandido[g.modelo];
    // Con el articulo completo ya en cache (se pide al expandir, ver mas abajo), se usa el MISMO
    // total que ya muestra el desglose por color -- antes el encabezado seguia mostrando el total
    // "liviano" (solo quiebre/riesgo de toda la red) mientras el desglose de abajo ya usaba datos
    // completos, y los dos numeros no coincidian entre si para el mismo articulo. Sin filtro de
    // empresa aca: repoDetalleHtml tambien muestra siempre el consolidado de las 2 empresas (asi
    // ya funcionaba antes de este cambio), asi que el total del encabezado tiene que sumar lo mismo
    // que se puede sumar a mano de los chips de color que se ven debajo, sin importar el selector
    // TESI/PUEBLO/TOTAL de mas arriba.
    const completo = expanded ? totalComprarCompleto(g.modelo, diasObjetivo) : null;
    const comprarTotal = completo ? completo.unidades : g.comprarTotal;
    const costoTotal = completo ? completo.costo : g.costoTotal;
    // Boton "Volver" pegado al costado del recuadro ambar, en el flujo normal de la pagina (NO
    // position:fixed con coordenadas calculadas en JS -- dos intentos de eso se rompian por la
    // naturaleza asincronica del scroll/render, uno termino literalmente encima de la grilla de
    // datos). position:absolute con left:100% dentro de un padre position:relative simplemente
    // sigue al recuadro al scrollear, sin ningun calculo ni medicion (2026-08-19).
    const volverAqui = expanded && volverACobertura && volverACobertura.modelo===g.modelo;
    return `<div class="pc mid pcard repo-card" data-mod="${g.modelo}">
      <div class="pc-top">${favStarHtml('modelo', g.modelo)} <span class="pc-cd">${g.modelo}</span><span class="pc-desc">${g.nombre.replace(" (SIM)","")}${g.sim?' <span class="sim">SIM</span>':''}</span></div>
      <div class="pc-stats">
        <span class="psuc">🏬 ${nSuc} sucursal${nSuc!==1?'es':''}</span>
        <span class="repo-buy">📦 ${fmt(comprarTotal)} unidades a comprar</span>
        <span class="pbig">${money(costoTotal)}</span>
        <span class="plupa">${expanded?'▲':'🔍'}</span>
        <span class="pcg-repo repo-editar" data-mod="${g.modelo}" title="Editar propuesta de recompra (consolidado por talle)">✏️</span>
      </div>
    </div>
    <div class="repo-detail" id="repo-detail-${g.modelo}" style="display:${expanded?'block':'none'};position:relative">${volverAqui?`<button class="repo-volver-junto-recuadro" data-mod="${g.modelo}">← Volver</button>`:''}${expanded?miniImgHtml(g.modelo, g.items[0]?.color, true):''}${expanded?repoDetalleHtml(g.modelo,diasObjetivo):''}</div>`;
  }).join("") || `<div style="padding:28px;text-align:center;color:#9aa7ad">No hace falta comprar nada en ${tituloFiltro}${repoProveedor!=='TODOS'?` para ${repoProveedor}`:''}: con ${diasObjetivo} días de cobertura objetivo, ya llega o supera ese nivel.</div>`;
```

Reemplazar por (clave compuesta `key` para `repoExpandido`/`data-mod`+`data-color`, el nombre del
artículo muestra el color, `totalComprarCompleto` recibe el color, `repoDetalleHtml` recibe el
color, `volverACobertura` ahora también compara color):

```js
  const filas = grupos.map(g=>{
    const key = g.modelo+"|"+g.color;
    const nSuc = new Set(g.items.map(x=>x.suc)).size;
    const expanded = !!repoExpandido[key];
    // Mismo motivo que antes (ver comentario historico), ahora acotado a este color puntual --
    // totalComprarCompleto recibe colorFiltro para no mezclar el total con otros colores del
    // mismo articulo.
    const completo = expanded ? totalComprarCompleto(g.modelo, diasObjetivo, null, g.color) : null;
    const comprarTotal = completo ? completo.unidades : g.comprarTotal;
    const costoTotal = completo ? completo.costo : g.costoTotal;
    const volverAqui = expanded && volverACobertura && volverACobertura.modelo===g.modelo && volverACobertura.color===g.color;
    return `<div class="pc mid pcard repo-card" data-mod="${g.modelo}" data-color="${g.color}">
      <div class="pc-top">${favStarHtml('modelo', g.modelo)} <span class="pc-cd">${g.modelo}</span><span class="pc-desc">${g.nombre.replace(" (SIM)","")}${g.sim?' <span class="sim">SIM</span>':''} — <b>${g.color==='—'?'Color único':g.color}</b></span></div>
      <div class="pc-stats">
        <span class="psuc">🏬 ${nSuc} sucursal${nSuc!==1?'es':''}</span>
        <span class="repo-buy">📦 ${fmt(comprarTotal)} unidades a comprar</span>
        <span class="pbig">${money(costoTotal)}</span>
        <span class="plupa">${expanded?'▲':'🔍'}</span>
        <span class="pcg-repo repo-editar" data-mod="${g.modelo}" data-color="${g.color}" title="Editar propuesta de recompra (consolidado por talle)">✏️</span>
      </div>
    </div>
    <div class="repo-detail" id="repo-detail-${key}" style="display:${expanded?'block':'none'};position:relative">${volverAqui?`<button class="repo-volver-junto-recuadro" data-mod="${g.modelo}" data-color="${g.color}">← Volver</button>`:''}${expanded?miniImgHtml(g.modelo, g.color, true):''}${expanded?repoDetalleHtml(g.modelo,diasObjetivo,g.color):''}</div>`;
  }).join("") || `<div style="padding:28px;text-align:center;color:#9aa7ad">No hace falta comprar nada en ${tituloFiltro}${repoProveedor!=='TODOS'?` para ${repoProveedor}`:''}: con ${diasObjetivo} días de cobertura objetivo, ya llega o supera ese nivel.</div>`;
```

- [ ] **Step 3: `totalComprarCompleto` — filtrar por color**

Ubicar (línea ~2829-2844 actual):

```js
function totalComprarCompleto(modelo, diasObjetivo, empresaFiltro){
  const completos = cacheArticuloCompleto.get(modelo);
  if(!completos || !completos.length) return null;
  // Respeta el filtro de empresa (TESI/PUEBLO/TOTAL) de la pantalla -- el deposito/OC ya se
  // reparte por empresa dentro de calcularNecesidadPorBarra, asi que filtrar antes de agrupar da
  // el mismo resultado que filtrar despues, sin tener que tocar esa funcion.
  const items = (empresaFiltro && empresaFiltro!=='TOTAL') ? completos.filter(x=>x.empresa===empresaFiltro) : completos;
  if(!items.length) return null;
  const mapa = calcularNecesidadPorBarra(diasObjetivo, items);
  let unidades = 0, costo = 0;
  items.forEach(x=>{
    const c = mapa.get(x.sku+"|"+x.suc)?.comprar || 0;
    unidades += c; costo += c*x.costo;
  });
  return {unidades, costo};
}
```

Reemplazar por (agrega `colorFiltro` al final, con el mismo patrón que `empresaFiltro`):

```js
function totalComprarCompleto(modelo, diasObjetivo, empresaFiltro, colorFiltro){
  const completos = cacheArticuloCompleto.get(modelo);
  if(!completos || !completos.length) return null;
  // Respeta el filtro de empresa (TESI/PUEBLO/TOTAL) de la pantalla -- el deposito/OC ya se
  // reparte por empresa dentro de calcularNecesidadPorBarra, asi que filtrar antes de agrupar da
  // el mismo resultado que filtrar despues, sin tener que tocar esa funcion.
  let items = (empresaFiltro && empresaFiltro!=='TOTAL') ? completos.filter(x=>x.empresa===empresaFiltro) : completos;
  if(colorFiltro) items = items.filter(x=>x.color===colorFiltro);
  if(!items.length) return null;
  const mapa = calcularNecesidadPorBarra(diasObjetivo, items);
  let unidades = 0, costo = 0;
  items.forEach(x=>{
    const c = mapa.get(x.sku+"|"+x.suc)?.comprar || 0;
    unidades += c; costo += c*x.costo;
  });
  return {unidades, costo};
}
```

- [ ] **Step 4: `repoDetalleHtml` — nuevo parámetro `color`, acota a ese color solo**

Ubicar (línea ~3003-3006 actual):

```js
function repoDetalleHtml(modelo, diasObjetivo){
  const itemsRed = ALL.filter(x=>x.modelo===modelo);
  const completos = cacheArticuloCompleto.get(modelo);
  const itemsBase = (completos && completos.length) ? completos : itemsRed;
```

Reemplazar por:

```js
function repoDetalleHtml(modelo, diasObjetivo, color){
  const itemsRed = ALL.filter(x=>x.modelo===modelo && x.color===color);
  const completos = cacheArticuloCompleto.get(modelo);
  const itemsBase = ((completos && completos.length) ? completos : itemsRed).filter(x=>x.color===color);
```

El resto de la función (líneas siguientes, `colores.forEach(color=>{...})` etc.) sigue funcionando
exactamente igual sin ningún otro cambio: como `itemsBase` ahora solo contiene ese color, el
`colores` que se calcula más abajo (`[...new Set(itemsBase.map(x=>x.color))]`) va a tener un solo
elemento, y el resto de la lógica (talles, sucursales, grilla) queda idéntica pero acotada a ese
color.

- [ ] **Step 5: bindings — clave compuesta en expandir/colapsar, editar, volver**

Ubicar (línea ~2977-2990 actual):

```js
  document.querySelectorAll('.repo-card').forEach(c=>c.onclick=()=>{
    const mod = c.dataset.mod;
    repoExpandido[mod] = !repoExpandido[mod];
    renderReposicion();
    // Al expandir: si todavia no se pidio el articulo completo (todos los estados) para este
    // modelo, pedirlo ahora y volver a renderizar cuando llegue -- repoDetalleHtml ya sabe usarlo
    // solo apenas esta en cacheArticuloCompleto.
    if(repoExpandido[mod] && !cacheArticuloCompleto.has(mod)){
      cargarArticuloCompleto(mod).then(()=>{ if(repoExpandido[mod]) renderReposicion(); });
    }
  });
  document.querySelectorAll('.repo-editar').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();
    abrirEdicionRecompra(b.dataset.mod, diasObjetivo);
  });
```

Reemplazar por (la clave de `repoExpandido` pasa a ser `"modelo|color"`; `cacheArticuloCompleto`
sigue siendo por `modelo` solo, sin cambios, porque cachea el artículo completo con todos sus
colores — no hace falta partirlo):

```js
  document.querySelectorAll('.repo-card').forEach(c=>c.onclick=()=>{
    const mod = c.dataset.mod, color = c.dataset.color, key = mod+"|"+color;
    repoExpandido[key] = !repoExpandido[key];
    renderReposicion();
    // Al expandir: si todavia no se pidio el articulo completo (todos los estados) para este
    // modelo, pedirlo ahora y volver a renderizar cuando llegue -- repoDetalleHtml ya sabe usarlo
    // solo apenas esta en cacheArticuloCompleto.
    if(repoExpandido[key] && !cacheArticuloCompleto.has(mod)){
      cargarArticuloCompleto(mod).then(()=>{ if(repoExpandido[key]) renderReposicion(); });
    }
  });
  document.querySelectorAll('.repo-editar').forEach(b=>b.onclick=(e)=>{
    e.stopPropagation();
    abrirEdicionRecompra(b.dataset.mod, b.dataset.color, diasObjetivo);
  });
```

- [ ] **Step 6: `repoExpandido` — actualizar el comentario de la declaración**

Ubicar (línea ~2846 actual): `let repoExpandido = {}; // modelo -> bool`

Reemplazar por: `let repoExpandido = {}; // "modelo|color" -> bool`

- [ ] **Step 7: `verPropuestaCompra`/`ejecutarVolverACobertura` — clave compuesta**

Ubicar (línea ~2594-2622 actual, función `verPropuestaCompra`):

```js
function verPropuestaCompra(modelo, color){
  document.getElementById('modal').style.display = "none"; // por si se llamó desde un modal abierto
  volverACobertura = {modelo, color: color||null};
  // Se resetean los filtros de empresa/proveedor y se fuerza el modelo por si el filtro de
  // favoritos u otro filtro de Reposición lo dejaría afuera de la lista -- sin esto, el artículo
  // que se venía viendo en Quiebre/Riesgo podía no aparecer y el usuario quedaba viendo la
  // pantalla de Reposición tal cual había quedado antes (otro artículo/filtro), no la suya.
  repoEmpresa = "TOTAL";
  repoProveedor = "TODOS";
  repoSeccion = "TODOS";
  repoFamilia = "TODOS";
  repoLinea = "TODOS";
  repoBusqueda = "";
  repoModeloForzado = modelo;
  repoExpandido[modelo] = true;
  irASolapa('reposicion');
  setTimeout(()=>{
    // Se hace scroll a la TARJETA (el encabezado), no al detalle -- el detalle puede tener
    // varios colores y ser más alto que la pantalla, y con block:'center' el usuario terminaba
    // viendo la mitad del detalle (ej. entre un color y el siguiente) en vez del artículo desde
    // el principio. El boton "Volver" ya nace position:fixed (.repo-volver-junto-recuadro, ver
    // CSS) asi que no hace falta ningun calculo de posicion despues del scroll -- puede ser
    // smooth sin problema.
    const el = document.querySelector('.repo-card[data-mod="'+modelo+'"]');
    if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'start'});
  }, 0);
}
```

Reemplazar por (si no llega color -- ej. desde el 🛒 de una fila vieja que por algún motivo no lo
tuviera -- se cae al primer `.repo-card` de ese modelo, cualquiera sea su color, en vez de romper
el selector):

```js
function verPropuestaCompra(modelo, color){
  document.getElementById('modal').style.display = "none"; // por si se llamó desde un modal abierto
  volverACobertura = {modelo, color: color||null};
  // Se resetean los filtros de empresa/proveedor y se fuerza el modelo por si el filtro de
  // favoritos u otro filtro de Reposición lo dejaría afuera de la lista -- sin esto, el artículo
  // que se venía viendo en Quiebre/Riesgo podía no aparecer y el usuario quedaba viendo la
  // pantalla de Reposición tal cual había quedado antes (otro artículo/filtro), no la suya.
  repoEmpresa = "TOTAL";
  repoProveedor = "TODOS";
  repoSeccion = "TODOS";
  repoFamilia = "TODOS";
  repoLinea = "TODOS";
  repoBusqueda = "";
  repoModeloForzado = modelo;
  if(color) repoExpandido[modelo+"|"+color] = true;
  irASolapa('reposicion');
  setTimeout(()=>{
    // Se hace scroll a la TARJETA (el encabezado), no al detalle. El boton "Volver" ya nace
    // position:fixed (.repo-volver-junto-recuadro, ver CSS) asi que no hace falta ningun calculo
    // de posicion despues del scroll -- puede ser smooth sin problema.
    const sel = color
      ? '.repo-card[data-mod="'+modelo+'"][data-color="'+(window.CSS && CSS.escape ? CSS.escape(color) : color)+'"]'
      : '.repo-card[data-mod="'+modelo+'"]';
    const el = document.querySelector(sel);
    if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'start'});
  }, 0);
}
```

Ubicar (línea ~2531-2545 actual, función `ejecutarVolverACobertura`) — esta función ya usa
`volverACobertura.color` para el scroll DENTRO del modal de Cobertura (sin cambios ahí), pero pasa
`talleResaltado=null` explícitamente a `abrirCoberturaArticulo` — como el parámetro se renombró a
`colorResaltado` en la Task 2, esto sigue siendo válido tal cual (pasar `null` sigue significando
"sin resaltado"), no requiere ningún cambio de código, solo confirmarlo al leer.

- [ ] **Step 8: Chequeo de sintaxis**

Mismo comando que en Tasks 1 y 2.

- [ ] **Step 9: Verificación con Playwright contra datos reales**

```js
// scratchpad/_verificar_task3.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto('http://localhost:3050', { waitUntil: 'networkidle' });
  await page.evaluate(() => { usuarioActual = { nombre: 'Test QA' }; renderUserWidget(); irASolapa('reposicion'); });
  await page.waitForTimeout(1500);

  // Buscar un modelo con mas de un color entre las tarjetas renderizadas
  const conteo = await page.evaluate(() => {
    const porModelo = {};
    document.querySelectorAll('.repo-card').forEach(c => {
      (porModelo[c.dataset.mod] = porModelo[c.dataset.mod] || new Set()).add(c.dataset.color);
    });
    let best = null, bestN = 0;
    for (const [mod, colores] of Object.entries(porModelo)) {
      if (colores.size > bestN) { bestN = colores.size; best = mod; }
    }
    return { best, bestN, totalCards: document.querySelectorAll('.repo-card').length };
  });
  console.log('modelo con mas colores en Reposicion:', JSON.stringify(conteo));
  console.assert(conteo.bestN > 1, 'FALLO: deberia haber al menos un modelo con mas de 1 tarjeta de color');

  // Expandir una tarjeta de ese modelo y confirmar que el detalle muestra SOLO ese color
  await page.evaluate((mod) => {
    document.querySelector(`.repo-card[data-mod="${mod}"]`).click();
  }, conteo.best);
  await page.waitForTimeout(1200);
  const coloresEnDetalle = await page.evaluate((mod) => {
    const detail = document.querySelector(`.repo-card[data-mod="${mod}"] + .repo-detail`) ||
                   [...document.querySelectorAll('.repo-detail')].find(d => d.style.display !== 'none');
    return [...(detail ? detail.querySelectorAll('.tpv-color-lbl') : [])].length;
  }, conteo.best);
  console.log('bloques de color dentro del detalle expandido (deberia ser 1):', coloresEnDetalle);
  await browser.close();
})();
```

Ejecutar y revisar que `bestN > 1` y `coloresEnDetalle === 1`. Además, hacer una pasada manual:
desde "Ver quiebres", clic en 🛒 de una fila, confirmar que Reposición abre expandida en la
tarjeta del COLOR correcto (no cualquier color del artículo) y que el botón "← Volver" hace
scroll de vuelta al bloque de color correcto dentro del modal de Cobertura.

Borrar el script al terminar.

- [ ] **Step 10: Commit**

```bash
cd "C:\Users\ClaudiaM\Motor Reposicion Nuevo" && git add public/tablero_motor_quiebre.html && git commit -m "$(cat <<'EOF'
Reposicion: una tarjeta por articulo+color (antes: una por articulo)

repoExpandido pasa a estar keyed por "modelo|color". repoDetalleHtml,
totalComprarCompleto y los botones Editar/Volver/expandir quedan acotados
al color de cada tarjeta en vez de mezclar todos los colores del articulo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Edición de recompra — editar por artículo+color

**Files:**
- Modify: `public/tablero_motor_quiebre.html`

**Interfaces:**
- Consumes: `.repo-editar` ahora dispara con `data-color` (Task 3).
- Produces: `abrirEdicionRecompra(modelo, color, diasObjetivo)` — nuevo parámetro en el medio.
  `edicionModelos` pasa a ser un array de strings `"modelo|color"` (antes: array de `modelo`
  solo) — ninguna otra tarea depende de esta forma interna.

- [ ] **Step 1: `abrirEdicionRecompra` — nuevo parámetro `color`, clave compuesta**

Ubicar (línea ~3116-3124 actual):

```js
async function abrirEdicionRecompra(modelo, diasObjetivo){
  if(!edicionModelos.includes(modelo)) edicionModelos.push(modelo);
  edicionDias = diasObjetivo;
  irASolapa('edicion');
  if(!cacheArticuloCompleto.has(modelo)){
    await cargarArticuloCompleto(modelo);
    renderEdicionRecompra();
  }
}
```

Reemplazar por:

```js
async function abrirEdicionRecompra(modelo, color, diasObjetivo){
  const key = modelo+"|"+color;
  if(!edicionModelos.includes(key)) edicionModelos.push(key);
  edicionDias = diasObjetivo;
  irASolapa('edicion');
  if(!cacheArticuloCompleto.has(modelo)){
    await cargarArticuloCompleto(modelo);
    renderEdicionRecompra();
  }
}
```

- [ ] **Step 2: `quitarDeEdicion` — recibir la clave compuesta**

Ubicar (línea ~3453-3456 actual):

```js
function quitarDeEdicion(modelo){
  edicionModelos = edicionModelos.filter(m=>m!==modelo);
  renderEdicionRecompra();
}
```

Reemplazar por:

```js
function quitarDeEdicion(key){
  edicionModelos = edicionModelos.filter(k=>k!==key);
  renderEdicionRecompra();
}
```

- [ ] **Step 3: dónde se llama a `quitarDeEdicion` — pasar la clave, no solo el modelo**

Buscar el binding del botón `.edicion-quitar` (dentro de `renderEdicionRecompra`, más abajo en el
mismo archivo — el texto exacto es
`document.querySelectorAll('.edicion-quitar').forEach(b=>b.onclick=()=>{ registrarActividad("Quitó artículo de Edición de recompra", b.dataset.mod); quitarDeEdicion(b.dataset.mod); });`).
Este cambia en el Step 5 (junto con el resto de `renderEdicionRecompra`) porque `b.dataset.mod`
pasa a necesitar también `b.dataset.color` — ver ese step para el texto completo del `data-mod`
del botón `.edicion-quitar`.

- [ ] **Step 4: `renderEdicionRecompra` — parsear la clave compuesta, acotar por color**

Ubicar (línea ~3458-3475 actual, inicio de la función):

```js
function renderEdicionRecompra(){
  const cont = document.getElementById('edicion-contenido');
  if(!edicionModelos.length){
    cont.innerHTML = `<div style="padding:28px;text-align:center;color:#9aa7ad">Todavía no elegiste ningún artículo. Andá a Reposición y hacé clic en ✏️ en la tarjeta que quieras ajustar — se van acumulando acá, uno debajo del otro.</div>`;
    return;
  }

  // IMPORTANTE: aunque el artículo se ve junto acá, las cantidades se consolidan
  // POR EMPRESA (no entre TESI y PUEBLO) — cada empresa termina siendo una orden de
  // compra distinta. La clave de edición incluye la empresa para no mezclarlas nunca.
  const articulos = edicionModelos.map(modelo=>{
    // Articulo COMPLETO (todos los estados) si ya se cargó -- si no, se cae a ALL (solo
    // quiebre/riesgo) como respaldo momentáneo mientras abrirEdicionRecompra lo está pidiendo.
    const completos = cacheArticuloCompleto.get(modelo);
    const itemsRed = (completos && completos.length) ? completos : ALL.filter(x=>x.modelo===modelo);
    if(!itemsRed.length) return null;
```

Reemplazar por (parsea `modelo`/`color` de la clave al principio del `.map`, y filtra `itemsRed`
por color inmediatamente):

```js
function renderEdicionRecompra(){
  const cont = document.getElementById('edicion-contenido');
  if(!edicionModelos.length){
    cont.innerHTML = `<div style="padding:28px;text-align:center;color:#9aa7ad">Todavía no elegiste ningún artículo. Andá a Reposición y hacé clic en ✏️ en la tarjeta que quieras ajustar — se van acumulando acá, uno debajo del otro.</div>`;
    return;
  }

  // IMPORTANTE: aunque el articulo+color se ve junto acá, las cantidades se consolidan
  // POR EMPRESA (no entre TESI y PUEBLO) — cada empresa termina siendo una orden de
  // compra distinta. La clave de edición incluye la empresa para no mezclarlas nunca.
  const articulos = edicionModelos.map(key=>{
    const sep = key.lastIndexOf("|");
    const modelo = key.slice(0, sep), color = key.slice(sep+1);
    // Articulo COMPLETO (todos los estados) si ya se cargó -- si no, se cae a ALL (solo
    // quiebre/riesgo) como respaldo momentáneo mientras abrirEdicionRecompra lo está pidiendo.
    // Acotado al color de ESTA entrada -- antes traía todos los colores del artículo mezclados.
    const completos = cacheArticuloCompleto.get(modelo);
    const itemsRed = ((completos && completos.length) ? completos : ALL.filter(x=>x.modelo===modelo)).filter(x=>x.color===color);
    if(!itemsRed.length) return null;
```

Más abajo en la misma función (todavía dentro del mismo `.map`), ubicar el `return` que cierra el
armado de cada artículo:

```js
    const totalEditado = bloques.reduce((a,bl)=>a+bl.totalEditado,0);
    return {modelo, nombre, costo, bloques, totalEditado, costoTotal: totalEditado*costo, color: itemsRed[0]?.color};
```

Reemplazar por (ya no hace falta inferir el color de `itemsRed[0]` porque ya viene fijo de la
clave — se usa directamente `color`, la variable ya parseada arriba):

```js
    const totalEditado = bloques.reduce((a,bl)=>a+bl.totalEditado,0);
    return {modelo, color, nombre, costo, bloques, totalEditado, costoTotal: totalEditado*costo};
```

- [ ] **Step 5: sección HTML de cada artículo — título con color, botón quitar con clave compuesta**

Ubicar (unas líneas más abajo en la misma función, la plantilla `secciones`):

```js
  const secciones = articulos.map(art=>`
    <div class="tpv-item" style="margin-bottom:16px">
      <div class="tpv-nmrow">
        <div class="pc-top">${favStarHtml('modelo', art.modelo)} <span class="pc-cd">${art.modelo}</span><span class="pc-desc">${art.nombre}</span></div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="edicion-quitar" data-mod="${art.modelo}">✕ Quitar de esta lista</button>
          ${miniImgHtml(art.modelo, art.color)}
        </div>
      </div>
```

Reemplazar por:

```js
  const secciones = articulos.map(art=>`
    <div class="tpv-item" style="margin-bottom:16px">
      <div class="tpv-nmrow">
        <div class="pc-top">${favStarHtml('modelo', art.modelo)} <span class="pc-cd">${art.modelo}</span><span class="pc-desc">${art.nombre} — <b>${art.color==='—'?'Color único':art.color}</b></span></div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="edicion-quitar" data-key="${art.modelo}|${art.color}">✕ Quitar de esta lista</button>
          ${miniImgHtml(art.modelo, art.color)}
        </div>
      </div>
```

- [ ] **Step 6: binding de `.edicion-quitar` — leer la clave compuesta**

Ubicar (más abajo, cerca del final de `renderEdicionRecompra`):

```js
  document.querySelectorAll('.edicion-quitar').forEach(b=>b.onclick=()=>{ registrarActividad("Quitó artículo de Edición de recompra", b.dataset.mod); quitarDeEdicion(b.dataset.mod); });
```

Reemplazar por:

```js
  document.querySelectorAll('.edicion-quitar').forEach(b=>b.onclick=()=>{ registrarActividad("Quitó artículo de Edición de recompra", b.dataset.key); quitarDeEdicion(b.dataset.key); });
```

- [ ] **Step 7: Chequeo de sintaxis**

Mismo comando que en tareas anteriores.

- [ ] **Step 8: Verificación con Playwright contra datos reales**

```js
// scratchpad/_verificar_task4.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto('http://localhost:3050', { waitUntil: 'networkidle' });
  await page.evaluate(() => { usuarioActual = { nombre: 'Test QA' }; renderUserWidget(); irASolapa('reposicion'); });
  await page.waitForTimeout(1500);

  const conteo = await page.evaluate(() => {
    const porModelo = {};
    document.querySelectorAll('.repo-card').forEach(c => {
      (porModelo[c.dataset.mod] = porModelo[c.dataset.mod] || new Set()).add(c.dataset.color);
    });
    let best = null, bestN = 0, bestColores = null;
    for (const [mod, colores] of Object.entries(porModelo)) {
      if (colores.size > bestN) { bestN = colores.size; best = mod; bestColores = [...colores]; }
    }
    return { best, bestColores };
  });
  console.log('modelo elegido:', conteo.best, 'colores:', conteo.bestColores);

  // Click en editar (✏️) de DOS colores distintos del mismo modelo
  for (const color of conteo.bestColores.slice(0, 2)) {
    await page.evaluate(({mod, color}) => {
      const card = document.querySelector(`.repo-card[data-mod="${mod}"][data-color="${color}"]`);
      card.querySelector('.repo-editar').click();
    }, { mod: conteo.best, color });
    await page.waitForTimeout(1200);
    await page.evaluate(() => irASolapa('reposicion')); // volver para poder clickear el siguiente
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => irASolapa('edicion'));
  await page.waitForTimeout(800);
  const tarjetasEdicion = await page.evaluate(() => document.querySelectorAll('#edicion-contenido .tpv-item').length);
  console.log('tarjetas en Edicion de recompra (deberia ser 2, una por color):', tarjetasEdicion);
  await browser.close();
})();
```

Ejecutar y confirmar `tarjetasEdicion === 2` (dos colores del mismo artículo, cada uno con su
propia tarjeta separada de edición). Verificar también manualmente: editar un talle de un color no
debe afectar los números del otro color del mismo artículo, y "Quitar de esta lista" en uno de los
dos debe dejar el otro intacto.

Borrar el script al terminar.

- [ ] **Step 9: Commit**

```bash
cd "C:\Users\ClaudiaM\Motor Reposicion Nuevo" && git add public/tablero_motor_quiebre.html && git commit -m "$(cat <<'EOF'
Edicion de recompra: editar por articulo+color (antes: todos los colores)

edicionModelos pasa a guardar claves "modelo|color". El icono ✏️ de cada
tarjeta de color en Reposicion ahora abre edicion solo para ese color --
para editar dos colores del mismo articulo, se agregan por separado desde
sus propias tarjetas (mismo patron ya usado para articulos distintos).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Favoritos (catálogo) — una fila por artículo+color

**Files:**
- Modify: `public/tablero_motor_quiebre.html`

**Interfaces:**
- Consumes: `abrirCoberturaArticulo(modelo, backFn, colorResaltado)` (Task 2).
- Produces: nada consumido por otras tareas — es la última pantalla de la lista.

- [ ] **Step 1: `renderCatalogoFavoritos` — agrupar por modelo+color**

Ubicar (línea ~3738-3752 actual):

```js
function renderCatalogoFavoritos(){
  const cont = document.getElementById('fav-catalogo');
  if(!cont) return;
  const porModelo = {};
  ALL.forEach(x=>{
    if(!porModelo[x.modelo]) porModelo[x.modelo] = {modelo:x.modelo, nombre:x.nombre, prov:x.prov, seccion:x.seccion, familia:x.familia, linea:x.linea, sim:x.sim, stockTotal:0, vdSum:0, n:0};
    const g = porModelo[x.modelo];
    g.stockTotal += x.stock; g.vdSum += x.vd; g.n += 1;
  });
  const vivos = Object.values(porModelo).filter(g=>g.stockTotal>0).map(g=>({...g, vdProm: g.vdSum/g.n}));
```

Reemplazar por:

```js
function renderCatalogoFavoritos(){
  const cont = document.getElementById('fav-catalogo');
  if(!cont) return;
  const porArticuloColor = {};
  ALL.forEach(x=>{
    const key = x.modelo+"|"+x.color;
    if(!porArticuloColor[key]) porArticuloColor[key] = {modelo:x.modelo, color:x.color, nombre:x.nombre, prov:x.prov, seccion:x.seccion, familia:x.familia, linea:x.linea, sim:x.sim, stockTotal:0, vdSum:0, n:0};
    const g = porArticuloColor[key];
    g.stockTotal += x.stock; g.vdSum += x.vd; g.n += 1;
  });
  const vivos = Object.values(porArticuloColor).filter(g=>g.stockTotal>0).map(g=>({...g, vdProm: g.vdSum/g.n}));
```

- [ ] **Step 2: la fila — mostrar color, pasar color al click**

Ubicar (línea ~3774-3782 actual):

```js
  const filas = filtrados.map(g=>`
    <div class="pc mid pcard" data-mod="${g.modelo}">
      <div class="pc-top">${favStarHtml('modelo', g.modelo)} <span class="pc-cd">${g.modelo}</span><span class="pc-desc">${g.nombre.replace(" (SIM)","")}${g.sim?' <span class="sim">SIM</span>':''}</span></div>
      <div class="pc-stats">
        <span class="psuc">📦 ${fmt(g.stockTotal)} unidades en stock</span>
        <span class="prot">⟳ ${g.vdProm.toLocaleString('es-AR',{maximumFractionDigits:2})} unidades/día prom.</span>
        <span class="plupa">🔍</span>
      </div>
    </div>`).join("") || `<div style="padding:16px;color:#9aa7ad;font-size:12.5px">No hay artículos${termino?` que coincidan con "${catBusqueda.trim()}"`:' con stock'} para este proveedor.</div>`;
```

Reemplazar por:

```js
  const filas = filtrados.map(g=>`
    <div class="pc mid pcard" data-mod="${g.modelo}" data-color="${g.color}">
      <div class="pc-top">${favStarHtml('modelo', g.modelo)} <span class="pc-cd">${g.modelo}</span><span class="pc-desc">${g.nombre.replace(" (SIM)","")}${g.sim?' <span class="sim">SIM</span>':''} — <b>${g.color==='—'?'Color único':g.color}</b></span></div>
      <div class="pc-stats">
        <span class="psuc">📦 ${fmt(g.stockTotal)} unidades en stock</span>
        <span class="prot">⟳ ${g.vdProm.toLocaleString('es-AR',{maximumFractionDigits:2})} unidades/día prom.</span>
        <span class="plupa">🔍</span>
      </div>
    </div>`).join("") || `<div style="padding:16px;color:#9aa7ad;font-size:12.5px">No hay artículos${termino?` que coincidan con "${catBusqueda.trim()}"`:' con stock'} para este proveedor.</div>`;
```

- [ ] **Step 3: click de la fila — pasar el color como resaltado**

Ubicar (línea ~3799 actual):

```js
  document.querySelectorAll('#fav-catalogo .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, ()=>irASolapa('favoritos')));
```

Reemplazar por:

```js
  document.querySelectorAll('#fav-catalogo .pcard').forEach(c=>c.onclick=()=>abrirCoberturaArticulo(c.dataset.mod, ()=>irASolapa('favoritos'), c.dataset.color));
```

- [ ] **Step 4: Chequeo de sintaxis**

Mismo comando que en tareas anteriores.

- [ ] **Step 5: Verificación con Playwright contra datos reales**

```js
// scratchpad/_verificar_task5.js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto('http://localhost:3050', { waitUntil: 'networkidle' });
  await page.evaluate(() => { usuarioActual = { nombre: 'Test QA' }; renderUserWidget(); irASolapa('favoritos'); });
  await page.waitForTimeout(1500);

  const conteo = await page.evaluate(() => {
    const porModelo = {};
    document.querySelectorAll('#fav-catalogo .pcard').forEach(c => {
      (porModelo[c.dataset.mod] = porModelo[c.dataset.mod] || new Set()).add(c.dataset.color);
    });
    let best = null, bestN = 0;
    for (const [mod, colores] of Object.entries(porModelo)) {
      if (colores.size > bestN) { bestN = colores.size; best = mod; }
    }
    return { best, bestN, totalFilas: document.querySelectorAll('#fav-catalogo .pcard').length };
  });
  console.log('Favoritos -- filas totales:', conteo.totalFilas, '| modelo con mas colores:', conteo.best, conteo.bestN);
  console.assert(conteo.bestN > 1, 'FALLO: deberia haber al menos un articulo con mas de 1 color/fila');
  await browser.close();
})();
```

Ejecutar y confirmar que hay más filas que artículos distintos (varias filas por artículo cuando
tiene varios colores) y, manualmente, que clickear una fila abre el modal de Cobertura scrolleado
al color correcto.

Borrar el script al terminar.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\ClaudiaM\Motor Reposicion Nuevo" && git add public/tablero_motor_quiebre.html && git commit -m "$(cat <<'EOF'
Favoritos (catalogo): una fila por articulo+color (antes: una por articulo)

Click en una fila abre el modal de Cobertura scrolleado a ese color. Marcar
la estrella sigue marcando el articulo completo, sin cambios (spec seccion 6).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verificación final end-to-end con datos reales

**Files:** ninguno (solo verificación, sin cambios de código).

**Interfaces:**
- Consumes: todo lo de Tasks 1-5.
- Produces: confirmación de que el flujo completo funciona cruzando las 5 pantallas con un
  artículo real de varios colores y varias tallas rotas por color.

- [ ] **Step 1: Elegir un artículo real de prueba**

Con el servidor corriendo, buscar (vía Playwright o `curl` a `/api/tablero/quiebre`) un `modelo`
real que tenga al menos 2 colores distintos, cada uno con al menos 2 tallas en estado QUIEBRE o
RIESGO simultáneamente — mismo criterio ya usado en las verificaciones de las Tasks 2-5. Anotar el
`modelo` y sus colores para las siguientes verificaciones manuales.

- [ ] **Step 2: Recorrer el flujo completo con Playwright**

Escribir un script descartable (`scratchpad/_verificar_e2e.js`) que, sobre el artículo elegido:

1. Abra Atención Prioritaria (o Ver quiebres si no aparece ahí) y confirme que aparece como
   filas separadas por color (no por talla).
2. Clic en una fila de un color → confirmar que el modal de Cobertura abre, hace scroll a ese
   bloque de color, y que las columnas de las tallas rotas de ESE color (no de otros colores)
   tienen la clase `tpv-col-resaltada`.
3. Clic en 🛒 "Ver propuesta de recompra" de esa fila → confirmar que Reposición abre expandida
   exactamente en la tarjeta de ese `modelo+color` (no otro color del mismo artículo).
4. Clic en "← Volver" (fijo arriba a la derecha) → confirmar que vuelve al modal de Cobertura,
   scrolleado al mismo bloque de color de antes.
5. Desde Reposición, clic en ✏️ de esa tarjeta → confirmar que Edición de recompra muestra
   únicamente ese color (no los demás colores del artículo).
6. Ir a Favoritos → confirmar que el mismo artículo aparece como filas separadas por color, y que
   clickear una de ellas también abre Cobertura scrolleada al color correcto.

```js
const { chromium } = require('playwright');
(async () => {
  const MODELO = 'CAMBIAR_POR_EL_MODELO_REAL_ELEGIDO_EN_STEP_1';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on('console', m => { if (m.type()==='error') console.log('CONSOLE ERROR:', m.text()); });
  await page.goto('http://localhost:3050', { waitUntil: 'networkidle' });
  await page.evaluate(() => { usuarioActual = { nombre: 'Test QA' }; renderUserWidget(); });
  await page.waitForTimeout(500);

  await page.evaluate(() => openQuiebresEmpresa('TOTAL'));
  await page.waitForTimeout(1200);
  const filaInfo = await page.evaluate((mod) => {
    const c = document.querySelector(`#m-body .pcard[data-mod="${mod}"]`);
    return c ? { color: c.dataset.color } : null;
  }, MODELO);
  console.log('fila encontrada en Ver quiebres:', JSON.stringify(filaInfo));
  if (!filaInfo) { console.log('AJUSTAR MODELO -- no se encontro en Ver quiebres'); await browser.close(); return; }

  await page.evaluate((mod) => document.querySelector(`#m-body .pcard[data-mod="${mod}"]`).click(), MODELO);
  await page.waitForTimeout(1200);
  const resaltado = await page.evaluate(() => document.querySelectorAll('.tpv-col-resaltada').length);
  console.log('columnas resaltadas tras click:', resaltado);

  await page.evaluate((mod) => document.querySelector(`#m-body .pcg-repo[data-mod="${mod}"]`)?.click()
    || document.querySelector('.tpv-repo-btn')?.click(), MODELO);
  await page.waitForTimeout(1200);
  const repoAbierto = await page.evaluate((mod) => {
    const cards = [...document.querySelectorAll(`.repo-card[data-mod="${mod}"]`)];
    return cards.map(c => ({ color: c.dataset.color, expandido: c.nextElementSibling?.style.display !== 'none' }));
  }, MODELO);
  console.log('tarjetas de Reposicion para este modelo tras "Ver propuesta de recompra":', JSON.stringify(repoAbierto));

  await page.evaluate(() => document.querySelector('.repo-volver-junto-recuadro')?.click());
  await page.waitForTimeout(1200);
  const volvioOk = await page.evaluate(() => document.getElementById('m-title').textContent);
  console.log('titulo del modal tras click en Volver:', volvioOk);

  await browser.close();
})();
```

Ejecutar, reemplazando `MODELO` por el artículo real elegido en el Step 1, y revisar cada línea de
salida contra lo esperado en los puntos 1-6 de arriba. Si algo no coincide, NO continuar — volver
a la task correspondiente y corregir antes de seguir.

- [ ] **Step 3: Verificación manual en el navegador (no reemplazable por Playwright)**

Abrir `http://localhost:3050` en un navegador real y repetir el mismo recorrido a ojo, prestando
atención a: que el texto de "tallas rotas" en las filas de lista no se corte visualmente, que la
miniatura de foto siga apareciendo correctamente por color, y que no haya ningún error en la
consola del navegador (F12 → Console) durante todo el recorrido.

- [ ] **Step 4: Borrar el script de verificación**

- [ ] **Step 5: Reportar a Claudia**

Avisar que el cambio está completo, resumir qué se verificó con datos reales (el artículo elegido,
cuántos colores/tallas tenía), y pedirle que confirme desde su propio navegador antes de considerar
la tarea cerrada — mismo criterio de "verificar con datos reales, no alcanza con razonamiento
teórico" que rige todo este proyecto.

(No hay commit en esta tarea — es solo verificación, sin cambios de código.)
