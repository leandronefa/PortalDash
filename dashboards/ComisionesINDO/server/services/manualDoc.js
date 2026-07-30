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
