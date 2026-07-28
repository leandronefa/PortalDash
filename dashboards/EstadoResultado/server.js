import 'dotenv/config'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { createStore, EMPRESAS } from './server/sap-store.js'
import { leerArchivoDeRed, descripcionDeError } from './server/sap-network.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT || '3008')
const SAP_SOURCE_PATH = process.env.SAP_SOURCE_PATH || '\\\\10.0.0.115\\Cegid'
// Ruta de red READ-ONLY donde SAP deja los archivos una vez por mes.
const SAP_NETWORK_PATH = process.env.SAP_NETWORK_PATH || '\\\\10.0.0.115\\Cegid'
const FILE_PUEBLO = 'SAP_PU_RESULT.txt'
const FILE_TESI = 'SAP_RESULT.txt'
const PROCESSED_SUBDIR = 'SAPResultProcesado'
const CACHE_FILE = path.join(__dirname, 'data-cache', 'latest.json')
const CHECK_HOUR = parseInt(process.env.CHECK_HOUR || '1')
const store = createStore({ dir: path.join(__dirname, 'data-store') })

const state = {
  pueblo: null,
  tesi: null,
  periodo: null,   // e.g. "2026-05" extraído del 5° campo del archivo
  lastUpdate: null,
  lastCheckAt: null,
  isRefreshing: false
}

function parseFile(content) {
  return content
    .replace(/\r/g, '')
    .split('\n')
    .filter(l => l.trim() && l.includes('|'))
    .map(line => {
      const parts = line.split('|')
      if (parts.length < 4) return null
      const valor = parseFloat(parts[3].trim())
      if (isNaN(valor)) return null
      return {
        cuenta: parts[0].trim(),
        descripcion: parts[1].trim(),
        sucursal: parts[2].trim(),
        valor,
        periodo: parts[4]?.trim() || null   // "YYYY-MM" opcional
      }
    })
    .filter(Boolean)
}

function extractPeriodo(records) {
  const p = records.find(r => r.periodo)?.periodo
  return p || null
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
      state.pueblo = data.pueblo
      state.tesi = data.tesi
      state.periodo = data.periodo ?? null
      state.lastUpdate = data.lastUpdate
      console.log('[EstadoResultado] Cache cargado:', new Date(data.lastUpdate).toLocaleString('es-AR'))
    }
  } catch (e) {
    console.error('[EstadoResultado] Error leyendo cache:', e.message)
  }
}

function saveCache() {
  try {
    const dir = path.dirname(CACHE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      pueblo: state.pueblo,
      tesi: state.tesi,
      periodo: state.periodo,
      lastUpdate: state.lastUpdate
    }))
  } catch (e) {
    console.error('[EstadoResultado] Error guardando cache:', e.message)
  }
}

// Archivado del historico (reemplaza moveToProcessed, que movia archivos desde
// la red; ahora la red es read-only y nunca se le escribe ni se le borra nada).
function archivarTexto(texto, filename) {
  try {
    const destDir = path.join(SAP_SOURCE_PATH, PROCESSED_SUBDIR)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    fs.writeFileSync(path.join(destDir, `${ts}_${filename}`), texto, 'utf8')
  } catch (e) {
    console.error(`[EstadoResultado] Error archivando ${filename}:`, e.message)
  }
}

// Reparseo del estado en memoria desde el vigente (unica fuente de verdad).
function recargarEstadoDesdeStore() {
  for (const key of Object.keys(EMPRESAS)) {
    const texto = store.readVigente(key)
    if (!texto) continue
    const records = parseFile(texto)
    if (records.length > 0) state[key] = records
  }
  state.periodo = extractPeriodo(state.tesi ?? state.pueblo ?? [])
  state.lastUpdate = new Date().toISOString()
  saveCache()
}

// Migracion al primer arranque: si data-store/ esta vacio, siembra con el
// archivo mas reciente de cada empresa en SAPResultProcesado/, como origen 'sap'.
function migrarSiHaceFalta() {
  const destDir = path.join(SAP_SOURCE_PATH, PROCESSED_SUBDIR)
  if (!fs.existsSync(destDir)) return
  for (const [key, filename] of Object.entries(EMPRESAS)) {
    if (store.readVigente(key)) continue
    const candidatos = fs.readdirSync(destDir).filter(f => f.endsWith(`_${filename}`)).sort()
    const ultimo = candidatos[candidatos.length - 1]
    if (!ultimo) continue
    const texto = fs.readFileSync(path.join(destDir, ultimo), 'utf8')
    try {
      const r = store.merge({ empresaKey: key, texto, origen: 'sap' })
      console.log(`[EstadoResultado] Migrado ${key.toUpperCase()} desde ${ultimo}: ${r.traidos.length} periodos`)
    } catch (e) {
      // manifest.json corrupto: store.merge() lee el manifest ANTES de escribir
      // nada, asi que si tira excepcion no se perdio ni se piso nada en disco.
      // Logueamos fuerte y NO migramos esta empresa; el arranque sigue igual
      // (mas abajo checkAndLoad() vuelve a intentar leer el manifest y aborta
      // el refresh de red de la misma forma si sigue corrupto).
      console.error(`[EstadoResultado] ######## MANIFEST.JSON CORRUPTO — no se pudo migrar ${key.toUpperCase()}: ${e.message} ########`)
    }
  }
}

// Refresh desde la red (reemplaza checkAndLoad de la version anterior, que leia
// del inbox local). El inbox local (SAP_SOURCE_PATH) queda solo como zona de
// paso para los uploads manuales.
async function checkAndLoad() {
  if (state.isRefreshing) return { ok: false, empresas: {} }
  state.isRefreshing = true
  state.lastCheckAt = new Date().toISOString()
  const empresas = {}

  try {
    // Manifest corrupto: abortamos el refresh completo ANTES de leer un solo
    // archivo de la red. store.merge() tambien lee el manifest y tiraria la
    // misma excepcion a mitad de la primera empresa que tocara; preferimos
    // detectarlo aca y devolver el error en el resultado (para que el llamador
        // -el endpoint o el scheduler diario- lo vea) en vez de dejar el proceso
    // con una excepcion sin capturar y, peor, con una empresa actualizada y la
    // otra no. La garantia que no se negocia es que ningun refresh de red puede
    // pisar un periodo 'manual', y con el manifest ilegible no hay forma de
    // saber cuales son esos periodos, asi que no se toca nada.
    let manifestError = null
    try {
      store.readManifest()
    } catch (e) {
      manifestError = e.message
    }
    if (manifestError) {
      console.error(`[EstadoResultado] Refresh abortado, manifest.json corrupto: ${manifestError}`)
      for (const key of Object.keys(EMPRESAS)) {
        empresas[key] = { ok: false, origen: null, traidos: [], preservados: [], error: `manifest.json corrupto: ${manifestError}` }
      }
      return { ok: false, empresas }
    }

    for (const [key, filename] of Object.entries(EMPRESAS)) {
      const leido = leerArchivoDeRed(SAP_NETWORK_PATH, filename)
      if (!leido.ok) {
        console.error(`[EstadoResultado] ${filename}: ${leido.code} — ${descripcionDeError(leido.code)}`)
        empresas[key] = { ok: false, origen: null, traidos: [], preservados: [], error: descripcionDeError(leido.code) }
        continue
      }
      const r = store.merge({ empresaKey: key, texto: leido.texto, origen: 'sap' })
      archivarTexto(leido.texto, filename)
      console.log(`[EstadoResultado] ${key.toUpperCase()} desde red — traidos: [${r.traidos}] preservados: [${r.preservados}]`)
      empresas[key] = { ok: true, origen: 'red', traidos: r.traidos, preservados: r.preservados }
    }
    recargarEstadoDesdeStore()
  } finally {
    state.isRefreshing = false
  }

  return { ok: Object.values(empresas).some(e => e.ok), empresas }
}

// Procesar uploads del inbox (los periodos que traen pasan a 'manual').
//
// Comparte el flag state.isRefreshing con checkAndLoad() para evitar la
// carrera: si un usuario sube un archivo justo cuando el chequeo automatico de
// la 1am (u otro refresh) esta escribiendo el store, las dos escrituras
// podrian pisarse. Elegimos RECHAZAR el upload en vez de encolarlo/esperarlo:
// es la opcion mas facil de razonar (no hay cola, no hay que decidir orden) y
// el costo para el usuario es minimo, un reintento a los pocos segundos.
async function procesarUploads(nombres) {
  if (state.isRefreshing) {
    return {
      rejected: true,
      message: 'Hay una actualizacion automatica en curso, reintente en unos segundos',
      empresas: {}
    }
  }
  state.isRefreshing = true
  try {
    const empresas = {}
    for (const [key, filename] of Object.entries(EMPRESAS)) {
      if (!nombres.includes(filename)) continue
      const p = path.join(SAP_SOURCE_PATH, filename)
      if (!fs.existsSync(p)) continue
      const texto = fs.readFileSync(p, 'utf8')
      try {
        const r = store.merge({ empresaKey: key, texto, origen: 'manual' })
        archivarTexto(texto, filename)
        fs.unlinkSync(p)   // el inbox es zona de paso; el vigente ya vive en data-store
        empresas[key] = { ok: true, origen: 'manual', traidos: r.traidos, preservados: [] }
        console.log(`[EstadoResultado] ${key.toUpperCase()} manual — periodos marcados: [${r.traidos}]`)
      } catch (e) {
        // manifest.json corrupto: no borramos el archivo del inbox (queda para
        // reintentar cuando se arregle el manifest) y no tocamos el vigente.
        console.error(`[EstadoResultado] Error procesando upload manual de ${filename}:`, e.message)
        empresas[key] = { ok: false, origen: null, traidos: [], preservados: [], error: e.message }
      }
    }
    recargarEstadoDesdeStore()
    return { rejected: false, empresas }
  } finally {
    state.isRefreshing = false
  }
}

function scheduleDailyCheck() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(CHECK_HOUR, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  const delay = next - now
  const horas = Math.round(delay / 3600000)
  console.log(`[EstadoResultado] Próximo chequeo: ${next.toLocaleString('es-AR')} (en ~${horas}h)`)
  setTimeout(async () => {
    await checkAndLoad()
    scheduleDailyCheck()
  }, delay)
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(SAP_SOURCE_PATH)) fs.mkdirSync(SAP_SOURCE_PATH, { recursive: true })
      cb(null, SAP_SOURCE_PATH)
    },
    filename: (req, file, cb) => cb(null, file.originalname)
  }),
  fileFilter: (req, file, cb) => {
    if (file.originalname === FILE_PUEBLO || file.originalname === FILE_TESI) {
      cb(null, true)
    } else {
      cb(new Error(`Archivo no reconocido: "${file.originalname}". Se esperan: ${FILE_TESI} o ${FILE_PUEBLO}`))
    }
  }
})

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'dist')))

app.get('/api/data', (req, res) => {
  const empresa = String(req.query.empresa || 'TESI').toUpperCase()
  const records = empresa === 'PUEBLO' ? state.pueblo : state.tesi
  res.json({ empresa, records: records ?? null, periodo: state.periodo, lastUpdate: state.lastUpdate })
})

app.get('/api/status', (req, res) => {
  // readManifest() lanza si manifest.json existe pero no parsea. No dejamos
  // que ese error tumbe el endpoint (500 deja el dashboard sin poder mostrar
  // ni siquiera el estado actual): respondemos 200 igual, con manifest: null
  // y el detalle del problema en manifestError.
  let manifest = null
  let manifestError = null
  try {
    manifest = store.readManifest()
  } catch (e) {
    manifestError = e.message
  }
  res.json({
    lastUpdate: state.lastUpdate,
    lastCheckAt: state.lastCheckAt,
    isRefreshing: state.isRefreshing,
    pueblo: { loaded: !!state.pueblo, count: state.pueblo?.length ?? 0 },
    tesi: { loaded: !!state.tesi, count: state.tesi?.length ?? 0 },
    sourcePath: SAP_SOURCE_PATH,
    networkPath: SAP_NETWORK_PATH,
    manifest,
    manifestError
  })
})

app.post('/api/refresh', async (req, res) => {
  if (state.isRefreshing) return res.json({ ok: false, message: 'Actualización ya en curso', empresas: {} })
  const r = await checkAndLoad()
  res.json(r)
})

app.get('/api/download', (req, res) => {
  const empresa = String(req.query.empresa || 'TESI').toUpperCase()
  const key = empresa === 'PUEBLO' ? 'pueblo' : 'tesi'
  const filename = EMPRESAS[key]
  const p = store.vigentePath(key)
  if (!fs.existsSync(p)) {
    return res.status(404).json({ ok: false, message: `Todavía no hay datos cargados para ${empresa}` })
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  fs.createReadStream(p).pipe(res)
})

app.post('/api/upload', (req, res) => {
  upload.array('files', 2)(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, message: err.message })
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ ok: false, message: 'No se recibieron archivos' })
    }
    const nombres = req.files.map(f => f.originalname)
    const resultado = await procesarUploads(nombres)
    if (resultado.rejected) {
      return res.status(409).json({ ok: false, message: resultado.message })
    }
    const { empresas } = resultado
    const periodos = [...new Set(Object.values(empresas).flatMap(e => e.traidos ?? []))].sort()
    res.json({ ok: true, message: `Cargado con ajustes manuales: ${nombres.join(', ')} (${periodos.join(', ')})`, empresas })
  })
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

loadCache()
migrarSiHaceFalta()
recargarEstadoDesdeStore()
await checkAndLoad()
scheduleDailyCheck()

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1'
app.listen(PORT, HOST, () => {
  console.log(`[EstadoResultado] Escuchando en http://${HOST}:${PORT}`)
  console.log(`[EstadoResultado] Fuente SAP (inbox local, uploads manuales): ${SAP_SOURCE_PATH}`)
  console.log(`[EstadoResultado] Fuente SAP (red, solo lectura): ${SAP_NETWORK_PATH}`)
})
