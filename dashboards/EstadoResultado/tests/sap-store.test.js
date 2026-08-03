import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createStore, EMPRESAS, empresaKeyDesdeLabel, listaDeEmpresas } from '../server/sap-store.js'
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
  assert.equal(EMPRESAS.indo, 'SAP_INDO_RESULT.txt')
})

test('empresaKeyDesdeLabel resuelve la etiqueta de la UI y rechaza las desconocidas', () => {
  assert.equal(empresaKeyDesdeLabel('INDO'), 'indo')
  assert.equal(empresaKeyDesdeLabel('tesi'), 'tesi')
  assert.equal(empresaKeyDesdeLabel('PUEBLO'), 'pueblo')
  assert.equal(empresaKeyDesdeLabel('OTRA'), null)
  assert.equal(empresaKeyDesdeLabel(''), null)
})

test('listaDeEmpresas expone key, label y filename de todas', () => {
  const lista = listaDeEmpresas()
  assert.deepEqual(lista.map(e => e.key), ['tesi', 'pueblo', 'indo'])
  assert.deepEqual(lista.map(e => e.label), ['TESI', 'PUEBLO', 'INDO'])
  assert.deepEqual(lista.map(e => e.filename), ['SAP_RESULT.txt', 'SAP_PU_RESULT.txt', 'SAP_INDO_RESULT.txt'])
})

// Al agregar una empresa, los manifest ya escritos en disco no la tienen. Esa
// ausencia es legitima (todavia no se cargo nunca) y debe arrancar vacia, sin
// disparar el fallo ruidoso reservado para manifest ausente/corrupto.
test('un manifest sin la empresa nueva la arranca vacia en vez de fallar', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP), origen: 'sap' })
  const p = path.join(store.dir, 'manifest.json')
  const viejo = JSON.parse(fs.readFileSync(p, 'utf8'))
  delete viejo.indo
  fs.writeFileSync(p, JSON.stringify(viejo, null, 2))

  const m = store.readManifest()
  assert.deepEqual(m.indo, {})
  assert.equal(m.tesi['2026-01'].origen, 'sap')
})

// El circuito manual (descargar -> editar -> subir -> el refresh no lo pisa)
// tiene que valer igual para la empresa nueva que para las dos originales.
test('INDO conserva sus ajustes manuales frente a un refresh de red', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'indo', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'indo', texto: txt(FEB_AJUSTADO), origen: 'manual' })

  const r = store.merge({ empresaKey: 'indo', texto: txt(ENE_SAP, FEB_SAP, MAR_SAP), origen: 'sap' })

  assert.deepEqual(r.preservados, ['2026-02'])
  assert.deepEqual(r.traidos, ['2026-01', '2026-03'])
  assert.equal(store.readVigente('indo'), txt(ENE_SAP, FEB_AJUSTADO, MAR_SAP))
  assert.equal(store.readManifest().indo['2026-02'].origen, 'manual')
})

test('cargar INDO no toca los vigentes de TESI ni PUEBLO', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'pueblo', texto: txt(FEB_AJUSTADO), origen: 'manual' })
  store.merge({ empresaKey: 'indo', texto: txt(MAR_SAP), origen: 'sap' })

  assert.equal(store.readVigente('tesi'), txt(ENE_SAP))
  assert.equal(store.readVigente('pueblo'), txt(FEB_AJUSTADO))
  assert.equal(store.readVigente('indo'), txt(MAR_SAP))
  assert.equal(store.readManifest().pueblo['2026-02'].origen, 'manual')
  assert.equal(store.readManifest().indo['2026-03'].origen, 'sap')
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

test('primera corrida legitima: sin manifest y sin ningun vigente, readManifest devuelve vacio', () => {
  const store = tmpStore()
  assert.deepEqual(store.readManifest(), { tesi: {}, pueblo: {}, indo: {} })
})

test('manifest ausente pero con un vigente ya cargado hace fallar readManifest (no es primera corrida)', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })
  // Simula que se perdio/borro el manifest.json sin tocar el vigente.
  fs.rmSync(path.join(store.dir, 'manifest.json'))

  assert.throws(() => store.readManifest())
  // Y por lo tanto un refresh de red tampoco puede pisar el vigente en este estado.
  const vigenteAntes = store.readVigente('tesi')
  assert.throws(() => store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' }))
  assert.equal(store.readVigente('tesi'), vigenteAntes)
})

test('manifest.json que parsea pero no es un objeto plano (array, numero, string, null) hace fallar readManifest', () => {
  for (const valorInvalido of ['[]', '123', '"x"', 'null']) {
    const store = tmpStore()
    fs.writeFileSync(path.join(store.dir, 'manifest.json'), valorInvalido)
    assert.throws(() => store.readManifest(), undefined, `no lanzo para: ${valorInvalido}`)
  }
})

// CRITICAL 1 de la revision final (2026-07-28-estado-resultado-refresh-red-y-descarga):
// escenario del revisor. El manifest marca un periodo 'manual' pero el bloque
// correspondiente no esta en el vigente (vigente truncado/borrado/tocado desde
// afuera, o manifest adelantado al vigente por una interrupcion entre las dos
// escrituras). Antes del fix, esto hacia que el merge desde 'sap' descartara el
// periodo entrante (lo reportaba como "preservado") y el mes desaparecia para
// siempre. Ahora: sin bloque en el vigente no hay nada que preservar, se acepta
// el dato de la red y el periodo queda presente.
test('manifest marca un periodo manual sin bloque correspondiente en el vigente: el merge desde sap lo trae igual', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })

  // Simula el vigente truncado/tocado desde afuera: se pierde el bloque de
  // febrero (el 'manual'), el manifest queda intacto y sigue diciendo 'manual'.
  fs.writeFileSync(store.vigentePath('tesi'), txt(ENE_SAP))
  assert.equal(store.readManifest().tesi['2026-02'].origen, 'manual', 'precondicion: el manifest sigue marcando manual')

  const r = store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP, MAR_SAP), origen: 'sap' })

  assert.deepEqual(r.preservados, [], 'no hay nada que preservar: el bloque manual no existia')
  assert.deepEqual(r.traidos, ['2026-01', '2026-02', '2026-03'])
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP, FEB_SAP, MAR_SAP), 'febrero debe volver con el dato crudo de sap, no desaparecer')
  assert.deepEqual(r.periodos, ['2026-01', '2026-02', '2026-03'])
})

// Idem pero con el vigente completamente borrado (no solo truncado): mismo
// resultado, ningun periodo puede desaparecer por esto.
test('manifest marca periodos manual y el vigente entero desaparecio: el merge desde sap reconstruye todo', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })

  fs.rmSync(store.vigentePath('tesi'))
  assert.equal(store.readVigente('tesi'), null, 'precondicion: el vigente desaparecio')

  const r = store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })

  assert.deepEqual(r.preservados, [])
  assert.deepEqual(r.traidos, ['2026-01', '2026-02'])
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP, FEB_SAP))
})

// El fix atomico no debe cambiar el contenido final ni cuando el bloque
// manual SI existe: sigue preservandose (no es una regresion de la regla
// central del negocio, solo de su verificacion contra el vigente).
test('con el bloque manual presente en el vigente, sigue preservandose igual que antes', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  store.merge({ empresaKey: 'tesi', texto: txt(FEB_AJUSTADO), origen: 'manual' })

  const r = store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP, MAR_SAP), origen: 'sap' })

  assert.deepEqual(r.preservados, ['2026-02'])
  assert.equal(store.readVigente('tesi'), txt(ENE_SAP, FEB_AJUSTADO, MAR_SAP))
})

// El vigente se escribe con temporal + rename (igual que el manifest): no debe
// quedar ningun archivo .tmp huerfano en el store despues de un merge exitoso.
test('el vigente se escribe atomicamente: no quedan temporales huerfanos tras el merge', () => {
  const store = tmpStore()
  store.merge({ empresaKey: 'tesi', texto: txt(ENE_SAP, FEB_SAP), origen: 'sap' })
  const restantes = fs.readdirSync(store.dir).filter(f => f.endsWith('.tmp'))
  assert.deepEqual(restantes, [])
})
