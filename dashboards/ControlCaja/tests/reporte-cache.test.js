import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearCache } from '../server/reporte-cache.js'

// Doble de la UNC: controla mtime/size y cuenta lecturas.
function fakeUNC(inicial) {
  const estado = { ...inicial, lecturas: 0 }
  return {
    estado,
    stat: () => estado.error
      ? { ok: false, code: estado.error, message: 'x' }
      : { ok: true, mtimeMs: estado.mtimeMs, size: estado.texto.length },
    leer: () => {
      if (estado.error) return { ok: false, code: estado.error, message: 'x' }
      estado.lecturas++
      return { ok: true, texto: estado.texto }
    }
  }
}

const LINEA = '03/06/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|100.00|.00|100.00'

test('el primer obtener lee y parsea', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  const r = cache.obtener('TESI')
  assert.equal(r.ok, true)
  assert.equal(r.registros.length, 1)
  assert.equal(unc.estado.lecturas, 1)
})

test('un segundo obtener con el mismo mtime y size no vuelve a leer', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  cache.obtener('TESI')
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 1)
  assert.equal(r.parseos, 1)
})

test('si cambia el mtime, reparsea', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  cache.obtener('TESI')
  unc.estado.mtimeMs = 2000
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 2)
  assert.equal(r.parseos, 2)
})

test('si cambia el size con el mismo mtime, reparsea', () => {
  // Una reescritura rapida puede dejar el mismo mtime segun el sistema de
  // archivos; el size lo detecta.
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  cache.obtener('TESI')
  unc.estado.texto = LINEA + '\n' + LINEA
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 2)
  assert.equal(r.registros.length, 2)
})

test('cada empresa tiene su propia entrada', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  cache.obtener('TESI')
  cache.obtener('PUEBLO')
  assert.equal(unc.estado.lecturas, 2)
})

test('un error de la UNC se devuelve tipificado y con mensaje legible', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA, error: 'ENOENT' })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  const r = cache.obtener('TESI')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
  assert.match(r.message, /no dejó el archivo/)
})

test('un error NO deja cacheado el fallo: el proximo intento reintenta', () => {
  // Si cacheara el error, un corte momentaneo de red dejaria el dashboard
  // roto hasta reiniciar el servicio.
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA, error: 'ETIMEDOUT' })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  assert.equal(cache.obtener('TESI').ok, false)
  unc.estado.error = null
  assert.equal(cache.obtener('TESI').ok, true)
})

test('una empresa desconocida lanza (es un bug del llamador, no un caso de datos)', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer })
  assert.throws(() => cache.obtener('INDO'), /INDO/)
})
