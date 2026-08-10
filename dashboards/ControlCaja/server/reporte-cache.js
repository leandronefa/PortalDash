import { statArchivo, leerArchivo, descripcionDeError } from './reporte-source.js'
import { parsearReporte } from './reporte-parse.js'
import { empresaValida, EMPRESAS } from './empresas.js'
import { crearStore } from './reporte-store.js'

/**
 * Orquesta red + persistencia local (server/reporte-store.js).
 *
 * SAP reescribe el archivo a diario (o, cuando pase a ser mensual, una vez al
 * mes); el primer request posterior a un cambio de mtime/size relee y vuelca
 * lo nuevo al store, el resto se sirve de lo ya guardado. Si la red no
 * responde (o el archivo cambio de forma que ya no trae un periodo que antes
 * si traia), el store sigue teniendo todo lo que se llego a leer alguna vez:
 * un corte de red pasa a ser una degradacion ("estos datos son de tal fecha"),
 * no un apagon total del tablero.
 *
 * Solo si el store esta vacio (primera corrida, nunca se pudo leer nada) un
 * fallo de red sigue siendo un error real: no hay nada que mostrar.
 *
 * stat/leer/parsear/store son inyectables SOLO para los tests.
 */
export function crearCache({ networkPath, dataDir, stat = statArchivo, leer = leerArchivo, parsear = parsearReporte, store }) {
  const almacen = store ?? crearStore({ dir: dataDir })
  // Ultimo mtime/size que ya se volco al store, por empresa. Vive en memoria
  // (no en disco): tras un reinicio se vuelve a leer y volcar una vez, que es
  // barato e idempotente (ver reporte-store: pisa el mismo periodo con el
  // mismo contenido).
  const vistos = new Map()
  let parseos = 0

  function obtener(claveEmpresa) {
    if (!empresaValida(claveEmpresa)) {
      // El llamador ya valido la empresa antes de llegar aca: si igual llega
      // una desconocida es un bug de programacion, no un caso de datos.
      throw new Error(`Empresa desconocida: ${claveEmpresa}`)
    }

    const { archivo } = EMPRESAS[claveEmpresa]
    const s = stat(networkPath, archivo)

    if (s.ok) {
      const previo = vistos.get(claveEmpresa)
      const yaVolcado = previo && previo.mtimeMs === s.mtimeMs && previo.size === s.size
      if (!yaVolcado) {
        const l = leer(networkPath, archivo)
        if (l.ok) {
          const { registros, descartadas } = parsear(l.texto)
          almacen.merge(claveEmpresa, registros, descartadas.length, { mtimeMs: s.mtimeMs, size: s.size })
          vistos.set(claveEmpresa, { mtimeMs: s.mtimeMs, size: s.size })
          parseos++
        }
        // Si la lectura del contenido falla pese a que el stat dio ok (carrera
        // rara: el archivo desaparecio entre el stat y el read), se cae al
        // store de abajo igual que si el stat hubiera fallado.
      }
    }

    const guardado = almacen.leer(claveEmpresa)
    if (guardado.periodos.length > 0) {
      return {
        ok: true,
        registros: guardado.registros,
        descartadas: guardado.descartadas,
        archivo: s.ok ? { mtimeMs: s.mtimeMs, size: s.size } : guardado.ultimaLecturaOk,
        fuente: s.ok ? 'red' : 'store',
        avisoRed: s.ok ? null : descripcionDeError(s.code),
        parseos
      }
    }

    // Store vacio (nunca se pudo leer nada, ni de red ni antes) y la red
    // tampoco responde ahora: recien aca es un error real.
    return { ok: false, code: s.code ?? 'UNKNOWN', message: descripcionDeError(s.code) }
  }

  return { obtener }
}
