// Carga inicial (o re-siembra manual) del data-store desde la UNC de SAP.
//
// El servicio corre como LocalSystem y hoy no puede leer \\10.0.0.115\Cegid
// (EPERM, credencial de red no disponible para esa cuenta). Este script se
// corre a mano con una cuenta que SI tiene acceso (ej. un admin con sesion
// interactiva) para sembrar/actualizar el data-store sin depender de que el
// servicio pueda leer la red. Una vez resuelta la credencial del servicio,
// este script deja de ser necesario para el uso normal (el propio dashboard
// se mantiene al dia solo), pero sigue sirviendo para una resiembra manual
// puntual si hiciera falta.
//
// Uso: node scripts/seed-desde-red.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { statArchivo, leerArchivo } from '../server/reporte-source.js'
import { parsearReporte } from '../server/reporte-parse.js'
import { crearStore } from '../server/reporte-store.js'
import { EMPRESAS } from '../server/empresas.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAP_NETWORK_PATH = process.env.SAP_NETWORK_PATH || '\\\\10.0.0.115\\Cegid'
const store = crearStore({ dir: path.join(__dirname, '..', 'data-store') })

for (const [clave, { archivo }] of Object.entries(EMPRESAS)) {
  const s = statArchivo(SAP_NETWORK_PATH, archivo)
  if (!s.ok) {
    console.error(`[seed] ${clave}: no se pudo leer ${archivo} (${s.code}) — se deja el data-store como estaba`)
    continue
  }
  const l = leerArchivo(SAP_NETWORK_PATH, archivo)
  if (!l.ok) {
    console.error(`[seed] ${clave}: stat ok pero la lectura fallo (${l.code})`)
    continue
  }
  const { registros, descartadas } = parsearReporte(l.texto)
  const r = store.merge(clave, registros, descartadas.length, { mtimeMs: s.mtimeMs, size: s.size })
  console.log(`[seed] ${clave}: ${r.periodos.length} periodos guardados (${r.periodos.join(', ')}), ${descartadas.length} lineas descartadas`)
}
