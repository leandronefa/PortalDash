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

// Doble del store: en memoria, sin tocar disco. Mismo contrato que
// server/reporte-store.js (leer/merge), para que los tests de la cache no
// dependan del filesystem.
function fakeStore() {
  const porEmpresa = new Map()
  return {
    leer(clave) {
      const e = porEmpresa.get(clave)
      if (!e) return { periodos: [], registros: [], descartadas: 0, ultimaLecturaOk: null }
      const claves = [...e.periodos.keys()].sort()
      return {
        periodos: claves,
        registros: claves.flatMap(p => e.periodos.get(p)),
        descartadas: e.ultimaLecturaOk?.descartadas ?? 0,
        ultimaLecturaOk: e.ultimaLecturaOk
      }
    },
    merge(clave, registros, descartadas, statInfo) {
      const e = porEmpresa.get(clave) ?? { periodos: new Map() }
      const porPeriodo = new Map()
      for (const r of registros) {
        if (!porPeriodo.has(r.periodo)) porPeriodo.set(r.periodo, [])
        porPeriodo.get(r.periodo).push(r)
      }
      // Reemplaza entero cada periodo que vino en esta lectura, igual que
      // server/reporte-store.js: un periodo NO tocado en este merge conserva
      // lo que ya tenia.
      for (const [periodo, regs] of porPeriodo) e.periodos.set(periodo, regs)
      e.ultimaLecturaOk = { ...statInfo, en: 'x', descartadas }
      porEmpresa.set(clave, e)
      return this.leer(clave)
    }
  }
}

const LINEA = '03/06/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|100.00|.00|100.00'

test('el primer obtener lee de la red y devuelve fuente red', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  const r = cache.obtener('TESI')
  assert.equal(r.ok, true)
  assert.equal(r.fuente, 'red')
  assert.equal(r.registros.length, 1)
  assert.equal(unc.estado.lecturas, 1)
})

test('un segundo obtener con el mismo mtime y size no vuelve a leer la red', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  cache.obtener('TESI')
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 1)
  assert.equal(r.parseos, 1)
})

test('si cambia el mtime, reparsea', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  cache.obtener('TESI')
  unc.estado.mtimeMs = 2000
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 2)
  assert.equal(r.parseos, 2)
})

test('si cambia el size con el mismo mtime, reparsea', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  cache.obtener('TESI')
  unc.estado.texto = LINEA + '\n' + LINEA
  const r = cache.obtener('TESI')
  assert.equal(unc.estado.lecturas, 2)
  assert.equal(r.registros.length, 2)
})

test('cada empresa tiene su propia entrada', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  cache.obtener('TESI')
  cache.obtener('PUEBLO')
  assert.equal(unc.estado.lecturas, 2)
})

test('un error de red sin nada guardado todavia se devuelve tipificado y con mensaje legible', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA, error: 'ENOENT' })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  const r = cache.obtener('TESI')
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ENOENT')
  assert.match(r.message, /no dejó el archivo/)
})

test('un error de red CON datos ya guardados degrada a fuente store en vez de romper', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  const primero = cache.obtener('TESI')
  assert.equal(primero.fuente, 'red')

  unc.estado.error = 'EPERM'
  const segundo = cache.obtener('TESI')
  assert.equal(segundo.ok, true)
  assert.equal(segundo.fuente, 'store')
  assert.equal(segundo.registros.length, 1)
  assert.match(segundo.avisoRed, /permiso/)
})

test('un error NO deja cacheado el fallo: el proximo intento reintenta', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA, error: 'ETIMEDOUT' })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  assert.equal(cache.obtener('TESI').ok, false)
  unc.estado.error = null
  assert.equal(cache.obtener('TESI').ok, true)
})

test('una empresa desconocida lanza (es un bug del llamador, no un caso de datos)', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  assert.throws(() => cache.obtener('INDO'), /INDO/)
})

test('un periodo que sale de la ventana rodante de SAP se sigue viendo (viene del store)', () => {
  const unc = fakeUNC({ mtimeMs: 1000, texto: LINEA })
  const cache = crearCache({ networkPath: 'X', stat: unc.stat, leer: unc.leer, store: fakeStore() })
  cache.obtener('TESI')

  const LINEA_JULIO = '01/07/2026 0:00:00|003|4.2.002.01.050 - Diferencias de Caja|50.00|.00|50.00'
  unc.estado.texto = LINEA_JULIO
  unc.estado.mtimeMs = 2000
  const r = cache.obtener('TESI')

  assert.equal(r.fuente, 'red')
  const periodos = new Set(r.registros.map(x => x.periodo))
  assert.ok(periodos.has('2026-06'), 'junio (fuera de la ventana nueva) debe seguir presente')
  assert.ok(periodos.has('2026-07'))
})
