import { statArchivo, leerArchivo, descripcionDeError } from './reporte-source.js'
import { parsearReporte } from './reporte-parse.js'
import { EMPRESAS, empresaValida } from './empresas.js'

/**
 * Cache en memoria del parseo, invalidada por mtime+size del archivo de red.
 *
 * SAP reescribe los archivos a diario, asi que el primer request posterior a la
 * reescritura reparsea (~decenas de ms para 13k lineas) y el resto se sirve de
 * memoria. No hay scheduler ni persistencia a proposito: la fuente de verdad es
 * el archivo de la red, y reiniciar el servicio no pierde nada porque no hay
 * nada propio que perder.
 *
 * stat/leer/parsear son inyectables SOLO para los tests.
 */
export function crearCache({ networkPath, stat = statArchivo, leer = leerArchivo, parsear = parsearReporte }) {
  const entradas = new Map()   // claveEmpresa -> { mtimeMs, size, registros, descartadas, parseos }

  function obtener(claveEmpresa) {
    if (!empresaValida(claveEmpresa)) {
      // El llamador ya valido la empresa (normalizarClave) antes de llegar aca:
      // si igual llega una desconocida es un bug de programacion, no un caso de
      // datos, y tiene que doler en vez de devolver una respuesta vacia.
      throw new Error(`Empresa desconocida: ${claveEmpresa}`)
    }
    const { archivo } = EMPRESAS[claveEmpresa]

    const s = stat(networkPath, archivo)
    if (!s.ok) return { ok: false, code: s.code, message: descripcionDeError(s.code) }

    const previa = entradas.get(claveEmpresa)
    if (previa && previa.mtimeMs === s.mtimeMs && previa.size === s.size) {
      return { ok: true, registros: previa.registros, descartadas: previa.descartadas,
               archivo: { mtimeMs: previa.mtimeMs, size: previa.size }, parseos: previa.parseos }
    }

    const l = leer(networkPath, archivo)
    if (!l.ok) return { ok: false, code: l.code, message: descripcionDeError(l.code) }

    const { registros, descartadas } = parsear(l.texto)
    // El error NO se cachea (solo el exito): un corte momentaneo de red no
    // puede dejar el dashboard roto hasta que alguien reinicie el servicio.
    const entrada = {
      mtimeMs: s.mtimeMs,
      size: s.size,
      registros,
      descartadas,
      parseos: (previa?.parseos ?? 0) + 1
    }
    entradas.set(claveEmpresa, entrada)
    return { ok: true, registros, descartadas,
             archivo: { mtimeMs: s.mtimeMs, size: s.size }, parseos: entrada.parseos }
  }

  return { obtener }
}
