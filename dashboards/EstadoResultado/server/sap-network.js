import fs from 'fs'
import path from 'path'

/**
 * Lee un .txt de SAP desde la ruta de red. NUNCA escribe ni borra en la red.
 * Devuelve el error tipificado en lugar de lanzar: distinguir "SAP todavia no
 * dejo el archivo" (ENOENT) de "el servicio no tiene permiso" (EACCES/EPERM) es
 * clave para diagnosticar, porque el servicio corre como SYSTEM y se presenta en
 * la red con la cuenta de maquina.
 */
export function leerArchivoDeRed(networkPath, filename) {
  try {
    const texto = fs.readFileSync(path.join(networkPath, filename), 'utf8')
    return { ok: true, texto }
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
      return 'Sin permiso para leer la ruta de red (el servicio corre como SYSTEM)'
    case 'ETIMEDOUT':
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
      return 'La ruta de red no responde'
    default:
      return 'No se pudo leer la ruta de red'
  }
}
