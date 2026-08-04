import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { ApiError, getEmpresas, getMatriz, getPeriodos, type Empresa, type Matriz } from '@/src/lib/api'
import { Encabezado } from '@/src/components/Encabezado'
import { TarjetasResumen } from '@/src/components/TarjetasResumen'

export default function App() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresa, setEmpresa] = useState('')
  const [periodos, setPeriodos] = useState<string[]>([])
  const [periodo, setPeriodo] = useState('')
  // A que empresa corresponden los periodos ya cargados. Sin este dato, cambiar
  // de empresa dispara el efecto de la matriz en el mismo render con el periodo
  // de la empresa ANTERIOR (el efecto de periodos solo arranca un fetch async y
  // no alcanza a corregirlo), y se ve un error espurio o el mes equivocado antes
  // de que se acomode.
  const [periodosDe, setPeriodosDe] = useState('')
  const [matriz, setMatriz] = useState<Matriz | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 1) Empresas (una sola vez).
  useEffect(() => {
    getEmpresas()
      .then(r => { setEmpresas(r.empresas); setEmpresa(r.empresas[0]?.clave ?? '') })
      .catch((e: ApiError) => { setError(e.message); setCargando(false) })
  }, [])

  // 2) Periodos de la empresa elegida. Default: el mas reciente.
  const cargarPeriodos = useCallback(async (emp: string) => {
    if (!emp) return
    setCargando(true); setError(null)
    try {
      const r = await getPeriodos(emp)
      setPeriodos(r.periodos)
      // Si el periodo elegido sigue existiendo en la empresa nueva se conserva;
      // si no, se cae al mas reciente. Cambiar de empresa no deberia sacarte del
      // mes que estabas mirando cuando ese mes existe en las dos.
      setPeriodo(prev => (prev && r.periodos.includes(prev) ? prev : r.periodos[r.periodos.length - 1] ?? ''))
      // Recien ahora el par (empresa, periodo) es coherente y el efecto de la
      // matriz puede correr. Va DESPUES de setPeriodo a proposito.
      setPeriodosDe(emp)
      if (r.periodos.length === 0) { setMatriz(null); setCargando(false) }
    } catch (e) {
      setError((e as ApiError).message); setMatriz(null); setCargando(false)
    }
  }, [])

  useEffect(() => { void cargarPeriodos(empresa) }, [empresa, cargarPeriodos])

  // 3) Matriz del par empresa+periodo.
  const cargarMatriz = useCallback(async (emp: string, per: string) => {
    if (!emp || !per) return
    setCargando(true); setError(null)
    try {
      setMatriz(await getMatriz(emp, per))
    } catch (e) {
      setError((e as ApiError).message); setMatriz(null)
    } finally {
      setCargando(false)
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
  const refrescar = useCallback(() => {
    void cargarPeriodos(empresa).then(() => cargarMatriz(empresa, periodo))
  }, [empresa, periodo, cargarPeriodos, cargarMatriz])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4">
      <Encabezado
        empresas={empresas} empresa={empresa} onEmpresa={setEmpresa}
        periodos={periodos} periodo={periodo} onPeriodo={setPeriodo}
        mtimeMs={matriz?.archivo.mtimeMs} descartadas={matriz?.descartadas ?? 0}
        cargando={cargando} onRefrescar={refrescar}
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

      {!error && matriz && <TarjetasResumen resumen={matriz.resumen} />}

      {!error && matriz && matriz.sucursales.length === 0 && !cargando && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No hay diferencias de caja registradas en este mes.
        </p>
      )}

      {/* La matriz y el panel del asiento se agregan en la Tarea 9. */}
    </div>
  )
}
