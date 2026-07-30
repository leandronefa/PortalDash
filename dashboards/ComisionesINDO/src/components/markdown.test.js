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

test('tabla sin fila separadora no desaparece: sobrevive como párrafo', () => {
  const html = mdToHtml('| a | b |\n| c | d |');
  assert.ok(html.length > 0, 'no debe devolver vacío');
  assert.ok(!html.includes('<table'), 'no es una tabla válida, no debe armar <table>');
  assert.match(html, /a/);
  assert.match(html, /b/);
  assert.match(html, /c/);
  assert.match(html, /d/);
});

test('tabla con separador con typo no desaparece: sobrevive como párrafo', () => {
  const html = mdToHtml('| Pesos | Paga |\n|-x-\n| Si | 100 |');
  assert.ok(html.length > 0, 'no debe devolver vacío');
  assert.ok(!html.includes('<table'), 'separador inválido, no debe armar <table>');
  assert.match(html, /Pesos/);
  assert.match(html, /Paga/);
  assert.match(html, /Si/);
  assert.match(html, /100/);
});

test('entrada vacía devuelve string vacío', () => {
  assert.equal(mdToHtml(''), '');
  assert.deepEqual(extraerSecciones(''), []);
});
