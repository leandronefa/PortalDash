import { X, AlertTriangle } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import { formatoFechaLarga, formatoImporte } from '@/src/lib/formato'
import type { Asiento } from '@/src/lib/api'

type Props = {
  asiento: Asiento | null
  cargando: boolean
  error: string | null
  onCerrar: () => void
}

/**
 * Panel lateral, NO modal: se puede seguir navegando la matriz con el detalle
 * abierto y comparar dias sin abrir y cerrar todo el tiempo.
 */
export function PanelAsiento({ asiento, cargando, error, onCerrar }: Props) {
  return (
    <aside className="w-full lg:w-[28rem] shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 h-fit lg:sticky lg:top-4">
      <div className="flex items-start gap-2 mb-2">
        <div className="mr-auto">
          <h2 className="font-semibold text-sm">Asiento del día</h2>
          {asiento && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sucursal {asiento.sucursal} · {formatoFechaLarga(asiento.fechaISO)}
            </p>
          )}
        </div>
        <button onClick={onCerrar} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Cerrar el panel">
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      {cargando && <p className="text-sm text-slate-500 dark:text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>}

      {asiento && !cargando && !error && (
        <>
          {!asiento.cuadra && (
            // Con datos de SAP no deberia pasar nunca; si pasa hay que verlo.
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 mb-2">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> El asiento no cuadra: debe ≠ haber
            </p>
          )}
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 text-left">
                <th scope="col" className="py-1 font-medium">Cuenta</th>
                <th scope="col" className="py-1 font-medium text-right">Debe</th>
                <th scope="col" className="py-1 font-medium text-right">Haber</th>
              </tr>
            </thead>
            <tbody>
              {asiento.lineas.map(l => (
                <tr key={l.cuentaCodigo}
                    className={cn('border-t border-slate-100 dark:border-slate-700',
                                  l.esDiferenciaCaja && 'font-semibold')}>
                  <td className="py-1 pr-2">
                    {l.esDiferenciaCaja && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                            style={{ backgroundColor: l.saldo > 0 ? 'var(--falt-2)' : 'var(--sobr-2)' }} aria-hidden />
                    )}
                    <span className="text-slate-500 dark:text-slate-400">{l.cuentaCodigo}</span>{' '}
                    {l.cuentaNombre}
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">{l.debe ? formatoImporte(l.debe) : ''}</td>
                  <td className="py-1 text-right whitespace-nowrap">{l.haber ? formatoImporte(l.haber) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-semibold">
                <td className="py-1">Totales</td>
                <td className="py-1 text-right whitespace-nowrap">{formatoImporte(asiento.totales.debe)}</td>
                <td className="py-1 text-right whitespace-nowrap">{formatoImporte(asiento.totales.haber)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}

      {!asiento && !cargando && !error && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Hacé clic en una celda de la matriz para ver el asiento de ese día.
        </p>
      )}
    </aside>
  )
}
