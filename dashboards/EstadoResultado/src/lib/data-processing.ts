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
