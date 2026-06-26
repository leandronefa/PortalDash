import { useState, useEffect, useCallback } from 'react'
import type { Usuario, Resumen, LogEntry } from './types'
import { api } from './api'
import { useTheme } from './hooks/useTheme'
import UserTable from './components/UserTable'
import LogTable from './components/LogTable'

// ── Toast ─────────────────────────────────────────────────────────────────────
interface Toast { id: number; msg: string; type: 'success' | 'error' | 'warn' }
let toastSeq = 0

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((msg: string, type: Toast['type'] = 'success') => {
    const id = ++toastSeq
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }, [])

  return { toasts, push }
}

// ── Tarjeta de resumen ────────────────────────────────────────────────────────
function SummaryCard({ label, value, type }: { label: string; value: number; type: string }) {
  return (
    <div className={`summary-card ${type}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  )
}

// ── Selector de servidor ──────────────────────────────────────────────────────
function ServerFilter({
  servidores, selected, onChange
}: { servidores: string[]; selected: string; onChange: (s: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <label style={{ fontSize: '0.82rem', color: '#8fa8d4', whiteSpace: 'nowrap' }}>
        Servidor:
      </label>
      <select
        value={selected}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '5px 10px',
          borderRadius: 6,
          border: '1px solid #4a6091',
          background: '#2a3f6f',
          color: '#fff',
          fontSize: '0.85rem',
          outline: 'none',
          cursor: 'pointer'
        }}
      >
        <option value="">Todos los servidores</option>
        {servidores.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
type Tab = 'usuarios' | 'log'

export default function App() {
  const { theme, toggle } = useTheme()
  const [tab, setTab]               = useState<Tab>('usuarios')
  const [servidores, setServidores] = useState<string[]>([])
  const [servidor, setServidor]     = useState('')          // '' = todos
  const [mostrarTodos, setMostrarTodos] = useState(false)
  const [resumen, setResumen]       = useState<Resumen | null>(null)
  const [usuarios, setUsuarios]     = useState<Usuario[]>([])
  const [log, setLog]               = useState<LogEntry[]>([])
  const [loading, setLoading]       = useState(true)
  const [lastUpdate, setLastUpdate] = useState('')
  const { toasts, push }            = useToasts()

  // ── Carga de datos ─────────────────────────────────────────────────────────
  const cargarDatos = useCallback(async () => {
    try {
      const [srvs, res, usu] = await Promise.all([
        api.getServidores(),
        api.getResumen(servidor || undefined),
        api.getUsuarios(servidor || undefined, mostrarTodos)
      ])
      setServidores(srvs)
      setResumen(res)
      setUsuarios(usu)
      setLastUpdate(new Date().toLocaleTimeString('es-AR'))
    } catch (err: unknown) {
      push(err instanceof Error ? err.message : 'Error al cargar datos', 'error')
    }
  }, [servidor, mostrarTodos, push])

  const cargarLog = useCallback(async () => {
    try {
      const data = await api.getLog(servidor || undefined, undefined, 200)
      setLog(data)
    } catch (err: unknown) {
      push(err instanceof Error ? err.message : 'Error al cargar historial', 'error')
    }
  }, [servidor, push])

  // Carga inicial
  useEffect(() => {
    setLoading(true)
    Promise.all([cargarDatos(), cargarLog()]).finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Recargar al cambiar filtros
  useEffect(() => {
    cargarDatos()
    cargarLog()
  }, [servidor, mostrarTodos, cargarDatos, cargarLog])

  // Auto-refresh cada 5 minutos
  useEffect(() => {
    const timer = setInterval(() => {
      cargarDatos()
      if (tab === 'log') cargarLog()
    }, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [tab, cargarDatos, cargarLog])

  const handleRecargar = () => {
    cargarDatos()
    cargarLog()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Header */}
      <header className="app-header">
        <div>
          <h1>🔐 PassReset</h1>
          <div className="subtitle">Monitor de contraseñas — {servidores.length} servidor(es)</div>
        </div>

        <ServerFilter
          servidores={servidores}
          selected={servidor}
          onChange={setServidor}
        />

        <div className="spacer" />

        {lastUpdate && (
          <span className="last-update">Actualizado: {lastUpdate}</span>
        )}
        <button
          onClick={toggle}
          title={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
          style={{
            background: 'none',
            border: '1px solid #4a6091',
            borderRadius: 6,
            color: '#8fa8d4',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: '4px 10px',
            lineHeight: 1,
          }}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <button
          className="btn btn-outline btn-sm"
          style={{ color: '#8fa8d4', borderColor: '#4a6091' }}
          onClick={handleRecargar}
          title="Recargar datos"
        >
          ↺ Recargar
        </button>
      </header>

      <div className="main-content">
        {/* Tarjetas de resumen */}
        {resumen && (
          <div className="summary-grid">
            <SummaryCard label="Usuarios activos"           value={resumen.Total}    type="total"   />
            <SummaryCard label="Contraseñas vencidas"       value={resumen.Vencidas} type="vencida" />
            <SummaryCard label="Próximas a vencer (≤5 días)" value={resumen.Proximas} type="proxima" />
            <SummaryCard label="Vigentes"                   value={resumen.Ok}       type="ok"      />
          </div>
        )}

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab-btn ${tab === 'usuarios' ? 'active' : ''}`}
            onClick={() => setTab('usuarios')}
          >
            🖥️ Servidores / Usuarios
          </button>
          <button
            className={`tab-btn ${tab === 'log' ? 'active' : ''}`}
            onClick={() => { setTab('log'); cargarLog() }}
          >
            📋 Historial de cambios
          </button>
        </div>

        {/* Panel Usuarios */}
        {tab === 'usuarios' && (
          <div className="panel">
            <div className="panel-header">
              <h2>
                Estado de contraseñas
                {servidor && <span className="text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>— {servidor}</span>}
              </h2>
              <label className="form-check" style={{ fontSize: '0.82rem', color: '#666' }}>
                <input
                  type="checkbox"
                  checked={mostrarTodos}
                  onChange={e => setMostrarTodos(e.target.checked)}
                />
                Mostrar inactivos
              </label>
              <div className="spacer" />
              <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                Solo lectura — los agentes actualizan los datos
              </span>
            </div>

            {loading
              ? <div className="empty-state">Cargando…</div>
              : <UserTable
                  usuarios={usuarios}
                  onUpdateCorreo={async (id, correo) => {
                    await api.updateCorreo(id, correo)
                    push('Correo actualizado', 'success')
                    await cargarDatos()
                  }}
                />
            }
          </div>
        )}

        {/* Panel Log */}
        {tab === 'log' && (
          <div className="panel">
            <div className="panel-header">
              <h2>
                Historial de operaciones
                {servidor && <span className="text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>— {servidor}</span>}
              </h2>
              <div className="spacer" />
              <button className="btn btn-outline btn-sm" onClick={cargarLog}>
                ↺ Recargar
              </button>
            </div>
            {loading
              ? <div className="empty-state">Cargando…</div>
              : <LogTable entries={log} />
            }
          </div>
        )}
      </div>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </>
  )
}
