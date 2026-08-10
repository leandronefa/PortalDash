import fs from 'node:fs'
import path from 'node:path'

/**
 * Persistencia de lo ya leido de la red, agrupado por periodo (YYYY-MM). A
 * diferencia de EstadoResultado, ControlCaja es de SOLO LECTURA: no existe un
 * origen 'manual', asi que una lectura de red nueva siempre pisa el periodo
 * que trae. Los periodos que no vienen en la lectura actual (porque salieron
 * de la ventana rodante de SAP, o porque el archivo paso a ser mensual) se
 * conservan tal cual estaban guardados.
 *
 * Objetivo: que un corte de red, o que SAP deje de mandar los ~3 meses de
 * ventana rodante para pasar a un archivo mensual, nunca borren un mes que ya
 * se llego a leer una vez.
 *
 * Un archivo por empresa: data-store/TESI.json, data-store/PUEBLO.json.
 */
export function crearStore({ dir }) {
  function archivoDe(claveEmpresa) {
    return path.join(dir, `${claveEmpresa}.json`)
  }

  function leerCrudo(claveEmpresa) {
    const p = archivoDe(claveEmpresa)
    if (!fs.existsSync(p)) return { periodos: {}, ultimaLecturaOk: null }
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'))
      return {
        periodos: data && typeof data.periodos === 'object' && data.periodos ? data.periodos : {},
        ultimaLecturaOk: data?.ultimaLecturaOk ?? null
      }
    } catch (err) {
      // Un store corrupto no puede tirar abajo el dashboard: a diferencia del
      // manifest de EstadoResultado (que protege ajustes manuales que no se
      // pueden recrear), aca todo viene de SAP y el proximo refresh de red lo
      // reconstruye solo. Se trata como vacio y se loguea para que quede
      // constancia de que se perdio historico.
      console.error(`[ControlCaja] data-store corrupto en ${p}, se descarta: ${err.message}`)
      return { periodos: {}, ultimaLecturaOk: null }
    }
  }

  function guardar(claveEmpresa, data) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const p = archivoDe(claveEmpresa)
    // Escritura atomica (temporal + rename): un proceso interrumpido a mitad
    // de escritura no puede dejar el JSON truncado en disco.
    const tmp = path.join(dir, `${claveEmpresa}.json.${process.pid}.${Date.now()}.tmp`)
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, p)
  }

  /** Vista de lectura: todos los periodos guardados, concatenados y ordenados. */
  function leer(claveEmpresa) {
    const { periodos, ultimaLecturaOk } = leerCrudo(claveEmpresa)
    const claves = Object.keys(periodos).sort()
    return {
      periodos: claves,
      registros: claves.flatMap(p => periodos[p]),
      descartadas: ultimaLecturaOk?.descartadas ?? 0,
      ultimaLecturaOk
    }
  }

  /**
   * Incorpora una lectura de red exitosa: agrupa `registros` por periodo y
   * pisa esas claves en lo ya guardado. Un periodo que no vino en esta lectura
   * (esta fuera de la ventana rodante actual del archivo) no se toca.
   */
  function merge(claveEmpresa, registros, descartadas, statInfo) {
    const actual = leerCrudo(claveEmpresa)
    const porPeriodo = new Map()
    for (const r of registros) {
      if (!porPeriodo.has(r.periodo)) porPeriodo.set(r.periodo, [])
      porPeriodo.get(r.periodo).push(r)
    }

    const periodos = { ...actual.periodos }
    for (const [periodo, regs] of porPeriodo) periodos[periodo] = regs

    guardar(claveEmpresa, {
      periodos,
      ultimaLecturaOk: { mtimeMs: statInfo.mtimeMs, size: statInfo.size, en: new Date().toISOString(), descartadas }
    })

    return leer(claveEmpresa)
  }

  return { dir, leer, merge }
}
