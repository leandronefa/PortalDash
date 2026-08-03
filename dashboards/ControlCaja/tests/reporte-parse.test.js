import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parsearReporte } from '../server/reporte-parse.js'

const tesi = fs.readFileSync('tests/fixtures/tesi-crlf.txt', 'utf8')
const pueblo = fs.readFileSync('tests/fixtures/pueblo-lf.txt', 'utf8')

test('parsea CRLF (TESI) sin dejar \\r en los campos', () => {
  const { registros } = parsearReporte(tesi)
  assert.equal(registros.length, 5)   // 7 lineas - 2 sin sucursal
  for (const r of registros) {
    assert.ok(!JSON.stringify(r).includes('\\r'), `quedo un \\r en ${JSON.stringify(r)}`)
  }
})

test('parsea LF (PUEBLO) igual que CRLF', () => {
  const { registros, descartadas } = parsearReporte(pueblo)
  assert.equal(registros.length, 2)
  assert.equal(descartadas.length, 0)
  assert.equal(registros[0].sucursal, '002')
})

test('la fecha se parte en strings sin usar Date', () => {
  const { registros } = parsearReporte(tesi)
  const r = registros[0]
  assert.equal(r.fechaISO, '2026-06-03')
  assert.equal(r.periodo, '2026-06')
  assert.equal(r.dia, '03')
})

test('el importe ".00" es 0 y el negativo se respeta', () => {
  const { registros } = parsearReporte(tesi)
  const dif003 = registros.find(r => r.sucursal === '003' && r.cuentaCodigo === '4.2.002.01.050')
  assert.equal(dif003.debe, 0)
  assert.equal(dif003.haber, 20500)
  assert.equal(dif003.saldo, -20500)
})

test('saldo = debe - haber en una linea con debe y haber a la vez', () => {
  const { registros } = parsearReporte(tesi)
  const r = registros.find(r => r.sucursal === '017')
  assert.equal(r.debe, 567453.02)
  assert.equal(r.haber, 4085803)
  assert.ok(Math.abs(r.saldo - (r.debe - r.haber)) < 0.005)
  assert.equal(r.saldo, -3518349.98)
})

test('la cuenta se parte en codigo y nombre en el primer " - "', () => {
  const { registros } = parsearReporte(tesi)
  const r = registros[0]
  assert.equal(r.cuentaCodigo, '1.1.001.01.009')
  assert.equal(r.cuentaNombre, 'Caja Recaudadora Suc 3')
})

test('un nombre de cuenta con " - " adentro no se trunca', () => {
  // "IVA - Credito Fiscal 21%": el segundo " - " es parte del nombre.
  // Se prueba con sucursal valida para que no caiga en descartadas.
  const linea = '03/06/2026 0:00:00|003|1.1.003.06.007 - IVA - Credito Fiscal 21%|1.00|.00|1.00'
  const { registros } = parsearReporte(linea)
  assert.equal(registros[0].cuentaCodigo, '1.1.003.06.007')
  assert.equal(registros[0].cuentaNombre, 'IVA - Credito Fiscal 21%')
})

test('las lineas con fecha en el campo 2 van a descartadas, no a registros', () => {
  const { registros, descartadas } = parsearReporte(tesi)
  assert.equal(descartadas.length, 2)
  assert.ok(descartadas.every(d => /sucursal/i.test(d.motivo)))
  assert.ok(registros.every(r => /^\d{3}$/.test(r.sucursal)))
})

test('lineas vacias y sin pipes se ignoran sin contarlas como descartadas', () => {
  const { registros, descartadas } = parsearReporte('\n   \n\n')
  assert.equal(registros.length, 0)
  assert.equal(descartadas.length, 0)
})

test('una linea con importe no numerico va a descartadas', () => {
  const linea = '03/06/2026 0:00:00|003|1.1.001.01.009 - Caja|N/D|.00|.00'
  const { registros, descartadas } = parsearReporte(linea)
  assert.equal(registros.length, 0)
  assert.equal(descartadas.length, 1)
  assert.match(descartadas[0].motivo, /importe/i)
})

test('una linea con menos de 6 campos va a descartadas', () => {
  const { registros, descartadas } = parsearReporte('03/06/2026 0:00:00|003|Caja|1.00')
  assert.equal(registros.length, 0)
  assert.equal(descartadas.length, 1)
  assert.match(descartadas[0].motivo, /campos/i)
})

test('una fecha con formato invalido va a descartadas', () => {
  const linea = '2026-06-03|003|1.1.001.01.009 - Caja|1.00|.00|1.00'
  const { registros, descartadas } = parsearReporte(linea)
  assert.equal(registros.length, 0)
  assert.match(descartadas[0].motivo, /fecha/i)
})
