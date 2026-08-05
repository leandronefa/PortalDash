import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filtrarSucursales, totalesDeFilas } from '../src/lib/filtroSucursales.ts'

const FILAS = [
  { codigo: '020', nombre: 'Centro', dias: { '03': -23200, '04': 1500 }, total: -21700 },
  { codigo: '010', nombre: '', dias: { '03': -500 }, total: -500 },
  { codigo: '003', nombre: 'Norte', dias: {}, total: 0 }
]

test('sin filtro de texto ni ocultas, devuelve todas las filas', () => {
  const r = filtrarSucursales(FILAS, '', new Set())
  assert.deepEqual(r.map(f => f.codigo), ['020', '010', '003'])
})

test('el filtro de texto matchea por codigo', () => {
  const r = filtrarSucursales(FILAS, '02', new Set())
  assert.deepEqual(r.map(f => f.codigo), ['020'])
})

test('el filtro de texto matchea por nombre, sin importar mayusculas', () => {
  const r = filtrarSucursales(FILAS, 'CENTRO', new Set())
  assert.deepEqual(r.map(f => f.codigo), ['020'])
})

test('una sucursal sin nombre no matchea texto pero si matchea por codigo', () => {
  const r = filtrarSucursales(FILAS, 'centro', new Set())
  assert.ok(!r.some(f => f.codigo === '010'))
})

test('las sucursales ocultas se excluyen aunque coincidan con el texto', () => {
  const r = filtrarSucursales(FILAS, '', new Set(['010']))
  assert.deepEqual(r.map(f => f.codigo), ['020', '003'])
})

test('texto y ocultas se combinan (AND), no se pisan entre si', () => {
  const r = filtrarSucursales(FILAS, '0', new Set(['010']))
  assert.deepEqual(r.map(f => f.codigo), ['020', '003'])
})

test('un texto que no matchea nada devuelve vacio', () => {
  assert.deepEqual(filtrarSucursales(FILAS, 'inexistente', new Set()), [])
})

test('totalesDeFilas suma solo las filas dadas, no todo el mes', () => {
  // Si el usuario filtro a una sola sucursal, el pie de la tabla tiene que
  // mostrar el total de ESA sucursal, no el del mes completo -- mostrar el
  // total sin filtrar seria mentir sobre lo que se esta viendo.
  const r = totalesDeFilas([FILAS[0]], ['03', '04'])
  assert.deepEqual(r.totalesPorDia, { '03': -23200, '04': 1500 })
  assert.equal(r.granTotal, -21700)
})

test('totalesDeFilas suma varias filas por dia', () => {
  const r = totalesDeFilas([FILAS[0], FILAS[1]], ['03', '04'])
  assert.equal(r.totalesPorDia['03'], -23700)
  assert.equal(r.totalesPorDia['04'], 1500)
  assert.equal(r.granTotal, -22200)
})

test('un dia sin ninguna celda entre las filas dadas no aparece en totalesPorDia', () => {
  // Igual que el backend: una celda ausente en TODAS las filas visibles no es
  // un cero, es la ausencia de dato para ese dia.
  const r = totalesDeFilas([FILAS[2]], ['03', '04'])
  assert.deepEqual(r.totalesPorDia, {})
  assert.equal(r.granTotal, 0)
})

test('totalesDeFilas con una ventana de dias mas chica que la fila no suma los dias de afuera', () => {
  // Con una ventana semanal, el gran total tiene que salir de sumar SOLO los
  // dias visibles, no del total del mes entero que ya trae cada fila
  // (fila.total). Con la fila completa (03 y 04) el total seria -21700; con
  // la ventana acotada al 03, tiene que ser el de esa columna sola: -23200.
  const r = totalesDeFilas([FILAS[0]], ['03'])
  assert.deepEqual(r.totalesPorDia, { '03': -23200 })
  assert.equal(r.granTotal, -23200)
})

test('totalesDeFilas con lista vacia de filas no rompe', () => {
  const r = totalesDeFilas([], ['03', '04'])
  assert.deepEqual(r.totalesPorDia, {})
  assert.equal(r.granTotal, 0)
})
