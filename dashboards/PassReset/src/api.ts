import type { Usuario, Resumen, LogEntry } from './types';

async function req<T>(url: string): Promise<T> {
  const res  = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  getServidores: () =>
    req<string[]>('/api/servidores'),

  getResumen: (servidor?: string) => {
    const qs = servidor ? `?servidor=${encodeURIComponent(servidor)}` : '';
    return req<Resumen>(`/api/resumen${qs}`);
  },

  getUsuarios: (servidor?: string, todos = false) => {
    const qs = new URLSearchParams();
    if (servidor) qs.set('servidor', servidor);
    if (todos)    qs.set('todos', '1');
    return req<Usuario[]>(`/api/usuarios?${qs}`);
  },

  getLog: (servidor?: string, idUsuario?: number, limite = 200) => {
    const qs = new URLSearchParams({ limite: String(limite) });
    if (servidor)  qs.set('servidor',  servidor);
    if (idUsuario) qs.set('idUsuario', String(idUsuario));
    return req<LogEntry[]>(`/api/log?${qs}`);
  },

  updateCorreo: async (id: number, correo: string): Promise<void> => {
    const res  = await fetch(`/api/usuarios/${id}/correo`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ correo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  }
};
