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
// Inbox local: zona de paso para los uploads manuales (multer escribe aca) y
// para el historico archivado. Default LOCAL a proposito: si faltara la env
// var, no puede terminar apuntando a la red (que es read-only) ni un upload
// ni el archivado — la fuente de la red vive solo en SAP_NETWORK_PATH.
const SAP_SOURCE_PATH = process.env.SAP_SOURCE_PATH || path.join(__dirname, 'sap-inbox')
// Ruta de red READ-ONLY donde SAP deja los archivos una vez por mes.
const SAP_NETWORK_PATH = process.env.SAP_NETWORK_PATH || '\\\\10.0.0.115\\Cegid'
const PROCESSED_SUBDIR = 'SAPResultProcesado'
const CHECK_HOUR = parseInt(process.env.CHECK_HOUR || '1')
const store = createStore({ dir: path.join(__dirname, 'data-store') })

const state = {
  pueblo: null,
  tesi: null,
  periodo: null,   // e.g. "2026-05" extraído del 5° campo del archivo
  lastUpdate: null,
  lastCheckAt: null,
  // Mutex real: excluye checkAndLoad y procesarUploads entre si para que no
  // escriban el store al mismo tiempo (ver comentario en procesarUploads).
  storeBusy: false,
  // Indicador de UI: solo informa si HAY UN REFRESH DE RED en curso. Separado
  // de storeBusy a proposito: un upload manual tambien toma storeBusy, pero
  // no es un "refresh de red" y no deberia mostrarse como tal en /api/status
  // (la tarea siguiente construye la UI sobre este campo).
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

// Archivado del historico (reemplaza moveToProcessed, que movia archivos desde
// la red; ahora la red es read-only y nunca se le escribe ni se le borra nada).
//
// El nombre lleva el origen ('sap' o 'manual') como infijo: migrarSiHaceFalta
// solo debe resembrar desde archivos de RED, nunca desde un upload manual
// archivado (que es indistinguible en contenido de uno de SAP, pero no en
// origen). Sin esta marca, perder data-store/ y volver a arrancar podria
// migrar un ajuste manual como si fuera 'sap' y checkAndLoad lo pisaria acto
// seguido con el dato crudo de la red.
function archivarTexto(texto, filename, origen) {
  try {
    const destDir = path.join(SAP_SOURCE_PATH, PROCESSED_SUBDIR)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const sufijo = `_${origen}_${filename}`
    // Si el contenido es igual al ultimo archivado de este origen, no genera
    // otra copia: con un refresh diario que casi nunca trae cambios, escribir
    // siempre acumula ~365 archivos/anio por empresa sin aportar nada.
    const candidatos = fs.readdirSync(destDir).filter(f => f.endsWith(sufijo)).sort()
    const ultimo = candidatos[candidatos.length - 1]
    if (ultimo && fs.readFileSync(path.join(destDir, ultimo), 'utf8') === texto) return
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    fs.writeFileSync(path.join(destDir, `${ts}${sufijo}`), texto, 'utf8')
  } catch (e) {
    console.error(`[EstadoResultado] Error archivando ${filename}:`, e.message)
  }
}

// Reparseo del estado en memoria desde el vigente (unica fuente de verdad).
// A proposito NO toca lastUpdate: eso queda a cargo de sellarActualizacion(),
// que los llamadores invocan solo cuando algo realmente entro nuevo (ver I5:
// sellar sin que haya entrado nada le mentiria al usuario "actualizado hace
// un minuto" sobre datos de hace un mes).
function recargarEstadoDesdeStore() {
  for (const key of Object.keys(EMPRESAS)) {
    const texto = store.readVigente(key)
    if (!texto) {
      // Sin vigente en disco: el estado en memoria no puede mostrar datos que
      // la descarga no tiene (si no, /api/data y /api/status informarian
      // "cargado" mientras /api/download da 404 para el mismo archivo).
      state[key] = null
      continue
    }
    const records = parseFile(texto)
    state[key] = records.length > 0 ? records : null
  }
  state.periodo = extractPeriodo(state.tesi ?? state.pueblo ?? [])
}

function sellarActualizacion() {
  state.lastUpdate = new Date().toISOString()
}

// Migracion al primer arranque: si data-store/ esta vacio, siembra con el
// archivo mas reciente de cada empresa en SAPResultProcesado/, como origen
// 'sap' — SOLO entre los archivados de red (sufijo "_sap_"), nunca entre los
// de un upload manual (ver comentario de archivarTexto).
// Devuelve true si migro algun periodo, para que el arranque pueda sellar
// lastUpdate de forma consistente con I5.
function migrarSiHaceFalta() {
  const destDir = path.join(SAP_SOURCE_PATH, PROCESSED_SUBDIR)
  if (!fs.existsSync(destDir)) return false
  let migroAlgo = false
  for (const [key, filename] of Object.entries(EMPRESAS)) {
    if (store.readVigente(key)) continue
    // I5: perder data-store/ entero (sin manifest ni vigentes) es indistinguible
    // de una primera corrida legitima, asi que se siembra desde SAP sin pedir
    // permiso. Pero si hay uploads manuales archivados para esta empresa, esos
    // ajustes contables estan por perderse en silencio (se resiembra con datos
    // crudos de SAP). No los resembramos automaticamente -que ajuste corresponde
    // a que mes es criterio humano-, pero avisamos bien fuerte para que alguien
    // los revise a mano en sap-inbox\SAPResultProcesado\.
    const sufijoManual = `_manual_${filename}`
    const archivadosManual = fs.readdirSync(destDir).filter(f => f.endsWith(sufijoManual))
    if (archivadosManual.length > 0) {
      console.error(`[EstadoResultado] ######## ADVERTENCIA: data-store/ vacio para ${key.toUpperCase()} pero hay ${archivadosManual.length} ajuste(s) manual(es) archivado(s) en ${destDir} (${archivadosManual.join(', ')}). Se va a resembrar desde SAP con datos crudos: revisar si esos ajustes hay que reaplicarlos a mano. ########`)
    }
    const sufijo = `_sap_${filename}`
    const candidatos = fs.readdirSync(destDir).filter(f => f.endsWith(sufijo)).sort()
    const ultimo = candidatos[candidatos.length - 1]
    if (!ultimo) continue
    const texto = fs.readFileSync(path.join(destDir, ultimo), 'utf8')
    try {
      const r = store.merge({ empresaKey: key, texto, origen: 'sap' })
      migroAlgo = migroAlgo || r.traidos.length > 0
      console.log(`[EstadoResultado] Migrado ${key.toUpperCase()} desde ${ultimo}: ${r.traidos.length} periodos`)
    } catch (e) {
      // manifest.json corrupto o ausente-con-vigente: store.merge() lee el
      // manifest ANTES de escribir nada, asi que si tira excepcion no se
      // perdio ni se piso nada en disco. Logueamos fuerte y NO migramos esta
      // empresa; el arranque sigue igual (mas abajo checkAndLoad() vuelve a
      // intentar leer el manifest y aborta el refresh de red de la misma
      // forma si sigue corrupto).
      console.error(`[EstadoResultado] ######## MANIFEST.JSON CORRUPTO — no se pudo migrar ${key.toUpperCase()}: ${e.message} ########`)
    }
  }
  return migroAlgo
}

// Refresh desde la red (reemplaza checkAndLoad de la version anterior, que leia
// del inbox local). El inbox local (SAP_SOURCE_PATH) queda solo como zona de
// paso para los uploads manuales.
async function checkAndLoad() {
  if (state.storeBusy) return { ok: false, empresas: {} }
  state.storeBusy = true
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
      archivarTexto(leido.texto, filename, 'sap')
      console.log(`[EstadoResultado] ${key.toUpperCase()} desde red — traidos: [${r.traidos}] preservados: [${r.preservados}]`)
      empresas[key] = { ok: true, origen: 'red', traidos: r.traidos, preservados: r.preservados }
    }
    recargarEstadoDesdeStore()
    // I5: si el share estaba caido (o el manifest corrupto) y ninguna empresa
    // trajo nada, no sellamos lastUpdate — que siga mostrando la fecha del
    // ultimo dato real en vez de mentir "actualizado ahora".
    if (Object.values(empresas).some(e => e.ok)) sellarActualizacion()
  } finally {
    state.storeBusy = false
    state.isRefreshing = false
  }

  return { ok: Object.values(empresas).some(e => e.ok), empresas }
}

// Procesar uploads del inbox (los periodos que traen pasan a 'manual').
//
// Comparte el mutex state.storeBusy con checkAndLoad() para evitar la
// carrera: si un usuario sube un archivo justo cuando el chequeo automatico de
// la 1am (u otro refresh) esta escribiendo el store, las dos escrituras
// podrian pisarse. Elegimos RECHAZAR el upload en vez de encolarlo/esperarlo:
// es la opcion mas facil de razonar (no hay cola, no hay que decidir orden) y
// el costo para el usuario es minimo, un reintento a los pocos segundos.
// storeBusy es un mutex neutro (no es "isRefreshing"): un upload manual no es
// un refresh de red, y /api/status no debe mostrarlo como tal (I minor).
async function procesarUploads(files) {
  if (state.storeBusy) {
    return {
      rejected: true,
      message: 'Hay una actualizacion automatica en curso, reintente en unos segundos',
      empresas: {}
    }
  }
  state.storeBusy = true
  try {
    const empresas = {}
    for (const [key, filename] of Object.entries(EMPRESAS)) {
      // Se busca por originalname (el contrato de nombre con el usuario), pero
      // se lee y se borra por la ruta real que multer reporto (f.path), nunca
      // reconstruida por nombre: con el nombre en disco unico (ver arriba en
      // la config de multer) dos uploads concurrentes ya no pueden leerse ni
      // borrarse el archivo entre si (IMPORTANT 3 de la revision final).
      const f = files.find(f => f.originalname === filename)
      if (!f || !fs.existsSync(f.path)) continue
      const texto = fs.readFileSync(f.path, 'utf8')
      try {
        const r = store.merge({ empresaKey: key, texto, origen: 'manual' })
        archivarTexto(texto, filename, 'manual')
        fs.unlinkSync(f.path)   // el inbox es zona de paso; el vigente ya vive en data-store
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
    // I5: mismo criterio que checkAndLoad — sellar solo si algo entro de verdad.
    if (Object.values(empresas).some(e => e.ok)) sellarActualizacion()
    return { rejected: false, empresas }
  } finally {
    state.storeBusy = false
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
    // Nombre UNICO en disco (no file.originalname): con dos uploads
    // concurrentes, escribir con nombre fijo hace que el segundo pise el
    // archivo del primero antes de que ninguno de los dos llegue al mutex de
    // procesarUploads (ver IMPORTANT 3 de la revision final). El
    // originalname sigue siendo el contrato de nombre con el usuario
    // (fileFilter lo valida abajo) y procesarUploads lo usa solo para saber a
    // que empresa corresponde cada archivo, no para encontrarlo en disco.
    filename: (req, file, cb) => cb(null, `${file.originalname}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
  }),
  fileFilter: (req, file, cb) => {
    const nombresValidos = Object.values(EMPRESAS)
    if (nombresValidos.includes(file.originalname)) {
      cb(null, true)
    } else {
      cb(new Error(`Archivo no reconocido: "${file.originalname}". Se esperan: ${nombresValidos.join(' o ')}`))
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
  if (state.storeBusy) return res.json({ ok: false, message: 'Hay una operación sobre el store en curso, reintente en unos segundos', empresas: {} })
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

// Borra del inbox los archivos que multer ya escribio, para el caso en que el
// upload se rechaza DESPUES de que la escritura a disco termino con exito
// (409 por storeBusy). Si dejaramos el archivo ahi, quedaria huerfano: nadie
// vuelve a leer el inbox salvo un proximo upload con el mismo nombre, y el
// mensaje "reintente" seria falso (el archivo del intento fallido nunca se
// aplica solo). El otro caso (fileFilter rechaza un nombre invalido a mitad
// de un upload de 2 archivos) ya lo limpia multer solo: ver
// remove-uploaded-files.js, abortWithError() borra los que ya se habian
// escrito antes de propagar el error, por eso NO hace falta repetir la
// limpieza en la rama de "err".
function limpiarArchivosSubidos(files) {
  for (const f of files ?? []) {
    try { fs.unlinkSync(f.path) } catch { /* ya no esta: nada que limpiar */ }
  }
}

app.post('/api/upload', (req, res) => {
  upload.array('files', 2)(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, message: err.message })
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ ok: false, message: 'No se recibieron archivos' })
    }
    const resultado = await procesarUploads(req.files)
    if (resultado.rejected) {
      limpiarArchivosSubidos(req.files)
      return res.status(409).json({ ok: false, message: resultado.message })
    }
    const { empresas } = resultado
    const nombres = req.files.map(f => f.originalname)
    const periodos = [...new Set(Object.values(empresas).flatMap(e => e.traidos ?? []))].sort()
    res.json({ ok: true, message: `Cargado con ajustes manuales: ${nombres.join(', ')} (${periodos.join(', ')})`, empresas })
  })
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const migro = migrarSiHaceFalta()
recargarEstadoDesdeStore()
if (migro) sellarActualizacion()
await checkAndLoad()
scheduleDailyCheck()

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1'
app.listen(PORT, HOST, () => {
  console.log(`[EstadoResultado] Escuchando en http://${HOST}:${PORT}`)
  console.log(`[EstadoResultado] Fuente SAP (inbox local, uploads manuales): ${SAP_SOURCE_PATH}`)
  console.log(`[EstadoResultado] Fuente SAP (red, solo lectura): ${SAP_NETWORK_PATH}`)
})
