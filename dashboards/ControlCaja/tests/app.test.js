import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { crearApp } from '../server/app.js'
import { parsearReporte } from '../server/reporte-parse.js'

const LINEAS = [
  '03/06/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|100.00|.00|100.00',
  '03/06/2026 0:00:00|003|4.1.001.01.001 - Venta|.00|100.00|-100.00',
  '04/06/2026 0:00:00|020|4.2.002.01.050 - Diferencias de Caja|.00|500.00|-500.00',
  '01/07/2026 0:00:00|003|4.1.001.01.001 - Venta|.00|50.00|-50.00'
].join('\n')

// Cache falsa: los tests de API no deben depender de la UNC.
function cacheFake({ falla = null } = {}) {
  return {
    obtener: () => {
      if (falla) return { ok: false, code: falla, message: 'la red no responde' }
      const { registros, descartadas } = parsearReporte(LINEAS)
      return { ok: true, registros, descartadas, archivo: { mtimeMs: 1717430000000, size: 123 }, parseos: 1 }
    }
  }
}

let server, base

before(async () => {
  const app = crearApp({ cache: cacheFake(), nombres: { '003': 'Centro' }, dirname: process.cwd() })
  server = app.listen(0)
  await new Promise(r => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => server?.close())

test('GET /api/empresas devuelve el registro', async () => {
  const r = await fetch(`${base}/api/empresas`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.empresas.map(e => e.clave), ['TESI', 'PUEBLO'])
})

test('GET /api/periodos devuelve meses, frescura y descartadas', async () => {
  const r = await fetch(`${base}/api/periodos?empresa=TESI`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.periodos, ['2026-06', '2026-07'])
  assert.equal(j.archivo.mtimeMs, 1717430000000)
  assert.equal(j.descartadas, 0)
})

test('GET /api/matriz devuelve la matriz del periodo con nombres', async () => {
  const r = await fetch(`${base}/api/matriz?empresa=TESI&periodo=2026-06`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.dias, ['03', '04'])
  const s003 = j.sucursales.find(s => s.codigo === '003')
  assert.equal(s003.nombre, 'Centro')
  assert.equal(s003.dias['03'], 100)
  assert.equal(j.resumen.faltantes, 100)
  assert.equal(j.resumen.sobrantes, -500)
})

test('GET /api/asiento devuelve las lineas del dia+sucursal', async () => {
  const r = await fetch(`${base}/api/asiento?empresa=TESI&fecha=2026-06-03&sucursal=003`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.lineas.length, 2)
  assert.equal(j.cuadra, true)
  assert.equal(j.lineas.find(l => l.esDiferenciaCaja).cuentaCodigo, '4.2.002.01.050')
})

test('empresa desconocida da 400, nunca un fallback silencioso a TESI', async () => {
  for (const ruta of ['/api/periodos?empresa=INDO', '/api/matriz?empresa=INDO&periodo=2026-06',
                      '/api/asiento?empresa=INDO&fecha=2026-06-03&sucursal=003']) {
    const r = await fetch(`${base}${ruta}`)
    assert.equal(r.status, 400, ruta)
    assert.match((await r.json()).message, /INDO/)
  }
})

test('falta el parametro empresa: 400', async () => {
  const r = await fetch(`${base}/api/matriz?periodo=2026-06`)
  assert.equal(r.status, 400)
})

test('periodo con formato invalido da 400', async () => {
  const r = await fetch(`${base}/api/matriz?empresa=TESI&periodo=junio`)
  assert.equal(r.status, 400)
  assert.match((await r.json()).message, /per[ií]odo/i)
})

test('fecha con formato invalido en asiento da 400', async () => {
  const r = await fetch(`${base}/api/asiento?empresa=TESI&fecha=03/06/2026&sucursal=003`)
  assert.equal(r.status, 400)
  assert.match((await r.json()).message, /fecha/i)
})

test('un periodo sin datos da 200 con matriz vacia, no 404', async () => {
  // Distinguir "no hay datos para este mes" de "no se pudo leer" importa: son
  // dos problemas distintos con dos acciones distintas.
  const r = await fetch(`${base}/api/matriz?empresa=TESI&periodo=2026-01`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.sucursales, [])
  assert.equal(j.resumen.diasTotales, 0)
})

test('sucursal con formato invalido en asiento da 400', async () => {
  for (const sucursal of ['99', 'abc']) {
    const r = await fetch(`${base}/api/asiento?empresa=TESI&fecha=2026-06-03&sucursal=${sucursal}`)
    assert.equal(r.status, 400, sucursal)
    assert.match((await r.json()).message, /sucursal/i)
  }
})

test('una ruta /api/* desconocida da 404 JSON, no el index de la SPA', async () => {
  // Sin esto, el catch-all de la SPA devolvia 200 con index.html: el cliente
  // esperaba JSON y `res.json()` tiraba "Unexpected token '<'" — un 404 real
  // disfrazado de un error de parseo.
  const r = await fetch(`${base}/api/rutaInexistente`)
  assert.equal(r.status, 404)
  const j = await r.json()
  assert.match(j.message, /no encontrada/i)
})

test('una ruta que no es /api sigue cayendo en el index de la SPA', async () => {
  const r = await fetch(`${base}/alguna/ruta/del/portal`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') ?? '', /html/)
})

test('si la UNC falla, la API responde 503 con el motivo', async () => {
  const app = crearApp({ cache: cacheFake({ falla: 'ETIMEDOUT' }), nombres: {}, dirname: process.cwd() })
  const s = app.listen(0)
  await new Promise(r => s.once('listening', r))
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/periodos?empresa=TESI`)
    assert.equal(r.status, 503)
    const j = await r.json()
    assert.equal(j.code, 'ETIMEDOUT')
    assert.match(j.message, /no responde/)
  } finally {
    s.close()
  }
})
