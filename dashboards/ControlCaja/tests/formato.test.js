import { test } from 'node:test'
import assert from 'node:assert/strict'
// Import directo del .ts: Node (24+) hace type-stripping nativo de TypeScript
// simple sin build ni flag. No hay logica especifica de tipos aca (solo
// anotaciones), asi que el archivo corre igual que si fuera .js.
import {
  formatoImporte, formatoImporteCorto, formatoMes, formatoFechaLarga,
  formatoFrescura, calcularEscala, nivelDeCelda, estiloDeCelda
} from '../src/lib/formato.ts'

test('formatoImporte usa separador de miles y coma decimal (es-AR)', () => {
  assert.equal(formatoImporte(1234.5), '1.234,50')
  assert.equal(formatoImporte(0), '0,00')
  assert.equal(formatoImporte(-500.1), '-500,10')
})

test('formatoImporteCorto redondea a k y M con el signo afuera', () => {
  assert.equal(formatoImporteCorto(23200), '23k')
  assert.equal(formatoImporteCorto(-23200), '-23k')
  assert.equal(formatoImporteCorto(3518349.98), '3.5M')
  assert.equal(formatoImporteCorto(500), '500')
  assert.equal(formatoImporteCorto(-500), '-500')
})

test('formatoImporteCorto no redondea una diferencia de centavos a "0"', () => {
  // El umbral de cero del proyecto es medio centavo: una celda pintada con un
  // valor real pero menor a $1 no puede leerse como si dijera "0".
  assert.equal(formatoImporteCorto(0.5), '<1')
  assert.equal(formatoImporteCorto(-0.5), '-<1')
})

test('formatoMes parte el string sin pasar por Date', () => {
  assert.equal(formatoMes('2026-06'), 'junio 2026')
  assert.equal(formatoMes('2026-01'), 'enero 2026')
  assert.equal(formatoMes('2026-12'), 'diciembre 2026')
})

test('formatoFechaLarga parte el string sin pasar por Date', () => {
  // El caso que importa: si esto pasara por new Date('2026-06-01') sin hora,
  // en UTC-3 el resultado corre al 31 de mayo. Comparar contra el string
  // evita ese corrimiento de raiz.
  assert.equal(formatoFechaLarga('2026-06-01'), '1 de junio de 2026')
  assert.equal(formatoFechaLarga('2026-06-03'), '3 de junio de 2026')
  assert.equal(formatoFechaLarga('2026-12-31'), '31 de diciembre de 2026')
})

test('formatoFrescura usa Date porque mtimeMs es un instante real, no una fecha de negocio', () => {
  const iso = new Date('2026-06-03T10:30:00').getTime()
  const texto = formatoFrescura(iso)
  assert.match(texto, /03\/06\/2026/)
  assert.match(texto, /10:30/)
})

test('calcularEscala usa percentiles sobre el valor absoluto', () => {
  // Con faltantes y sobrantes mezclados, la escala tiene que compartir una sola
  // nocion de "grande" entre los dos brazos (por eso abs antes de ordenar).
  const escala = calcularEscala([100, -3000000, 500, -200])
  assert.equal(escala.p50, 500)
  assert.equal(escala.p90, 3000000)
})

test('calcularEscala ignora los ceros: una celda vacia no cuenta como "chica"', () => {
  const escala = calcularEscala([0, 0, 1000])
  assert.equal(escala.p50, 1000)
  assert.equal(escala.p90, 1000)
})

test('calcularEscala con lista vacia no divide por cero ni da NaN', () => {
  const escala = calcularEscala([])
  assert.deepEqual(escala, { p50: 0, p90: 0 })
  assert.equal(Number.isNaN(escala.p50), false)
})

test('nivelDeCelda ubica el valor en 1, 2 o 3 segun la escala', () => {
  const escala = { p50: 100, p90: 1000 }
  assert.equal(nivelDeCelda(50, escala), 1)
  assert.equal(nivelDeCelda(100, escala), 2)
  assert.equal(nivelDeCelda(500, escala), 2)
  assert.equal(nivelDeCelda(1000, escala), 3)
  assert.equal(nivelDeCelda(-1000, escala), 3)   // el nivel no depende del signo
})

test('nivelDeCelda con escala degenerada (p50 === p90): el nivel 2 queda inalcanzable', () => {
  // Documentado, no corregido aca: con exactamente dos celdas no nulas del
  // mismo mes, calcularEscala da p50 === p90 (ambas caen en el percentil alto),
  // y todo valor >= ese punto salta directo a nivel 3. Es cosmetico (solo la
  // intensidad del color, nunca el importe mostrado) y quedo deferred en el
  // review final de la rama. Este test fija el comportamiento actual para que
  // un cambio futuro sea deliberado, no un descubrimiento accidental.
  const escala = calcularEscala([100, 200])
  assert.equal(escala.p50, escala.p90)
  assert.equal(nivelDeCelda(100, escala), 1)
  assert.equal(nivelDeCelda(200, escala), 3)   // nunca 2: el escalon queda vacio
})

test('estiloDeCelda mapea faltante a rojo y sobrante a azul, nunca al reves', () => {
  const escala = { p50: 100, p90: 1000 }
  const faltante = estiloDeCelda(500, escala)
  const sobrante = estiloDeCelda(-500, escala)
  assert.equal(faltante.backgroundColor, 'var(--falt-2)')
  assert.equal(sobrante.backgroundColor, 'var(--sobr-2)')
  assert.notEqual(faltante.backgroundColor, sobrante.backgroundColor)
})

test('estiloDeCelda escala la variable de color junto con el nivel', () => {
  const escala = { p50: 100, p90: 1000 }
  assert.equal(estiloDeCelda(50, escala).backgroundColor, 'var(--falt-1)')
  assert.equal(estiloDeCelda(1000, escala).backgroundColor, 'var(--falt-3)')
})
