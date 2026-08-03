export type Empresa = { clave: string; label: string }
export type ArchivoInfo = { mtimeMs: number; size: number }

export type Periodos = {
  empresa: string
  periodos: string[]
  archivo: ArchivoInfo
  descartadas: number
}

export type SucursalFila = {
  codigo: string
  nombre: string
  dias: Record<string, number>
  total: number
}

export type Matriz = {
  empresa: string
  periodo: string
  archivo: ArchivoInfo
  descartadas: number
  dias: string[]
  sucursales: SucursalFila[]
  totalesPorDia: Record<string, number>
  granTotal: number
  resumen: {
    faltantes: number
    sobrantes: number
    neto: number
    diasConDiferencia: number
    diasTotales: number
  }
}

export type LineaAsiento = {
  cuentaCodigo: string
  cuentaNombre: string
  debe: number
  haber: number
  saldo: number
  esDiferenciaCaja: boolean
}

export type Asiento = {
  empresa: string
  fechaISO: string
  sucursal: string
  lineas: LineaAsiento[]
  totales: { debe: number; haber: number }
  cuadra: boolean
}

/** Error con el mensaje que el backend ya redacto para el usuario. */
export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    // El backend manda { message, code } tanto en 400 como en 503. Si por algo
    // no viniera JSON, no tapamos el problema con un mensaje generico mudo.
    let message = `Error ${res.status}`
    let code: string | undefined
    try {
      const j = await res.json()
      if (j?.message) message = j.message
      code = j?.code
    } catch { /* respuesta sin JSON: queda el mensaje con el status */ }
    throw new ApiError(res.status, message, code)
  }
  return res.json() as Promise<T>
}

export const getEmpresas = () => get<{ empresas: Empresa[] }>('/api/empresas')
export const getPeriodos = (empresa: string) =>
  get<Periodos>(`/api/periodos?empresa=${encodeURIComponent(empresa)}`)
export const getMatriz = (empresa: string, periodo: string) =>
  get<Matriz>(`/api/matriz?empresa=${encodeURIComponent(empresa)}&periodo=${encodeURIComponent(periodo)}`)
export const getAsiento = (empresa: string, fecha: string, sucursal: string) =>
  get<Asiento>(`/api/asiento?empresa=${encodeURIComponent(empresa)}&fecha=${encodeURIComponent(fecha)}&sucursal=${encodeURIComponent(sucursal)}`)
