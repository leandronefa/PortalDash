import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ApiError, getAsiento, getEmpresas, getMatriz, getPeriodos,
         type ArchivoInfo, type Asiento, type Empresa, type Matriz } from '@/src/lib/api'
import { Encabezado } from '@/src/components/Encabezado'
import { TarjetasResumen } from '@/src/components/TarjetasResumen'
import { MatrizDiferencias } from '@/src/components/MatrizDiferencias'
import { PanelAsiento } from '@/src/components/PanelAsiento'

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresa, setEmpresa] = useState('')
  const [periodos, setPeriodos] = useState<string[]>([])
  const [periodo, setPeriodo] = useState('')
  // Info del archivo tal como la devuelve /api/periodos (mtime + descartadas).
  // Independiente de `matriz` a proposito: cuando el archivo no tiene ningun mes
  // con datos, matriz queda en null y el encabezado igual necesita mostrar la
  // frescura y, sobre todo, el contador de descartadas (justo el caso en que mas
  // importa verlo, porque puede ser que se haya descartado todo el archivo).
  const [periodosArchivo, setPeriodosArchivo] = useState<ArchivoInfo | undefined>(undefined)
  const [periodosDescartadas, setPeriodosDescartadas] = useState(0)
  // A que empresa corresponden los periodos ya cargados. Sin este dato, cambiar
  // de empresa dispara el efecto de la matriz en el mismo render con el periodo
  // de la empresa ANTERIOR (el efecto de periodos solo arranca un fetch async y
  // no alcanza a corregirlo), y se ve un error espurio o el mes equivocado antes
  // de que se acomode.
  const [periodosDe, setPeriodosDe] = useState('')
  const [matriz, setMatriz] = useState<Matriz | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<{ fechaISO: string; sucursal: string } | null>(null)
  const [asiento, setAsiento] = useState<Asiento | null>(null)
  const [asientoCargando, setAsientoCargando] = useState(false)
  const [asientoError, setAsientoError] = useState<string | null>(null)
  // Numero del ultimo pedido de asiento. Sin esto, un pedido lento de la empresa
  // X que resuelve DESPUES de uno de la empresa Y pisa los datos de Y: el panel
  // muestra el asiento de otra empresa bajo un encabezado que dice la correcta.
  // Falla en silencio, y en un tablero contable eso es peor que un error visible.
  const pedidoAsiento = useRef(0)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  const abrirAsiento = useCallback(async (fechaISO: string, sucursal: string) => {
    const pedido = ++pedidoAsiento.current
    setSeleccion({ fechaISO, sucursal })
    setAsientoCargando(true); setAsientoError(null)
    try {
      const a = await getAsiento(empresa, fechaISO, sucursal)
      if (pedido !== pedidoAsiento.current) return   // llego tarde: ya hay otro pedido
      setAsiento(a)
    } catch (e) {
      if (pedido !== pedidoAsiento.current) return
      setAsientoError((e as ApiError).message); setAsiento(null)
    } finally {
      if (pedido === pedidoAsiento.current) setAsientoCargando(false)
    }
  }, [empresa])

  const cerrarAsiento = useCallback(() => {
    // Invalida cualquier pedido en vuelo: si uno resuelve despues de cerrar, su
    // resultado ya no corresponde a nada de lo que se esta viendo.
    pedidoAsiento.current++
    setSeleccion(null); setAsiento(null); setAsientoError(null); setAsientoCargando(false)
  }, [])

  // Al cambiar de empresa o de mes, el asiento abierto pertenece a otro
  // contexto: dejarlo abierto mostraria el detalle de un dia que ya no esta en
  // la matriz de al lado.
  useEffect(() => { cerrarAsiento() }, [empresa, periodo, cerrarAsiento])

  // 1) Empresas (una sola vez).
  useEffect(() => {
    getEmpresas()
      .then(r => { setEmpresas(r.empresas); setEmpresa(r.empresas[0]?.clave ?? '') })
      .catch((e: ApiError) => { setError(e.message); setCargando(false) })
  }, [])

  // Ultimo `periodo` conocido, sin ser dependencia de `cargarPeriodos`: si lo
  // fuera, cambiar de mes recrearia el callback y el efecto de abajo (que lo
  // lista como dependencia) volveria a pedir periodos sin necesidad.
  const periodoRef = useRef('')
  useEffect(() => { periodoRef.current = periodo }, [periodo])

  // 2) Periodos de la empresa elegida. Default: el mas reciente. Devuelve el
  // periodo resuelto para que quien encadena una carga de matriz (refrescar)
  // pida el mes correcto y no el que quedo en el closure de un render viejo.
  const cargarPeriodos = useCallback(async (emp: string): Promise<string> => {
    if (!emp) return ''
    setCargando(true); setError(null)
    try {
      const r = await getPeriodos(emp)
      setPeriodos(r.periodos)
      setPeriodosArchivo(r.archivo)
      setPeriodosDescartadas(r.descartadas)
      // Si el periodo elegido sigue existiendo en la empresa nueva se conserva;
      // si no, se cae al mas reciente. Cambiar de empresa no deberia sacarte del
      // mes que estabas mirando cuando ese mes existe en las dos.
      const prev = periodoRef.current
      const resuelto = prev && r.periodos.includes(prev) ? prev : (r.periodos[r.periodos.length - 1] ?? '')
      setPeriodo(resuelto)
      // Recien ahora el par (empresa, periodo) es coherente y el efecto de la
      // matriz puede correr. Va DESPUES de setPeriodo a proposito.
      setPeriodosDe(emp)
      if (r.periodos.length === 0) { setMatriz(null); setCargando(false) }
      return resuelto
    } catch (e) {
      setError((e as ApiError).message); setMatriz(null); setCargando(false)
      return ''
    }
  }, [])

  useEffect(() => { void cargarPeriodos(empresa) }, [empresa, cargarPeriodos])

  // Numero del ultimo pedido de matriz. Sin esto, dos pedidos superpuestos (dos
  // cambios de mes rapidos, o un cambio de empresa mientras el reparseo del
  // primer pedido todavia corre en el servidor) pueden resolver fuera de orden:
  // el mas viejo pisaria con setMatriz los datos del mas nuevo, pintando el mes
  // o la empresa equivocada sin ninguna senal visible (la matriz nunca muestra
  // matriz.periodo). Mismo patron que pedidoAsiento.
  const pedidoMatriz = useRef(0)

  // 3) Matriz del par empresa+periodo.
  const cargarMatriz = useCallback(async (emp: string, per: string) => {
    if (!emp || !per) return
    const pedido = ++pedidoMatriz.current
    setCargando(true); setError(null)
    try {
      const m = await getMatriz(emp, per)
      if (pedido !== pedidoMatriz.current) return   // llego tarde: ya hay otro pedido
      setMatriz(m)
    } catch (e) {
      if (pedido !== pedidoMatriz.current) return
      setError((e as ApiError).message); setMatriz(null)
    } finally {
      if (pedido === pedidoMatriz.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    // Guarda contra la carrera: mientras los periodos cargados sigan siendo de
    // otra empresa, el `periodo` de este render no le corresponde y pedir la
    // matriz con ese par daria un 400 o el mes equivocado.
    if (periodosDe !== empresa) return
    void cargarMatriz(empresa, periodo)
  }, [empresa, periodo, periodosDe, cargarMatriz])

  // Refrescar: vuelve a pedir periodos y matriz. El backend hace stat de la UNC
  // y reparsea solo si el archivo cambio, asi que esto es barato.
  // Usa el periodo que `cargarPeriodos` resuelve, no el del closure de este
  // render: si el mes elegido desaparecio del archivo reescrito, cargarPeriodos
  // ya cayo al mas reciente, y pedir la matriz con el periodo viejo del closure
  // pediria un mes que el selector ya no ofrece. Si no hay ningun periodo (mes
  // resuelto === ''), no hay nada que pedir.
  const refrescar = useCallback(() => {
    void cargarPeriodos(empresa).then(p => { if (p) void cargarMatriz(empresa, p) })
  }, [empresa, cargarPeriodos, cargarMatriz])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4">
      <Encabezado
        empresas={empresas} empresa={empresa} onEmpresa={setEmpresa}
        periodos={periodos} periodo={periodo} onPeriodo={setPeriodo}
        mtimeMs={periodosArchivo?.mtimeMs} descartadas={periodosDescartadas}
        cargando={cargando} onRefrescar={refrescar}
        dark={dark} onDark={setDark}
      />

      {error && (
        // El mensaje viene del backend ya redactado (ENOENT / permisos / red).
        // Nunca una pantalla en blanco ni datos viejos disfrazados de frescos.
        <div className="rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 p-4 mb-4">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4" aria-hidden /> No se pudieron traer los datos
          </div>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={refrescar} className="mt-3 rounded border border-amber-400 px-2.5 py-1 text-sm">
            Reintentar
          </button>
        </div>
      )}

      {/* Archivo sin ningun mes con datos: no hay periodo que elegir ni matriz que
          pedir. El encabezado ya muestra frescura y descartadas desde
          periodosArchivo/periodosDescartadas, independientes de `matriz`, asi que
          el contador sigue visible aca aunque se haya descartado todo el archivo. */}
      {!error && !cargando && periodosDe === empresa && periodos.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          El archivo de SAP no tiene meses con datos.
        </p>
      )}

      {!error && matriz && <TarjetasResumen resumen={matriz.resumen} />}

      {/* Con una fila por sucursal con actividad (incluso sin diferencias), un
          array vacio significa que el mes no tiene NINGUN dato en el archivo de
          SAP, no que "cerro todo bien" — ese mensaje anterior afirmaba lo
          contrario de lo que el backend sabe. */}
      {!error && matriz && matriz.sucursales.length === 0 && !cargando && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Este mes no tiene datos en el archivo de SAP.
        </p>
      )}

      {/* El "todo bien" genuino: hay filas (el mes tuvo actividad) y el total es
          cero dentro de la tolerancia del proyecto. La matriz sigue mostrandose
          debajo — las filas con celdas vacias son la evidencia de la afirmacion. */}
      {!error && matriz && matriz.sucursales.length > 0 && Math.abs(matriz.granTotal) < 0.005 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Todas las sucursales cerraron sin diferencias este mes.
        </p>
      )}

      {!error && matriz && matriz.sucursales.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="min-w-0 flex-1">
            <MatrizDiferencias matriz={matriz} onCelda={abrirAsiento} seleccion={seleccion} />
          </div>
          {seleccion && (
            <PanelAsiento asiento={asiento} cargando={asientoCargando} error={asientoError} onCerrar={cerrarAsiento} />
          )}
        </div>
      )}
    </div>
  )
}
