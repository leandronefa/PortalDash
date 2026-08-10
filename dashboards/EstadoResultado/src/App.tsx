import { useEffect, useState, useMemo, useCallback, Fragment, useRef } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevronRightNav, Moon, Sun, Upload, Download, ArrowUpDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card'
import {
  buildPLStatement, buildBranchSummary, buildBranchPL, topExpenses, buildMatrixPL,
  type SAPRecord, type PLStatement, type BranchSummary, type PLRow, type MatrixPL
} from '@/src/lib/data-processing'

// La etiqueta de empresa la define el backend (registro EMPRESAS en
// server/sap-store.js) y llega por /api/status: sumar una empresa no debe
// requerir tocar el frontend.
type Empresa = string
type EmpresaInfo = { key: string; label: Empresa; filename: string }

// Fallback para el primer render y para el caso de /api/status caido: sin esto
// el selector queda vacio y el tablero no muestra nada hasta que responda.
const EMPRESAS_FALLBACK: EmpresaInfo[] = [
  { key: 'tesi', label: 'TESI', filename: 'SAP_RESULT.txt' },
  { key: 'pueblo', label: 'PUEBLO', filename: 'SAP_PU_RESULT.txt' },
  { key: 'indo', label: 'INDO', filename: 'SAP_INDO_RESULT.txt' },
]
type TabId = 'resumen' | 'pl' | 'sucursal' | 'graficos'

const TABS: { id: TabId; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'pl', label: 'Estado de Resultado' },
  { id: 'sucursal', label: 'Por Sucursal' },
  { id: 'graficos', label: 'Gráficos' },
]

const nfAR0 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const nfAR1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function fmt(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    const abs = Math.abs(n)
    const s = n < 0 ? '-' : ''
    if (abs >= 1_000_000) return `${s}$${nfAR1.format(abs / 1_000_000)}M`
    if (abs >= 1_000) return `${s}$${nfAR0.format(abs / 1_000)}K`
    return `${s}$${nfAR0.format(abs)}`
  }
  return nfAR0.format(n)
}

function fmtARS(n: number): string {
  return n < 0 ? `($${fmt(Math.abs(n))})` : `$${fmt(n)}`
}

function ResultadoColor({ value }: { value: number }) {
  if (value > 0) return <span className="text-emerald-500 dark:text-emerald-400">{fmtARS(value)}</span>
  if (value < 0) return <span className="text-red-500 dark:text-red-400">{fmtARS(value)}</span>
  return <span className="text-slate-500 dark:text-slate-400">{fmtARS(value)}</span>
}

// ─── P&L Group (collapsible) ─────────────────────────────────────────────────
function PLGroupSection({
  label, rows, subtotal, defaultOpen = false, compact = false
}: {
  label: string; rows: PLRow[]; subtotal: number; defaultOpen?: boolean; compact?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  // Orden de las sub-filas de centro de costo: por importe (default) o por código
  const [sortByCentro, setSortByCentro] = useState(false)

  function toggleRow(cuenta: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(cuenta)) next.delete(cuenta)
      else next.add(cuenta)
      return next
    })
  }

  const hPad = compact ? 'px-3 py-1' : 'px-4 py-2'
  const rPad = compact ? 'px-3 py-0.5' : 'px-4 py-1.5'
  const valPad = compact ? 'px-3 py-0.5' : 'px-4 py-1.5'
  const sz = compact ? 'text-xs' : 'text-sm'
  const codeSz = compact ? 'text-[0.6rem]' : 'text-xs'
  const chevSz = compact ? 'w-2.5 h-2.5' : 'w-3 h-3'
  const indent1 = compact ? 'pl-7' : 'pl-8'
  const indent2 = compact ? 'pl-10' : 'pl-12'

  return (
    <tbody>
      {/* Cabecera del grupo */}
      <tr
        className="bg-slate-100 dark:bg-slate-700 cursor-pointer select-none hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <td className={`${hPad} font-semibold text-slate-700 dark:text-slate-200 ${sz} uppercase tracking-wide`}>
          <div className="flex items-center gap-1.5">
            {open
              ? <ChevronDown className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0`} />
              : <ChevronRight className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0`} />
            }
            {label}
            {!compact && (
              <button
                type="button"
                title={sortByCentro ? 'Ordenando por centro de costo — click para ordenar por importe' : 'Ordenando por importe — click para ordenar por centro de costo'}
                onClick={e => { e.stopPropagation(); setSortByCentro(v => !v) }}
                className="ml-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.65rem] font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <ArrowUpDown className="w-3 h-3" />
                {sortByCentro ? 'Centro de costo' : 'Importe'}
              </button>
            )}
          </div>
        </td>
        <td className={`${hPad} text-right font-semibold text-slate-700 dark:text-slate-200 ${sz} whitespace-nowrap`}>
          {fmtARS(subtotal)}
        </td>
      </tr>

      {open && rows.map(row => {
        const isIngreso = row.cuenta.startsWith('4.1')
        const rowExpanded = expandedRows.has(row.cuenta)
        // Sucursales con valor distinto de cero, en display sign
        const sucursales = Object.entries(row.bySucursal)
          .map(([suc, val]) => ({ sucursal: suc, displayVal: isIngreso ? -val : val }))
          .filter(s => s.displayVal !== 0)
          .sort((a, b) => sortByCentro ? a.sucursal.localeCompare(b.sucursal) : b.displayVal - a.displayVal)
        // Solo mostrar expand en la vista principal (no compact = BranchPLView)
        const expandable = !compact && sucursales.length > 0

        return (
          <Fragment key={row.cuenta}>
            {/* Fila de cuenta */}
            <tr
              className={`border-b border-slate-100 dark:border-slate-700/50 transition-colors ${
                expandable
                  ? `cursor-pointer select-none ${rowExpanded ? 'bg-indigo-50/40 dark:bg-indigo-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`
                  : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'
              }`}
              onClick={() => expandable && toggleRow(row.cuenta)}
            >
              <td className={`${rPad} ${indent1} ${sz} text-slate-600 dark:text-slate-300`}>
                <div className="flex items-center gap-1.5">
                  {expandable
                    ? (rowExpanded
                        ? <ChevronDown className={`${chevSz} shrink-0 text-indigo-400 dark:text-indigo-500`} />
                        : <ChevronRight className={`${chevSz} shrink-0 text-slate-300 dark:text-slate-600`} />
                      )
                    : <span className={`${chevSz} shrink-0 inline-block`} />
                  }
                  <span className={`text-slate-400 dark:text-slate-500 mr-1.5 font-mono ${codeSz}`}>{row.cuenta}</span>
                  {row.descripcion}
                </div>
              </td>
              <td className={`${valPad} text-right ${sz} font-mono whitespace-nowrap ${row.displayTotal < 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {fmtARS(row.displayTotal)}
              </td>
            </tr>

            {/* Sub-filas por sucursal */}
            {rowExpanded && sucursales.map(s => (
              <tr
                key={`${row.cuenta}-${s.sucursal}`}
                className="border-b border-slate-100 dark:border-slate-700/30 bg-indigo-50/25 dark:bg-indigo-950/10"
              >
                <td className={`${rPad} ${indent2} ${sz} text-slate-500 dark:text-slate-400`}>
                  <span className="text-slate-300 dark:text-slate-600 mr-2 select-none">↳</span>
                  <span className="font-mono">{s.sucursal}</span>
                </td>
                <td className={`${valPad} text-right ${sz} font-mono whitespace-nowrap ${s.displayVal < 0 ? 'text-red-400 dark:text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
                  {fmtARS(s.displayVal)}
                </td>
              </tr>
            ))}
          </Fragment>
        )
      })}
    </tbody>
  )
}

// ─── Desglose P&L de una sucursal ────────────────────────────────────────────
function BranchPLView({ records, sucursal }: { records: SAPRecord[]; sucursal: string }) {
  const branchPL = useMemo(() => buildBranchPL(records, sucursal), [records, sucursal])

  return (
    <div className="border-t border-indigo-100 dark:border-indigo-900 bg-white dark:bg-slate-800/60">
      <table className="w-full">
        {branchPL.ingresos.rows.length > 0 && (
          <PLGroupSection compact label="Ingresos" rows={branchPL.ingresos.rows} subtotal={branchPL.ingresos.subtotal} />
        )}
        {branchPL.gastosOperativos.rows.length > 0 && (
          <PLGroupSection compact label="Gastos Operativos" rows={branchPL.gastosOperativos.rows} subtotal={branchPL.gastosOperativos.subtotal} />
        )}
        {branchPL.serviciosCentrales.rows.length > 0 && (
          <PLGroupSection compact label="Servicios Centrales" rows={branchPL.serviciosCentrales.rows} subtotal={branchPL.serviciosCentrales.subtotal} />
        )}
        {branchPL.resultadosFinancieros.rows.length > 0 && (
          <PLGroupSection compact label="Resultados Financieros" rows={branchPL.resultadosFinancieros.rows} subtotal={branchPL.resultadosFinancieros.subtotal} />
        )}
        <tbody>
          {branchPL.totalGastos !== 0 && (
            <tr className="border-t border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50">
              <td className="px-3 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Total Gastos</td>
              <td className="px-3 py-1 text-right text-xs font-bold text-red-500 dark:text-red-400 whitespace-nowrap">{fmtARS(branchPL.totalGastos)}</td>
            </tr>
          )}
          <tr className="bg-slate-100 dark:bg-slate-700 border-t border-slate-300 dark:border-slate-600">
            <td className="px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">Resultado</td>
            <td className="px-3 py-1.5 text-right text-xs font-bold whitespace-nowrap">
              <ResultadoColor value={branchPL.resultado} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── Fila de sucursal (expandible) ───────────────────────────────────────────
function SucursalRow({
  branch, records, expanded, onToggle
}: {
  branch: BranchSummary; records: SAPRecord[]; expanded: boolean; onToggle: () => void
}) {
  return (
    <>
      <tr
        className={`border-b border-slate-100 dark:border-slate-700 cursor-pointer select-none transition-colors ${
          expanded
            ? 'bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-950/60'
            : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'
        }`}
        onClick={onToggle}
      >
        <td className="px-4 py-2.5 font-mono font-medium text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-2">
            {expanded
              ? <ChevronDown className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
              : <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
            }
            {branch.sucursal}
          </div>
        </td>
        <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300 font-mono text-sm">{fmtARS(branch.ventasNetas)}</td>
        <td className="px-4 py-2.5 text-right text-red-500 dark:text-red-400 font-mono text-sm">{fmtARS(branch.totalGastos)}</td>
        <td className="px-4 py-2.5 text-right font-mono text-sm font-medium">
          <ResultadoColor value={branch.resultado} />
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="p-0 border-b border-indigo-200 dark:border-indigo-800">
            <BranchPLView records={records} sucursal={branch.sucursal} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Vista Resumen: matriz P&L por sucursal (estilo Excel contable) ──────────
function sucLabel(code: string): string {
  return `SUC${code.replace(/^0/, '')}`
}

function pct(num: number, den: number, decimals = 0): string {
  if (den === 0) return '–'
  return `${((num / den) * 100).toFixed(decimals)}%`
}

// Semáforo para G/V% (menor = mejor). El valor SIEMPRE está impreso en la celda:
// el color es refuerzo, no la única codificación.
function heatClass(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0
  if (t < 0.2) return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
  if (t < 0.4) return 'bg-lime-100 dark:bg-lime-900/40 text-lime-800 dark:text-lime-300'
  if (t < 0.6) return 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300'
  if (t < 0.8) return 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300'
  return 'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-300'
}

function MatrixView({ matrix, periodoStr }: { matrix: MatrixPL; periodoStr: string | null }) {
  const { totales } = matrix
  const t = totales

  // Sucursales como filas, ordenadas por ventas desc (como el Excel de contabilidad)
  const filas = useMemo(
    () => [...matrix.columnas].sort((a, b) => b.ventas - a.ventas),
    [matrix]
  )
  const gvRatios = filas.map(f => (f.ventas !== 0 ? f.directos / f.ventas : 0))
  const gvMin = Math.min(...gvRatios)
  const gvMax = Math.max(...gvRatios)

  const th = 'px-3 py-2 text-right text-[0.68rem] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 whitespace-nowrap border-l border-slate-300 dark:border-slate-600'
  const num = 'px-3 py-1.5 text-right font-mono text-xs whitespace-nowrap border-l border-slate-200 dark:border-slate-700'
  const pctCell = `${num} text-slate-500 dark:text-slate-400`

  function Money({ value, bold = false, highlightNeg = false }: { value: number; bold?: boolean; highlightNeg?: boolean }) {
    const isNeg = value < 0
    return (
      <td className={`${num} ${bold ? 'font-semibold' : ''} ${
        isNeg
          ? highlightNeg
            ? 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 font-semibold'
            : 'text-red-500 dark:text-red-400'
          : 'text-slate-700 dark:text-slate-200'
      }`}>
        {nfAR0.format(Math.round(value))}
      </td>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-200 dark:bg-slate-700 border-b-2 border-slate-400 dark:border-slate-500">
                <th className="px-3 py-2 text-left text-[0.68rem] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 capitalize whitespace-nowrap border-r-2 border-slate-300 dark:border-slate-600">
                  {periodoStr ?? 'Sucursal'}
                </th>
                <th className={th}>Ventas</th>
                <th className={th}>%</th>
                <th className={th}>Costo de Ventas</th>
                <th className={th}>Margen Bruto</th>
                <th className={th}>Mg %</th>
                <th className={th}>Gastos Directos</th>
                <th className={th}>Contribución</th>
                <th className={th}>%</th>
                <th className={th}>G/V %</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const gv = f.ventas !== 0 ? f.directos / f.ventas : 0
                const contrPct = f.ventas !== 0 ? f.contribucion / f.ventas : 0
                return (
                  <tr key={f.sucursal} className="border-b border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 py-1.5 text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap border-r-2 border-slate-200 dark:border-slate-600">
                      {sucLabel(f.sucursal)}
                    </td>
                    <Money value={f.ventas} bold />
                    <td className={pctCell}>{pct(f.ventas, t.ventas)}</td>
                    <Money value={f.costo} />
                    <Money value={f.margen} />
                    <td className={pctCell}>{pct(f.margen, f.ventas, 1)}</td>
                    <Money value={f.directos} />
                    <Money value={f.contribucion} bold highlightNeg />
                    <td className={`${num} ${f.contribucion < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                      {pct(f.contribucion, f.ventas)}
                    </td>
                    <td className={`${num} font-semibold ${heatClass(gvRatios[i], gvMin, gvMax)}`}>
                      {(gv * 100).toFixed(0)}%
                    </td>
                  </tr>
                )
              })}
              {/* TOTAL */}
              <tr className="border-t-2 border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700 font-bold">
                <td className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100 border-r-2 border-slate-300 dark:border-slate-600">Total</td>
                <Money value={t.ventas} bold />
                <td className={pctCell}>100%</td>
                <Money value={t.costo} bold />
                <Money value={t.margen} bold />
                <td className={`${pctCell} font-bold text-slate-700 dark:text-slate-200`}>{pct(t.margen, t.ventas, 1)}</td>
                <Money value={t.directos} bold />
                <Money value={t.contribucion} bold highlightNeg />
                <td className={`${num} font-bold ${t.contribucion < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>
                  {pct(t.contribucion, t.ventas)}
                </td>
                <td className={`${num} font-bold text-slate-700 dark:text-slate-200`}>{pct(t.directos, t.ventas)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cuadro de totales (como el Excel) */}
      <Card className="w-full sm:w-[30rem]">
        <table className="w-full text-sm">
          <tbody>
            {([
              { label: 'Total Ventas', value: t.ventas, bold: true },
              { label: 'Total costo de ventas', value: t.costo },
              { label: 'Margen Bruto', value: t.margen, bold: true, extra: pct(t.margen, t.ventas, 1) },
              { label: 'Total gastos directos', value: t.directos },
              { label: 'Total gastos indirectos', value: t.indirectos, extra: nfAR0.format(Math.round(t.totalGastos)) },
            ] as { label: string; value: number; bold?: boolean; extra?: string }[]).map(row => (
              <tr key={row.label} className={`border-b border-slate-100 dark:border-slate-700 ${row.bold ? 'bg-slate-100 dark:bg-slate-700/50' : ''}`}>
                <td className={`px-3 py-1.5 text-xs ${row.bold ? 'font-bold' : 'font-medium'} text-slate-700 dark:text-slate-200`}>{row.label}</td>
                <td className={`px-3 py-1.5 text-right font-mono text-xs whitespace-nowrap ${row.bold ? 'font-bold' : ''} ${row.value < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>
                  {nfAR0.format(Math.round(row.value))}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-[0.68rem] text-slate-400 dark:text-slate-500 whitespace-nowrap w-20">
                  {row.extra ?? ''}
                </td>
              </tr>
            ))}
            <tr className={`border-t-2 border-slate-300 dark:border-slate-600 ${t.utilidad < 0 ? 'bg-red-50 dark:bg-red-950/40' : 'bg-emerald-50 dark:bg-emerald-950/40'}`}>
              <td className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">Utilidad neta</td>
              <td className={`px-3 py-2 text-right font-mono text-xs font-bold whitespace-nowrap ${t.utilidad < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {nfAR0.format(Math.round(t.utilidad))}
              </td>
              <td className="px-2 py-2 text-right font-mono text-[0.68rem] text-slate-400 dark:text-slate-500 w-20">
                {pct(t.utilidad, t.ventas)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="px-3 py-2 text-[0.65rem] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700">
          Gastos indirectos = centros de costo + servicios centrales + resultados financieros, prorrateados por participación en ventas.
          G/V % = gastos directos sobre ventas (verde = menor, rojo = mayor).
        </p>
      </Card>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
// Origen de cada periodo en el manifest: 'sap' (vino de la red) o 'manual' (ajustado a mano).
type OrigenPeriodo = { origen: 'sap' | 'manual'; cargadoEn: string }
// Indexado por la clave interna de cada empresa ('tesi', 'pueblo', 'indo', ...).
type Manifest = Record<string, Record<string, OrigenPeriodo>>

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [empresa, setEmpresa] = useState<Empresa>('TESI')
  const [records, setRecords] = useState<SAPRecord[] | null>(null)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('resumen')
  const [sortField, setSortField] = useState<'sucursal' | 'ventasNetas' | 'totalGastos' | 'resultado'>('ventasNetas')
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set())
  const [empresas, setEmpresas] = useState<EmpresaInfo[]>(EMPRESAS_FALLBACK)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedPeriodo, setSelectedPeriodo] = useState<string | null>(null)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [downloading, setDownloading] = useState(false)
  // Id del setTimeout pendiente que limpia uploadMsg, para poder cancelarlo si llega un mensaje nuevo antes de tiempo.
  const uploadMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.empresas) && d.empresas.length > 0) setEmpresas(d.empresas)
        setSourcePath(d.sourcePath)
        setManifest(d.manifest ?? null)
        // El manifest puede venir null si el manifest.json del servidor esta corrupto/inconsistente.
        // En ese caso el backend manda el motivo en manifestError: avisamos porque Actualizar no va a poder traer datos.
        if (!d.manifest && d.manifestError) {
          setUploadMsg({ ok: false, text: d.manifestError })
        }
      })
      .catch(() => {})
  }, [])

  const fetchData = useCallback(async (emp: Empresa) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/data?empresa=${emp}`)
      const json = await res.json()
      setRecords(json.records)
      setLastUpdate(json.lastUpdate)
    } catch {
      setRecords(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(empresa)
    setExpandedBranches(new Set())
  }, [empresa, fetchData])

  function toggleBranch(sucursal: string) {
    setExpandedBranches(prev => {
      const next = new Set(prev)
      if (next.has(sucursal)) next.delete(sucursal)
      else next.add(sucursal)
      return next
    })
  }

  const periodos = useMemo<string[]>(() => {
    if (!records) return []
    const set = new Set<string>()
    for (const r of records) { if (r.periodo) set.add(r.periodo) }
    return [...set].sort().reverse()
  }, [records])

  useEffect(() => {
    if (periodos.length === 0) return
    setSelectedPeriodo(prev => periodos.includes(prev ?? '') ? prev : periodos[0])
  }, [periodos])

  const filteredRecords = useMemo<SAPRecord[] | null>(() => {
    if (!records) return null
    if (!selectedPeriodo) return records
    return records.filter(r => r.periodo === selectedPeriodo)
  }, [records, selectedPeriodo])

  const pl = useMemo<PLStatement | null>(() => filteredRecords ? buildPLStatement(filteredRecords) : null, [filteredRecords])
  const branches = useMemo<BranchSummary[]>(() => filteredRecords ? buildBranchSummary(filteredRecords) : [], [filteredRecords])
  const sortedBranches = useMemo(() => [...branches].sort((a, b) => {
    if (sortField === 'sucursal') return a.sucursal.localeCompare(b.sucursal)
    return b[sortField] - a[sortField]
  }), [branches, sortField])
  const chartData = useMemo(() => pl ? topExpenses(pl, 15) : [], [pl])
  const matrix = useMemo<MatrixPL | null>(() => filteredRecords ? buildMatrixPL(filteredRecords) : null, [filteredRecords])

  // Info de ajuste manual del mes visible, para la empresa actualmente seleccionada.
  const ajusteDelPeriodo = useMemo<OrigenPeriodo | null>(() => {
    if (!manifest || !selectedPeriodo) return null
    const key = empresas.find(e => e.label === empresa)?.key ?? empresa.toLowerCase()
    const info = manifest[key]?.[selectedPeriodo]
    return info?.origen === 'manual' ? info : null
  }, [manifest, empresa, empresas, selectedPeriodo])

  // Programa el borrado automatico del banner, cancelando cualquier timer anterior
  // pendiente: si el usuario encadena Actualizar -> Subir files, el timer del primer
  // mensaje no debe pisar al mensaje del segundo antes de tiempo.
  function scheduleClearUploadMsg(ms: number) {
    if (uploadMsgTimerRef.current) clearTimeout(uploadMsgTimerRef.current)
    uploadMsgTimerRef.current = setTimeout(() => setUploadMsg(null), ms)
  }

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    if (uploadMsgTimerRef.current) clearTimeout(uploadMsgTimerRef.current)
    setUploadMsg(null)
    try {
      const r = await (await fetch('/api/refresh', { method: 'POST' })).json()
      const partes: string[] = []
      for (const { key, label } of empresas) {
        const e = r.empresas?.[key]
        if (!e) continue
        if (!e.ok) { partes.push(`${label}: ${e.error ?? 'no se pudo actualizar'}`); continue }
        const traidos = e.traidos?.length ? `${e.traidos.length} mes(es) de SAP` : 'sin cambios'
        const preservados = e.preservados?.length ? `, preservados con ajustes: ${e.preservados.join(', ')}` : ''
        partes.push(`${label}: ${traidos}${preservados}`)
      }
      setUploadMsg({ ok: !!r.ok, text: partes.join(' · ') || 'No se pudo actualizar' })
      await fetchData(empresa)
      const st = await (await fetch('/api/status')).json()
      setManifest(st.manifest ?? null)
    } catch {
      setUploadMsg({ ok: false, text: 'Error al actualizar desde la red' })
    } finally {
      setRefreshing(false)
      scheduleClearUploadMsg(8000)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    if (uploadMsgTimerRef.current) clearTimeout(uploadMsgTimerRef.current)
    setUploadMsg(null)
    try {
      const form = new FormData()
      for (const f of files) form.append('files', f)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const json = await res.json()
      // El backend puede responder 409 si hay un refresh de red en curso: json.message ya trae
      // el texto para el usuario (pedirle que reintente), no lo tapamos con uno genérico.
      setUploadMsg({ ok: !!json.ok, text: json.message ?? 'Error al subir los archivos' })
      if (json.ok) {
        await fetchData(empresa)
        const st = await (await fetch('/api/status')).json()
        setManifest(st.manifest ?? null)
      }
    } catch {
      setUploadMsg({ ok: false, text: 'Error al subir los archivos' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      scheduleClearUploadMsg(5000)
    }
  }

  async function handleDownload() {
    if (downloading) return
    setDownloading(true)
    if (uploadMsgTimerRef.current) clearTimeout(uploadMsgTimerRef.current)
    setUploadMsg(null)
    // Nombres reales de SAP: el usuario los edita a mano y los vuelve a subir, y el
    // backend valida el upload por nombre de archivo — no se puede dejar vacio.
    const targets: Array<{ empresa: Empresa; filename: string }> =
      empresas.map(e => ({ empresa: e.label, filename: e.filename }))
    const fallas: string[] = []
    let bajados = 0
    try {
      // Nota: aun bajando desde blobs (no <a href> directo), Chrome puede pedirle
      // permiso al usuario la primera vez que un sitio dispara varias descargas
      // seguidas ("Allow multiple downloads"). Es esperado, no un bug: el usuario
      // lo concede una sola vez y despues las dos descargas salen sin aviso.
      for (const { empresa: emp, filename } of targets) {
        try {
          const res = await fetch(`/api/download?empresa=${emp}`)
          if (!res.ok) {
            let msg = `no se encontraron datos cargados (HTTP ${res.status})`
            try {
              const json = await res.json()
              if (json?.message) msg = json.message
            } catch { /* respuesta sin JSON: nos quedamos con el mensaje generico */ }
            fallas.push(`${emp}: ${msg}`)
            continue
          }
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
          bajados++
        } catch {
          fallas.push(`${emp}: error al descargar`)
        }
      }
      if (fallas.length === 0) {
        setUploadMsg({ ok: true, text: `Se descargaron los ${targets.length} archivos` })
      } else if (bajados > 0) {
        setUploadMsg({ ok: false, text: `Se descargaron ${bajados} archivo(s). Fallo: ${fallas.join(' · ')}` })
      } else {
        setUploadMsg({ ok: false, text: `No se pudo descargar ningun archivo. ${fallas.join(' · ')}` })
      }
    } finally {
      setDownloading(false)
      scheduleClearUploadMsg(8000)
    }
  }

  const updatedStr = lastUpdate
    ? new Date(lastUpdate).toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const periodoStr = selectedPeriodo
    ? new Date(selectedPeriodo + '-02').toLocaleString('es-AR', { month: 'long', year: 'numeric' })
    : null

  function formatPeriodoOption(p: string): string {
    return new Date(p + '-02').toLocaleString('es-AR', { month: 'long', year: 'numeric' })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              Estado de Resultado
              {periodoStr && <span className="ml-2 text-sm font-normal text-indigo-600 dark:text-indigo-400 capitalize">{periodoStr}</span>}
            </h1>
            {updatedStr && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Actualizado: {updatedStr}</p>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            {/* Company selector */}
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-sm font-medium">
              {empresas.map(({ key, label: emp }) => (
                <button
                  key={key}
                  onClick={() => setEmpresa(emp)}
                  className={`px-4 py-2 transition-colors ${
                    empresa === emp
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {emp}
                </button>
              ))}
            </div>

            {/* Period selector: ‹ mes › (periodos ordenados de más nuevo a más viejo) */}
            {periodos.length > 0 && (
              <div className="flex items-center rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 overflow-hidden">
                <button
                  onClick={() => {
                    const i = periodos.indexOf(selectedPeriodo ?? '')
                    if (i < periodos.length - 1) setSelectedPeriodo(periodos[i + 1])
                  }}
                  disabled={periodos.indexOf(selectedPeriodo ?? '') >= periodos.length - 1}
                  className="px-2.5 py-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-30 disabled:cursor-default transition-colors"
                  title="Mes anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <select
                  value={selectedPeriodo ?? ''}
                  onChange={e => setSelectedPeriodo(e.target.value)}
                  className="px-2 py-2 text-sm font-semibold bg-transparent text-indigo-700 dark:text-indigo-300 focus:outline-none capitalize cursor-pointer"
                  title="Elegir mes a visualizar"
                >
                  {periodos.map(p => (
                    <option key={p} value={p} className="capitalize bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200">{formatPeriodoOption(p)}</option>
                  ))}
                </select>
                {ajusteDelPeriodo && (
                  <span
                    className="w-2 h-2 mr-1 rounded-full bg-amber-500 shrink-0"
                    title={`Mes con ajustes manuales, cargado el ${new Date(ajusteDelPeriodo.cargadoEn).toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Actualizar no lo va a sobrescribir.`}
                  />
                )}
                <button
                  onClick={() => {
                    const i = periodos.indexOf(selectedPeriodo ?? '')
                    if (i > 0) setSelectedPeriodo(periodos[i - 1])
                  }}
                  disabled={periodos.indexOf(selectedPeriodo ?? '') <= 0}
                  className="px-2.5 py-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-30 disabled:cursor-default transition-colors"
                  title="Mes siguiente"
                >
                  <ChevronRightNav className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              title={sourcePath ? `Verifica archivos SAP en:\n${sourcePath}` : 'Chequear nuevos archivos SAP en la ruta de red'}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Actualizar
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              multiple
              className="hidden"
              onChange={handleUpload}
            />
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              title={`Descargar ${empresas.map(e => e.filename).join(', ')} tal como están cargados, para ajustarlos y volver a subirlos`}
            >
              <Download className={`w-4 h-4 ${downloading ? 'animate-pulse' : ''}`} />
              Descargar files
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              title={`Subir desde tu PC uno o varios de: ${empresas.map(e => e.filename).join(', ')}`}
            >
              <Upload className={`w-4 h-4 ${uploading ? 'animate-pulse' : ''}`} />
              Subir files
            </button>

            {/* Dark mode toggle */}
            <button
              onClick={() => setDark(d => !d)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              title={dark ? 'Modo claro' : 'Modo oscuro'}
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {uploadMsg && (
        <div className={`px-6 py-2 text-sm text-center ${uploadMsg.ok ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
          {uploadMsg.text}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {loading && (
          <div className="text-center py-12 text-slate-400 dark:text-slate-500">Cargando datos...</div>
        )}

        {!loading && !records && (
          <div className="text-center py-12 text-slate-400 dark:text-slate-500">
            <p className="text-lg font-medium mb-2">Sin datos disponibles</p>
            <p className="text-sm">Los archivos SAP se verifican diariamente a las 01:00 AM desde la red.</p>
            <p className="text-sm mt-1">Hacé clic en <strong>Actualizar</strong> para verificar ahora.</p>
          </div>
        )}

        {!loading && pl && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Ventas Netas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{fmt(pl.totalIngresos, { compact: true })}</span>
                    <TrendingUp className="w-6 h-6 text-emerald-400 dark:text-emerald-500" />
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{fmt(pl.totalIngresos)} ARS</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Gastos</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <span className="text-2xl font-bold text-red-500 dark:text-red-400">{fmt(pl.totalGastos, { compact: true })}</span>
                    <TrendingDown className="w-6 h-6 text-red-400 dark:text-red-500" />
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{fmt(pl.totalGastos)} ARS</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Resultado</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <span className={`text-2xl font-bold ${pl.resultado >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {fmt(pl.resultado, { compact: true })}
                    </span>
                    {pl.resultado >= 0
                      ? <TrendingUp className="w-6 h-6 text-emerald-400 dark:text-emerald-500" />
                      : <TrendingDown className="w-6 h-6 text-red-400 dark:text-red-500" />
                    }
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    Margen: {pl.totalIngresos > 0 ? ((pl.resultado / pl.totalIngresos) * 100).toFixed(1) : '–'}%
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200 dark:border-slate-700">
              <nav className="flex" role="tablist">
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Tab: Resumen (matriz por sucursal) */}
            {activeTab === 'resumen' && matrix && (
              <MatrixView matrix={matrix} periodoStr={periodoStr} />
            )}

            {/* Tab: Estado de Resultado */}
            {activeTab === 'pl' && (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                        <th className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold w-full">Cuenta</th>
                        <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">Importe ARS</th>
                      </tr>
                    </thead>
                    <PLGroupSection label="Ingresos" rows={pl.ingresos.rows} subtotal={pl.ingresos.subtotal} />
                    <PLGroupSection label="Gastos Operativos" rows={pl.gastosOperativos.rows} subtotal={pl.gastosOperativos.subtotal} />
                    {pl.serviciosCentrales.rows.length > 0 && (
                      <PLGroupSection label="Servicios Centrales" rows={pl.serviciosCentrales.rows} subtotal={pl.serviciosCentrales.subtotal} defaultOpen={false} />
                    )}
                    {pl.resultadosFinancieros.rows.length > 0 && (
                      <PLGroupSection label="Resultados Financieros" rows={pl.resultadosFinancieros.rows} subtotal={pl.resultadosFinancieros.subtotal} defaultOpen={false} />
                    )}
                    <tbody>
                      <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50">
                        <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">Total Gastos</td>
                        <td className="px-4 py-2.5 text-right font-bold text-red-600 dark:text-red-400">{fmtARS(pl.totalGastos)}</td>
                      </tr>
                      <tr className="border-t border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700">
                        <td className="px-4 py-3 font-bold text-base text-slate-800 dark:text-slate-100 uppercase tracking-wide">Resultado</td>
                        <td className="px-4 py-3 text-right font-bold text-base">
                          <ResultadoColor value={pl.resultado} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Tab: Por Sucursal */}
            {activeTab === 'sucursal' && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Resultado por Sucursal</CardTitle>
                    <span className="text-xs text-slate-400 dark:text-slate-500">Clic en una fila para ver el desglose completo</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
                          {([
                            { key: 'sucursal', label: 'Sucursal' },
                            { key: 'ventasNetas', label: 'Ventas Netas' },
                            { key: 'totalGastos', label: 'Total Gastos' },
                            { key: 'resultado', label: 'Resultado' },
                          ] as const).map(col => (
                            <th
                              key={col.key}
                              className={`px-4 py-3 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold cursor-pointer hover:text-slate-800 dark:hover:text-slate-200 select-none ${col.key === 'sucursal' ? 'text-left' : 'text-right'}`}
                              onClick={() => setSortField(col.key)}
                            >
                              {col.label}{sortField === col.key && ' ↓'}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBranches.map(b => (
                          <SucursalRow
                            key={b.sucursal}
                            branch={b}
                            records={filteredRecords!}
                            expanded={expandedBranches.has(b.sucursal)}
                            onToggle={() => toggleBranch(b.sucursal)}
                          />
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 font-bold">
                          <td className="px-4 py-2.5 pl-10 text-slate-700 dark:text-slate-200">TOTAL</td>
                          <td className="px-4 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400">{fmtARS(pl.totalIngresos)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-red-600 dark:text-red-400">{fmtARS(pl.totalGastos)}</td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            <ResultadoColor value={pl.resultado} />
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tab: Gráficos */}
            {activeTab === 'graficos' && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Top Gastos por Rubro</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={420}>
                      <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 80, left: 220, bottom: 0 }}>
                        <XAxis
                          type="number"
                          tickFormatter={v => fmt(v, { compact: true })}
                          tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#94a3b8' }}
                          axisLine={false} tickLine={false}
                        />
                        <YAxis
                          type="category" dataKey="descripcion" width={210}
                          tick={{ fontSize: 11, fill: dark ? '#94a3b8' : '#475569' }}
                          axisLine={false} tickLine={false}
                        />
                        <Tooltip
                          formatter={(v: number) => [`$${fmt(v)}`, 'Importe']}
                          contentStyle={{
                            fontSize: 12, borderRadius: 6,
                            backgroundColor: dark ? '#1e293b' : '#fff',
                            borderColor: dark ? '#334155' : '#e2e8f0',
                            color: dark ? '#e2e8f0' : '#1e293b'
                          }}
                        />
                        <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                          {chartData.map((_, i) => (
                            <Cell key={i} fill={i < 3 ? '#ef4444' : i < 6 ? '#f97316' : '#6366f1'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Resumen Ingresos vs Gastos</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { label: 'Ventas Netas', value: pl.totalIngresos, color: 'bg-emerald-500' },
                        { label: 'Gastos Operativos', value: pl.gastosOperativos.subtotal, color: 'bg-orange-400' },
                        { label: 'Servicios Centrales', value: pl.serviciosCentrales.subtotal, color: 'bg-amber-400' },
                        { label: 'Resultados Financieros', value: Math.abs(pl.resultadosFinancieros.subtotal), color: 'bg-purple-400' },
                      ].map(item => {
                        const pct = pl.totalIngresos > 0 ? (item.value / pl.totalIngresos) * 100 : 0
                        return (
                          <div key={item.label} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {fmt(item.value, { compact: true })} ({pct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                          </div>
                        )
                      })}
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between text-sm font-semibold">
                        <span className="text-slate-700 dark:text-slate-200">Resultado</span>
                        <ResultadoColor value={pl.resultado} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
