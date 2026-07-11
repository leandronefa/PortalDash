export type Rol = 'PORTERO' | 'ADMIN'

export interface Sesion {
  token: string
  usuario: string
  nombre: string
  rol: Rol
}

export interface Vehiculo {
  Id: number
  Patente: string
  Tipo: 'TRACTOR' | 'SEMI'
  Descripcion: string | null
  Activo: boolean
}

export interface Conductor {
  Id: number
  Nombre: string
  Documento: string | null
  Activo: boolean
}

export interface Usuario {
  Id: number
  Usuario: string
  Nombre: string
  Rol: Rol
  Activo: boolean
  CreadoEn: string
}

export interface Movimiento {
  Id: number
  FechaHora: string
  Tipo: 'INGRESO' | 'EGRESO'
  EsPropio: boolean
  PatTractor: string | null
  PatSemi: string | null
  Conductor: string | null
  Kilometraje: number | null
  DestinoOrigen: string | null
  NroViaje: string | null
  NroRemito: string | null
  Patente: string | null
  TipoVehiculo: string | null
  ConductorNom: string | null
  Observaciones: string | null
  UsuarioCarga: string
  Anulado: boolean
  AnuladoPor: string | null
}

export interface EstadoVehiculo {
  Id: number
  Patente: string
  Tipo: 'TRACTOR' | 'SEMI'
  Descripcion: string | null
  UltimoMov: 'INGRESO' | 'EGRESO' | null
  FechaHora: string | null
  Kilometraje: number | null
  Conductor: string | null
  DestinoOrigen: string | null
}

export interface NoPropioDentro {
  Patente: string
  FechaHora: string
  TipoVehiculo: string | null
  ConductorNom: string | null
  Observaciones: string | null
}

export interface Estado {
  propios: EstadoVehiculo[]
  noPropiosDentro: NoPropioDentro[]
}

export interface Kpis {
  resumen: {
    TractoresDentro: number
    TractoresFuera: number
    SemisDentro: number
    SemisFuera: number
    NoPropiosDentro: number
    MovHoy: number
    IngresosHoy: number
    EgresosHoy: number
  }
  porDia: { Dia: string; Ingresos: number; Egresos: number }[]
  topConductores: { Nombre: string; Movimientos: number }[]
  permanenciaNoPropios: { PromMinutos: number | null; Visitas: number }
  kmTractores: { Patente: string; KmRecorridos: number; Movimientos: number }[]
  rango: { desde: string; hasta: string }
}
