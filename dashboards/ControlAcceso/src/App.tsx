import { useEffect, useState, FormEvent } from 'react'
import { api, getSesion, setSesion, setOnUnauthorized } from './api'
import type { Sesion } from './types'
import { useTheme } from './hooks/useTheme'
import { ToastProvider, Modal, useToast } from './components/ui'
import Login from './components/Login'
import Carga from './components/Carga'
import EstadoBoard from './components/EstadoBoard'
import Movimientos from './components/Movimientos'
import Kpis from './components/Kpis'
import Admin from './components/Admin'

type Tab = 'carga' | 'estado' | 'movimientos' | 'kpis' | 'admin'

function CambiarPassword({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (nueva !== repetir) { toast('error', 'Las contraseñas nuevas no coinciden'); return }
    try {
      await api('/api/mi-password', { method: 'PUT', body: JSON.stringify({ actual, nueva }) })
      toast('success', 'Contraseña actualizada')
      onClose()
    } catch (err: any) { toast('error', err.message) }
  }

  return (
    <Modal title="Cambiar mi contraseña" onClose={onClose}
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar as any} disabled={!actual || nueva.length < 4}>Guardar</button>
      </>}>
      <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="form-group">
          <label>Contraseña actual</label>
          <input autoFocus type="password" value={actual} onChange={e => setActual(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="form-group">
          <label>Nueva contraseña</label>
          <input type="password" value={nueva} onChange={e => setNueva(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="form-group">
          <label>Repetir nueva contraseña</label>
          <input type="password" value={repetir} onChange={e => setRepetir(e.target.value)} autoComplete="new-password" />
        </div>
      </form>
    </Modal>
  )
}

function AppInner() {
  const { theme, toggle } = useTheme()
  const [sesion, setSes] = useState<Sesion | null>(getSesion())
  const [tab, setTab] = useState<Tab>('carga')
  const [cambiarPw, setCambiarPw] = useState(false)

  useEffect(() => {
    setOnUnauthorized(() => setSes(null))
  }, [])

  // validar el token guardado al abrir
  useEffect(() => {
    if (sesion) api('/api/me').catch(() => {})
  }, [])

  function salir() {
    setSesion(null)
    setSes(null)
  }

  if (!sesion) return <Login onLogin={s => { setSes(s); setTab('carga') }} />

  const esAdmin = sesion.rol === 'ADMIN'

  return (
    <>
      <header className="app-header">
        <div>
          <h1>🚛 Control de Acceso</h1>
          <div className="subtitle">Ingreso y egreso de vehículos — R RH 08-0</div>
        </div>
        <div className="spacer" />
        <span className="user-chip"><b>{sesion.nombre}</b> · {esAdmin ? 'Administrador' : 'Portero'}</span>
        <button className="btn btn-outline btn-sm" style={{ background: 'transparent', color: '#c7d4ec', borderColor: '#3a4f70' }}
                onClick={toggle} title="Cambiar tema">{theme === 'light' ? '🌙' : '☀️'}</button>
        <button className="btn btn-outline btn-sm" style={{ background: 'transparent', color: '#c7d4ec', borderColor: '#3a4f70' }}
                onClick={() => setCambiarPw(true)} title="Cambiar contraseña">🔑</button>
        <button className="btn btn-outline btn-sm" style={{ background: 'transparent', color: '#c7d4ec', borderColor: '#3a4f70' }}
                onClick={salir}>Salir</button>
      </header>

      <main className="main-content">
        <div className="tabs">
          <button className={`tab-btn ${tab === 'carga' ? 'active' : ''}`} onClick={() => setTab('carga')}>Carga</button>
          <button className={`tab-btn ${tab === 'estado' ? 'active' : ''}`} onClick={() => setTab('estado')}>Dentro / Fuera</button>
          <button className={`tab-btn ${tab === 'movimientos' ? 'active' : ''}`} onClick={() => setTab('movimientos')}>Movimientos</button>
          {esAdmin && <button className={`tab-btn ${tab === 'kpis' ? 'active' : ''}`} onClick={() => setTab('kpis')}>KPIs</button>}
          {esAdmin && <button className={`tab-btn ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')}>Administración</button>}
        </div>

        {tab === 'carga' && <Carga />}
        {tab === 'estado' && <EstadoBoard />}
        {tab === 'movimientos' && <Movimientos rol={sesion.rol} />}
        {tab === 'kpis' && esAdmin && <Kpis />}
        {tab === 'admin' && esAdmin && <Admin />}
      </main>

      {cambiarPw && <CambiarPassword onClose={() => setCambiarPw(false)} />}
    </>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}
