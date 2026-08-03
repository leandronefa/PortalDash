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
