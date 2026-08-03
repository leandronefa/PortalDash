import fs from 'fs'
import path from 'path'
import { splitIntoPeriodBlocks, serializeBlocks } from './sap-format.js'

// Registro unico de empresas: clave interna -> nombre del archivo que SAP deja
// en la red (y que el usuario descarga, ajusta y vuelve a subir con ESE nombre).
// Agregar una empresa es agregar una linea aca: el resto del backend y el
// selector del frontend se derivan de este mapa.
export const EMPRESAS = {
  tesi: 'SAP_RESULT.txt',
  pueblo: 'SAP_PU_RESULT.txt',
  indo: 'SAP_INDO_RESULT.txt'
}

// La etiqueta que ve el usuario es la clave en mayusculas (TESI, PUEBLO, INDO).
// Mantener esa relacion 1:1 evita una segunda tabla que se pueda desincronizar.
export function listaDeEmpresas() {
  return Object.entries(EMPRESAS).map(([key, filename]) => ({
    key,
    label: key.toUpperCase(),
    filename
  }))
}

/**
 * Traduce la etiqueta que llega por querystring a la clave interna.
 * Devuelve null si no corresponde a ninguna empresa: el llamador contesta 400
 * en vez de caer por default a TESI, que mostraria datos de otra empresa bajo
 * el nombre pedido.
 */
export function empresaKeyDesdeLabel(label) {
  const key = String(label ?? '').trim().toLowerCase()
  return Object.hasOwn(EMPRESAS, key) ? key : null
}

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
    if (!fs.existsSync(p)) {
      // Que no exista es el arranque legitimo SOLO si tampoco hay ningun
      // vigente todavia (primera corrida real: no hay nada que perder). Si ya
      // hay al menos un archivo vigente en el store, el manifest no puede
      // faltar de forma legitima: alguien lo borro o se perdio, y tratarlo
      // como "primera corrida" (manifest vacio) haria que el siguiente
      // refresh de red piense que ningun periodo es 'manual' y los pise a
      // todos en silencio. Mismo criterio que el JSON corrupto: fallar ruidoso.
      const hayVigente = Object.keys(EMPRESAS).some(k => fs.existsSync(vigentePath(k)))
      if (hayVigente) {
        throw new Error(`manifest.json ausente en ${p} pero hay archivos vigentes en el store`)
      }
      return vacio()
    }
    // Que exista y no parsee (o no sea un objeto plano: array, numero, string,
    // null) es otra cosa: un manifest vacio ahi seria indistinguible de
    // "primera corrida" y la siguiente lectura de red pisaria en silencio
    // todos los periodos manual. Mejor fallar ruidoso.
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch (err) {
      throw new Error(`manifest.json corrupto en ${p}: ${err.message}`)
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`manifest.json corrupto en ${p}: no es un objeto`)
    }
    // Una empresa sin entrada en el manifest arranca vacia: es el caso normal
    // al sumar una empresa nueva (el manifest en disco es anterior a ella) y no
    // tiene nada que ver con el manifest ausente/corrupto de arriba — ahi el
    // riesgo es pisar ajustes manuales existentes; aca todavia no hay ninguno.
    return Object.fromEntries(
      Object.keys(EMPRESAS).map(key => [key, raw[key] ?? {}])
    )
  }

  function vacio() {
    return Object.fromEntries(Object.keys(EMPRESAS).map(key => [key, {}]))
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
      // 'manual' solo es preservable si el bloque realmente existe en el
      // vigente leido. Si el manifest dice 'manual' pero el bloque no esta
      // (vigente truncado/borrado/tocado desde afuera, manifest.json
      // adelantado al vigente), no hay nada que preservar: es un estado
      // inconsistente, no un ajuste. Preferimos aceptar el dato crudo de la
      // red antes que dejar el mes afuera para siempre (ver CRITICAL 1 de la
      // revision final): un mes con datos de SAP es mejor que un mes que no
      // existe.
      const marcadoManual = meta[periodo]?.origen === 'manual'
      const esManual = marcadoManual && blocks.has(periodo)
      if (marcadoManual && !blocks.has(periodo)) {
        console.error(`[sap-store] ######## manifest/vigente desincronizados para ${empresaKey}/${periodo}: marcado 'manual' pero sin bloque en el vigente. Se acepta el dato de la red para no perder el mes. ########`)
      }
      if (origen === 'sap' && esManual) {
        preservados.push(periodo)
        continue
      }
      blocks.set(periodo, lines)
      meta[periodo] = { origen, cargadoEn }
      traidos.push(periodo)
    }

    ensureDir()
    // Orden: manifest ANTES que el archivo vigente. Si el proceso se corta
    // entre las dos escrituras, el peor caso es que el periodo quede marcado
    // 'manual' en el manifest mientras el vigente en disco todavia tiene el
    // contenido viejo (verificado con el vigente en read-only: EPERM en el
    // segundo write, manifest ya commiteado). Esto NO es "nada perdido de
    // forma irreversible" como decia antes este comentario: el mes queda
    // blindado como ajustado sin tener ningun ajuste, y un refresh de red
    // posterior no lo va a corregir (ver IMPORTANT 2 de la revision final).
    // Es preferible al orden inverso, que dejaria el vigente con el ajuste
    // pero el manifest todavia en 'sap' — ahi si el siguiente refresh de red
    // lo pisaria sin aviso, perdiendo el ajuste en silencio. El fix real de
    // este riesgo es la escritura atomica de abajo, que reduce la ventana de
    // interrupcion a un rename (practicamente instantaneo) en vez de a todo
    // el tiempo que tarda writeFileSync.
    saveManifest(manifest)
    // Escritura atomica del vigente, igual que el manifest: temporal + rename.
    // Sin esto, un proceso interrumpido a mitad de writeFileSync (reinicio,
    // disco lleno, kill) deja el .txt truncado; con el manifest ya sano, un
    // periodo 'manual' que no llega a estar en el vigente se reportaria como
    // preservado y desaparecería para siempre. El rename tambien cierra la
    // descarga concurrente (IMPORTANT 4): un lector ve el archivo viejo o el
    // nuevo completo, nunca uno a medias.
    const p = vigentePath(empresaKey)
    const tmp = path.join(dir, `${EMPRESAS[empresaKey]}.${process.pid}.${Date.now()}.tmp`)
    fs.writeFileSync(tmp, serializeBlocks(blocks), 'utf8')
    fs.renameSync(tmp, p)

    return {
      traidos: traidos.sort(),
      preservados: preservados.sort(),
      periodos: [...blocks.keys()].sort()
    }
  }

  return { dir, vigentePath, readVigente, readManifest, merge }
}
