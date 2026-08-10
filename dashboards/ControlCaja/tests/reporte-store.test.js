import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { crearStore } from '../server/reporte-store.js'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-store-'))
  return crearStore({ dir })
}

const registro = (periodo, sucursal = '003', saldo = 100) => ({
  fechaISO: `${periodo}-01`, periodo, dia: '01', sucursal,
  cuentaCodigo: '4.2.002.01.050', cuentaNombre: 'Diferencias de Caja',
  debe: saldo > 0 ? saldo : 0, haber: saldo < 0 ? -saldo : 0, saldo
})

test('leer de un store vacio no lanza y devuelve todo vacio', () => {
  const store = tmpStore()
  const r = store.leer('TESI')
  assert.deepEqual(r.periodos, [])
  assert.deepEqual(r.registros, [])
  assert.equal(r.descartadas, 0)
  assert.equal(r.ultimaLecturaOk, null)
})

test('merge guarda los registros agrupados por periodo', () => {
  const store = tmpStore()
  const r = store.merge('TESI', [registro('2026-05'), registro('2026-06')], 0, { mtimeMs: 1000, size: 10 })
  assert.deepEqual(r.periodos, ['2026-05', '2026-06'])
  assert.equal(r.registros.length, 2)
})

test('un periodo que no viene en un merge posterior se conserva', () => {
  // Simula la ventana rodante de SAP: mayo sale del archivo pero ya se habia
  // guardado, y el archivo nuevo solo trae junio.
  const store = tmpStore()
  store.merge('TESI', [registro('2026-05'), registro('2026-06')], 0, { mtimeMs: 1000, size: 10 })
  const r = store.merge('TESI', [registro('2026-06')], 0, { mtimeMs: 2000, size: 5 })
  assert.deepEqual(r.periodos, ['2026-05', '2026-06'])
})

test('un periodo que SI viene en un merge posterior se pisa entero (SAP corrigio datos)', () => {
  const store = tmpStore()
  store.merge('TESI', [registro('2026-06', '003', 100)], 0, { mtimeMs: 1000, size: 10 })
  const r = store.merge('TESI', [registro('2026-06', '003', 200)], 0, { mtimeMs: 2000, size: 20 })
  assert.equal(r.registros.length, 1)
  assert.equal(r.registros[0].saldo, 200)
})

test('el archivo mensual futuro solo agrega el mes nuevo sin tocar los anteriores', () => {
  // El caso que motiva el diseño: SAP deja de mandar la ventana de 3 meses y
  // pasa a mandar un archivo por mes.
  const store = tmpStore()
  store.merge('TESI', [registro('2026-06')], 0, { mtimeMs: 1000, size: 10 })
  store.merge('TESI', [registro('2026-07')], 0, { mtimeMs: 2000, size: 10 })
  const r = store.merge('TESI', [registro('2026-08')], 0, { mtimeMs: 3000, size: 10 })
  assert.deepEqual(r.periodos, ['2026-06', '2026-07', '2026-08'])
})

test('ultimaLecturaOk guarda mtime, size, fecha y descartadas del ultimo merge', () => {
  const store = tmpStore()
  const r = store.merge('TESI', [registro('2026-06')], 3, { mtimeMs: 555, size: 777 })
  assert.equal(r.ultimaLecturaOk.mtimeMs, 555)
  assert.equal(r.ultimaLecturaOk.size, 777)
  assert.equal(r.ultimaLecturaOk.descartadas, 3)
  assert.ok(r.ultimaLecturaOk.en)
})

test('empresas distintas no se contaminan entre si', () => {
  const store = tmpStore()
  store.merge('TESI', [registro('2026-06')], 0, { mtimeMs: 1, size: 1 })
  store.merge('PUEBLO', [registro('2026-07')], 0, { mtimeMs: 1, size: 1 })
  assert.deepEqual(store.leer('TESI').periodos, ['2026-06'])
  assert.deepEqual(store.leer('PUEBLO').periodos, ['2026-07'])
})

test('un data-store corrupto se descarta en vez de romper: leer devuelve vacio', () => {
  const store = tmpStore()
  store.merge('TESI', [registro('2026-06')], 0, { mtimeMs: 1, size: 1 })
  fs.writeFileSync(path.join(store.dir, 'TESI.json'), '{ esto no es json')
  const r = store.leer('TESI')
  assert.deepEqual(r.periodos, [])
})

test('el archivo se escribe atomicamente: no quedan temporales huerfanos', () => {
  const store = tmpStore()
  store.merge('TESI', [registro('2026-06')], 0, { mtimeMs: 1, size: 1 })
  const restantes = fs.readdirSync(store.dir).filter(f => f.endsWith('.tmp'))
  assert.deepEqual(restantes, [])
})

test('un merge vacio (0 registros) no borra lo ya guardado', () => {
  // Puede pasar si el archivo de red trae solo un periodo que no tiene ninguna
  // linea util (todo descartado); no debe interpretarse como "borrar todo".
  const store = tmpStore()
  store.merge('TESI', [registro('2026-06')], 0, { mtimeMs: 1, size: 1 })
  const r = store.merge('TESI', [], 5, { mtimeMs: 2, size: 2 })
  assert.deepEqual(r.periodos, ['2026-06'])
  assert.equal(r.descartadas, 5)
})
