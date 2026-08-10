import express from 'express'
import path from 'node:path'
import { listaDeEmpresas, normalizarClave } from './empresas.js'
import { construirMatriz, construirAsiento, periodosDisponibles } from './control-caja.js'

const RE_PERIODO = /^\d{4}-\d{2}$/
const RE_FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/
const RE_SUCURSAL = /^\d{3}$/

/**
 * Rutas del dashboard. Todas GET: este tablero no escribe nada, ni en la red ni
 * en disco. Se separa de server.js (que hace el listen) para que los tests
 * levanten la app en un puerto efimero con una cache inyectada, sin depender de
 * la UNC ni del servicio real.
 */
export function crearApp({ cache, nombres = {}, dirname }) {
  const app = express()
  app.use(express.static(path.join(dirname, 'dist')))

  // Resuelve empresa + datos, o responde el error y devuelve null. Concentra
  // aca las dos respuestas de error (400 empresa / 503 red) para que las tres
  // rutas de datos no las repitan y no se desalineen entre si.
  function datosDe(req, res) {
    const clave = normalizarClave(req.query.empresa)
    if (!clave) {
      res.status(400).json({ ok: false, message: `Empresa desconocida: ${req.query.empresa ?? '(sin especificar)'}` })
      return null
    }
    const r = cache.obtener(clave)
    if (!r.ok) {
      // 503, no 500: el dashboard esta bien, la fuente no esta disponible.
      res.status(503).json({ ok: false, code: r.code, message: r.message })
      return null
    }
    return { clave, ...r }
  }

  app.get('/api/empresas', (req, res) => {
    res.json({ empresas: listaDeEmpresas() })
  })

  app.get('/api/periodos', (req, res) => {
    const d = datosDe(req, res)
    if (!d) return
    res.json({
      empresa: d.clave,
      periodos: periodosDisponibles(d.registros),
      archivo: d.archivo,
      descartadas: d.descartadas,
      fuente: d.fuente,
      avisoRed: d.avisoRed ?? null
    })
  })

  app.get('/api/matriz', (req, res) => {
    const d = datosDe(req, res)
    if (!d) return
    const periodo = String(req.query.periodo ?? '')
    if (!RE_PERIODO.test(periodo)) {
      return res.status(400).json({ ok: false, message: `Período inválido: "${periodo}" (se espera YYYY-MM)` })
    }
    res.json({
      empresa: d.clave,
      archivo: d.archivo,
      descartadas: d.descartadas,
      fuente: d.fuente,
      avisoRed: d.avisoRed ?? null,
      ...construirMatriz(d.registros, periodo, nombres)
    })
  })

  app.get('/api/asiento', (req, res) => {
    const d = datosDe(req, res)
    if (!d) return
    const fecha = String(req.query.fecha ?? '')
    if (!RE_FECHA_ISO.test(fecha)) {
      return res.status(400).json({ ok: false, message: `Fecha inválida: "${fecha}" (se espera YYYY-MM-DD)` })
    }
    const sucursal = String(req.query.sucursal ?? '')
    if (!RE_SUCURSAL.test(sucursal)) {
      return res.status(400).json({ ok: false, message: `Sucursal inválida: "${sucursal}" (se esperan 3 dígitos)` })
    }
    res.json({ empresa: d.clave, ...construirAsiento(d.registros, fecha, sucursal) })
  })

  // Una ruta /api/* que no matcheo ninguna de arriba: 404 JSON, no el index.
  // Sin esto caia en el catch-all de abajo, el cliente recibia HTML donde
  // esperaba JSON, y `res.json()` tiraba "Unexpected token '<'" — un error
  // real disfrazado de uno de parseo.
  app.get('/api/*', (req, res) => {
    res.status(404).json({ ok: false, message: `Ruta no encontrada: ${req.path}` })
  })

  // SPA: cualquier otra ruta sirve el index para que /d/16/ y los refrescos
  // dentro del iframe del portal no den 404.
  app.get('*', (req, res) => {
    res.sendFile(path.join(dirname, 'dist', 'index.html'))
  })

  return app
}
