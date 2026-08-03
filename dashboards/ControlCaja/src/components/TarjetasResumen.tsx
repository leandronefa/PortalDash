import { Card, CardContent } from '@/src/components/ui/card'
import { formatoImporte } from '@/src/lib/formato'
import type { Matriz } from '@/src/lib/api'

/**
 * Faltantes y sobrantes van SEPARADOS a proposito: un neto cercano a cero puede
 * esconder un faltante grande compensado por un sobrante grande, que es justo el
 * caso que hay que poder ver.
 */
export function TarjetasResumen({ resumen }: { resumen: Matriz['resumen'] }) {
  const items = [
    { rotulo: 'Faltantes', valor: formatoImporte(resumen.faltantes), color: 'var(--falt-2)' },
    { rotulo: 'Sobrantes', valor: formatoImporte(Math.abs(resumen.sobrantes)), color: 'var(--sobr-2)' },
    { rotulo: 'Neto', valor: formatoImporte(resumen.neto), color: undefined },
    {
      rotulo: 'Días con diferencia',
      valor: `${resumen.diasConDiferencia} de ${resumen.diasTotales}`,
      color: undefined
    }
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {items.map(i => (
        <Card key={i.rotulo}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {i.color && <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: i.color }} aria-hidden />}
              {i.rotulo}
            </div>
            <div className="text-xl font-semibold tabular-nums mt-1">{i.valor}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
