import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { periodoDeLinea, splitIntoPeriodBlocks, serializeBlocks, EOL } from '../server/sap-format.js'

const L1 = '4.1.000.00.000|INGRESOS||.00|2026-01'
const L2 = '4.1.001.01.001|Venta|011 - Sportotal 11|-107029809.47|2026-01'
const L3 = '4.2.002.01.001|Sueldos|020 - Sportotal 20|58200.10|2026-02'

test('periodoDeLinea extrae el 5o campo', () => {
  assert.equal(periodoDeLinea(L1), '2026-01')
  assert.equal(periodoDeLinea(L3), '2026-02')
})

test('periodoDeLinea devuelve cadena vacia si falta el periodo', () => {
  assert.equal(periodoDeLinea('4.1.000.00.000|INGRESOS||.00'), '')
})

test('splitIntoPeriodBlocks agrupa por periodo preservando las lineas textuales', () => {
  const text = [L1, L2, L3].join(EOL) + EOL
  const blocks = splitIntoPeriodBlocks(text)
  assert.deepEqual([...blocks.keys()], ['2026-01', '2026-02'])
  assert.deepEqual(blocks.get('2026-01'), [L1, L2])
  assert.deepEqual(blocks.get('2026-02'), [L3])
})

test('splitIntoPeriodBlocks ignora lineas vacias', () => {
  const text = [L1, '', L3, ''].join(EOL)
  const blocks = splitIntoPeriodBlocks(text)
  assert.deepEqual(blocks.get('2026-01'), [L1])
  assert.deepEqual(blocks.get('2026-02'), [L3])
})

test('splitIntoPeriodBlocks agrupa las lineas sin periodo bajo la clave vacia', () => {
  const sinPeriodo = '4.1.000.00.000|INGRESOS||.00'
  const blocks = splitIntoPeriodBlocks([sinPeriodo, L3].join(EOL) + EOL)
  assert.deepEqual(blocks.get(''), [sinPeriodo])
})

test('serializeBlocks ordena periodos ascendente y cierra con CRLF', () => {
  const blocks = new Map([['2026-02', [L3]], ['2026-01', [L1, L2]]])
  assert.equal(serializeBlocks(blocks), [L1, L2, L3].join(EOL) + EOL)
})

test('serializeBlocks de un mapa vacio devuelve cadena vacia', () => {
  assert.equal(serializeBlocks(new Map()), '')
})

// EL test que garantiza la igualdad byte a byte del circuito completo.
// Solo valida archivos con el formato que emite SAP (CRLF y CRLF final): en
// SAPResultProcesado\ tambien se archivan los que sube un usuario, que pueden venir
// con LF si los editó con otra herramienta. Esos se saltean en lugar de dar falso positivo.
test('round-trip byte-exacto contra los archivos SAP reales', () => {
  const dir = path.join(import.meta.dirname, '..', 'sap-inbox', 'SAPResultProcesado')
  const candidatos = fs.readdirSync(dir).filter(f => f.endsWith('.txt'))
  let validados = 0
  for (const f of candidatos) {
    const original = fs.readFileSync(path.join(dir, f), 'utf8')
    const formatoSAP = original.endsWith('\r\n') && !/(^|[^\r])\n/.test(original)
    if (!formatoSAP) continue
    assert.equal(serializeBlocks(splitIntoPeriodBlocks(original)), original, `round-trip no exacto para ${f}`)
    validados++
  }
  assert.ok(validados > 0, 'no se encontro ningun archivo en formato SAP para validar el round-trip')
})
