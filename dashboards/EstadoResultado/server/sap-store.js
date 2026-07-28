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
    // Que no exista es el arranque legitimo (primera corrida): manifest vacio.
    if (!fs.existsSync(p)) return { tesi: {}, pueblo: {} }
    // Que exista y no parsee es otra cosa: un manifest vacio ahi seria
    // indistinguible de "primera corrida" y la siguiente lectura de red
    // pisaria en silencio todos los periodos manual. Mejor fallar ruidoso.
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch (err) {
      throw new Error(`manifest.json corrupto en ${p}: ${err.message}`)
    }
    return { tesi: raw.tesi ?? {}, pueblo: raw.pueblo ?? {} }
  }

  function saveManifest(m) {
    ensureDir()
    // Escritura atomica: temporal + rename, para que una interrupcion a mitad
    // de la escritura nunca deje un manifest.json truncado/corrupto en disco.
    const p = path.join(dir, MANIFEST)
    const tmp = path.join(dir, `${MANIFEST}.${process.pid}.${Date.now()}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2))
    fs.renameSync(tmp, p)
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
    // Orden deliberado: manifest ANTES que el archivo vigente. Si el proceso
    // se corta entre las dos escrituras, esto deja el peor caso del lado
    // seguro: el periodo ya quedo marcado 'manual' pero el vigente en disco
    // todavia tiene el contenido viejo (nada perdido de forma irreversible;
    // el usuario nota que su ajuste no se ve y lo vuelve a subir). El orden
    // inverso dejaria el vigente con el ajuste pero el manifest todavia en
    // 'sap', y el siguiente refresh de red lo pisaria sin aviso.
    saveManifest(manifest)
    fs.writeFileSync(vigentePath(empresaKey), serializeBlocks(blocks), 'utf8')

    return {
      traidos: traidos.sort(),
      preservados: preservados.sort(),
      periodos: [...blocks.keys()].sort()
    }
  }

  return { dir, vigentePath, readVigente, readManifest, merge }
}
