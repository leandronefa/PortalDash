import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createStore, EMPRESAS } from '../server/sap-store.js'
import { EOL } from '../server/sap-format.js'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapstore-'))
  return createStore({ dir })
}

const ENE_SAP = '4.1.001.01.001|Venta|011|-100.00|2026-01'
const FEB_SAP = '4.1.001.01.001|Venta|011|-200.00|2026-02'
const MAR_SAP = '4.1.001.01.001|Venta|011|-300.00|2026-03'
const FEB_AJUSTADO = '4.1.001.01.001|Venta|011|-999.99|2026-02'

const txt = (...lines) => lines.join(EOL) + EOL

test('EMPRESAS mapea las claves a los nombres de archivo de SAP', () => {
  assert.equal(EMPRESAS.tesi, 'SAP_RESULT.txt')
  assert.equal(EMPRESAS.pueblo, 'SAP_PU_RESULT.txt')
})

test('merge inicial desde sap guarda el vigente igual al entrante', () => {
  const store = tmpStore()
  const entrante = txt(ENE_SAP, FEB_SAP)
  const r = store.merge({ empresaKey: 'tesi', texto: entrante, origen: 'sap' })
  assert.deepEqual(r.traidos, ['2026-01', '2026-02'])
  assert.deepEqual(r.preservados, [])
  assert.equal(store.readVigente('tesi'), entrante)
})

test('readVigente devuelve null si no hay nada cargado', () => {
  assert.equal(tmpStore().readVigente('pueblo'), null)
})

test('el manifest registra el origen de cada periodo', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP), origen: 'sap' })
  const m = store.readManifest()
  assert.equal(m.tesi['2026-01'].origen, 'sap')
  assert.ok(m.tesi['2026-01'].cargadoEn, 'falta cargadoEn')
})

test('un upload manual pisa el periodo y lo marca manual', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  const r = store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })
  assert.deepEqual(r.traidos, ['2026-02'])
  assert.equal(store.readManifest().tesi['2026-02'].origen, 'manual')
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP, FEB_AJUSTADO))
})

// LA regla de negocio central del spec.
test('una lectura de red NO pisa un periodo manual, pero si trae los nuevos', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })

  const r = store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP, MAR_SAP), origen: 'sap' })

  assert.deepEqual(r.preservados, ['2026-02'], 'febrero ajustado debia preservarse')
  assert.deepEqual(r.traidos, ['2026-01', '2026-03'])
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP, FEB_AJUSTADO, MAR_SAP))
  assert.equal(store.readManifest().tesi['2026-02'].origen, 'manual')
  assert.equal(store.readManifest().tesi['2026-03'].origen, 'sap')
})

test('refrescar dos veces desde sap es idempotente', () => {
  const store = tmpStore()
  const entrante = txt(ENE_SAP, FEB_SAP)
  store.merge({ empresaKey: 'tesi', texto: entrante, origen: 'sap' })
  store.merge({ empresaKey: 'tesi', texto: entrante, origen: 'sap' })
  assert.equal(store.readVigente('tesi'), entrante)
})

test('un upload manual reemplaza un periodo ya ajustado', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })
  const otro = '4.1.001.01.001|Venta|011|-111.11|2026-02'
  store.merge({ empresaKey: 'tesi', texto: txt(otro), origen: 'manual' })
  assert.equal(store.readVigente('tesi'), txt(otro))
})

test('las empresas no se contaminan entre si', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'pueblo', texto: txt(FEB_SAP), origen: 'manual' })
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP))
  assert.equal(store.readVigente('pueblo'), txt(FEB_SAP))
  assert.equal(store.readManifest().tesi['2026-02'], undefined)
})

test('periodos devuelve todos los periodos del vigente, no solo los del entrante', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  const r = store.merge({ empresaKey: 'tesi', texto: txt(MAR_SAP), origen: 'sap' })
  assert.deepEqual(r.periodos, ['2026-01', '2026-02', '2026-03'])
})

test('un manifest.json corrupto hace fallar readManifest en vez de devolver uno vacio', () => {
  const store = tmpStore()
  fs.writeFileSync(path.join(store.dir, 'manifest.json'), '{ esto no es json')
  assert.throws(() => store.readManifest())
})

test('con un periodo manual y el manifest corrupto, un refresh de red no llega a pisar el vigente', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })
  const vigenteAntes = store.readVigente('tesi')
  fs.writeFileSync(path.join(store.dir, 'manifest.json'), '{ esto no es json')

  assert.throws(() => store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' }))

  assert.equal(store.readVigente('tesi'), vigenteAntes)
})
