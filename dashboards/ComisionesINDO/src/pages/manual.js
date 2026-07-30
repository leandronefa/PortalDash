import { api } from '../api/client.js';
import { mdToHtml, extraerSecciones, escapeHtml } from '../components/markdown.js';

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
        <p style="font-size:12px;color:var(--color-muted)"><span id="manual-err"></span></p>
        <button id="manual-retry" class="btn btn-primary btn-sm" style="margin-top:12px">Reintentar</button>
      </div>`;
    $content.querySelector('#manual-err').textContent = err.message;
    $content.querySelector('#manual-retry')
      .addEventListener('click', () => renderManual(container));
    return;
  }

  const md = data.markdown || '';

  if (!md.trim()) {
    $content.innerHTML = `
      <div class="manual-msg">
        <div style="font-size:32px;margin-bottom:12px">📭</div>
        <p style="font-weight:600">El manual está vacío</p>
        <p style="font-size:12px;color:var(--color-muted)">Avisale al equipo técnico.</p>
      </div>`;
    $index.innerHTML = '';
    $foot.textContent = `Última actualización del manual: ${fmtFecha(data.actualizado)}`;
    return;
  }

  $content.innerHTML = mdToHtml(md);
  $foot.textContent = `Última actualización del manual: ${fmtFecha(data.actualizado)}`;

  const secciones = extraerSecciones(md);
  $index.innerHTML = secciones.length
    ? `<div class="manual-index-title">Contenido</div>` +
      secciones.map(s => `<a class="manual-index-link" href="#${s.id}" data-id="${s.id}">${escapeHtml(s.titulo)}</a>`).join('')
    : '';

  // Scroll manual: el contenedor scrolleable es .manual-content, no la ventana,
  // así que href="#id" no alcanza.
  $index.querySelectorAll('.manual-index-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      // Si hay un filtro activo, la sección destino puede estar oculta y el
      // scroll no haría nada: limpiamos el buscador y restauramos el
      // contenido completo antes de scrollear.
      if ($search.value) {
        $search.value = '';
        aplicarBusqueda('');
      }
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
          <p>Sin coincidencias para «<span id="manual-q"></span>»</p>
        </div>`;
      $content.querySelector('#manual-q').textContent = termino;
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
