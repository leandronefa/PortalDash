import type React from 'react'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const fmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatoImporte = (n: number) => fmt.format(n)

/** Para las celdas de la matriz, donde no entra un importe completo. */
export function formatoImporteCorto(n: number): string {
  const abs = Math.abs(n)
  const signo = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${signo}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${signo}${Math.round(abs / 1_000)}k`
  // Una diferencia de centavos existe (el umbral de cero es medio centavo), y
  // redondeada daria "0": una celda pintada que dice cero se lee como un bug.
  if (abs < 1) return `${signo}<1`
  return `${signo}${Math.round(abs)}`
}

/** 'YYYY-MM' -> 'julio 2026'. Sin Date: el string ya trae todo. */
export function formatoMes(periodo: string): string {
  const [anio, mes] = periodo.split('-')
  return `${MESES[Number(mes) - 1] ?? mes} ${anio}`
}

/** 'YYYY-MM-DD' -> '3 de julio de 2026'. Sin Date, por lo mismo. */
export function formatoFechaLarga(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split('-')
  return `${Number(dia)} de ${MESES[Number(mes) - 1] ?? mes} de ${anio}`
}

/**
 * Frescura del archivo. Aca SI se usa Date: mtimeMs es un instante real
 * (epoch), no una fecha de negocio parseada de un string, asi que no hay riesgo
 * de corrimiento por zona horaria.
 */
export function formatoFrescura(mtimeMs: number): string {
  return new Date(mtimeMs).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

export type Escala = { p50: number; p90: number }

/**
 * Escala de intensidad por percentiles del mes en curso, no por umbrales
 * fijos en pesos: las diferencias reales van de $100 a $3.5M y con cortes
 * fijos casi todas las celdas caerian en el mismo escalon. Los percentiles se
 * calculan sobre el VALOR ABSOLUTO, para que los dos brazos compartan la misma
 * nocion de "grande".
 */
export function calcularEscala(valores: number[]): Escala {
  const abs = valores.map(Math.abs).filter(v => v > 0).sort((a, b) => a - b)
  if (abs.length === 0) return { p50: 0, p90: 0 }
  const at = (p: number) => abs[Math.min(abs.length - 1, Math.floor(abs.length * p))]
  return { p50: at(0.5), p90: at(0.9) }
}

export function nivelDeCelda(valor: number, escala: Escala): 1 | 2 | 3 {
  const abs = Math.abs(valor)
  if (abs >= escala.p90) return 3
  if (abs >= escala.p50) return 2
  return 1
}

/** Estilos inline de la celda, tomados de las variables CSS de index.css. */
export function estiloDeCelda(valor: number, escala: Escala): React.CSSProperties {
  const nivel = nivelDeCelda(valor, escala)
  const brazo = valor > 0 ? 'falt' : 'sobr'
  return {
    backgroundColor: `var(--${brazo}-${nivel})`,
    color: `var(--ink-sobre-${nivel})`
  }
}
