import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Estado, EstadoVehiculo } from '../types'
import { fmtFecha, fmtHace, useToast } from './ui'

function TablaVehiculos({ titulo, lista, dentro }: { titulo: string; lista: EstadoVehiculo[]; dentro: boolean }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{titulo}</h2>
        <span className={`badge ${dentro ? 'badge-dentro' : 'badge-fuera'}`}>{dentro ? 'DENTRO' : 'FUERA'}</span>
        <div className="spacer" />
        <span className="count-pill">{lista.length}</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: 380 }}>
        {lista.length === 0 ? <div className="empty-state">Sin unidades</div> : (
          <table>
            <thead>
              <tr><th>Patente</th><th>Tipo</th><th>Último mov.</th><th>Conductor</th><th>Destino / Origen</th></tr>
            </thead>
            <tbody>
              {lista.map(v => (
                <tr key={v.Id}>
                  <td className="monospace"><b>{v.Patente}</b>{v.Descripcion ? <span className="text-muted"> {v.Descripcion}</span> : null}</td>
                  <td>{v.Tipo === 'TRACTOR' ? 'Tractor' : 'Semi'}</td>
                  <td title={fmtFecha(v.FechaHora)}>{v.FechaHora ? `${fmtFecha(v.FechaHora)} (${fmtHace(v.FechaHora)})` : '—'}</td>
                  <td>{v.Conductor || '—'}</td>
                  <td>{v.DestinoOrigen || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function EstadoBoard() {
  const toast = useToast()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [buscar, setBuscar] = useState('')

  async function cargar() {
    try { setEstado(await api<Estado>('/api/estado')) }
    catch (err: any) { toast('error', err.message) }
  }
  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 60000)
    return () => clearInterval(t)
  }, [])

  if (!estado) return <div className="empty-state">Cargando…</div>

  const f = (v: EstadoVehiculo) =>
    !buscar || v.Patente.includes(buscar.toUpperCase().replace(/[^A-Z0-9]/g, ''))

  const dentro    = estado.propios.filter(v => v.UltimoMov === 'INGRESO').filter(f)
  const fuera     = estado.propios.filter(v => v.UltimoMov === 'EGRESO').filter(f)
  const sinMov    = estado.propios.filter(v => !v.UltimoMov).filter(f)
  const noPropios = estado.noPropiosDentro.filter(n => !buscar || n.Patente.includes(buscar.toUpperCase().replace(/[^A-Z0-9]/g, '')))

  return (
    <>
      <div className="filters-row" style={{ marginBottom: 16 }}>
        <div className="form-group" style={{ minWidth: 220 }}>
          <label>Buscar patente</label>
          <input value={buscar} onChange={e => setBuscar(e.target.value.toUpperCase())} placeholder="AA123BB" className="monospace" />
        </div>
        <button className="btn btn-outline" onClick={cargar}>⟳ Actualizar</button>
      </div>

      <div className="estado-grid">
        <TablaVehiculos titulo="Unidades propias dentro" lista={dentro} dentro={true} />
        <TablaVehiculos titulo="Unidades propias fuera" lista={fuera} dentro={false} />
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <h2>Vehículos no propios dentro del predio</h2>
          <div className="spacer" />
          <span className="count-pill">{noPropios.length}</span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          {noPropios.length === 0 ? <div className="empty-state">No hay vehículos externos dentro</div> : (
            <table>
              <thead>
                <tr><th>Patente</th><th>Tipo</th><th>Conductor</th><th>Ingresó</th><th>Observaciones</th></tr>
              </thead>
              <tbody>
                {noPropios.map(n => (
                  <tr key={n.Patente}>
                    <td className="monospace"><b>{n.Patente}</b></td>
                    <td>{n.TipoVehiculo || '—'}</td>
                    <td>{n.ConductorNom || '—'}</td>
                    <td>{fmtFecha(n.FechaHora)} <span className="text-muted">({fmtHace(n.FechaHora)})</span></td>
                    <td>{n.Observaciones || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {sinMov.length > 0 && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-header">
            <h2>Unidades sin movimientos registrados</h2>
            <div className="spacer" />
            <span className="count-pill">{sinMov.length}</span>
          </div>
          <div className="panel-body">
            <p className="text-muted" style={{ marginBottom: 8 }}>Todavía no tienen ingresos ni egresos cargados, por eso no se sabe si están dentro o fuera.</p>
            {sinMov.map(v => (
              <span key={v.Id} className="badge badge-sindatos monospace" style={{ marginRight: 6, marginBottom: 6, display: 'inline-block' }}>
                {v.Patente} ({v.Tipo === 'TRACTOR' ? 'T' : 'S'})
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
