import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { leerArchivoDeRed, descripcionDeError } from '../server/sap-network.js'

test('lee un archivo existente y devuelve el texto tal cual', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapnet-'))
  const contenido = '4.1.001.01.001|Venta|011|-100.00|2026-01\r\n'
  fs.writeFileSync(path.join(dir, 'SAP_RESULT.txt'), contenido, 'utf8')
  const r = leerArchivoDeRed(dir, 'SAP_RESULT.txt')
  assert.equal(r.ok, true)
  assert.equal(r.texto, contenido)
})

test('archivo inexistente devuelve ENOENT sin lanzar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapnet-'))
  const r = leerArchivoDeRed(dir, 'SAP_RESULT.txt')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
})

test('ruta de red inexistente devuelve error sin lanzar', () => {
  const r = leerArchivoDeRed('\\\\10.255.255.255\\NoExiste', 'SAP_RESULT.txt')
  assert.equal(r.ok, false)
  assert.ok(r.code, 'deberia traer un code')
})

test('descripcionDeError distingue permisos de archivo ausente', () => {
  assert.match(descripcionDeError('ENOENT'), /no dej[oó]|no est[aá]/i)
  assert.match(descripcionDeError('EACCES'), /permis/i)
  assert.match(descripcionDeError('EPERM'), /permis/i)
})
