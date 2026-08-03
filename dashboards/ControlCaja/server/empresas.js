import fs from 'node:fs'

/**
 * Registro de empresas: clave canonica -> archivo en la UNC + label de UI.
 *
 * SUMAR UNA EMPRESA ES UNA LINEA ACA. /api/empresas publica este registro y el
 * frontend arma el selector con eso, asi que no hay que tocar la UI. INDO esta
 * pendiente: el usuario planea generar la exportacion, y cuando exista alcanza
 * con agregar { INDO: { archivo: '...', label: 'INDO' } }.
 */
export const EMPRESAS = {
  TESI: { archivo: 'SAP_REPORTE_Z.TXT', label: 'TESI' },
  PUEBLO: { archivo: 'SAP_PU_REPORTE_Z.TXT', label: 'PUEBLO' }
}

export function listaDeEmpresas() {
  return Object.entries(EMPRESAS).map(([clave, { label }]) => ({ clave, label }))
}

export function empresaValida(clave) {
  return Object.hasOwn(EMPRESAS, clave)
}

/**
 * Empresa desconocida devuelve null y el llamador responde 400. NUNCA un
 * fallback silencioso a TESI: mostrar los numeros de una empresa bajo el
 * nombre de otra es peor que un error visible.
 */
export function normalizarClave(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const clave = raw.trim().toUpperCase()
  return empresaValida(clave) ? clave : null
}

/**
 * Mapeo codigo -> nombre de sucursal. Es cosmetico: los archivos de SAP solo
 * traen el codigo, y un codigo ausente del mapeo se rotula con el codigo solo.
 * Por eso cualquier problema de lectura o de JSON devuelve {} en vez de lanzar:
 * un json mal editado a mano no puede dejar el dashboard sin arrancar.
 */
export function cargarNombresSucursal(rutaJson) {
  try {
    const obj = JSON.parse(fs.readFileSync(rutaJson, 'utf8'))
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch {
    return {}
  }
}
