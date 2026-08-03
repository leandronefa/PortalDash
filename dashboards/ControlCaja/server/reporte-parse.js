/**
 * Parseo del reporte Z de SAP: pipe-delimited, sin encabezado, 6 campos.
 *
 *   fecha|sucursal|cuenta|debe|haber|saldo
 *   03/06/2026 0:00:00|003|1.1.001.01.009 - Caja Recaudadora Suc 3|270000.00|270000.00|.00
 *
 * Dos particularidades de los archivos reales que este modulo absorbe:
 *
 *  1. Los dos archivos NO usan el mismo fin de linea: SAP_REPORTE_Z.TXT viene
 *     con CRLF y SAP_PU_REPORTE_Z.TXT con LF. Se normaliza antes de partir.
 *  2. En ~600 lineas el campo 2 trae una FECHA en lugar del codigo de sucursal
 *     (siempre en cuentas de compras). No pertenecen a ninguna sucursal, asi
 *     que no pueden entrar en un control de caja por sucursal: van a
 *     `descartadas` con su motivo. Se cuentan y se informan en la UI a
 *     proposito — el reporte se va a corregir en origen, y cuando eso pase el
 *     contador tiene que bajar a cero de forma visible en vez de que el cambio
 *     ocurra en silencio.
 *
 * Las fechas se devuelven como STRINGS ('2026-06-03', '2026-06', '03'), nunca
 * como Date: construir un Date desde 'dd/mm/yyyy' y despues formatearlo es la
 * via clasica a que un movimiento del dia 1 aparezca el ultimo dia del mes
 * anterior por zona horaria.
 */

const RE_SUCURSAL = /^\d{3}$/
const RE_FECHA = /^(\d{2})\/(\d{2})\/(\d{4})\b/
const RE_IMPORTE = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/

function parsearImporte(raw) {
  const s = raw.trim()
  if (!RE_IMPORTE.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function parsearReporte(texto) {
  const registros = []
  const descartadas = []

  const lineas = String(texto ?? '').replace(/\r\n?/g, '\n').split('\n')

  for (const linea of lineas) {
    // Linea vacia o sin separadores: ruido de formato, no un dato perdido.
    // No cuenta como descartada para que el contador de la UI signifique
    // "datos que SAP mando mal", no "el archivo termina en un salto de linea".
    if (!linea.trim() || !linea.includes('|')) continue

    const campos = linea.split('|')
    if (campos.length < 6) {
      descartadas.push({ linea, motivo: `Se esperaban 6 campos y llegaron ${campos.length}` })
      continue
    }

    const [rawFecha, rawSucursal, rawCuenta, rawDebe, rawHaber, rawSaldo] = campos

    const mf = RE_FECHA.exec(rawFecha.trim())
    if (!mf) {
      descartadas.push({ linea, motivo: `Fecha con formato inesperado: "${rawFecha.trim()}"` })
      continue
    }
    const [, dia, mes, anio] = mf

    const sucursal = rawSucursal.trim()
    if (!RE_SUCURSAL.test(sucursal)) {
      descartadas.push({ linea, motivo: `El campo de sucursal no es un código de 3 dígitos: "${sucursal}"` })
      continue
    }

    const debe = parsearImporte(rawDebe)
    const haber = parsearImporte(rawHaber)
    const saldo = parsearImporte(rawSaldo)
    if (debe === null || haber === null || saldo === null) {
      descartadas.push({ linea, motivo: 'Importe no numérico' })
      continue
    }

    // Primer " - ": el codigo nunca lo contiene, pero el nombre si
    // ("IVA - Credito Fiscal 21%"), asi que partir por todas las ocurrencias
    // truncaria el nombre.
    const cuenta = rawCuenta.trim()
    const sep = cuenta.indexOf(' - ')
    const cuentaCodigo = sep === -1 ? cuenta : cuenta.slice(0, sep).trim()
    const cuentaNombre = sep === -1 ? '' : cuenta.slice(sep + 3).trim()

    registros.push({
      fechaISO: `${anio}-${mes}-${dia}`,
      periodo: `${anio}-${mes}`,
      dia,
      sucursal,
      cuentaCodigo,
      cuentaNombre,
      debe,
      haber,
      saldo
    })
  }

  return { registros, descartadas }
}
