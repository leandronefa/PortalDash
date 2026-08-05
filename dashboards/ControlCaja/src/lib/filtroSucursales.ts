import type { SucursalFila } from '@/src/lib/api'

/**
 * Filtra por texto (codigo o nombre, sin distinguir mayusculas) y por el set
 * de codigos ocultados desde la lista de checkboxes. Los dos filtros se
 * combinan con AND: una sucursal oculta no aparece aunque el texto matchee.
 */
export function filtrarSucursales(
  sucursales: SucursalFila[],
  filtroTexto: string,
  ocultas: ReadonlySet<string>
): SucursalFila[] {
  const q = filtroTexto.trim().toLowerCase()
  return sucursales.filter(s => {
    if (ocultas.has(s.codigo)) return false
    if (!q) return true
    return s.codigo.toLowerCase().includes(q) || s.nombre.toLowerCase().includes(q)
  })
}

/**
 * Recalcula el total por dia y el gran total SOLO sobre las filas y los dias
 * dados. El pie de la matriz tiene que reflejar lo que esta filtrado (por
 * sucursal Y por ventana de dias, p.ej. una semana), no el mes completo:
 * mostrar el total sin filtrar seria mentir sobre lo que se ve. Mismo
 * criterio que el backend: un dia sin ninguna celda entre las filas dadas no
 * entra en totalesPorDia (ausencia de dato, no un cero).
 *
 * granTotal se deriva de totalesPorDia (no de `fila.total`, que es el total
 * del MES ENTERO calculado por el backend): si `dias` es una ventana mas
 * chica que el mes completo, sumar `fila.total` incluiria dias que no estan
 * en la ventana visible.
 */
export function totalesDeFilas(filas: SucursalFila[], dias: string[]) {
  const totalesPorDia: Record<string, number> = {}
  for (const dia of dias) {
    let suma = 0
    let tieneAlguna = false
    for (const f of filas) {
      const v = f.dias[dia]
      if (v == null) continue
      suma += v
      tieneAlguna = true
    }
    if (tieneAlguna) totalesPorDia[dia] = suma
  }
  const granTotal = Object.values(totalesPorDia).reduce((acc, v) => acc + v, 0)
  return { totalesPorDia, granTotal }
}
