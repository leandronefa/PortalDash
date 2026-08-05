import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/src/lib/utils'
import { calcularEscala, estiloDeCelda, formatoImporte, formatoImporteCorto } from '@/src/lib/formato'
import { filtrarSucursales, totalesDeFilas } from '@/src/lib/filtroSucursales'
import type { Matriz } from '@/src/lib/api'

type Props = {
  matriz: Matriz
  onCelda: (fechaISO: string, sucursal: string) => void
  seleccion: { fechaISO: string; sucursal: string } | null
}

export function MatrizDiferencias({ matriz, onCelda, seleccion }: Props) {
  // Por defecto las problematicas arriba (el backend ya las manda asi).
  const [ordenPorCodigo, setOrdenPorCodigo] = useState(false)
  const [filtroTexto, setFiltroTexto] = useState('')
  // Codigos ocultados desde la lista de checkboxes. Un Set de OCULTAS (no de
  // "seleccionadas") para que una sucursal nueva que aparece en otro mes entre
  // visible por defecto, sin tener que sincronizar la lista completa cada vez
  // que cambia el conjunto de sucursales del periodo.
  const [ocultas, setOcultas] = useState<ReadonlySet<string>>(new Set())
  const [listaAbierta, setListaAbierta] = useState(false)
  const listaRef = useRef<HTMLDivElement>(null)

  // El universo de sucursales es el de la empresa, no el del mes: si se oculta
  // una sucursal y despues se cambia de mes, tiene que seguir oculta (es una
  // eleccion del usuario, no un dato del periodo). Cambiar de EMPRESA si limpia
  // los filtros, porque son dos universos de codigos sin relacion entre si.
  useEffect(() => { setOcultas(new Set()); setFiltroTexto('') }, [matriz.empresa])

  // Cierra la lista de checkboxes al clickear afuera o con Escape.
  useEffect(() => {
    if (!listaAbierta) return
    function onClick(e: MouseEvent) {
      if (listaRef.current && !listaRef.current.contains(e.target as Node)) setListaAbierta(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setListaAbierta(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [listaAbierta])

  const filas = useMemo(() => {
    const base = ordenPorCodigo
      ? [...matriz.sucursales].sort((a, b) => a.codigo.localeCompare(b.codigo))
      : matriz.sucursales
    return filtrarSucursales(base, filtroTexto, ocultas)
  }, [matriz.sucursales, ordenPorCodigo, filtroTexto, ocultas])

  // La escala se calcula sobre TODAS las celdas del mes, no solo las filas
  // filtradas, para que la intensidad no cambie de significado al filtrar (un
  // color de nivel 3 sigue queriendo decir "grande para el mes", no "grande
  // entre las sucursales que quedaron visibles").
  const escala = useMemo(
    () => calcularEscala(matriz.sucursales.flatMap(s => Object.values(s.dias))),
    [matriz.sucursales]
  )

  // Los totales del pie reflejan SOLO las filas visibles: mostrar el total del
  // mes completo mientras se filtra a una sola sucursal seria mentir sobre lo
  // que se esta viendo.
  const { totalesPorDia, granTotal } = useMemo(
    () => totalesDeFilas(filas, matriz.dias),
    [filas, matriz.dias]
  )

  const hayFiltroActivo = filtroTexto.trim() !== '' || ocultas.size > 0

  const th = 'sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs font-medium'
  const sucursalCol = 'sticky left-0 z-10 bg-white dark:bg-slate-900 px-2 py-1 text-left whitespace-nowrap'

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
        <span className="text-sm font-medium">Diferencias de caja por día</span>

        <label className="relative flex items-center">
          <Search className="w-3.5 h-3.5 absolute left-2 text-slate-400" aria-hidden />
          <span className="sr-only">Buscar sucursal</span>
          <input
            type="search"
            value={filtroTexto}
            onChange={e => setFiltroTexto(e.target.value)}
            placeholder="Buscar sucursal…"
            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-7 pr-2 py-1 text-xs w-40"
          />
        </label>

        <div className="relative" ref={listaRef}>
          <button
            onClick={() => setListaAbierta(v => !v)}
            aria-expanded={listaAbierta}
            className="flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs bg-white dark:bg-slate-900"
          >
            Sucursales ({matriz.sucursales.length - ocultas.size}/{matriz.sucursales.length})
            <ChevronDown className="w-3 h-3" aria-hidden />
          </button>
          {listaAbierta && (
            <div className="absolute z-40 mt-1 w-48 max-h-64 overflow-auto rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg p-1.5">
              <div className="flex gap-2 px-1 pb-1.5 mb-1 border-b border-slate-100 dark:border-slate-700 text-xs">
                <button className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setOcultas(new Set())}>
                  Todas
                </button>
                <button
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                  onClick={() => setOcultas(new Set(matriz.sucursales.map(s => s.codigo)))}
                >
                  Ninguna
                </button>
              </div>
              {matriz.sucursales.map(s => (
                <label key={s.codigo} className="flex items-center gap-1.5 px-1 py-0.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-700">
                  <input
                    type="checkbox"
                    checked={!ocultas.has(s.codigo)}
                    onChange={e => {
                      const siguiente = new Set(ocultas)
                      if (e.target.checked) siguiente.delete(s.codigo)
                      else siguiente.add(s.codigo)
                      setOcultas(siguiente)
                    }}
                  />
                  <span className="font-medium">{s.codigo}</span>
                  {s.nombre && <span className="text-slate-500 dark:text-slate-400 truncate">— {s.nombre}</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={ordenPorCodigo} onChange={e => setOrdenPorCodigo(e.target.checked)} />
          Ordenar por código
        </label>

        {/* Leyenda: la identidad nunca depende solo del color. */}
        <span className="flex items-center gap-3 text-xs ml-auto">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--falt-2)' }} aria-hidden /> Faltante
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--sobr-2)' }} aria-hidden /> Sobrante
          </span>
        </span>
      </div>

      {filas.length === 0 && (
        <p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">
          Ninguna sucursal coincide con el filtro.
        </p>
      )}

      {filas.length > 0 && (
      <>
      {/* max-h fija: sin ella el contenedor solo scrollea horizontal (su alto
          se ajusta al contenido) y el header `sticky top-0` no tiene contra que
          fijarse. Con un eje vertical real, el header queda fijo igual que la
          columna de sucursal. */}
      <div className="overflow-auto max-h-[75vh]">
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
              <th scope="row" className={cn(sucursalCol, 'font-medium')}>
                {hayFiltroActivo ? 'Total filtrado' : 'Total por día'}
              </th>
              {matriz.dias.map(d => (
                <td key={d} className="px-1.5 py-1 text-right text-xs whitespace-nowrap">
                  {totalesPorDia[d] != null ? formatoImporteCorto(totalesPorDia[d]) : ''}
                </td>
              ))}
              <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">{formatoImporte(granTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      </>
      )}
    </div>
  )
}
