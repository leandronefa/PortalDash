import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Movimiento, Rol } from '../types'
import { fmtFecha, useToast } from './ui'

function hoyMenos(dias: number): string {
  const d = new Date(Date.now() - dias * 86400000)
  return d.toISOString().slice(0, 10)
}

export default function Movimientos({ rol }: { rol: Rol }) {
  const toast = useToast()
  const [lista, setLista] = useState<Movimiento[]>([])
  const [desde, setDesde] = useState(hoyMenos(7))
  const [hasta, setHasta] = useState(hoyMenos(0))
  const [tipo, setTipo] = useState('')
  const [propio, setPropio] = useState('')
  const [buscar, setBuscar] = useState('')
  const [cargando, setCargando] = useState(false)

  async function cargar() {
    setCargando(true)
    try {
      const qs = new URLSearchParams()
      if (desde) qs.set('desde', desde)
      if (hasta) qs.set('hasta', hasta)
      if (tipo) qs.set('tipo', tipo)
      if (propio !== '') qs.set('propio', propio)
      if (buscar) qs.set('buscar', buscar)
      setLista(await api<Movimiento[]>(`/api/movimientos?${qs}`))
    } catch (err: any) { toast('error', err.message) }
    finally { setCargando(false) }
  }
  useEffect(() => { cargar() }, [desde, hasta, tipo, propio])

  async function anular(m: Movimiento) {
    const desc = m.EsPropio ? (m.PatTractor || m.PatSemi) : m.Patente
    if (!window.confirm(`¿Anular el ${m.Tipo} de ${desc} del ${fmtFecha(m.FechaHora)}? Queda registrado como anulado.`)) return
    try {
      await api(`/api/movimientos/${m.Id}`, { method: 'DELETE' })
      toast('success', 'Movimiento anulado')
      cargar()
    } catch (err: any) { toast('error', err.message) }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Historial de movimientos</h2>
        <div className="spacer" />
        <span className="count-pill">{lista.length}</span>
      </div>
      <div className="panel-body" style={{ paddingBottom: 0 }}>
        <div className="filters-row" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label>Desde</label>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Movimiento</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="INGRESO">Ingresos</option>
              <option value="EGRESO">Egresos</option>
            </select>
          </div>
          <div className="form-group">
            <label>Flota</label>
            <select value={propio} onChange={e => setPropio(e.target.value)}>
              <option value="">Todas</option>
              <option value="1">Propios</option>
              <option value="0">No propios</option>
            </select>
          </div>
          <div className="form-group">
            <label>Patente</label>
            <input value={buscar} onChange={e => setBuscar(e.target.value.toUpperCase())}
                   onKeyDown={e => e.key === 'Enter' && cargar()} placeholder="AA123BB" className="monospace" />
          </div>
          <button className="btn btn-outline" onClick={cargar} disabled={cargando}>{cargando ? '…' : 'Filtrar'}</button>
        </div>
      </div>
      <div className="table-wrap">
        {lista.length === 0 ? <div className="empty-state">Sin movimientos en el período</div> : (
          <table>
            <thead>
              <tr>
                <th>Fecha y hora</th><th>Mov.</th><th>Tractor / Patente</th><th>Semi</th>
                <th>Conductor</th><th>Km</th><th>Destino / Origen</th><th>Viaje</th><th>Remito</th>
                <th>Obs.</th><th>Cargó</th>{rol === 'ADMIN' && <th></th>}
              </tr>
            </thead>
            <tbody>
              {lista.map(m => (
                <tr key={m.Id} className={m.Anulado ? 'anulado' : ''}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtFecha(m.FechaHora)}</td>
                  <td><span className={`badge badge-${m.Tipo.toLowerCase()}`}>{m.Tipo}</span></td>
                  <td className="monospace">
                    <b>{m.EsPropio ? (m.PatTractor || '—') : m.Patente}</b>
                    {!m.EsPropio && <span className="text-muted"> {m.TipoVehiculo}</span>}
                  </td>
                  <td className="monospace">{m.PatSemi || '—'}</td>
                  <td>{m.Conductor || m.ConductorNom || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{m.Kilometraje ?? '—'}</td>
                  <td>{m.DestinoOrigen || '—'}</td>
                  <td>{m.NroViaje || '—'}</td>
                  <td>{m.NroRemito || '—'}</td>
                  <td title={m.Observaciones || ''} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.Observaciones || '—'}
                  </td>
                  <td className="text-muted">{m.UsuarioCarga}{m.Anulado && ` · anulado por ${m.AnuladoPor}`}</td>
                  {rol === 'ADMIN' && (
                    <td>{!m.Anulado && <button className="btn btn-danger btn-sm" onClick={() => anular(m)}>Anular</button>}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
