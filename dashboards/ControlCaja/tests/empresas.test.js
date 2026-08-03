import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EMPRESAS, listaDeEmpresas, empresaValida, normalizarClave, cargarNombresSucursal } from '../server/empresas.js'

test('el registro tiene TESI y PUEBLO apuntando a los archivos de SAP', () => {
  assert.equal(EMPRESAS.TESI.archivo, 'SAP_REPORTE_Z.TXT')
  assert.equal(EMPRESAS.PUEBLO.archivo, 'SAP_PU_REPORTE_Z.TXT')
})

test('INDO todavia no esta en el registro', () => {
  // El spec lo deja explicitamente fuera: no existe la exportacion.
  assert.equal(EMPRESAS.INDO, undefined)
})

test('listaDeEmpresas devuelve clave y label para el selector', () => {
  const l = listaDeEmpresas()
  assert.deepEqual(l, [{ clave: 'TESI', label: 'TESI' }, { clave: 'PUEBLO', label: 'PUEBLO' }])
})

test('normalizarClave acepta minusculas y rechaza lo desconocido', () => {
  assert.equal(normalizarClave('tesi'), 'TESI')
  assert.equal(normalizarClave('PUEBLO'), 'PUEBLO')
  assert.equal(normalizarClave('INDO'), null)
  assert.equal(normalizarClave(''), null)
  assert.equal(normalizarClave(undefined), null)
})

test('empresaValida coincide con el registro', () => {
  assert.equal(empresaValida('TESI'), true)
  assert.equal(empresaValida('INDO'), false)
})

test('cargarNombresSucursal lee el json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-suc-'))
  const p = path.join(tmp, 's.json')
  fs.writeFileSync(p, JSON.stringify({ '003': 'Centro' }), 'utf8')
  assert.deepEqual(cargarNombresSucursal(p), { '003': 'Centro' })
})

test('cargarNombresSucursal devuelve {} si el archivo no existe o esta corrupto', () => {
  // El mapeo es cosmetico: si falta, la matriz se rotula con el codigo. Nunca
  // debe tumbar el arranque del dashboard por un json mal editado a mano.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-suc-'))
  assert.deepEqual(cargarNombresSucursal(path.join(tmp, 'no-existe.json')), {})
  const roto = path.join(tmp, 'roto.json')
  fs.writeFileSync(roto, '{ esto no es json', 'utf8')
  assert.deepEqual(cargarNombresSucursal(roto), {})
})
