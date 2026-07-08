import 'dotenv/config'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT || '3008')
const SAP_SOURCE_PATH = process.env.SAP_SOURCE_PATH || '\\\\10.0.0.115\\Cegid'
const FILE_PUEBLO = 'SAP_PU_RESULT.txt'
const FILE_TESI = 'SAP_RESULT.txt'
const PROCESSED_SUBDIR = 'SAPResultProcesado'
const CACHE_FILE = path.join(__dirname, 'data-cache', 'latest.json')
const CHECK_HOUR = parseInt(process.env.CHECK_HOUR || '1')

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

function moveToProcessed(srcPath, filename) {
  try {
    const destDir = path.join(SAP_SOURCE_PATH, PROCESSED_SUBDIR)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    fs.renameSync(srcPath, path.join(destDir, `${ts}_${filename}`))
    console.log(`[EstadoResultado] Archivado: ${filename} → ${PROCESSED_SUBDIR}`)
  } catch (e) {
    console.error(`[EstadoResultado] Error archivando ${filename}:`, e.message)
  }
}

async function checkAndLoad() {
  if (state.isRefreshing) return
  state.isRefreshing = true
  state.lastCheckAt = new Date().toISOString()
  let loaded = false

  const files = [
    { key: 'pueblo', filename: FILE_PUEBLO },
    { key: 'tesi', filename: FILE_TESI }
  ]

  for (const { key, filename } of files) {
    const srcPath = path.join(SAP_SOURCE_PATH, filename)
    try {
      if (!fs.existsSync(srcPath)) continue
      const content = fs.readFileSync(srcPath, 'utf8')
      const records = parseFile(content)
      if (records.length === 0) continue
      state[key] = records
      if (!state.periodo) state.periodo = extractPeriodo(records)
      console.log(`[EstadoResultado] ${key.toUpperCase()}: ${records.length} registros cargados`)
      moveToProcessed(srcPath, filename)
      loaded = true
    } catch (e) {
      console.error(`[EstadoResultado] Error leyendo ${filename}:`, e.message)
    }
  }

  if (loaded) {
    state.lastUpdate = new Date().toISOString()
    saveCache()
  } else {
    console.log('[EstadoResultado] Sin archivos nuevos en', SAP_SOURCE_PATH)
  }

  state.isRefreshing = false
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
  res.json({
    lastUpdate: state.lastUpdate,
    lastCheckAt: state.lastCheckAt,
    isRefreshing: state.isRefreshing,
    pueblo: { loaded: !!state.pueblo, count: state.pueblo?.length ?? 0 },
    tesi: { loaded: !!state.tesi, count: state.tesi?.length ?? 0 },
    sourcePath: SAP_SOURCE_PATH
  })
})

app.post('/api/refresh', (req, res) => {
  if (state.isRefreshing) return res.json({ ok: true, message: 'Actualización ya en curso' })
  checkAndLoad()
  res.json({ ok: true, message: 'Chequeo iniciado' })
})

app.post('/api/upload', (req, res) => {
  upload.array('files', 2)(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, message: err.message })
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ ok: false, message: 'No se recibieron archivos' })
    }
    const nombres = req.files.map(f => f.originalname)
    console.log(`[EstadoResultado] Archivos subidos manualmente: ${nombres.join(', ')}`)
    await checkAndLoad()
    res.json({ ok: true, message: `Procesados: ${nombres.join(', ')}` })
  })
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

loadCache()
await checkAndLoad()
scheduleDailyCheck()

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1'
app.listen(PORT, HOST, () => {
  console.log(`[EstadoResultado] Escuchando en http://${HOST}:${PORT}`)
  console.log(`[EstadoResultado] Fuente SAP: ${SAP_SOURCE_PATH}`)
})
