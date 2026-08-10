import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crearApp } from './server/app.js'
import { crearCache } from './server/reporte-cache.js'
import { cargarNombresSucursal } from './server/empresas.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT || '3014')
// Ruta de red READ-ONLY donde SAP deja los reportes Z. Este dashboard solo lee.
const SAP_NETWORK_PATH = process.env.SAP_NETWORK_PATH || '\\\\10.0.0.115\\Cegid'

const cache = crearCache({ networkPath: SAP_NETWORK_PATH, dataDir: path.join(__dirname, 'data-store') })
const nombres = cargarNombresSucursal(path.join(__dirname, 'data', 'sucursales.json'))

const app = crearApp({ cache, nombres, dirname: __dirname })

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80).
const HOST = process.env.HOST || '127.0.0.1'
app.listen(PORT, HOST, () => {
  console.log(`[ControlCaja] Escuchando en http://${HOST}:${PORT}`)
  console.log(`[ControlCaja] Fuente SAP (red, solo lectura): ${SAP_NETWORK_PATH}`)
  console.log(`[ControlCaja] Sucursales con nombre en el mapeo: ${Object.values(nombres).filter(Boolean).length}`)
})
