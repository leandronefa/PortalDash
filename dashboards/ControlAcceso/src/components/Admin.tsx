import { useEffect, useState, FormEvent } from 'react'
import { api } from '../api'
import type { Vehiculo, Conductor, Usuario } from '../types'
import { Modal, useToast } from './ui'

type SubTab = 'vehiculos' | 'conductores' | 'usuarios'

// ── Vehículos ────────────────────────────────────────────────────────────────
function AbmVehiculos() {
  const toast = useToast()
  const [lista, setLista] = useState<Vehiculo[]>([])
  const [modal, setModal] = useState<null | { veh?: Vehiculo }>(null)
  const [patente, setPatente] = useState('')
  const [tipo, setTipo] = useState<'TRACTOR' | 'SEMI'>('TRACTOR')
  const [descripcion, setDescripcion] = useState('')

  async function cargar() {
    try { setLista(await api<Vehiculo[]>('/api/vehiculos?todos=1')) }
    catch (err: any) { toast('error', err.message) }
  }
  useEffect(() => { cargar() }, [])

  function abrir(veh?: Vehiculo) {
    setPatente(veh?.Patente || '')
    setTipo(veh?.Tipo || 'TRACTOR')
    setDescripcion(veh?.Descripcion || '')
    setModal({ veh })
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    try {
      if (modal?.veh) {
        await api(`/api/vehiculos/${modal.veh.Id}`, { method: 'PUT', body: JSON.stringify({ descripcion, activo: modal.veh.Activo }) })
      } else {
        await api('/api/vehiculos', { method: 'POST', body: JSON.stringify({ patente, tipo, descripcion }) })
      }
      toast('success', 'Vehículo guardado')
      setModal(null)
      cargar()
    } catch (err: any) { toast('error', err.message) }
  }

  async function toggleActivo(v: Vehiculo) {
    try {
      await api(`/api/vehiculos/${v.Id}`, { method: 'PUT', body: JSON.stringify({ descripcion: v.Descripcion, activo: !v.Activo }) })
      cargar()
    } catch (err: any) { toast('error', err.message) }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Vehículos propios</h2>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => abrir()}>+ Agregar</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Patente</th><th>Tipo</th><th>Descripción</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {lista.map(v => (
              <tr key={v.Id}>
                <td className="monospace"><b>{v.Patente}</b></td>
                <td>{v.Tipo === 'TRACTOR' ? 'Tractor' : 'Semirremolque'}</td>
                <td>{v.Descripcion || '—'}</td>
                <td>{v.Activo ? <span className="badge badge-dentro">Activo</span> : <span className="badge badge-inactivo">Inactivo</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => abrir(v)}>Editar</button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => toggleActivo(v)}>{v.Activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title={modal.veh ? `Editar ${modal.veh.Patente}` : 'Nuevo vehículo'} onClose={() => setModal(null)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar as any}>Guardar</button>
          </>}>
          <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!modal.veh && (
              <>
                <div className="form-group">
                  <label>Patente</label>
                  <input autoFocus value={patente} onChange={e => setPatente(e.target.value.toUpperCase())} className="monospace" maxLength={10} />
                  <div className="hint">Mayúsculas, sin espacios ni guiones</div>
                </div>
                <div className="form-group">
                  <label>Tipo</label>
                  <select value={tipo} onChange={e => setTipo(e.target.value as any)}>
                    <option value="TRACTOR">Tractor</option>
                    <option value="SEMI">Semirremolque</option>
                  </select>
                </div>
              </>
            )}
            <div className="form-group">
              <label>Descripción</label>
              <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Ej: Scania R450" />
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Conductores ──────────────────────────────────────────────────────────────
function AbmConductores() {
  const toast = useToast()
  const [lista, setLista] = useState<Conductor[]>([])
  const [modal, setModal] = useState<null | { con?: Conductor }>(null)
  const [nombre, setNombre] = useState('')
  const [documento, setDocumento] = useState('')

  async function cargar() {
    try { setLista(await api<Conductor[]>('/api/conductores?todos=1')) }
    catch (err: any) { toast('error', err.message) }
  }
  useEffect(() => { cargar() }, [])

  function abrir(con?: Conductor) {
    setNombre(con?.Nombre || '')
    setDocumento(con?.Documento || '')
    setModal({ con })
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    try {
      if (modal?.con) {
        await api(`/api/conductores/${modal.con.Id}`, { method: 'PUT', body: JSON.stringify({ nombre, documento, activo: modal.con.Activo }) })
      } else {
        await api('/api/conductores', { method: 'POST', body: JSON.stringify({ nombre, documento }) })
      }
      toast('success', 'Conductor guardado')
      setModal(null)
      cargar()
    } catch (err: any) { toast('error', err.message) }
  }

  async function toggleActivo(c: Conductor) {
    try {
      await api(`/api/conductores/${c.Id}`, { method: 'PUT', body: JSON.stringify({ nombre: c.Nombre, documento: c.Documento, activo: !c.Activo }) })
      cargar()
    } catch (err: any) { toast('error', err.message) }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Conductores</h2>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => abrir()}>+ Agregar</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Documento</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {lista.map(c => (
              <tr key={c.Id}>
                <td>{c.Nombre}</td>
                <td>{c.Documento || '—'}</td>
                <td>{c.Activo ? <span className="badge badge-dentro">Activo</span> : <span className="badge badge-inactivo">Inactivo</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => abrir(c)}>Editar</button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => toggleActivo(c)}>{c.Activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title={modal.con ? `Editar ${modal.con.Nombre}` : 'Nuevo conductor'} onClose={() => setModal(null)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar as any}>Guardar</button>
          </>}>
          <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label>Nombre y apellido</label>
              <input autoFocus value={nombre} onChange={e => setNombre(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Documento (opcional)</label>
              <input value={documento} onChange={e => setDocumento(e.target.value)} />
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Usuarios ─────────────────────────────────────────────────────────────────
function AbmUsuarios() {
  const toast = useToast()
  const [lista, setLista] = useState<Usuario[]>([])
  const [modal, setModal] = useState<null | { usu?: Usuario }>(null)
  const [usuario, setUsuario] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState<'PORTERO' | 'ADMIN'>('PORTERO')
  const [password, setPassword] = useState('')

  async function cargar() {
    try { setLista(await api<Usuario[]>('/api/usuarios')) }
    catch (err: any) { toast('error', err.message) }
  }
  useEffect(() => { cargar() }, [])

  function abrir(usu?: Usuario) {
    setUsuario(usu?.Usuario || '')
    setNombre(usu?.Nombre || '')
    setRol(usu?.Rol || 'PORTERO')
    setPassword('')
    setModal({ usu })
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    try {
      if (modal?.usu) {
        await api(`/api/usuarios/${modal.usu.Id}`, {
          method: 'PUT',
          body: JSON.stringify({ nombre, rol, activo: modal.usu.Activo, password: password || undefined })
        })
      } else {
        await api('/api/usuarios', { method: 'POST', body: JSON.stringify({ usuario, nombre, rol, password }) })
      }
      toast('success', 'Usuario guardado')
      setModal(null)
      cargar()
    } catch (err: any) { toast('error', err.message) }
  }

  async function toggleActivo(u: Usuario) {
    try {
      await api(`/api/usuarios/${u.Id}`, {
        method: 'PUT',
        body: JSON.stringify({ nombre: u.Nombre, rol: u.Rol, activo: !u.Activo })
      })
      cargar()
    } catch (err: any) { toast('error', err.message) }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Usuarios del sistema</h2>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => abrir()}>+ Agregar</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {lista.map(u => (
              <tr key={u.Id}>
                <td className="monospace">{u.Usuario}</td>
                <td>{u.Nombre}</td>
                <td><span className={`badge badge-${u.Rol.toLowerCase()}`}>{u.Rol === 'ADMIN' ? 'Administrador' : 'Portero'}</span></td>
                <td>{u.Activo ? <span className="badge badge-dentro">Activo</span> : <span className="badge badge-inactivo">Inactivo</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => abrir(u)}>Editar</button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => toggleActivo(u)}>{u.Activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal title={modal.usu ? `Editar ${modal.usu.Usuario}` : 'Nuevo usuario'} onClose={() => setModal(null)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar as any}>Guardar</button>
          </>}>
          <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!modal.usu && (
              <div className="form-group">
                <label>Usuario (login)</label>
                <input autoFocus value={usuario} onChange={e => setUsuario(e.target.value.toLowerCase())} autoCapitalize="none" />
                <div className="hint">Minúsculas, números y . _ -</div>
              </div>
            )}
            <div className="form-group">
              <label>Nombre completo</label>
              <input value={nombre} onChange={e => setNombre(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Rol</label>
              <select value={rol} onChange={e => setRol(e.target.value as any)}>
                <option value="PORTERO">Portero (carga de movimientos)</option>
                <option value="ADMIN">Administrador (KPIs + ABM)</option>
              </select>
            </div>
            <div className="form-group">
              <label>{modal.usu ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Contenedor ───────────────────────────────────────────────────────────────
export default function Admin() {
  const [sub, setSub] = useState<SubTab>('vehiculos')
  return (
    <>
      <div className="tabs">
        <button className={`tab-btn ${sub === 'vehiculos' ? 'active' : ''}`} onClick={() => setSub('vehiculos')}>Vehículos</button>
        <button className={`tab-btn ${sub === 'conductores' ? 'active' : ''}`} onClick={() => setSub('conductores')}>Conductores</button>
        <button className={`tab-btn ${sub === 'usuarios' ? 'active' : ''}`} onClick={() => setSub('usuarios')}>Usuarios</button>
      </div>
      {sub === 'vehiculos' && <AbmVehiculos />}
      {sub === 'conductores' && <AbmConductores />}
      {sub === 'usuarios' && <AbmUsuarios />}
    </>
  )
}
