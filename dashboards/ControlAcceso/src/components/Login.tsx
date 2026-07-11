import { useState, FormEvent } from 'react'
import { api, setSesion } from '../api'
import type { Sesion } from '../types'

export default function Login({ onLogin }: { onLogin: (s: Sesion) => void }) {
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setCargando(true)
    try {
      const r = await api<Sesion & { token: string }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ usuario, password })
      })
      const ses: Sesion = { token: r.token, usuario: r.usuario, nombre: r.nombre, rol: r.rol }
      setSesion(ses)
      onLogin(ses)
    } catch (err: any) {
      setError(err.message || 'Error de conexión')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <h1>🚛 Control de Acceso</h1>
          <p>Ingreso y egreso de vehículos — R RH 08-0</p>
        </div>
        <form onSubmit={submit}>
          {error && <div className="login-error">{error}</div>}
          <div className="form-group">
            <label>Usuario</label>
            <input autoFocus value={usuario} onChange={e => setUsuario(e.target.value)}
                   autoComplete="username" autoCapitalize="none" />
          </div>
          <div className="form-group">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                   autoComplete="current-password" />
          </div>
          <button className="btn btn-primary btn-lg" disabled={cargando || !usuario || !password}>
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}
