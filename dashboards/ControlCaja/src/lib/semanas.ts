/**
 * Particion de los dias del mes en bloques de 7 para la vista semanal, por
 * POSICION en el array, nunca por aritmetica de fechas: `matriz.dias` trae
 * solo los dias con actividad real en toda la empresa, asi que puede faltar
 * un dia (domingo, feriado) sin que eso sea un hueco a rellenar. Alinear por
 * dia-de-semana de calendario no tiene sentido cuando el propio dato no
 * garantiza continuidad.
 */

/** Cantidad de bloques de 7. Nunca 0 (evita dividir por cero en la UI). */
export function totalSemanas(dias: string[]): number {
  return Math.max(1, Math.ceil(dias.length / 7))
}

/** El bloque en el indice dado (el ultimo puede tener menos de 7 dias). */
export function diasDeLaSemana(dias: string[], indice: number): string[] {
  const inicio = indice * 7
  return dias.slice(inicio, inicio + 7)
}

/** Indice del ultimo bloque: la semana mas reciente, el default razonable. */
export function ultimaSemana(dias: string[]): number {
  return totalSemanas(dias) - 1
}
