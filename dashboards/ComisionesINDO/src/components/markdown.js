/**
 * Mini-parser Markdown para el manual de uso. Sin dependencias.
 *
 * Soporta: # / ## / ###, párrafos, listas (- y numeradas), tablas GFM,
 * bloques ```, blockquotes >, ---, y en línea **negrita**, *itálica*, `código`.
 *
 * Regla de robustez: lo que no reconoce sale como párrafo plano. Nunca lanza:
 * un manual mal formado tiene que verse feo, no dejar la página en blanco.
 */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function slugify(texto) {
  return String(texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // saca acentos
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
    if (buf.length) { out.push(`<p>${inline(escapeHtml(buf.join(' ')))}</p>`); continue; }
    // Salvaguarda: la línea no la consumió ningún bloque (ej: fila de tabla mal
    // formada, sin separador válido). Regla de robustez: nunca se descarta en
    // silencio, sale como párrafo plano escapado. Y siempre avanza `i`.
    out.push(`<p>${inline(escapeHtml(lineas[i].trim()))}</p>`);
    i++;
  }

  return out.join('\n');
}
