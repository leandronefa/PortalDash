import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CUENTA_DIFERENCIAS_CAJA, periodosDisponibles, construirMatriz } from '../server/control-caja.js'

// Helper: arma un registro con los campos que la matriz mira.
function reg(fechaISO, sucursal, cuentaCodigo, saldo, extra = {}) {
  const [anio, mes, dia] = fechaISO.split('-')
  return {
    fechaISO, periodo: `${anio}-${mes}`, dia, sucursal,
    cuentaCodigo, cuentaNombre: 'x',
    debe: saldo > 0 ? saldo : 0, haber: saldo < 0 ? -saldo : 0, saldo,
    ...extra
  }
}

const DIF = CUENTA_DIFERENCIAS_CAJA
const VENTA = '4.1.001.01.001'

test('la cuenta de control es la del spec', () => {
  assert.equal(CUENTA_DIFERENCIAS_CAJA, '4.2.002.01.050')
})

test('periodosDisponibles devuelve los meses presentes, ordenados y sin repetir', () => {
  const rs = [
    reg('2026-07-01', '003', VENTA, 1),
    reg('2026-06-03', '003', VENTA, 1),
    reg('2026-06-04', '003', VENTA, 1)
  ]
  assert.deepEqual(periodosDisponibles(rs), ['2026-06', '2026-07'])
})

test('una celda toma el saldo de la cuenta de diferencias', () => {
  const rs = [reg('2026-06-03', '020', DIF, 23200)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales[0].codigo, '020')
  assert.equal(m.sucursales[0].dias['03'], 23200)
})

test('dos lineas de diferencias en el mismo grupo se suman', () => {
  // Hoy no ocurre (verificado sobre los archivos reales), pero se suma para que
  // una linea duplicada en un archivo futuro no de un numero mal en silencio.
  const rs = [reg('2026-06-03', '020', DIF, 100), reg('2026-06-03', '020', DIF, 50)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales[0].dias['03'], 150)
})

test('una sucursal sin ninguna diferencia aparece con la fila vacia', () => {
  // Decidido por el usuario el 03/08/2026: es confirmacion positiva. La
  // ausencia de fila seria indistinguible de "no opero" o "no vino en el
  // archivo"; una fila vacia dice "opero y cerro bien todos los dias".
  const rs = [reg('2026-06-03', '003', VENTA, 5000)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales.length, 1)
  assert.equal(m.sucursales[0].codigo, '003')
  assert.deepEqual(m.sucursales[0].dias, {})
  assert.equal(m.sucursales[0].total, 0)
})

test('una diferencia que suma cero no genera celda', () => {
  const rs = [reg('2026-06-03', '003', DIF, 500), reg('2026-06-03', '003', DIF, -500)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales.length, 1)
  assert.deepEqual(m.sucursales[0].dias, {})
  assert.equal(m.sucursales[0].total, 0)
})

test('las columnas son solo los dias presentes en el periodo, ordenados', () => {
  const rs = [
    reg('2026-06-10', '003', VENTA, 1),
    reg('2026-06-03', '003', VENTA, 1),
    reg('2026-07-05', '003', VENTA, 1)   // otro periodo, no debe aparecer
  ]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.dias, ['03', '10'])
})

test('los dias con actividad cuentan aunque no haya diferencias', () => {
  // Una columna sin ninguna diferencia sigue siendo un dia operado: sacarla
  // haria que "5 de 20 dias con diferencia" se convirtiera en "5 de 5".
  const rs = [reg('2026-06-03', '003', VENTA, 1), reg('2026-06-04', '003', DIF, 100)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.dias, ['03', '04'])
  assert.equal(m.resumen.diasTotales, 2)
  assert.equal(m.resumen.diasConDiferencia, 1)
})

test('el nombre viene del mapeo y cae al vacio si falta', () => {
  const rs = [reg('2026-06-03', '003', DIF, 1), reg('2026-06-03', '080', DIF, 1)]
  const m = construirMatriz(rs, '2026-06', { '003': 'Centro' })
  const porCodigo = Object.fromEntries(m.sucursales.map(s => [s.codigo, s.nombre]))
  assert.equal(porCodigo['003'], 'Centro')
  assert.equal(porCodigo['080'], '')
})

test('una sucursal sin Caja Recaudadora aparece igual si tiene diferencias', () => {
  // El criterio de control es la cuenta de diferencias, no la de caja, asi que
  // una sucursal sin cuenta de Caja Recaudadora no puede quedar fuera de la
  // matriz. (En los archivos de hoy no hay ninguna asi: las cuatro que estaban
  // en ese estado -080, 111, 081, 102- dejaron de venir cuando el usuario
  // corrigio el reporte el 03/08/2026. El caso se cubre igual: es una
  // propiedad del criterio, no un accidente de los datos de un dia.)
  const rs = [reg('2026-06-03', '111', DIF, -900)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.sucursales.length, 1)
  assert.equal(m.sucursales[0].codigo, '111')
  assert.equal(m.sucursales[0].dias['03'], -900)
})

test('totales de fila, de columna y gran total', () => {
  const rs = [
    reg('2026-06-03', '003', DIF, 100),
    reg('2026-06-04', '003', DIF, -30),
    reg('2026-06-03', '020', DIF, 500)
  ]
  const m = construirMatriz(rs, '2026-06', {})
  const s003 = m.sucursales.find(s => s.codigo === '003')
  assert.equal(s003.total, 70)
  assert.equal(m.totalesPorDia['03'], 600)
  assert.equal(m.totalesPorDia['04'], -30)
  assert.equal(m.granTotal, 570)
})

test('el resumen separa faltantes de sobrantes', () => {
  // Un neto de 0 puede esconder un faltante grande compensado por un sobrante
  // grande: ese es justo el caso que el tablero tiene que dejar ver.
  const rs = [
    reg('2026-06-03', '003', DIF, 1000),
    reg('2026-06-04', '020', DIF, -1000)
  ]
  const m = construirMatriz(rs, '2026-06', {})
  assert.equal(m.resumen.faltantes, 1000)
  assert.equal(m.resumen.sobrantes, -1000)
  assert.equal(m.resumen.neto, 0)
  assert.equal(m.resumen.diasConDiferencia, 2)
})

test('las filas se ordenan por total absoluto descendente', () => {
  const rs = [
    reg('2026-06-03', '003', DIF, 100),
    reg('2026-06-03', '020', DIF, -5000),
    reg('2026-06-03', '010', DIF, 800)
  ]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.sucursales.map(s => s.codigo), ['020', '010', '003'])
})

test('a igual total absoluto el orden es por codigo, para que sea estable', () => {
  const rs = [reg('2026-06-03', '020', DIF, 100), reg('2026-06-03', '003', DIF, -100)]
  const m = construirMatriz(rs, '2026-06', {})
  assert.deepEqual(m.sucursales.map(s => s.codigo), ['003', '020'])
})

test('un periodo sin registros da una matriz vacia, no un error', () => {
  const m = construirMatriz([reg('2026-06-03', '003', DIF, 1)], '2026-08', {})
  assert.deepEqual(m.dias, [])
  assert.deepEqual(m.sucursales, [])
  assert.equal(m.granTotal, 0)
  assert.equal(m.resumen.diasTotales, 0)
})
