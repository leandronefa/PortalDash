import { useState } from 'react'
import type { LogEntry } from '../types'

interface Props {
  entries: LogEntry[]
}

function ResultBadge({ r }: { r: LogEntry['Resultado'] }) {
  if (r === 'OK')            return <span className="badge badge-ok">OK</span>
  if (r === 'OK_MAIL_ERROR') return <span className="badge badge-mail-err">OK (sin correo)</span>
  return <span className="badge badge-error">Error</span>
}

export default function LogTable({ entries }: Props) {
  const [filtro, setFiltro] = useState('')

  const lista = filtro
    ? entries.filter(e =>
        e.UsuarioWindows.toLowerCase().includes(filtro.toLowerCase()) ||
        e.Servidor.toLowerCase().includes(filtro.toLowerCase()) ||
        e.Resultado.toLowerCase().includes(filtro.toLowerCase())
      )
    : entries

  if (entries.length === 0) {
    return <div className="empty-state">Los agentes aún no reportaron ninguna operación.</div>
  }

  return (
    <>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f0f0' }}>
        <input
          type="search"
          placeholder="Buscar servidor, usuario o resultado…"
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          style={{
            padding: '6px 12px', border: '1px solid #ccc', borderRadius: 6,
            width: 300, fontSize: '0.87rem', outline: 'none'
          }}
        />
        <span className="text-muted" style={{ marginLeft: 12 }}>
          {lista.length} de {entries.length} registro(s)
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha y hora</th>
              <th>Servidor</th>
              <th>Usuario</th>
              <th>Resultado</th>
              <th>Origen</th>
              <th>Próximo cambio</th>
              <th>Detalle error</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(e => (
              <tr key={e.Id}>
                <td className="text-muted">{e.Id}</td>
                <td className="text-muted monospace" style={{ whiteSpace: 'nowrap' }}>
                  {e.FechaHora}
                </td>
                <td><strong className="monospace">{e.Servidor}</strong></td>
                <td className="monospace">{e.UsuarioWindows}</td>
                <td><ResultBadge r={e.Resultado} /></td>
                <td>
                  <span className={`badge ${e.Origen === 'MANUAL' ? 'badge-manual' : 'badge-auto'}`}>
                    {e.Origen}
                  </span>
                </td>
                <td className="text-muted monospace" style={{ whiteSpace: 'nowrap' }}>
                  {e.FechaProximoCambio}
                </td>
                <td style={{ maxWidth: 280 }}>
                  {e.MensajeError
                    ? <span style={{ color: '#c0392b', fontSize: '0.8rem' }}>{e.MensajeError}</span>
                    : <span className="text-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
