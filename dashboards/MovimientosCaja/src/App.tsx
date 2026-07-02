import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search, Download, RefreshCw, TrendingDown, TrendingUp,
  Scale, Hash, ChevronLeft, ChevronRight, X, ChevronDown,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Movimiento {
  fecha: string | null;
  tipoproducto: string | null;
  sucursal: string | null;
  tipocartera: string | null;
  mediopago: string | null;
  estadopago: string | null;
  estado: string | null;
  tipomovcaja: string | null;
  importedebito: number | null;
  importecredito: number | null;
}

interface FiltrosOpciones {
  tipoproducto: string[];
  sucursal: string[];
  tipocartera: string[];
  mediopago: string[];
  estadopago: string[];
  estado: string[];
  tipomovcaja: string[];
}

interface FiltrosActivos {
  fechaDesde: string;
  fechaHasta: string;
  tipoproducto: string[];
  sucursal: string[];
  tipocartera: string[];
  mediopago: string[];
  estadopago: string[];
  estado: string[];
  tipomovcaja: string[];
}

interface ApiResponse {
  rows: Movimiento[];
  truncated: boolean;
  limit: number;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const FILTROS_VACÍOS: FiltrosActivos = {
  fechaDesde: '', fechaHasta: '',
  tipoproducto: [], sucursal: [],
  tipocartera: [], mediopago: [],
  estadopago: [], estado: [], tipomovcaja: [],
};

const FILTROS_DROPDOWN: { key: keyof Omit<FiltrosActivos, 'fechaDesde' | 'fechaHasta'>; label: string }[] = [
  { key: 'sucursal',     label: 'Sucursal'      },
  { key: 'mediopago',    label: 'Medio de Pago' },
  { key: 'estadopago',   label: 'Estado Pago'   },
  { key: 'estado',       label: 'Estado'        },
  { key: 'tipocartera',  label: 'Tipo Cartera'  },
  { key: 'tipoproducto', label: 'Tipo Producto' },
  { key: 'tipomovcaja',  label: 'Tipo Mov. Caja'},
];

const PAGE_SIZE = 100;

// ── Utilidades ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function exportarCSV(data: Movimiento[]) {
  const cols: (keyof Movimiento)[] = [
    'fecha', 'sucursal', 'mediopago', 'estadopago',
    'estado', 'tipocartera', 'tipoproducto',
    'importedebito', 'importecredito',
  ];
  const headers = [
    'Fecha', 'Sucursal', 'Medio Pago', 'Estado Pago',
    'Estado', 'Tipo Cartera', 'Tipo Producto',
    'Importe Débito', 'Importe Crédito',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(';') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = data.map(r => cols.map(c => escape(r[c])).join(';'));
  const csv = [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'movimientos_caja.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── MultiSelect ───────────────────────────────────────────────────────────────

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

function MultiSelect({ label, options, selected, onChange, disabled }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);

  const toggleAll = () =>
    onChange(selected.length === options.length ? [] : [...options]);

  const allSelected = options.length > 0 && selected.length === options.length;
  const someSelected = selected.length > 0 && selected.length < options.length;

  const buttonText =
    selected.length === 0 ? 'Todos'
    : selected.length === 1 ? selected[0]
    : `${selected.length} seleccionados`;

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs text-gray-400 mb-1.5">{label}</label>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        disabled={disabled}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-left focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-wait flex items-center justify-between gap-2"
      >
        <span className={`truncate ${selected.length === 0 ? 'text-gray-500' : 'text-white'}`}>
          {buttonText}
        </span>
        <ChevronDown size={12} className={`text-gray-500 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-max bg-gray-800 border border-gray-700 rounded-lg shadow-2xl max-h-64 overflow-y-auto">
          {/* Todos */}
          <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-700 cursor-pointer border-b border-gray-700/60 select-none">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleAll}
              className="accent-blue-500 w-3.5 h-3.5 flex-shrink-0"
            />
            <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Todos</span>
          </label>
          {options.length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-600 italic">Sin opciones disponibles</div>
          )}
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-700/70 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="accent-blue-500 w-3.5 h-3.5 flex-shrink-0"
              />
              <span className="text-sm text-gray-300 truncate">{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string; value: string; icon: React.ReactNode;
  colorClass: string; borderClass: string;
}

function KpiCard({ label, value, icon, colorClass, borderClass }: KpiCardProps) {
  return (
    <div className={`rounded-xl p-4 border bg-gray-900 ${borderClass}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</span>
        <span className={colorClass}>{icon}</span>
      </div>
      <div className="text-lg font-bold text-white font-mono truncate">{value}</div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [data, setData] = useState<Movimiento[]>([]);
  const [opcionesFiltros, setOpcionesFiltros] = useState<FiltrosOpciones>({
    tipoproducto: [], sucursal: [], tipocartera: [],
    mediopago: [], estadopago: [], estado: [], tipomovcaja: [],
  });
  const [filtros, setFiltros] = useState<FiltrosActivos>(FILTROS_VACÍOS);
  const [loading, setLoading] = useState(false);
  const [loadingOpciones, setLoadingOpciones] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [page, setPage] = useState(1);
  const [buscado, setBuscado] = useState(false);

  useEffect(() => {
    setLoadingOpciones(true);
    fetch('/api/filtros')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<FiltrosOpciones>; })
      .then(setOpcionesFiltros)
      .catch(e => console.error('Error cargando filtros:', e))
      .finally(() => setLoadingOpciones(false));
  }, []);

  const buscar = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPage(1);
    try {
      const params = new URLSearchParams();
      if (filtros.fechaDesde) params.append('fechaDesde', filtros.fechaDesde);
      if (filtros.fechaHasta) params.append('fechaHasta', filtros.fechaHasta);
      FILTROS_DROPDOWN.forEach(({ key }) => {
        filtros[key].forEach(v => params.append(key, v));
      });

      const res = await fetch('/api/movimientos?' + params.toString());
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Error HTTP ${res.status}`);
      }
      const json = await res.json() as ApiResponse;
      setData(json.rows);
      setTruncado(json.truncated);
      setBuscado(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  const limpiar = () => {
    setFiltros(FILTROS_VACÍOS);
    setData([]); setBuscado(false); setTruncado(false); setError(null); setPage(1);
  };

  const setDropdown = (key: keyof Omit<FiltrosActivos, 'fechaDesde' | 'fechaHasta'>, values: string[]) =>
    setFiltros(f => ({ ...f, [key]: values }));

  const kpis = useMemo(() => ({
    totalDebito:  data.reduce((s, r) => s + (r.importedebito  ?? 0), 0),
    totalCredito: data.reduce((s, r) => s + (r.importecredito ?? 0), 0),
    balance:      data.reduce((s, r) => s + ((r.importecredito ?? 0) - (r.importedebito ?? 0)), 0),
    cantidad:     data.length,
  }), [data]);

  const paginated = useMemo(() => data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [data, page]);
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));

  const filtrosAplicados =
    filtros.fechaDesde !== '' || filtros.fechaHasta !== '' ||
    FILTROS_DROPDOWN.some(({ key }) => filtros[key].length > 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Movimientos de Caja</h1>
            <p className="text-xs text-gray-500 mt-0.5">BeClever · CajasMovimientosTipoCartera</p>
          </div>
          {buscado && (
            <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1 rounded-full">
              {data.length.toLocaleString('es-AR')} registros cargados
            </span>
          )}
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">

        {/* Filtros */}
        <section className="bg-gray-900 rounded-xl p-5 border border-gray-800">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Filtros</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Fecha desde</label>
              <input type="date" value={filtros.fechaDesde}
                onChange={e => setFiltros(f => ({ ...f, fechaDesde: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Fecha hasta</label>
              <input type="date" value={filtros.fechaHasta}
                onChange={e => setFiltros(f => ({ ...f, fechaHasta: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            {FILTROS_DROPDOWN.map(({ key, label }) => (
              <MultiSelect
                key={key}
                label={label}
                options={opcionesFiltros[key] ?? []}
                selected={filtros[key]}
                onChange={values => setDropdown(key, values)}
                disabled={loadingOpciones}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 mt-5">
            <button onClick={buscar} disabled={loading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
              {loading ? 'Consultando...' : 'Buscar'}
            </button>
            {filtrosAplicados && (
              <button onClick={limpiar} disabled={loading}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-4 py-2 rounded-lg transition-colors">
                <X size={13} /> Limpiar
              </button>
            )}
          </div>
        </section>

        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">{error}</div>
        )}

        {buscado && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Total Débito"  value={fmt(kpis.totalDebito)}  icon={<TrendingDown size={18} />} colorClass="text-red-400"   borderClass="border-red-900/50" />
              <KpiCard label="Total Crédito" value={fmt(kpis.totalCredito)} icon={<TrendingUp size={18} />}   colorClass="text-green-400" borderClass="border-green-900/50" />
              <KpiCard label="Balance Neto"  value={fmt(kpis.balance)}      icon={<Scale size={18} />}        colorClass={kpis.balance >= 0 ? 'text-green-400' : 'text-red-400'} borderClass={kpis.balance >= 0 ? 'border-green-900/50' : 'border-red-900/50'} />
              <KpiCard label="Registros"     value={kpis.cantidad.toLocaleString('es-AR')} icon={<Hash size={18} />} colorClass="text-blue-400" borderClass="border-blue-900/50" />
            </div>

            {truncado && (
              <div className="bg-yellow-950 border border-yellow-800 rounded-xl px-4 py-3 text-yellow-300 text-sm">
                ⚠ Se muestran los primeros 10.000 registros. Aplicá más filtros para acotar los resultados.
              </div>
            )}

            {/* Tabla */}
            <section className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <span className="text-xs text-gray-500">
                  Mostrando {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, data.length)} de {data.length.toLocaleString('es-AR')}
                </span>
                <button onClick={() => exportarCSV(data)}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800">
                  <Download size={13} /> Exportar CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-800/60 border-b border-gray-800">
                      {['Fecha','Sucursal','Medio Pago','Est. Pago','Estado','Tipo Cartera','Tipo Producto','Débito','Crédito'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {paginated.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-600">Sin resultados para los filtros aplicados.</td></tr>
                    ) : paginated.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{fmtDate(row.fecha)}</td>
                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{row.sucursal ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{row.mediopago ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{row.estadopago ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{row.estado ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{row.tipocartera ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{row.tipoproducto ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                          {row.importedebito != null ? <span className="text-red-400">{fmt(row.importedebito)}</span> : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                          {row.importecredito != null ? <span className="text-green-400">{fmt(row.importecredito)}</span> : <span className="text-gray-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                  <span className="text-xs text-gray-500">Página {page} de {totalPages}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                      className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      <ChevronLeft size={14} />
                    </button>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      className="p-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {!buscado && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-700">
            <Search size={52} strokeWidth={1.2} className="mb-4" />
            <p className="text-base">Seleccioná filtros y presioná <strong className="text-gray-500">Buscar</strong></p>
          </div>
        )}
      </main>
    </div>
  );
}
