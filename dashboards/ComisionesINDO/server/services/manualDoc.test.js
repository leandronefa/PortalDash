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
