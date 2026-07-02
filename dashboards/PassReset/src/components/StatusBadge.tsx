import type { Estado } from '../types'

interface Props {
  estado: Estado
}

const LABEL: Record<Estado, string> = {
  VENCIDA:    'Vencida',
  PROXIMA:    'Próxima',
  OK:         'Vigente',
  PROGRAMADA: 'Programada',
}

const CLASS: Record<Estado, string> = {
  VENCIDA:    'badge badge-vencida',
  PROXIMA:    'badge badge-proxima',
  OK:         'badge badge-ok',
  PROGRAMADA: 'badge badge-programada',
}

export default function StatusBadge({ estado }: Props) {
  return <span className={CLASS[estado]}>{LABEL[estado]}</span>
}
