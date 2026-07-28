import fs from 'fs'
import path from 'path'
import { splitIntoPeriodBlocks, serializeBlocks } from './sap-format.js'

export const EMPRESAS = { tesi: 'SAP_RESULT.txt', pueblo: 'SAP_PU_RESULT.txt' }

const MANIFEST = 'manifest.json'

/**
 * Estado vigente del tablero: un archivo por empresa (texto tal cual, byte-fiel)
 * mas un manifest con el origen de cada periodo.
 *
 * Regla central: un periodo con origen 'manual' solo puede reemplazarse con
 * otro upload manual. Una lectura de red ('sap') nunca lo toca.
 */
export function createStore({ dir }) {
  function ensureDir() {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  function vigentePath(empresaKey) {
    return path.join(dir, EMPRESAS[empresaKey])
  }

  function readVigente(empresaKey) {
    const p = vigentePath(empresaKey)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  }

  function readManifest() {
    const p = path.join(dir, MANIFEST)
    const vacio = { tesi: {}, pueblo: {} }
    if (!fs.existsSync(p)) return vacio
    try {
      const m = JSON.parse(fs.readFileSync(p, 'utf8'))
      return { tesi: m.tesi ?? {}, pueblo: m.pueblo ?? {} }
    } catch {
      return vacio
    }
  }

  function saveManifest(m) {
    ensureDir()
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m, null, 2))
  }

  function merge({ empresaKey, texto, origen }) {
    if (!EMPRESAS[empresaKey]) throw new Error(`Empresa desconocida: ${empresaKey}`)
    if (origen !== 'sap' && origen !== 'manual') throw new Error(`Origen invalido: ${origen}`)

    const manifest = readManifest()
    const meta = manifest[empresaKey]
    const vigente = readVigente(empresaKey)
    const blocks = vigente ? splitIntoPeriodBlocks(vigente) : new Map()
    const entrantes = splitIntoPeriodBlocks(texto)

    const traidos = []
    const preservados = []
    const cargadoEn = new Date().toISOString()

    for (const [periodo, lines] of entrantes) {
      const esManual = meta[periodo]?.origen === 'manual'
      if (origen === 'sap' && esManual) {
        preservados.push(periodo)
        continue
      }
      blocks.set(periodo, lines)
      meta[periodo] = { origen, cargadoEn }
      traidos.push(periodo)
    }

    ensureDir()
    fs.writeFileSync(vigentePath(empresaKey), serializeBlocks(blocks), 'utf8')
    saveManifest(manifest)

    return {
      traidos: traidos.sort(),
      preservados: preservados.sort(),
      periodos: [...blocks.keys()].sort()
    }
  }

  return { dir, vigentePath, readVigente, readManifest, merge }
}
