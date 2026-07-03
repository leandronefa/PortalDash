export interface SAPRecord {
  cuenta: string
  descripcion: string
  sucursal: string
  valor: number // SAP sign: ingresos = negativo (crédito), gastos = positivo (débito)
  periodo?: string | null
}

export interface PLRow {
  cuenta: string
  descripcion: string
  sapTotal: number
  displayTotal: number  // ingresos: negado → positivo; gastos: tal cual
  bySucursal: Record<string, number>  // sucursal → SAP valor
}

export interface PLGroup {
  label: string
  rows: PLRow[]
  subtotal: number
}

export interface PLStatement {
  ingresos: PLGroup
  gastosOperativos: PLGroup      // 4.2.002
  serviciosCentrales: PLGroup    // 4.2.002.02 + 4.2.002.03
  resultadosFinancieros: PLGroup // 4.2.004
  totalIngresos: number
  totalGastos: number
  resultado: number
  sucursales: string[]
}

export interface BranchSummary {
  sucursal: string
  ventasNetas: number
  totalGastos: number
  resultado: number
}

function getGroupKey(cuenta: string): 'ingreso' | 'gastosOp' | 'servicios' | 'finaniero' {
  if (cuenta.startsWith('4.1')) return 'ingreso'
  if (cuenta.startsWith('4.2.004')) return 'finaniero'
  // 4.2.002.02 y 4.2.002.03 → servicios centrales
  const parts = cuenta.split('.')
  if (parts[2] === '002' && (parts[3] === '02' || parts[3] === '03')) return 'servicios'
  return 'gastosOp'
}

export function buildPLStatement(records: SAPRecord[]): PLStatement {
  const grouped = new Map<string, PLRow>()

  for (const r of records) {
    let row = grouped.get(r.cuenta)
    if (!row) {
      row = { cuenta: r.cuenta, descripcion: r.descripcion, sapTotal: 0, displayTotal: 0, bySucursal: {} }
      grouped.set(r.cuenta, row)
    }
    row.sapTotal += r.valor
    if (r.sucursal) {
      row.bySucursal[r.sucursal] = (row.bySucursal[r.sucursal] ?? 0) + r.valor
    }
  }

  for (const row of grouped.values()) {
    // Ingresos: SAP negativo → negar para mostrar positivo
    row.displayTotal = row.cuenta.startsWith('4.1') ? -row.sapTotal : row.sapTotal
  }

  const allRows = Array.from(grouped.values()).sort((a, b) => a.cuenta.localeCompare(b.cuenta))

  const ingresosRows = allRows.filter(r => getGroupKey(r.cuenta) === 'ingreso')
  const gastosOpRows = allRows.filter(r => getGroupKey(r.cuenta) === 'gastosOp')
  const serviciosRows = allRows.filter(r => getGroupKey(r.cuenta) === 'servicios')
  const financieroRows = allRows.filter(r => getGroupKey(r.cuenta) === 'finaniero')

  const sum = (rows: PLRow[]) => rows.reduce((acc, r) => acc + r.displayTotal, 0)

  const totalIngresos = sum(ingresosRows)
  const totalGastosOp = sum(gastosOpRows)
  const totalServicios = sum(serviciosRows)
  const totalFinanciero = sum(financieroRows)
  const totalGastos = totalGastosOp + totalServicios + totalFinanciero

  const sucursales = [...new Set(records.map(r => r.sucursal).filter(Boolean))].sort()

  return {
    ingresos: { label: 'Ingresos', rows: ingresosRows, subtotal: totalIngresos },
    gastosOperativos: { label: 'Gastos Operativos', rows: gastosOpRows, subtotal: totalGastosOp },
    serviciosCentrales: { label: 'Servicios Centrales', rows: serviciosRows, subtotal: totalServicios },
    resultadosFinancieros: { label: 'Resultados Financieros', rows: financieroRows, subtotal: totalFinanciero },
    totalIngresos,
    totalGastos,
    resultado: totalIngresos - totalGastos,
    sucursales
  }
}

export function buildBranchSummary(records: SAPRecord[]): BranchSummary[] {
  const byBranch = new Map<string, { sapIngresos: number; sapGastos: number }>()

  for (const r of records) {
    const suc = r.sucursal || '(Sin sucursal)'
    let b = byBranch.get(suc)
    if (!b) { b = { sapIngresos: 0, sapGastos: 0 }; byBranch.set(suc, b) }
    if (r.cuenta.startsWith('4.1')) {
      b.sapIngresos += r.valor
    } else {
      b.sapGastos += r.valor
    }
  }

  return Array.from(byBranch.entries())
    .map(([sucursal, b]) => ({
      sucursal,
      ventasNetas: -b.sapIngresos,
      totalGastos: b.sapGastos,
      resultado: -b.sapIngresos - b.sapGastos
    }))
    .sort((a, b) => b.ventasNetas - a.ventasNetas)
}

export function buildBranchPL(records: SAPRecord[], sucursal: string): PLStatement {
  return buildPLStatement(records.filter(r => r.sucursal === sucursal))
}

// ─── Matriz P&L por sucursal (vista Resumen) ────────────────────────────────
// Líneas estilo Excel contable: Ventas / Costo / Margen / G.Directos / Contribución / G.Indirectos / Utilidad
// Criterio: los gastos de sucursales SIN ventas (centros de costo), los gastos sin sucursal
// y las cuentas de servicios centrales (4.2.002.02/03) + resultados financieros (4.2.004)
// forman un pool de "gastos indirectos" que se prorratea por participación en ventas.
export interface MatrixColumn {
  sucursal: string
  ventas: number
  costo: number
  margen: number
  directos: number
  contribucion: number
  indirectos: number
  utilidad: number
}

export interface MatrixPL {
  columnas: MatrixColumn[]
  totales: {
    ventas: number; costo: number; margen: number
    directos: number; indirectos: number; totalGastos: number
    contribucion: number; utilidad: number
  }
}

export function buildMatrixPL(records: SAPRecord[]): MatrixPL {
  type Acc = { ventas: number; costo: number; directos: number; otros: number }
  const by = new Map<string, Acc>()

  for (const r of records) {
    const suc = r.sucursal || '(sin)'
    let b = by.get(suc)
    if (!b) { b = { ventas: 0, costo: 0, directos: 0, otros: 0 }; by.set(suc, b) }
    const v = r.cuenta.startsWith('4.1') ? -r.valor : r.valor
    if (r.cuenta.startsWith('4.1')) b.ventas += v
    else if (r.cuenta.startsWith('4.2.001')) b.costo += v
    else if (r.cuenta.startsWith('4.2.002.01')) b.directos += v
    else b.otros += v // servicios centrales + resultados financieros
  }

  let pool = 0
  const selling: { sucursal: string; ventas: number; costo: number; directos: number }[] = []

  for (const [suc, b] of by) {
    if (b.ventas !== 0 && suc !== '(sin)') {
      selling.push({ sucursal: suc, ventas: b.ventas, costo: b.costo, directos: b.directos })
      pool += b.otros
    } else {
      // centro de costo (sin ventas) o registros sin sucursal → todo al pool de indirectos
      pool += b.costo + b.directos + b.otros - b.ventas
    }
  }

  const totalVentas = selling.reduce((a, s) => a + s.ventas, 0)

  const columnas: MatrixColumn[] = selling
    .sort((a, b) => a.sucursal.localeCompare(b.sucursal))
    .map(s => {
      const margen = s.ventas - s.costo
      const contribucion = margen - s.directos
      const indirectos = totalVentas !== 0 ? pool * (s.ventas / totalVentas) : 0
      return {
        sucursal: s.sucursal,
        ventas: s.ventas,
        costo: s.costo,
        margen,
        directos: s.directos,
        contribucion,
        indirectos,
        utilidad: contribucion - indirectos
      }
    })

  const sumCol = (k: keyof MatrixColumn) => columnas.reduce((a, c) => a + (c[k] as number), 0)
  const totales = {
    ventas: sumCol('ventas'),
    costo: sumCol('costo'),
    margen: sumCol('margen'),
    directos: sumCol('directos'),
    indirectos: pool,
    totalGastos: sumCol('directos') + pool,
    contribucion: sumCol('contribucion'),
    utilidad: sumCol('contribucion') - pool
  }

  return { columnas, totales }
}

export function topExpenses(pl: PLStatement, n = 15): { descripcion: string; valor: number }[] {
  const all = [
    ...pl.gastosOperativos.rows,
    ...pl.serviciosCentrales.rows,
    ...pl.resultadosFinancieros.rows
  ]
    .filter(r => r.displayTotal > 0)
    .map(r => ({ descripcion: r.descripcion, valor: r.displayTotal }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, n)
  return all
}
