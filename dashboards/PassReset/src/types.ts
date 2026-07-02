export type Estado = 'VENCIDA' | 'PROXIMA' | 'OK' | 'PROGRAMADA';

export interface Usuario {
  Id: number;
  Servidor: string;
  UsuarioWindows: string;
  CorreoDestino: string;
  MaxDias: number;
  UltimoCambio: string | null;
  Activo: boolean;
  FechaCreacion: string;
  DiasTranscurridos: number | null;
  DiasRestantes: number | null;
  FechaProximoCambio: string | null;
  ResetDesde: string | null;
  Estado: Estado;
}

export interface Resumen {
  Total: number;
  Vencidas: number;
  Proximas: number;
  Ok: number;
}

export interface LogEntry {
  Id: number;
  IdUsuario: number;
  Servidor: string;
  FechaHora: string;
  UsuarioWindows: string;
  PasswordGenerada: string;
  CorreoDestino: string;
  Resultado: 'OK' | 'OK_MAIL_ERROR' | 'ERROR';
  MensajeError: string | null;
  FechaProximoCambio: string;
  Origen: 'AUTO' | 'MANUAL';
}
