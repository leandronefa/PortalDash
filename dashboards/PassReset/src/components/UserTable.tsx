import { useState } from 'react'
import type { Usuario } from '../types'
import StatusBadge from './StatusBadge'
import DiasBar from './DiasBar'

interface Props {
  usuarios: Usuario[]
  onUpdateCorreo: (id: number, correo: string) => Promise<void>
}

function CorreoCell({
  usuario,
  onUpdateCorreo
}: {
  usuario: Usuario
  onUpdateCorreo: (id: number, correo: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value,   setValue]   = useState(usuario.CorreoDestino)
  const [saving,  setSaving]  = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdateCorreo(usuario.Id, value.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setValue(usuario.CorreoDestino)
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 260 }}>
        <input
          type="email"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
          autoFocus
          disabled={saving}
          placeholder="correo@dominio.com"
          style={{
            flex: 1,
            padding: '3px 7px',
            borderRadius: 5,
            border: '1px solid #4a88d4',
            fontSize: '0.82rem',
            background: 'var(--bg-card, #1e2d4f)',
            color: 'inherit',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSave}
          disabled={saving}
          title="Guardar"
          style={{
            background: '#2e7d32', color: '#fff', border: 'none',
            borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: '0.78rem'
          }}
        >
          {saving ? '…' : '✓'}
        </button>
        <button
          onClick={handleCancel}
          disabled={saving}
          title="Cancelar"
          style={{
            background: '#555', color: '#fff', border: 'none',
            borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: '0.78rem'
          }}
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}
      className="correo-cell"
    >
      {usuario.CorreoDestino
        ? <span style={{ fontSize: '0.8rem' }}>{usuario.CorreoDestino}</span>
        : <em style={{ color: '#888', fontSize: '0.78rem' }}>sin correo</em>
      }
      <button
        onClick={() => { setValue(usuario.CorreoDestino); setEditing(true) }}
        title="Editar correo"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#6a9fd8', fontSize: '0.75rem', padding: '0 2px',
          opacity: 0.6, lineHeight: 1,
        }}
        className="correo-edit-btn"
      >
        ✎
      </button>
    </div>
  )
}

export default function UserTable({ usuarios, onUpdateCorreo }: Props) {
  const [filtro, setFiltro] = useState('')

  const lista = filtro
    ? usuarios.filter(u =>
        u.UsuarioWindows.toLowerCase().includes(filtro.toLowerCase()) ||
        u.Servidor.toLowerCase().includes(filtro.toLowerCase()) ||
        u.CorreoDestino.toLowerCase().includes(filtro.toLowerCase())
      )
    : usuarios

  if (usuarios.length === 0) {
    return <div className="empty-state">No hay usuarios registrados por los agentes todavía.</div>
  }

  return (
    <>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f0f0' }}>
        <input
          type="search"
          placeholder="Buscar servidor, usuario o correo…"
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          style={{
            padding: '6px 12px', border: '1px solid #ccc', borderRadius: 6,
            width: 300, fontSize: '0.87rem', outline: 'none'
          }}
        />
        <span className="text-muted" style={{ marginLeft: 12 }}>
          {lista.length} de {usuarios.length} usuario(s)
        </span>
      </div>

      <style>{`
        .correo-edit-btn { visibility: hidden; }
        .correo-cell:hover .correo-edit-btn { visibility: visible; }
      `}</style>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Estado</th>
              <th>Servidor</th>
              <th>Usuario Windows</th>
              <th>MaxDías</th>
              <th>Último cambio</th>
              <th>Próximo cambio</th>
              <th>Vigencia restante</th>
              <th>Correo</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(u => (
              <tr key={u.Id} style={{ opacity: u.Activo ? 1 : 0.5 }}>
                <td><StatusBadge estado={u.Estado} /></td>
                <td>
                  <strong className="monospace">{u.Servidor}</strong>
                  {!u.Activo && (
                    <span className="text-muted" style={{ marginLeft: 6 }}>(inactivo)</span>
                  )}
                </td>
                <td className="monospace">{u.UsuarioWindows}</td>
                <td style={{ textAlign: 'center' }}>{u.MaxDias}</td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                  {u.UltimoCambio
                    ? u.UltimoCambio.replace('T', ' ').slice(0, 16)
                    : <em style={{ color: '#bbb' }}>nunca registrado</em>}
                </td>
                <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                  {u.FechaProximoCambio
                    ? u.FechaProximoCambio.replace('T', ' ').slice(0, 16)
                    : '—'}
                </td>
                <td>
                  <DiasBar
                    diasRestantes={u.DiasRestantes}
                    maxDias={u.MaxDias}
                    estado={u.Estado}
                  />
                </td>
                <td>
                  <CorreoCell usuario={u} onUpdateCorreo={onUpdateCorreo} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
