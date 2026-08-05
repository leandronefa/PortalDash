import { test } from 'node:test'
import assert from 'node:assert/strict'
import { totalSemanas, diasDeLaSemana, ultimaSemana } from '../src/lib/semanas.ts'

const MES_COMPLETO = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
                       '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
                       '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31']

test('totalSemanas parte 31 dias en 5 bloques de 7', () => {
  assert.equal(totalSemanas(MES_COMPLETO), 5)
})

test('totalSemanas con exactamente 7 dias da 1 bloque', () => {
  assert.equal(totalSemanas(MES_COMPLETO.slice(0, 7)), 1)
})

test('totalSemanas con 8 dias da 2 bloques (el segundo con 1 solo dia)', () => {
  assert.equal(totalSemanas(MES_COMPLETO.slice(0, 8)), 2)
})

test('totalSemanas con lista vacia da 1 bloque (no 0, para no dividir por cero en la UI)', () => {
  assert.equal(totalSemanas([]), 1)
})

test('diasDeLaSemana en el indice 0 devuelve los primeros 7', () => {
  assert.deepEqual(diasDeLaSemana(MES_COMPLETO, 0), ['01', '02', '03', '04', '05', '06', '07'])
})

test('diasDeLaSemana en el ultimo indice devuelve el resto, aunque sean menos de 7', () => {
  // 31 dias / 7 = 4 bloques completos + 3 dias sueltos (29,30,31) en el indice 4.
  assert.deepEqual(diasDeLaSemana(MES_COMPLETO, 4), ['29', '30', '31'])
})

test('diasDeLaSemana con un indice fuera de rango devuelve vacio, no un error', () => {
  assert.deepEqual(diasDeLaSemana(MES_COMPLETO, 99), [])
})

test('ultimaSemana apunta al ultimo bloque, cero-indexado', () => {
  // 31 dias -> 5 bloques -> el ultimo es el indice 4.
  assert.equal(ultimaSemana(MES_COMPLETO), 4)
  assert.equal(ultimaSemana(MES_COMPLETO.slice(0, 7)), 0)
  assert.equal(ultimaSemana([]), 0)
})

test('un mes con dias faltantes (dias sin ninguna actividad en toda la empresa) se parte igual, por posicion', () => {
  // Los "dias" de la matriz vienen de la actividad real, no de un calendario:
  // si un domingo nadie opero, ese dia ni siquiera aparece en la lista. Partir
  // por POSICION (no por aritmetica de fechas) es lo unico que tiene sentido
  // sin inventar dias que no estan.
  const conHuecos = ['01', '02', '03', '06', '07', '08', '09', '10', '13', '14']
  assert.equal(totalSemanas(conHuecos), 2)
  assert.deepEqual(diasDeLaSemana(conHuecos, 0), ['01', '02', '03', '06', '07', '08', '09'])
  assert.deepEqual(diasDeLaSemana(conHuecos, 1), ['10', '13', '14'])
})
