import { RefreshCw, AlertTriangle, Sun, Moon } from 'lucide-react'
import type { Empresa } from '@/src/lib/api'
import { formatoFrescura, formatoMes } from '@/src/lib/formato'

type Props = {
  empresas: Empresa[]
  empresa: string
  onEmpresa: (e: string) => void
  periodos: string[]
  periodo: string
  onPeriodo: (p: string) => void
  mtimeMs?: number
  descartadas: number
  cargando: boolean
  onRefrescar: () => void
  dark: boolean
  onDark: (d: boolean) => void
}

export function Encabezado(p: Props) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
      <h1 className="text-xl font-semibold mr-auto">Control de Caja</h1>

      <label className="text-sm">
        <span className="sr-only">Empresa</span>
        <select value={p.empresa} onChange={e => p.onEmpresa(e.target.value)}
                className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1">
          {p.empresas.map(e => <option key={e.clave} value={e.clave}>{e.label}</option>)}
        </select>
      </label>

      <label className="text-sm">
        <span className="sr-only">Mes</span>
        <select value={p.periodo} onChange={e => p.onPeriodo(e.target.value)}
                className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1">
          {p.periodos.map(x => <option key={x} value={x}>{formatoMes(x)}</option>)}
        </select>
      </label>

      {p.mtimeMs != null && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          SAP al {formatoFrescura(p.mtimeMs)}
        </span>
      )}

      {p.descartadas > 0 && (
        // Se informa a proposito: el reporte se va a corregir en origen para
        // que estas lineas no vengan, y cuando eso pase el contador tiene que
        // bajar a cero de forma visible.
        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
              title="Líneas cuyo campo de sucursal trae una fecha en lugar del código. Son de cuentas de compras y no corresponden a ninguna sucursal.">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
          {p.descartadas} líneas sin sucursal ignoradas
        </span>
      )}

      <button onClick={p.onRefrescar} disabled={p.cargando}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-sm disabled:opacity-50">
        <RefreshCw className={`w-4 h-4 ${p.cargando ? 'animate-spin' : ''}`} aria-hidden />
        Refrescar
      </button>

      <button onClick={() => p.onDark(!p.dark)}
              title={p.dark ? 'Modo claro' : 'Modo oscuro'}
              aria-label={p.dark ? 'Modo claro' : 'Modo oscuro'}
              className="inline-flex items-center justify-center rounded border border-slate-300 dark:border-slate-600 p-1.5">
        {p.dark ? <Sun className="w-4 h-4" aria-hidden /> : <Moon className="w-4 h-4" aria-hidden />}
      </button>
    </header>
  )
}
