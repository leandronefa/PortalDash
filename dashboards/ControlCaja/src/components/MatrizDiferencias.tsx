import { useMemo, useState } from 'react'
import { cn } from '@/src/lib/utils'
import { calcularEscala, estiloDeCelda, formatoImporte, formatoImporteCorto } from '@/src/lib/formato'
import type { Matriz } from '@/src/lib/api'

type Props = {
  matriz: Matriz
  onCelda: (fechaISO: string, sucursal: string) => void
  seleccion: { fechaISO: string; sucursal: string } | null
}

export function MatrizDiferencias({ matriz, onCelda, seleccion }: Props) {
  // Por defecto las problematicas arriba (el backend ya las manda asi).
  const [ordenPorCodigo, setOrdenPorCodigo] = useState(false)

  const filas = useMemo(() => {
    if (!ordenPorCodigo) return matriz.sucursales
    return [...matriz.sucursales].sort((a, b) => a.codigo.localeCompare(b.codigo))
  }, [matriz.sucursales, ordenPorCodigo])

  // La escala se calcula sobre TODAS las celdas del mes para que la intensidad
  // sea comparable entre filas (si fuera por fila, un $500 de una sucursal
  // tranquila se veria igual que un $3M de otra).
  const escala = useMemo(
    () => calcularEscala(matriz.sucursales.flatMap(s => Object.values(s.dias))),
    [matriz.sucursales]
  )

  const th = 'sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs font-medium'
  const sucursalCol = 'sticky left-0 z-10 bg-white dark:bg-slate-900 px-2 py-1 text-left whitespace-nowrap'

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <span className="text-sm font-medium mr-auto">Diferencias de caja por día</span>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={ordenPorCodigo} onChange={e => setOrdenPorCodigo(e.target.checked)} />
          Ordenar por código
        </label>
        {/* Leyenda: la identidad nunca depende solo del color. */}
        <span className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--falt-2)' }} aria-hidden /> Faltante
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--sobr-2)' }} aria-hidden /> Sobrante
          </span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm tabular-nums">
          <caption className="sr-only">
            Diferencias de caja por sucursal y día. Valores positivos son faltantes, negativos sobrantes.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={cn(th, 'sticky left-0 z-30 text-left')}>Sucursal</th>
              {matriz.dias.map(d => <th scope="col" key={d} className={th}>{d}</th>)}
              <th scope="col" className={cn(th, 'text-right')}>Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(s => (
              <tr key={s.codigo} className="border-t border-slate-100 dark:border-slate-800">
                <th scope="row" className={cn(sucursalCol, 'font-normal')}>
                  <span className="font-medium">{s.codigo}</span>
                  {s.nombre && <span className="text-slate-500 dark:text-slate-400"> — {s.nombre}</span>}
                </th>
                {matriz.dias.map(d => {
                  const v = s.dias[d]
                  if (v == null) return <td key={d} className="px-1 py-0.5" />
                  const activa = seleccion?.fechaISO === `${matriz.periodo}-${d}` && seleccion?.sucursal === s.codigo
                  return (
                    <td key={d} className="p-0.5">
                      <button
                        onClick={() => onCelda(`${matriz.periodo}-${d}`, s.codigo)}
                        style={estiloDeCelda(v, escala)}
                        // 2px de aire entre celdas y anillo en la seleccionada:
                        // los fills no se tocan y la celda activa se distingue
                        // sin depender del color de fondo.
                        className={cn('w-full min-w-16 rounded px-1.5 py-1 text-xs text-right',
                                      activa && 'ring-2 ring-offset-1 ring-slate-900 dark:ring-white')}
                        title={`${s.codigo} · día ${d} · ${v > 0 ? 'faltante' : 'sobrante'} ${formatoImporte(Math.abs(v))} — clic para ver el asiento`}
                      >
                        {formatoImporteCorto(v)}
                      </button>
                    </td>
                  )
                })}
                <td className="px-2 py-1 text-right font-medium whitespace-nowrap">{formatoImporte(s.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 dark:border-slate-600">
              <th scope="row" className={cn(sucursalCol, 'font-medium')}>Total por día</th>
              {matriz.dias.map(d => (
                <td key={d} className="px-1.5 py-1 text-right text-xs whitespace-nowrap">
                  {matriz.totalesPorDia[d] != null ? formatoImporteCorto(matriz.totalesPorDia[d]) : ''}
                </td>
              ))}
              <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">{formatoImporte(matriz.granTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
