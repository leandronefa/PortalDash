import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { statArchivo, leerArchivo, descripcionDeError } from '../server/reporte-source.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-source-'))
fs.writeFileSync(path.join(tmp, 'OK.TXT'), 'hola', 'utf8')

test('leerArchivo devuelve el texto de un archivo existente', () => {
  const r = leerArchivo(tmp, 'OK.TXT')
  assert.equal(r.ok, true)
  assert.equal(r.texto, 'hola')
})

test('statArchivo devuelve mtimeMs y size', () => {
  const r = statArchivo(tmp, 'OK.TXT')
  assert.equal(r.ok, true)
  assert.equal(r.size, 4)
  assert.equal(typeof r.mtimeMs, 'number')
})

test('leerArchivo tipifica ENOENT en lugar de lanzar', () => {
  const r = leerArchivo(tmp, 'NO_EXISTE.TXT')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
})

test('statArchivo tipifica ENOENT en lugar de lanzar', () => {
  const r = statArchivo(tmp, 'NO_EXISTE.TXT')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
})

test('descripcionDeError da un mensaje distinto por causa', () => {
  assert.match(descripcionDeError('ENOENT'), /no dejó el archivo/)
  assert.match(descripcionDeError('EACCES'), /permiso/)
  assert.match(descripcionDeError('EPERM'), /permiso/)
  assert.match(descripcionDeError('ETIMEDOUT'), /no responde/)
  assert.match(descripcionDeError('LO_QUE_SEA'), /No se pudo leer/)
})
