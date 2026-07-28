// Formato de los archivos SAP (verificado el 28/07/2026):
// pipe-delimited CUENTA|DESCRIPCION|SUCURSAL|VALOR|PERIODO, sin BOM, sin encabezado,
// CRLF (incluido al final del archivo), UTF-8, periodos en bloques contiguos ascendentes.
//
// Las lineas se tratan SIEMPRE como texto: los importes vienen como ".00" y
// "-107029809.47", asi que regenerarlos desde parseFloat rompe la igualdad byte a byte
// que necesita el circuito descargar -> editar -> subir.

export const EOL = '\r\n'

export function periodoDeLinea(line) {
  const parts = line.split('|')
  return (parts[4] ?? '').trim()
}

/**
 * Agrupa las lineas del texto por periodo, preservando cada linea textual.
 * Las lineas sin periodo caen en la clave ''. Descarta lineas vacias.
 * @returns {Map<string, string[]>} periodo -> lineas, en orden de aparicion
 */
export function splitIntoPeriodBlocks(text) {
  const blocks = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const periodo = periodoDeLinea(line)
    if (!blocks.has(periodo)) blocks.set(periodo, [])
    blocks.get(periodo).push(line)
  }
  return blocks
}

/**
 * Reconstruye el archivo: periodos ordenados ascendente, lineas unidas con CRLF
 * y CRLF final (como lo emite SAP).
 */
export function serializeBlocks(blocks) {
  const periodos = [...blocks.keys()].sort()
  const lines = periodos.flatMap(p => blocks.get(p))
  return lines.length === 0 ? '' : lines.join(EOL) + EOL
}
