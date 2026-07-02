import { useEffect, useState, useMemo, useCallback, Fragment, useRef } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight, Moon, Sun, Upload } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/src/components/ui/card'
import {
  buildPLStatement, buildBranchSummary, buildBranchPL, topExpenses,
  type SAPRecord, type PLStatement, type BranchSummary, type PLRow
} from '@/src/lib/data-processing'

type Empresa = 'TESI' | 'PUEBLO'
type TabId = 'pl' | 'sucursal' | 'graficos'

const TABS: { id: TabId; label: string }[] = [
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
          .sort((a, b) => b.displayVal - a.displayVal)
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [empresa, setEmpresa] = useState<Empresa>('TESI')
  const [records, setRecords] = useState<SAPRecord[] | null>(null)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('pl')
  const [sortField, setSortField] = useState<'sucursal' | 'ventasNetas' | 'totalGastos' | 'resultado'>('ventasNetas')
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set())
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedPeriodo, setSelectedPeriodo] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => setSourcePath(d.sourcePath))
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

  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await fetch('/api/refresh', { method: 'POST' })
      await new Promise(r => setTimeout(r, 1500))
      await fetchData(empresa)
    } finally {
      setRefreshing(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadMsg(null)
    try {
      const form = new FormData()
      for (const f of files) form.append('files', f)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const json = await res.json()
      setUploadMsg({ ok: json.ok, text: json.message })
      if (json.ok) await fetchData(empresa)
    } catch {
      setUploadMsg({ ok: false, text: 'Error al subir los archivos' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTimeout(() => setUploadMsg(null), 5000)
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
              {(['TESI', 'PUEBLO'] as Empresa[]).map(emp => (
                <button
                  key={emp}
                  onClick={() => setEmpresa(emp)}
                  className={`px-5 py-2 transition-colors ${
                    empresa === emp
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {emp}
                </button>
              ))}
            </div>

            {/* Period selector */}
            {periodos.length > 0 && (
              <select
                value={selectedPeriodo ?? ''}
                onChange={e => setSelectedPeriodo(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 capitalize"
              >
                {periodos.map(p => (
                  <option key={p} value={p} className="capitalize">{formatPeriodoOption(p)}</option>
                ))}
              </select>
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
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              title={`Subir SAP_RESULT.txt y/o SAP_PU_RESULT.txt desde tu PC`}
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
