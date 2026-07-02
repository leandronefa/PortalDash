import type { Estado } from '../types'

interface Props {
  diasRestantes: number | null
  maxDias: number
  estado: Estado
}

export default function DiasBar({ diasRestantes, maxDias, estado }: Props) {
  if (diasRestantes === null) {
    return <span className="text-muted">Sin registro</span>
  }

  const pct = Math.min(Math.max((diasRestantes / maxDias) * 100, 0), 100)
  const fillClass = estado === 'OK' ? 'ok' : estado === 'PROXIMA' ? 'proxima' : 'vencida'

  let label: string
  if (diasRestantes < 0) {
    label = `Vencida hace ${Math.abs(diasRestantes)} día(s)`
  } else if (diasRestantes === 0) {
    label = 'Vence hoy'
  } else {
    label = `${diasRestantes} día(s)`
  }

  return (
    <div className="dias-bar-wrap">
      <div className="dias-bar">
        <div
          className={`dias-bar-fill ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="dias-num">{label}</span>
    </div>
  )
}
