import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Kpis as KpisT } from '../types'
import { useToast } from './ui'

function hoyMenos(dias: number): string {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
}

function fmtDia(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

function fmtHoras(min: number | null): string {
  if (min === null || min === undefined) return '—'
  if (min < 60) return `${Math.round(min)} min`
  return `${(min / 60).toFixed(1)} h`
}

export default function Kpis() {
  const toast = useToast()
  const [datos, setDatos] = useState<KpisT | null>(null)
  const [desde, setDesde] = useState(hoyMenos(30))
  const [hasta, setHasta] = useState(hoyMenos(0))

  async function cargar() {
    try {
      setDatos(await api<KpisT>(`/api/kpis?desde=${desde}&hasta=${hasta}`))
    } catch (err: any) { toast('error', err.message) }
  }
  useEffect(() => { cargar() }, [desde, hasta])

  if (!datos) return <div className="empty-state">Cargando…</div>
  const r = datos.resumen
  const maxDia = Math.max(1, ...datos.porDia.map(d => Math.max(d.Ingresos, d.Egresos)))
  const maxCond = Math.max(1, ...datos.topConductores.map(c => c.Movimientos))

  return (
    <>
      {/* Estado actual */}
      <div className="summary-grid">
        <div className="summary-card dentro">
          <span className="label">Tractores dentro</span>
          <span className="value">{r.TractoresDentro}</span>
          <span className="sub">{r.TractoresFuera} fuera</span>
        </div>
        <div className="summary-card dentro">
          <span className="label">Semis dentro</span>
          <span className="value">{r.SemisDentro}</span>
          <span className="sub">{r.SemisFuera} fuera</span>
        </div>
        <div className="summary-card">
          <span className="label">No propios dentro</span>
          <span className="value">{r.NoPropiosDentro}</span>
          <span className="sub">vehículos externos en el predio</span>
        </div>
        <div className="summary-card">
          <span className="label">Movimientos hoy</span>
          <span className="value">{r.MovHoy}</span>
          <span className="sub">{r.IngresosHoy} ingresos · {r.EgresosHoy} egresos</span>
        </div>
      </div>

      {/* Filtro de rango */}
      <div className="filters-row" style={{ marginBottom: 16 }}>
        <div className="form-group">
          <label>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
      </div>

      {/* Movimientos por día */}
      <div className="panel">
        <div className="panel-header"><h2>Movimientos por día</h2></div>
        <div className="panel-body">
          <div className="chart-legend">
            <span className="key"><span className="swatch ingreso" />Ingresos</span>
            <span className="key"><span className="swatch egreso" />Egresos</span>
          </div>
          {datos.porDia.length === 0 ? <div className="empty-state">Sin movimientos en el período</div> : (
            <div className="bars-chart">
              {datos.porDia.map(d => (
                <div className="bars-day" key={d.Dia}>
                  <div className="tip">{fmtDia(d.Dia)} — Ingresos: {d.Ingresos} · Egresos: {d.Egresos}</div>
                  <div className="bars-pair">
                    <div className="bar ingreso" style={{ height: `${(d.Ingresos / maxDia) * 100}%` }} />
                    <div className="bar egreso"  style={{ height: `${(d.Egresos / maxDia) * 100}%` }} />
                  </div>
                  <span className="day-label">{fmtDia(d.Dia)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="estado-grid">
        {/* Top conductores */}
        <div className="panel">
          <div className="panel-header"><h2>Conductores con más movimientos</h2></div>
          <div className="panel-body">
            {datos.topConductores.length === 0 ? <div className="empty-state">Sin datos</div> :
              datos.topConductores.map(c => (
                <div className="hbar-row" key={c.Nombre}>
                  <span className="name" title={c.Nombre}>{c.Nombre}</span>
                  <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(c.Movimientos / maxCond) * 100}%` }} /></div>
                  <span className="num">{c.Movimientos}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Permanencia + km */}
        <div className="panel">
          <div className="panel-header"><h2>Visitas de no propios y km de tractores</h2></div>
          <div className="panel-body">
            <div className="summary-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
              <div className="summary-card">
                <span className="label">Permanencia promedio</span>
                <span className="value" style={{ fontSize: '1.6rem' }}>{fmtHoras(datos.permanenciaNoPropios?.PromMinutos)}</span>
                <span className="sub">vehículos no propios</span>
              </div>
              <div className="summary-card">
                <span className="label">Visitas cerradas</span>
                <span className="value" style={{ fontSize: '1.6rem' }}>{datos.permanenciaNoPropios?.Visitas ?? 0}</span>
                <span className="sub">ingreso + egreso en el período</span>
              </div>
            </div>
            {datos.kmTractores.length > 0 && (
              <table>
                <thead><tr><th>Tractor</th><th style={{ textAlign: 'right' }}>Km recorridos</th><th style={{ textAlign: 'right' }}>Movs.</th></tr></thead>
                <tbody>
                  {datos.kmTractores.map(k => (
                    <tr key={k.Patente}>
                      <td className="monospace"><b>{k.Patente}</b></td>
                      <td style={{ textAlign: 'right' }}>{Number(k.KmRecorridos).toLocaleString('es-AR')}</td>
                      <td style={{ textAlign: 'right' }}>{k.Movimientos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
