import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import type { Vehiculo, Conductor, Estado } from '../types'
import { Modal, useToast, fmtHace } from './ui'

function ahoraLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function Carga() {
  const toast = useToast()

  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [conductores, setConductores] = useState<Conductor[]>([])
  const [tiposVehiculo, setTiposVehiculo] = useState<string[]>([])
  const [estado, setEstado] = useState<Estado | null>(null)

  const [esPropio, setEsPropio] = useState(true)
  const [tipo, setTipo] = useState<'INGRESO' | 'EGRESO' | ''>('')
  const [fechaHora, setFechaHora] = useState(ahoraLocal())
  // propios
  const [idTractor, setIdTractor] = useState('')
  const [idSemi, setIdSemi] = useState('')
  const [idConductor, setIdConductor] = useState('')
  const [kilometraje, setKilometraje] = useState('')
  const [destinoOrigen, setDestinoOrigen] = useState('')
  const [nroViaje, setNroViaje] = useState('')
  const [nroRemito, setNroRemito] = useState('')
  // no propios
  const [patente, setPatente] = useState('')
  const [tipoVehiculo, setTipoVehiculo] = useState('')
  const [conductorNombre, setConductorNombre] = useState('')

  const [observaciones, setObservaciones] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [avisos, setAvisos] = useState<string[] | null>(null)

  async function cargarCatalogos() {
    try {
      const [v, c, t, e] = await Promise.all([
        api<Vehiculo[]>('/api/vehiculos'),
        api<Conductor[]>('/api/conductores'),
        api<string[]>('/api/tipos-vehiculo'),
        api<Estado>('/api/estado')
      ])
      setVehiculos(v); setConductores(c); setTiposVehiculo(t); setEstado(e)
    } catch (err: any) {
      toast('error', err.message)
    }
  }
  useEffect(() => { cargarCatalogos() }, [])

  const tractores = useMemo(() => vehiculos.filter(v => v.Tipo === 'TRACTOR'), [vehiculos])
  const semis     = useMemo(() => vehiculos.filter(v => v.Tipo === 'SEMI'), [vehiculos])

  function estadoDe(id: string) {
    if (!id || !estado) return null
    return estado.propios.find(p => p.Id === parseInt(id)) || null
  }
  const estTractor = estadoDe(idTractor)
  const estSemi    = estadoDe(idSemi)

  function badgeEstado(e: ReturnType<typeof estadoDe>) {
    if (!e) return null
    if (!e.UltimoMov) return <span className="badge badge-sindatos">sin movimientos</span>
    return e.UltimoMov === 'INGRESO'
      ? <span className="badge badge-dentro">DENTRO {fmtHace(e.FechaHora)}</span>
      : <span className="badge badge-fuera">FUERA {fmtHace(e.FechaHora)}</span>
  }

  // sugerir el movimiento contrario al estado actual del tractor
  useEffect(() => {
    const e = estTractor || estSemi
    if (e && e.UltimoMov && !tipo) {
      setTipo(e.UltimoMov === 'INGRESO' ? 'EGRESO' : 'INGRESO')
    }
  }, [idTractor, idSemi])

  function limpiar() {
    setTipo(''); setFechaHora(ahoraLocal())
    setIdTractor(''); setIdSemi(''); setIdConductor(''); setKilometraje('')
    setDestinoOrigen(''); setNroViaje(''); setNroRemito('')
    setPatente(''); setTipoVehiculo(''); setConductorNombre('')
    setObservaciones('')
  }

  const valido = tipo && (esPropio
    ? (idTractor || idSemi) && idConductor
    : patente.trim().length >= 5 && tipoVehiculo)

  async function guardar(forzar = false) {
    if (!valido || guardando) return
    setGuardando(true)
    setAvisos(null)
    try {
      await api('/api/movimientos', {
        method: 'POST',
        body: JSON.stringify({
          tipo, esPropio, forzar,
          fechaHora: new Date(fechaHora).toISOString(),
          idTractor: idTractor || null,
          idSemi: idSemi || null,
          idConductor: idConductor || null,
          kilometraje: kilometraje || null,
          destinoOrigen, nroViaje, nroRemito,
          patente, tipoVehiculo, conductorNombre,
          observaciones
        })
      })
      toast('success', `${tipo} registrado correctamente`)
      limpiar()
      cargarCatalogos()
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.avisos) {
        setAvisos(err.avisos)
      } else {
        toast('error', err.message)
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Registrar movimiento</h2>
        <div className="spacer" />
        <div className="seg seg-sm" style={{ width: 280 }}>
          <button className={esPropio ? 'on-neutral' : ''} onClick={() => setEsPropio(true)}>Vehículo propio</button>
          <button className={!esPropio ? 'on-neutral' : ''} onClick={() => setEsPropio(false)}>No propio</button>
        </div>
      </div>
      <div className="panel-body">
        <div className="form-grid">
          <div className="form-group full">
            <label>Tipo de movimiento</label>
            <div className="seg">
              <button type="button" className={tipo === 'INGRESO' ? 'on-ingreso' : ''} onClick={() => setTipo('INGRESO')}>⬇ INGRESO</button>
              <button type="button" className={tipo === 'EGRESO' ? 'on-egreso' : ''} onClick={() => setTipo('EGRESO')}>⬆ EGRESO</button>
            </div>
          </div>

          <div className="form-group">
            <label>Fecha y hora</label>
            <input type="datetime-local" value={fechaHora} onChange={e => setFechaHora(e.target.value)} />
          </div>

          {esPropio ? (
            <>
              <div className="form-group">
                <label>Conductor</label>
                <select value={idConductor} onChange={e => setIdConductor(e.target.value)}>
                  <option value="">— Elegir conductor —</option>
                  {conductores.map(c => <option key={c.Id} value={c.Id}>{c.Nombre}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Patente tractor</label>
                <select value={idTractor} onChange={e => { setIdTractor(e.target.value); setTipo('') }}>
                  <option value="">— Elegir tractor —</option>
                  {tractores.map(v => <option key={v.Id} value={v.Id}>{v.Patente}{v.Descripcion ? ` · ${v.Descripcion}` : ''}</option>)}
                </select>
                <div className="estado-hint">{badgeEstado(estTractor)}</div>
              </div>
              <div className="form-group">
                <label>Patente semirremolque</label>
                <select value={idSemi} onChange={e => setIdSemi(e.target.value)}>
                  <option value="">— Sin semi —</option>
                  {semis.map(v => <option key={v.Id} value={v.Id}>{v.Patente}{v.Descripcion ? ` · ${v.Descripcion}` : ''}</option>)}
                </select>
                <div className="estado-hint">{badgeEstado(estSemi)}</div>
              </div>
              <div className="form-group">
                <label>Kilometraje (km)</label>
                <input type="number" min="0" step="0.1" value={kilometraje} onChange={e => setKilometraje(e.target.value)} placeholder="Ej: 152340" />
              </div>
              <div className="form-group">
                <label>Destino / Origen</label>
                <input value={destinoOrigen} onChange={e => setDestinoOrigen(e.target.value)} placeholder="Ej: Sucursal Córdoba" />
              </div>
              <div className="form-group">
                <label>N° Viaje</label>
                <input value={nroViaje} onChange={e => setNroViaje(e.target.value)} />
              </div>
              <div className="form-group">
                <label>N° Remito</label>
                <input value={nroRemito} onChange={e => setNroRemito(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label>Patente</label>
                <input value={patente} onChange={e => setPatente(e.target.value.toUpperCase())}
                       placeholder="AA123BB" maxLength={10} className="monospace" />
                <div className="hint">Se guarda en mayúsculas, sin espacios ni guiones</div>
              </div>
              <div className="form-group">
                <label>Tipo de vehículo</label>
                <select value={tipoVehiculo} onChange={e => setTipoVehiculo(e.target.value)}>
                  <option value="">— Elegir tipo —</option>
                  {tiposVehiculo.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Conductor (nombre)</label>
                <input value={conductorNombre} onChange={e => setConductorNombre(e.target.value)} placeholder="Nombre y apellido" />
              </div>
            </>
          )}

          <div className="form-group full">
            <label>Detalles / Observaciones</label>
            <textarea rows={2} value={observaciones} onChange={e => setObservaciones(e.target.value)} />
          </div>

          <div className="full" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={limpiar} disabled={guardando}>Limpiar</button>
            <button className="btn btn-primary btn-lg" onClick={() => guardar(false)} disabled={!valido || guardando}>
              {guardando ? 'Guardando…' : `Registrar ${tipo || 'movimiento'}`}
            </button>
          </div>
        </div>
      </div>

      {avisos && (
        <Modal title="Revisar antes de guardar" onClose={() => setAvisos(null)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setAvisos(null)}>Corregir</button>
            <button className="btn btn-danger" onClick={() => { setAvisos(null); guardar(true) }}>Guardar igual</button>
          </>}>
          <div className="modal-warn">
            {avisos.map((a, i) => <p key={i} style={{ marginBottom: i < avisos.length - 1 ? 8 : 0 }}>⚠ {a}</p>)}
          </div>
          <p className="text-muted">Si es un error de carga, tocá “Corregir”. Si el movimiento es real (por ej. quedó uno sin registrar), podés guardarlo igual.</p>
        </Modal>
      )}
    </div>
  )
}
