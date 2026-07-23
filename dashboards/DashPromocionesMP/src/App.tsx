/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Activity, PercentIcon, CreditCard, DollarSign, Download, X } from 'lucide-react';

import { Venta, Tesi, parseVentas, parseTesi, crossData, aggregateSalesByPromo, aggregateSalesByPaymentMethod, getPromoByPaymentMethod, getPromoFullDetail, aggregateCuotasByNonMP, PromoFullDetail, CrossMatch } from './lib/data-processing';
import { Card, CardHeader, CardTitle, CardContent } from './components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#3b82f6', '#ec4899'];

function App() {
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [tesi, setTesi] = useState<Tesi[]>([]);
  const [crossMatched, setCrossMatched] = useState<CrossMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<{ ventas: string | null; tesi: string | null; pueblo: string | null }>({ ventas: null, tesi: null, pueblo: null });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ moved: string[]; inserted: number; errors: string[] } | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'detalle' | 'graficos' | 'cruce'>('dashboard');
  const [selectedMP, setSelectedMP] = useState<string>('All');
  const [selectedSuc, setSelectedSuc] = useState<string>('All');
  const [crossFilter, setCrossFilter] = useState<'all' | 'match' | 'nomatch'>('all');
  const [promoFilter, setPromoFilter] = useState<string>('All');
  const [detalleCuotasFilter, setDetalleCuotasFilter] = useState<string>('All');
  const [detalleIssuerFilter, setDetalleIssuerFilter] = useState<string>('All');
  const [graficoMetric, setGraficoMetric] = useState<'Ventas' | 'Descuento'>('Ventas');
  const [expandedMPKeys, setExpandedMPKeys] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const itemsPerPage = 50;

  // Reporte histórico
  const [showHistoricoModal, setShowHistoricoModal] = useState(false);
  const [historicoDesde, setHistoricoDesde] = useState<string>('');
  const [historicoHasta, setHistoricoHasta] = useState<string>('');
  const [historicoLoading, setHistoricoLoading] = useState(false);
  const [historicoError, setHistoricoError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleDescargarHistorico = async () => {
    if (!historicoDesde || !historicoHasta) {
      setHistoricoError('Ingresá las fechas de inicio y fin.');
      return;
    }
    if (historicoDesde > historicoHasta) {
      setHistoricoError('La fecha desde no puede ser mayor que la fecha hasta.');
      return;
    }
    setHistoricoError(null);
    setHistoricoLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(
        `/api/reporte-ventas-historico?desde=${historicoDesde}&hasta=${historicoHasta}`,
        { signal: ctrl.signal }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Error ${res.status}` }));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ventas_historico_${historicoDesde}_${historicoHasta}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setShowHistoricoModal(false);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setHistoricoError(err.message ?? 'Error al descargar el reporte.');
      }
    } finally {
      setHistoricoLoading(false);
    }
  };

  const toggleMP = (key: string) => {
    setExpandedMPKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [ventasRes, tesiRes, puebloRes] = await Promise.all([
          fetch('/api/ventas'),
          fetch('/api/tesi'),
          fetch('/api/pueblo'),
        ]);
        if (!ventasRes.ok) throw new Error(`Error cargando ventas: ${ventasRes.status} ${ventasRes.statusText}`);
        if (!tesiRes.ok) throw new Error(`Error cargando Tesi: ${tesiRes.status} ${tesiRes.statusText}`);
        if (!puebloRes.ok) throw new Error(`Error cargando Pueblo: ${puebloRes.status} ${puebloRes.statusText}`);
        const [ventasCSV, tesiCSV, puebloCSV] = await Promise.all([
          ventasRes.text(),
          tesiRes.text(),
          puebloRes.text(),
        ]);
        const [parsedVentas, parsedTesi, parsedPueblo] = await Promise.all([
          parseVentas(ventasCSV),
          parseTesi(tesiCSV),
          parseTesi(puebloCSV),
        ]);
        setVentas(parsedVentas);
        setTesi([...parsedTesi, ...parsedPueblo]);
        // Fetch timestamps
        try {
          const statusRes = await fetch('/api/status');
          if (statusRes.ok) {
            const s = await statusRes.json();
            setDataStatus(s.lastUpdated);
          }
        } catch (_) {}
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido al cargar datos');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleLocalImport = async () => {
    if (isImporting || isRefreshing) return;
    setIsImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/api/local/import', { method: 'POST' });
      const data = await res.json();
      setImportResult(data.summary);
      if (data.summary.moved.length > 0) {
        // Hay datos nuevos: rehacer cruce y recargar datos del dashboard
        await fetch('/api/save-cruce', { method: 'POST' });
        const [vRes, tRes, pRes] = await Promise.all([
          fetch('/api/ventas'), fetch('/api/tesi'), fetch('/api/pueblo'),
        ]);
        const [vCSV, tCSV, pCSV] = await Promise.all([vRes.text(), tRes.text(), pRes.text()]);
        const [pV, pT, pP] = await Promise.all([parseVentas(vCSV), parseTesi(tCSV), parseTesi(pCSV)]);
        setVentas(pV);
        setTesi([...pT, ...pP]);
        const s = await fetch('/api/status').then(r => r.json());
        setDataStatus(s.lastUpdated);
      }
    } catch {
      setImportResult({ moved: [], inserted: 0, errors: ['Error de red al importar'] });
    } finally {
      setIsImporting(false);
    }
  };

  const handleManualRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      if (!res.ok) {
        setIsRefreshing(false);
        return;
      }
      // Poll /api/status hasta que el servidor reporte isRefreshing:false
      // Máximo 60 intentos (2 min) como seguridad
      let attempts = 0;
      const poll = async () => {
        attempts++;
        try {
          const s = await fetch('/api/status').then(r => r.json());
          setDataStatus(s.lastUpdated);
          if (s.isRefreshing && attempts < 60) {
            setTimeout(poll, 2000);
          } else {
            setIsRefreshing(false);
            // Recargar datos del cache actualizado
            try {
              const [vRes, tRes, pRes] = await Promise.all([
                fetch('/api/ventas'), fetch('/api/tesi'), fetch('/api/pueblo'),
              ]);
              const [vCSV, tCSV, pCSV] = await Promise.all([vRes.text(), tRes.text(), pRes.text()]);
              const [pV, pT, pP] = await Promise.all([parseVentas(vCSV), parseTesi(tCSV), parseTesi(pCSV)]);
              setVentas(pV);
              setTesi([...pT, ...pP]);
            } catch (_) {}
          }
        } catch (_) {
          // error de red en el poll — reintentar
          if (attempts < 60) setTimeout(poll, 3000);
          else setIsRefreshing(false);
        }
      };
      setTimeout(poll, 1500);
    } catch (_) { setIsRefreshing(false); }
  };

  const uniqueMPs = useMemo(() => {
    const seen = new Map<string, string>();
    ventas.forEach(v => { if (v.cod_MP && !seen.has(v.cod_MP)) seen.set(v.cod_MP, v.nom_MP || v.cod_MP); });
    return Array.from(seen.entries()).map(([code, name]) => ({ code, name }));
  }, [ventas]);

  const uniqueSucs = useMemo(() =>
    Array.from(new Set(ventas.map(v => v.suc).filter(Boolean))).sort((a, b) => Number(a) - Number(b)),
  [ventas]);

  const filteredVentas = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00Z') : null;
    const to   = dateTo   ? new Date(dateTo   + 'T23:59:59Z') : null;
    return ventas.filter(v => {
      if (selectedMP  !== 'All' && v.cod_MP !== selectedMP)  return false;
      if (selectedSuc !== 'All' && v.suc    !== selectedSuc) return false;
      if (from || to) {
        const vt = v.parsedDate ? v.parsedDate.getTime() : NaN;
        if (isNaN(vt)) return true; // no fecha → incluir
        if (from && vt < from.getTime()) return false;
        if (to   && vt > to.getTime())   return false;
      }
      return true;
    });
  }, [ventas, selectedMP, selectedSuc, dateFrom, dateTo]);

  const filteredTesi = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00Z') : null;
    const to   = dateTo   ? new Date(dateTo   + 'T23:59:59Z') : null;
    if (!from && !to) return tesi;
    return tesi.filter(t => {
      const tt = t.parsedDate ? t.parsedDate.getTime() : NaN;
      if (isNaN(tt)) return true;
      if (from && tt < from.getTime()) return false;
      if (to   && tt > to.getTime())   return false;
      return true;
    });
  }, [tesi, dateFrom, dateTo]);

  useEffect(() => {
    if (filteredVentas.length > 0) {
      setCrossMatched(crossData(filteredVentas, filteredTesi));
    } else {
      setCrossMatched([]);
    }
  }, [filteredVentas, filteredTesi]);

  const salesByPromo = useMemo(() => aggregateSalesByPromo(filteredVentas), [filteredVentas]);
  const salesByMP = useMemo(() => aggregateSalesByPaymentMethod(filteredVentas), [filteredVentas]);
  const promoByMP = useMemo(() => getPromoByPaymentMethod(filteredVentas), [filteredVentas]);
  const cuotasNonMP = useMemo(() => aggregateCuotasByNonMP(filteredVentas), [filteredVentas]);

  const maxVentaDate = useMemo(() => {
    let max = 0;
    ventas.forEach(v => {
      const cleaned = (v.FECHA ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      const t = new Date(cleaned).getTime();
      if (!isNaN(t) && t > max) max = t;
    });
    return max > 0 ? new Date(max) : null;
  }, [ventas]);

  const maxTesiDate = useMemo(() => {
    let max = 0;
    tesi.forEach(t => {
      const ts = new Date(t.date_created ?? '').getTime();
      if (!isNaN(ts) && ts > max) max = ts;
    });
    return max > 0 ? new Date(max) : null;
  }, [tesi]);

  const stats = useMemo(() => {
    const totalSales = filteredVentas.reduce((acc, v) => acc + v.preciolleno, 0);
    const totalDiscounts = filteredVentas.reduce((acc, v) => acc + v.descuento, 0);
    const totalTx = filteredVentas.length;
    const totalTickets = new Set(filteredVentas.map(v => v.NUMERO)).size;
    return { totalSales, totalDiscounts, totalTx, totalTickets };
  }, [filteredVentas]);

  const matchedTx = crossMatched.filter(c => c.tesiMatch !== null);
  const mpTargetTx = crossMatched.filter(c => ["555", "M", "ME"].includes(c.cod_MP));
  const promoFullDetail = useMemo(() => getPromoFullDetail(crossMatched), [crossMatched]);
  const uniquePromos = useMemo(() => ['All', ...promoFullDetail.map(p => p.promoName)], [promoFullDetail]);
  const filteredPromoDetail = useMemo(() =>
    promoFilter === 'All' ? promoFullDetail : promoFullDetail.filter(p => p.promoName === promoFilter),
    [promoFullDetail, promoFilter]
  );

  const uniqueCuotas = useMemo(() => {
    const all = new Set<number>();
    promoFullDetail.forEach(p => p.paymentMethods.forEach(m => m.tesiBreakdown.forEach(t => all.add(t.cuotas))));
    return ['All', ...Array.from(all).sort((a, b) => a - b).map(String)];
  }, [promoFullDetail]);

  const uniqueIssuers = useMemo(() => {
    const all = new Set<string>();
    promoFullDetail.forEach(p => p.paymentMethods.forEach(m => m.tesiBreakdown.forEach(t => {
      if (t.issuer_name && t.issuer_name !== 'N/A') all.add(t.issuer_name);
    })));
    return ['All', ...Array.from(all).sort()];
  }, [promoFullDetail]);

  const detalleStats = useMemo(() => {
    const anyFilter = detalleCuotasFilter !== 'All' || detalleIssuerFilter !== 'All';
    if (!anyFilter) {
      const totalSales = filteredPromoDetail.reduce((s, p) => s + p.totalImporte, 0);
      const totalDiscounts = filteredPromoDetail.reduce((s, p) => s + p.totalDescuento, 0);
      const totalTx = filteredPromoDetail.reduce((s, p) => s + p.totalVentas, 0);
      const totalTickets: number | null = filteredPromoDetail.reduce((s, p) => s + p.totalTickets, 0);
      return { totalSales, totalDiscounts, totalTx, totalTickets };
    } else {
      let totalSales = 0, totalDiscounts = 0, totalTx = 0;
      filteredPromoDetail.forEach(p =>
        p.paymentMethods.forEach(mp =>
          mp.tesiBreakdown.filter(t =>
            (detalleCuotasFilter === 'All' || String(t.cuotas) === detalleCuotasFilter) &&
            (detalleIssuerFilter === 'All' || t.issuer_name === detalleIssuerFilter)
          ).forEach(t => {
            totalSales += t.ventaImporte;
            totalDiscounts += t.descuento;
            totalTx += t.count;
          })
        )
      );
      return { totalSales, totalDiscounts, totalTx, totalTickets: null as null };
    }
  }, [filteredPromoDetail, detalleCuotasFilter, detalleIssuerFilter]);

  const filteredCrossTx = useMemo(() => {
    let result = mpTargetTx;
    if (promoFilter !== 'All') result = result.filter(c => c.nombre_cond === promoFilter);
    if (detalleCuotasFilter !== 'All') result = result.filter(c => c.tesiMatch?.cuotas === parseInt(detalleCuotasFilter));
    if (detalleIssuerFilter !== 'All') result = result.filter(c => c.tesiMatch?.issuer_name === detalleIssuerFilter);
    if (crossFilter === 'match') return result.filter(c => c.tesiMatch !== null);
    if (crossFilter === 'nomatch') return result.filter(c => c.tesiMatch === null);
    return result;
  }, [mpTargetTx, crossFilter, promoFilter, detalleCuotasFilter, detalleIssuerFilter]);

  const downloadCruceCsv = () => {
    const headers = ['Sucursal','Promo','Medio','Importe Vta','Fecha','Estado','Cuotas','QR/POINT','Issuer','Neto MP','Costo MP','Desc Financiacion','DNI Cliente','Apellido','Nombre'];
    const rows = filteredCrossTx.map(tx => [
      `SUC_${tx.suc}`,
      tx.nombre_cond ?? '',
      tx.cod_MP,
      tx.IMPORTE,
      tx.FECHA.split('.')[0],
      tx.tesiMatch ? 'COINCIDE' : 'SIN MATCH',
      tx.tesiMatch?.cuotas ?? '',
      tx.tesiMatch?.sub_unit ?? '',
      tx.tesiMatch?.issuer_name ?? '',
      tx.tesiMatch?.net_received_amount ?? '',
      tx.tesiMatch?.mercadopago_fee ?? '',
      tx.tesiMatch?.financing_fee ?? '',
      tx.dniCliente ?? '',
      tx.apeCliente ?? '',
      tx.nomCliente ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(';')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'cruce_mp.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const paginatedMatched = filteredCrossTx.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredCrossTx.length / itemsPerPage);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans p-6 overflow-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Análisis de Ventas y Promociones</h1>
          <p className="text-zinc-400 text-sm">Cruce de información: <span className="text-indigo-400">Vtas</span> vs <span className="text-emerald-400">Tesi / Pueblo</span></p>
          {ventas.length > 0 && (
            <div className="flex gap-4 flex-wrap mt-1">
              <span className="text-[11px] text-zinc-500">
                <span className="text-zinc-400 font-semibold">Ventas:</span>{' '}
                {maxVentaDate
                  ? maxVentaDate.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : <span className="text-zinc-600">—</span>}
              </span>
              <span className="text-zinc-700">│</span>
              <span className="text-[11px] text-zinc-500">
                <span className="text-zinc-400 font-semibold">MercadoPago:</span>{' '}
                {maxTesiDate
                  ? maxTesiDate.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : <span className="text-zinc-600">—</span>}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-3 flex-wrap items-center">
          <select 
            value={selectedSuc}
            onChange={(e) => setSelectedSuc(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="All">Todas las Sucursales</option>
            {uniqueSucs.map(s => (
              <option key={s} value={s}>Suc. {s}</option>
            ))}
          </select>
          <select 
            value={selectedMP} 
            onChange={(e) => setSelectedMP(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="All">Todos los Medios</option>
            {uniqueMPs.map(mp => (
              <option key={mp.code} value={mp.code}>{mp.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setCurrentPage(1); }}
              className="bg-zinc-900 border border-zinc-800 px-2 py-1.5 rounded-lg text-xs text-zinc-300 outline-none focus:ring-1 focus:ring-indigo-500"
              title="Desde"
            />
            <span className="text-zinc-600 text-xs">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setCurrentPage(1); }}
              className="bg-zinc-900 border border-zinc-800 px-2 py-1.5 rounded-lg text-xs text-zinc-300 outline-none focus:ring-1 focus:ring-indigo-500"
              title="Hasta"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-zinc-500 hover:text-zinc-300 text-xs px-1"
                title="Limpiar fechas"
              >✕</button>
            )}
          </div>
          <button
            onClick={handleLocalImport}
            disabled={isImporting || isRefreshing || loading}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              isImporting
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 cursor-wait'
                : 'bg-violet-500/10 border-violet-500/30 text-violet-400 hover:bg-violet-500/20'
            } disabled:opacity-60`}
            title="Importa los CSV de la carpeta raíz y los mueve a Procesados/"
          >
            <span className={isImporting ? 'animate-spin inline-block' : ''}>⬆</span>
            {isImporting ? 'Importando…' : 'Importar archivos'}
          </button>
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing || loading}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              isRefreshing
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 cursor-wait'
                : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20'
            } disabled:opacity-60`}
          >
            <span className={isRefreshing ? 'animate-spin inline-block' : ''}>↻</span>
            {isRefreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button
            onClick={() => { setHistoricoError(null); setShowHistoricoModal(true); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            <Download size={13} />
            Reporte Ventas Histórico
          </button>
        </div>
      </header>

      {/* ── Modal Reporte Histórico ── */}
      {showHistoricoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Reporte de Ventas Histórico</h2>
              <button
                onClick={() => { if (!historicoLoading) setShowHistoricoModal(false); }}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-zinc-400">Seleccioná el rango de fechas. El archivo CSV se descargará directamente (puede tener más de 100.000 filas).</p>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-zinc-400">Fecha desde</label>
                <input
                  type="date"
                  value={historicoDesde}
                  onChange={e => setHistoricoDesde(e.target.value)}
                  disabled={historicoLoading}
                  className="bg-zinc-800 border border-zinc-700 px-3 py-2 rounded-lg text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-zinc-400">Fecha hasta</label>
                <input
                  type="date"
                  value={historicoHasta}
                  onChange={e => setHistoricoHasta(e.target.value)}
                  disabled={historicoLoading}
                  className="bg-zinc-800 border border-zinc-700 px-3 py-2 rounded-lg text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                />
              </div>
            </div>
            {historicoError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{historicoError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleDescargarHistorico}
                disabled={historicoLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                {historicoLoading ? (
                  <><span className="animate-spin inline-block">↻</span> Generando…</>
                ) : (
                  <><Download size={14} /> Descargar CSV</>
                )}
              </button>
              <button
                onClick={() => {
                  if (historicoLoading && abortRef.current) abortRef.current.abort();
                  setShowHistoricoModal(false);
                }}
                disabled={false}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {ventas.length > 0 && (
        <div className="flex gap-4 mb-6 border-b border-zinc-800 pb-2">
          <button 
            onClick={() => setActiveTab('dashboard')} 
            className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('detalle')} 
            className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${activeTab === 'detalle' ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'}`}
          >
            Detalle por Promoción
          </button>
          <button 
            onClick={() => setActiveTab('graficos')} 
            className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${activeTab === 'graficos' ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'}`}
          >
            Gráficos
          </button>
          <button 
            onClick={() => setActiveTab('cruce')} 
            className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${activeTab === 'cruce' ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'}`}
          >
            Cruce de Info.
          </button>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4 flex-1 items-start">
        {loading && <div className="col-span-12 text-center text-zinc-500 py-8">Cargando datos...</div>}
        {importResult && (
          <div className={`col-span-12 rounded-lg px-4 py-3 text-xs border flex items-start gap-3 ${
            importResult.errors.length > 0
              ? 'bg-amber-950 border-amber-700 text-amber-300'
              : 'bg-emerald-950 border-emerald-700 text-emerald-300'
          }`}>
            <span className="mt-0.5">
              {importResult.moved.length > 0
                ? `✔ ${importResult.moved.length} archivo(s) importado(s) → ${importResult.inserted} filas. Movidos a Procesados/.`
                : importResult.total === 0
                  ? 'No se encontraron archivos CSV en el directorio.'
                  : 'No se procesó ningún archivo.'}
              {importResult.errors.length > 0 && ` Errores: ${importResult.errors.join(' | ')}`}
            </span>
            <button onClick={() => setImportResult(null)} className="ml-auto text-zinc-400 hover:text-zinc-200">✕</button>
          </div>
        )}
        {error && (
          <div className="col-span-12 bg-red-950 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}
        {/* Indicators */}
        {activeTab === 'dashboard' && ventas.length > 0 && (
          <>
            <div className="col-span-12 md:col-span-4 bg-zinc-900/50 border border-zinc-700 border-l-4 border-l-emerald-500 rounded-2xl p-4 flex flex-col justify-between min-h-[120px]">
              <div className="flex justify-between items-start">
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Precio de Lista</span>
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              </div>
              <div className="text-3xl font-bold">${stats.totalSales.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
              <div className="text-xs text-emerald-400 font-medium">{stats.totalTickets.toLocaleString('es-AR')} tickets · {stats.totalTx.toLocaleString('es-AR')} ops</div>
            </div>
            <div className="col-span-12 md:col-span-4 bg-zinc-900/50 border border-zinc-700 border-l-4 border-l-indigo-500 rounded-2xl p-4 flex flex-col justify-between min-h-[120px]">
              <div className="flex justify-between items-start">
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Total Descuentos</span>
                <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
              </div>
              <div className="text-3xl font-bold">${stats.totalDiscounts.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
              <div className="text-xs text-zinc-500">En {salesByPromo.length} campañas</div>
            </div>
            <div className="col-span-12 md:col-span-4 bg-zinc-900/50 border border-zinc-700 border-l-4 border-l-amber-500 rounded-2xl p-4 flex flex-col justify-between min-h-[120px]">
              <div className="flex justify-between items-start">
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">% Descuento s/ Ventas</span>
                <div className="w-2 h-2 rounded-full bg-amber-500"></div>
              </div>
              <div className="text-3xl font-bold text-amber-400">
                {stats.totalSales ? ((Math.abs(stats.totalDiscounts) / stats.totalSales) * 100).toFixed(1) : '0.0'}%
              </div>
              <div className="text-xs text-zinc-500">{stats.totalTickets.toLocaleString('es-AR')} tkts · {salesByPromo.length} promociones</div>
            </div>
          </>
        )}

        {/* Promotions by Payment Method Detailed Breakdown */}
        {activeTab === 'dashboard' && ventas.length > 0 && (
          <div className="col-span-12 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 overflow-hidden flex flex-col">
            <h3 className="text-sm font-semibold mb-4">Desglose por Medio de Pago</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {promoByMP.map((mpData, i) => (
                <div key={mpData.paymentMethod} className="bg-zinc-800/40 border border-zinc-700 rounded-xl flex flex-col">
                  <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center font-bold text-indigo-400">
                      {mpData.paymentMethod.substring(0, 3)}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-zinc-100">{mpData.paymentMethod}</div>
                      <div className="text-[10px] text-zinc-400">Promociones usadas con este medio</div>
                    </div>
                  </div>
                  <div className="p-0 overflow-x-auto">
                    <table className="w-full text-left text-xs border-separate border-spacing-0">
                      <thead className="text-zinc-500 bg-zinc-900/50">
                        <tr>
                          <th className="px-4 py-2 font-medium border-b border-zinc-800">Promoción</th>
                          <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Ventas</th>
                          <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Importe</th>
                          <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Descuentos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {mpData.promotions.map((p, idx) => (
                          <tr key={idx} className="hover:bg-zinc-800/30">
                            <td className="px-4 py-2 max-w-[200px] truncate" title={p.promoName}>{p.promoName}</td>
                            <td className="px-4 py-2 text-right">{p.ventas}</td>
                            <td className="px-4 py-2 text-right font-mono">${p.importe.toLocaleString('es-AR', {maximumFractionDigits:0})}</td>
                            <td className="px-4 py-2 text-right text-emerald-400">${p.descuentos.toLocaleString('es-AR', {maximumFractionDigits:0})}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-zinc-700 bg-zinc-800/40 font-semibold">
                          <td className="px-4 py-2 text-zinc-300">Total</td>
                          <td className="px-4 py-2 text-right">{mpData.promotions.reduce((s, p) => s + p.ventas, 0)}</td>
                          <td className="px-4 py-2 text-right font-mono">${mpData.promotions.reduce((s, p) => s + p.importe, 0).toLocaleString('es-AR', {maximumFractionDigits:0})}</td>
                          <td className="px-4 py-2 text-right font-mono text-emerald-400">${mpData.promotions.reduce((s, p) => s + p.descuentos, 0).toLocaleString('es-AR', {maximumFractionDigits:0})}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cuotas por Medio de Pago (no MP) */}
        {activeTab === 'dashboard' && cuotasNonMP.length > 0 && (
          <div className="col-span-12 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 overflow-hidden flex flex-col">
            <h3 className="text-sm font-semibold mb-1">Cuotas — Otros Medios de Pago</h3>
            <p className="text-[10px] text-zinc-500 mb-4">Distribución de cuotas para medios distintos de MercadoPago (555 / M / ME)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {cuotasNonMP.map(mp => (
                <div key={mp.cod_MP} className="bg-zinc-800/40 border border-zinc-700 rounded-xl flex flex-col">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
                    <div>
                      <div className="text-xs font-bold text-zinc-100">{mp.nom_MP}</div>
                      <div className="text-[10px] text-zinc-400">{mp.totalVentas} ventas · ${mp.totalImporte.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                    </div>
                    {mp.totalDescuento > 0 && (
                      <span className="text-[10px] text-emerald-400 font-mono">-${mp.totalDescuento.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-separate border-spacing-0">
                      <thead className="text-zinc-500 bg-zinc-900/50">
                        <tr>
                          <th className="px-4 py-2 font-medium border-b border-zinc-800">Cuotas</th>
                          <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Ventas</th>
                          <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">%</th>
                          <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Importe</th>
                          {mp.totalDescuento > 0 && <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Descuento</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {mp.cuotasBreakdown.map(row => (
                          <tr key={row.cuotas} className="hover:bg-zinc-800/30">
                            <td className="px-4 py-2 font-semibold text-indigo-300">{row.cuotas === 1 ? 'Contado' : `${row.cuotas} cuotas`}</td>
                            <td className="px-4 py-2 text-right">{row.ventas}</td>
                            <td className="px-4 py-2 text-right text-zinc-400">{((row.ventas / mp.totalVentas) * 100).toFixed(0)}%</td>
                            <td className="px-4 py-2 text-right font-mono">${row.importe.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                            {mp.totalDescuento > 0 && <td className="px-4 py-2 text-right font-mono text-emerald-400">{row.descuento > 0 ? `$${row.descuento.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '--'}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Graficos */}
        {activeTab === 'graficos' && ventas.length > 0 && (() => {
          const fmt = (v: number) => '$' + (v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : v >= 1_000 ? (v / 1_000).toFixed(0) + 'K' : v.toString());
          const dataKey = graficoMetric;
          const color = graficoMetric === 'Ventas' ? '#6366f1' : '#10b981';

          const promoChartData = salesByPromo.map(p => ({
            name: p.promo.length > 32 ? p.promo.substring(0, 32) + '…' : p.promo,
            Ventas: p.importe,
            Descuento: Math.abs(p.descuentos),
          })).sort((a, b) => a[dataKey] - b[dataKey]);

          const mpChartData = salesByMP.map(m => ({
            name: m.mp,
            Ventas: m.importe,
            Descuento: Math.abs(m.descuentos),
          })).sort((a, b) => a[dataKey] - b[dataKey]);

          const promoBarH = Math.max(280, promoChartData.length * 36);
          const mpBarH = Math.max(160, mpChartData.length * 44);

          return (
            <>
              {/* Metric toggle */}
              <div className="col-span-12 flex gap-2 mb-2">
                {(['Ventas', 'Descuento'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setGraficoMetric(m)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                      graficoMetric === m
                        ? m === 'Ventas' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        : 'text-zinc-400 border-zinc-800 hover:text-zinc-100'
                    }`}
                  >
                    {m === 'Ventas' ? 'Ventas ($)' : 'Descuento ($)'}
                  </button>
                ))}
              </div>

              <div className="col-span-12 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 mb-4">
                <h3 className="text-sm font-semibold mb-1">{graficoMetric} por Promoción</h3>
                <p className="text-[10px] text-zinc-500 mb-4">{graficoMetric === 'Ventas' ? 'Importe facturado' : 'Descuento aplicado'} por cada campaña · ordenado de menor a mayor</p>
                <ResponsiveContainer width="100%" height={promoBarH}>
                  <BarChart data={promoChartData} layout="vertical" margin={{ top: 4, right: 90, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                    <XAxis type="number" tickFormatter={fmt} tick={{ fill: '#a1a1aa', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={230} tick={{ fill: '#d4d4d8', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                      labelStyle={{ color: '#e4e4e7', fontSize: 11 }}
                      formatter={(v: number) => [`$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`, graficoMetric]}
                    />
                    <Bar dataKey={dataKey} fill={color} radius={[0,4,4,0]} label={{ position: 'right', formatter: fmt, fill: '#a1a1aa', fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="col-span-12 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 mb-10">
                <h3 className="text-sm font-semibold mb-1">{graficoMetric} por Medio de Pago</h3>
                <p className="text-[10px] text-zinc-500 mb-4">{graficoMetric === 'Ventas' ? 'Importe facturado' : 'Descuento aplicado'} por medio de pago</p>
                <ResponsiveContainer width="100%" height={mpBarH}>
                  <BarChart data={mpChartData} layout="vertical" margin={{ top: 4, right: 90, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                    <XAxis type="number" tickFormatter={fmt} tick={{ fill: '#a1a1aa', fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={170} tick={{ fill: '#d4d4d8', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }}
                      labelStyle={{ color: '#e4e4e7', fontSize: 11 }}
                      formatter={(v: number) => [`$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`, graficoMetric]}
                    />
                    <Bar dataKey={dataKey} fill={color} radius={[0,4,4,0]} label={{ position: 'right', formatter: fmt, fill: '#a1a1aa', fontSize: 10 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          );
        })()}

        {/* Cross Reference Table */}
        {activeTab === 'cruce' && ventas.length > 0 && (
          <div className="col-span-12 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 overflow-hidden flex flex-col mb-10">
            <div className="flex justify-between items-center mb-4">
               <div>
                 <h3 className="text-sm font-semibold">Registro de Cruce Vtas & Tesi (Medios 555 & M/ME)</h3>
                 <p className="text-[10px] text-amber-400 mt-0.5">
                   Conciliación: {mpTargetTx.length ? ((matchedTx.length / mpTargetTx.length) * 100).toFixed(1) : '0.0'}% ({matchedTx.length}/{mpTargetTx.length})
                   {' · '}
                   <span className="text-emerald-400">Match ${matchedTx.reduce((s,c) => s + c.IMPORTE, 0).toLocaleString('es-AR', {maximumFractionDigits:0})}</span>
                   {' · '}
                   <span className="text-red-400">Sin match ${mpTargetTx.filter(c => !c.tesiMatch).reduce((s,c) => s + c.IMPORTE, 0).toLocaleString('es-AR', {maximumFractionDigits:0})}</span>
                 </p>
                 {(promoFilter !== 'All' || detalleCuotasFilter !== 'All' || detalleIssuerFilter !== 'All') && (
                   <div className="flex flex-wrap gap-1 mt-1.5">
                     {promoFilter !== 'All' && <span className="text-[10px] bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded">Promo: {promoFilter}</span>}
                     {detalleCuotasFilter !== 'All' && <span className="text-[10px] bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded">{detalleCuotasFilter} cuotas</span>}
                     {detalleIssuerFilter !== 'All' && <span className="text-[10px] bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded">{detalleIssuerFilter}</span>}
                   </div>
                 )}
               </div>
               <div className="flex items-center gap-2">
                 <div className="flex rounded-lg border border-zinc-800 overflow-hidden text-[10px] font-bold">
                   {(['all', 'match', 'nomatch'] as const).map(f => (
                     <button
                       key={f}
                       onClick={() => { setCrossFilter(f); setCurrentPage(1); }}
                       className={`px-2.5 py-1 transition-colors ${
                         crossFilter === f
                           ? f === 'match' ? 'bg-emerald-500/20 text-emerald-400' : f === 'nomatch' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-zinc-100'
                           : 'text-zinc-500 hover:text-zinc-300'
                       }`}
                     >
                       {f === 'all' ? 'Todos' : f === 'match' ? 'Match' : 'No Match'}
                     </button>
                   ))}
                 </div>
                 <button
                   onClick={downloadCruceCsv}
                   className="px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-[10px] font-semibold transition-colors"
                 >
                   ↓ Descargar CSV
                 </button>
               </div>
            </div>
            
            <div className="flex-1 overflow-x-auto min-h-[300px]">
              <table className="w-full text-left text-xs border-separate border-spacing-0">
                <thead className="text-zinc-500 sticky top-0 bg-zinc-900">
                  <tr>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800">Sucursal</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800">Promo</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800">Método</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800 text-right">Importe Vta</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800">Fecha</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800">Cliente</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800 text-center">Estado</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800 text-center">Cuotas</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800 text-center">QR/POINT</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800 text-right">Neto MP</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800 text-right">Costo MP</th>
                    <th className="pb-3 px-2 font-medium border-b border-zinc-800 text-right">Desc. Financiación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {paginatedMatched.map((tx, idx) => (
                    <tr key={idx} className="hover:bg-zinc-800/20">
                      <td className="py-2.5 px-2">SUC_{tx.suc}</td>
                      <td className="py-2.5 px-2 text-zinc-400 max-w-[160px] truncate" title={tx.nombre_cond ?? ''}>{tx.nombre_cond ?? '—'}</td>
                      <td className="py-2.5 px-2 font-bold text-indigo-400">{tx.cod_MP}</td>
                      <td className="py-2.5 px-2 text-right font-mono">${tx.IMPORTE.toLocaleString('es-AR')}</td>
                      <td className="py-2.5 px-2 whitespace-nowrap">{tx.FECHA.split('.')[0]}</td>
                      <td className="py-2.5 px-2 text-zinc-400 max-w-[160px] truncate" title={`${tx.dniCliente ?? ''} ${tx.apeCliente ?? ''} ${tx.nomCliente ?? ''}`.trim()}>
                        {(tx.apeCliente || tx.nomCliente) ? `${tx.apeCliente ?? ''} ${tx.nomCliente ?? ''}`.trim() : '—'}
                        {tx.dniCliente ? <span className="text-zinc-600"> ({tx.dniCliente})</span> : null}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {tx.tesiMatch ?
                          <span className="inline-flex px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-medium text-[10px]">COINCIDE</span> 
                          : 
                          <span className="inline-flex px-1.5 py-0.5 bg-red-400/10 text-red-400 border border-red-400/20 rounded font-medium text-[10px]">SIN MATCH</span>
                        }
                      </td>
                      <td className="py-2.5 px-2 text-center text-zinc-300">{tx.tesiMatch?.cuotas ?? '—'}</td>
                      <td className="py-2.5 px-2 text-center">
                        {tx.tesiMatch?.sub_unit
                          ? <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                              /qr/i.test(tx.tesiMatch.sub_unit) ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' : 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                            }`}>{tx.tesiMatch.sub_unit.toUpperCase()}</span>
                          : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-zinc-300">{tx.tesiMatch ? `$${tx.tesiMatch.net_received_amount.toLocaleString('es-AR')}` : '--'}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-rose-400">{tx.tesiMatch ? `$${tx.tesiMatch.mercadopago_fee.toLocaleString('es-AR')}` : '--'}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-emerald-400">{tx.tesiMatch && tx.tesiMatch.financing_fee < 0 ? `$${tx.tesiMatch.financing_fee.toLocaleString('es-AR')}` : '--'}</td>
                    </tr>
                  ))}
                  {filteredCrossTx.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-zinc-500">
                        No hay transacciones registradas para los medios de pago configurados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {filteredCrossTx.length > 0 && (
              <div className="flex justify-between items-center mt-4">
                 <span className="text-xs text-zinc-400">Página {currentPage} de {totalPages} ({filteredCrossTx.length} registros)</span>
                 <div className="flex items-center gap-2 border border-zinc-800 rounded-lg p-1 bg-zinc-950">
                   <button 
                     onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                     disabled={currentPage === 1}
                     className="px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-white disabled:opacity-50 disabled:hover:text-zinc-400 transition"
                   >
                     Anterior
                   </button>
                   <button 
                     onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} 
                     disabled={currentPage === totalPages}
                     className="px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-white disabled:opacity-50 disabled:hover:text-zinc-400 transition"
                   >
                     Siguiente
                   </button>
                 </div>
              </div>
            )}
          </div>
        )}

        {/* Promo full detail: all payment methods + M/555 Tesi breakdown */}
        {activeTab === 'detalle' && filteredVentas.length > 0 && (
          <div className="col-span-12 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 overflow-hidden flex flex-col mb-10">
            <h3 className="text-sm font-semibold mb-1">Detalle por Promoción</h3>
            <p className="text-[10px] text-zinc-500 mb-3">Todos los medios de pago · Para M / 555 / ME: desglose de tipo de pago, emisor y cuotas según Tesi/Pueblo</p>

            {/* Filters */}
            <div className="flex gap-3 mb-4 flex-wrap">
              <select
                value={promoFilter}
                onChange={e => { setPromoFilter(e.target.value); }}
                className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {uniquePromos.map(p => (
                  <option key={p} value={p}>{p === 'All' ? 'Todas las promociones' : p}</option>
                ))}
              </select>
              <select
                value={detalleCuotasFilter}
                onChange={e => setDetalleCuotasFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {uniqueCuotas.map(c => (
                  <option key={c} value={c}>{c === 'All' ? 'Todas las cuotas' : `${c} cuotas`}</option>
                ))}
              </select>
              <select
                value={detalleIssuerFilter}
                onChange={e => setDetalleIssuerFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {uniqueIssuers.map(i => (
                  <option key={i} value={i}>{i === 'All' ? 'Todos los emisores' : i}</option>
                ))}
              </select>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-zinc-900/50 border border-zinc-700 border-l-4 border-l-emerald-500 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Precio de Lista</span>
                <span className="text-xl font-bold">${detalleStats.totalSales.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                <span className="text-[10px] text-zinc-500">
                  {detalleStats.totalTx.toLocaleString('es-AR')} ops{detalleStats.totalTickets !== null ? ` · ${detalleStats.totalTickets.toLocaleString('es-AR')} tkts` : ''}
                </span>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-700 border-l-4 border-l-indigo-500 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Total Descuentos</span>
                <span className="text-xl font-bold">${detalleStats.totalDiscounts.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                <span className="text-[10px] text-zinc-500">&nbsp;</span>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-700 border-l-4 border-l-amber-500 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">% Desc. s/ Ventas</span>
                <span className="text-xl font-bold text-amber-400">
                  {detalleStats.totalSales ? ((Math.abs(detalleStats.totalDiscounts) / detalleStats.totalSales) * 100).toFixed(1) : '0.0'}%
                </span>
                <span className="text-[10px] text-zinc-500">&nbsp;</span>
              </div>
            </div>

            {/* Promo list */}
            <div className="flex flex-col gap-4">
              {filteredPromoDetail.map((promo) => (
                <div key={promo.promoName} className="bg-zinc-800/40 border border-zinc-700 rounded-xl overflow-hidden">
                  {/* Promo header */}
                  <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-800 bg-zinc-800/30">
                    <div className="text-sm font-bold text-zinc-100 truncate" title={promo.promoName}>{promo.promoName}</div>
                    <div className="text-xs text-zinc-300 whitespace-nowrap shrink-0 flex items-center gap-3">
                      <span className="text-zinc-500">{promo.totalTickets} tkts · {promo.totalVentas} ops</span>
                      <span className="font-mono">${promo.totalImporte.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                      <span className="text-emerald-400 font-mono">desc: ${promo.totalDescuento.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                  {/* Payment methods table */}
                  <table className="w-full text-left text-xs border-separate border-spacing-0">
                    <colgroup>
                      <col />
                      <col className="w-48" />
                      <col className="w-32" />
                      <col className="w-32" />
                    </colgroup>
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="px-4 py-2 font-medium border-b border-zinc-800">Medio de Pago</th>
                        <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Ops</th>
                        <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Importe</th>
                        <th className="px-4 py-2 font-medium border-b border-zinc-800 text-right">Descuento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {promo.paymentMethods.map((mp, idx) => {
                        const isTarget = ["555","M","ME"].includes(mp.mpCode);
                        const expandKey = `${promo.promoName}|${mp.mpCode}`;
                        const isExpanded = expandedMPKeys.has(expandKey);
                        const filteredBreakdown = mp.tesiBreakdown.filter(t =>
                          (detalleCuotasFilter === 'All' || String(t.cuotas) === detalleCuotasFilter) &&
                          (detalleIssuerFilter === 'All' || t.issuer_name === detalleIssuerFilter)
                        );
                        const anyFilter = detalleCuotasFilter !== 'All' || detalleIssuerFilter !== 'All';
                        if (anyFilter && isTarget && filteredBreakdown.length === 0) return null;
                        // Non-MP: only expandable if has more than 1 cuota or cuota != 1
                        const nonMPBreakdown = mp.ventaCuotasBreakdown;
                        const nonMPExpandable = !isTarget && nonMPBreakdown.length > 0;
                        return (
                          <React.Fragment key={idx}>
                            <tr
                              className={isTarget ? 'bg-indigo-500/5 cursor-pointer hover:bg-indigo-500/10' : nonMPExpandable ? 'cursor-pointer hover:bg-zinc-800/30' : 'hover:bg-zinc-800/20'}
                              onClick={() => (isTarget || nonMPExpandable) && toggleMP(expandKey)}
                            >
                              <td className="px-4 py-2 font-semibold">
                                {(isTarget || nonMPExpandable) && (
                                  <span className="inline-block mr-1.5 text-zinc-500">
                                    {isExpanded ? '▾' : '▸'}
                                  </span>
                                )}
                                <span className={isTarget ? 'text-indigo-400' : 'text-zinc-300'}>{mp.mpCode}</span>
                                {mp.mpName && mp.mpName !== mp.mpCode && <span className="text-zinc-400 font-normal ml-1.5">{mp.mpName}</span>}
                              </td>
                              <td className="px-4 py-2 text-right">{mp.count}</td>
                              <td className="px-4 py-2 text-right font-mono">${mp.importe.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                              <td className="px-4 py-2 text-right font-mono text-emerald-400">${mp.descuento.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                            </tr>
                            {/* MP target: tesi breakdown */}
                            {isTarget && isExpanded && filteredBreakdown.map((t, ti) => (
                              <tr key={`t-${ti}`} className="bg-zinc-800/20">
                                <td className="pl-10 pr-4 py-1.5 text-zinc-400">
                                  <span className="w-1 h-1 rounded-full bg-zinc-600 shrink-0 inline-block mr-2"></span>
                                  <span className="capitalize">{t.payment_type}</span>
                                </td>
                                <td className="px-4 py-1.5 text-right text-indigo-300 font-mono text-[11px]">
                                  {t.issuer_name && t.issuer_name !== 'N/A' ? `${t.issuer_name} · ` : ''}{t.cuotas}c &nbsp; {t.count}
                                </td>
                                <td className="px-4 py-1.5 text-right font-mono text-zinc-400">${t.ventaImporte.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                                <td className="px-4 py-1.5 text-right font-mono text-emerald-400">{t.descuento !== 0 ? `$${t.descuento.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '--'}</td>
                              </tr>
                            ))}
                            {isTarget && isExpanded && filteredBreakdown.length === 0 && (
                              <tr className="bg-zinc-800/10">
                                <td colSpan={4} className="pl-10 py-1.5 text-[10px] text-zinc-600 italic">Sin coincidencia en Tesi/Pueblo</td>
                              </tr>
                            )}
                            {/* Non-MP: cuotas from SP */}
                            {nonMPExpandable && isExpanded && nonMPBreakdown.map((row, ri) => (
                              <tr key={`c-${ri}`} className="bg-zinc-800/20">
                                <td className="pl-10 pr-4 py-1.5 text-zinc-400">
                                  <span className="w-1 h-1 rounded-full bg-zinc-600 shrink-0 inline-block mr-2"></span>
                                  {row.cuotas === 1 ? 'Contado' : `${row.cuotas} cuotas`}
                                </td>
                                <td className="px-4 py-1.5 text-right text-zinc-300 font-mono text-[11px]">{row.count}</td>
                                <td className="px-4 py-1.5 text-right font-mono text-zinc-400">${row.importe.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</td>
                                <td className="px-4 py-1.5 text-right font-mono text-emerald-400">{row.descuento !== 0 ? `$${row.descuento.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '--'}</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

