/**
 * Logica de negocio del control de caja. Unico modulo que conoce la cuenta de
 * control y el criterio de "no cierra"; no lee archivos ni sabe de HTTP.
 */

/**
 * La partida doble ya viene cuadrada por fecha+sucursal en los archivos de SAP
 * (verificado: 850 grupos en TESI y 744 en PUEBLO, cero descuadres), asi que
 * "suma de saldos != 0" NO sirve como criterio de control: siempre da 0. El
 * indicador real es lo que SAP imputa a esta cuenta.
 */
export const CUENTA_DIFERENCIAS_CAJA = '4.2.002.01.050'

// Debajo de medio centavo es cero: evita que un error de punto flotante
// convierta un dia que cerro en una celda pintada.
const EPS = 0.005
const esCero = n => Math.abs(n) < EPS

export function periodosDisponibles(registros) {
  return [...new Set(registros.map(r => r.periodo))].sort()
}

export function construirMatriz(registros, periodo, nombres = {}) {
  const delPeriodo = registros.filter(r => r.periodo === periodo)

  // Dias y pares (sucursal, dia) con ACTIVIDAD: se derivan de todos los
  // registros del periodo, no solo de los de la cuenta de diferencias. Un dia
  // operado sin diferencias es una columna vacia legitima, y es el denominador
  // de "N de M dias con diferencia" — si solo contaramos los dias con
  // diferencia, el ratio seria siempre 100%.
  const dias = [...new Set(delPeriodo.map(r => r.dia))].sort()
  const paresConActividad = new Set(delPeriodo.map(r => `${r.sucursal}|${r.dia}`))

  // Suma de saldos de la cuenta de control por sucursal+dia.
  const porSucursal = new Map()
  for (const r of delPeriodo) {
    if (r.cuentaCodigo !== CUENTA_DIFERENCIAS_CAJA) continue
    if (!porSucursal.has(r.sucursal)) porSucursal.set(r.sucursal, new Map())
    const m = porSucursal.get(r.sucursal)
    m.set(r.dia, (m.get(r.dia) ?? 0) + r.saldo)
  }

  const totalesPorDia = {}
  let faltantes = 0
  let sobrantes = 0
  let diasConDiferencia = 0

  // Construir sucursales desde todas las que aparecen en el periodo.
  // Una sucursal cuyas diferencias se cancelaron todas no aporta una fila:
  // no tiene nada que revisar.
  const todasLasSucursales = [...new Set(delPeriodo.map(r => r.sucursal))].sort()
  const sucursales = []

  for (const codigo of todasLasSucursales) {
    const porDia = porSucursal.get(codigo) || new Map()
    const celdas = {}
    let total = 0

    for (const [dia, valor] of porDia) {
      if (esCero(valor)) continue   // un dia que cerro no deja celda pintada
      celdas[dia] = valor
      total += valor
      totalesPorDia[dia] = (totalesPorDia[dia] ?? 0) + valor
      diasConDiferencia++
      if (valor > 0) faltantes += valor
      else sobrantes += valor
    }

    sucursales.push({ codigo, nombre: nombres[codigo] ?? '', dias: celdas, total })
  }

  // Las problematicas arriba (por magnitud, sin importar el signo). El
  // desempate por codigo mantiene el orden estable entre requests: sin el, dos
  // sucursales con el mismo total podrian alternar posicion y la tabla
  // "saltaria" al refrescar.
  sucursales.sort((a, b) =>
    Math.abs(b.total) - Math.abs(a.total) || a.codigo.localeCompare(b.codigo))

  const granTotal = Object.values(totalesPorDia).reduce((a, b) => a + b, 0)

  return {
    periodo,
    dias,
    sucursales,
    totalesPorDia,
    granTotal,
    resumen: {
      faltantes,
      sobrantes,
      neto: faltantes + sobrantes,
      diasConDiferencia,
      diasTotales: paresConActividad.size
    }
  }
}
