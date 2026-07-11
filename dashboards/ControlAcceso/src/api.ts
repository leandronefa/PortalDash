import type { Sesion } from './types'

const KEY = 'ctrlacceso.sesion'

export function getSesion(): Sesion | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as Sesion : null
  } catch { return null }
}

export function setSesion(s: Sesion | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s))
  else localStorage.removeItem(KEY)
}

export class ApiError extends Error {
  status: number
  avisos?: string[]
  constructor(status: number, message: string, avisos?: string[]) {
    super(message)
    this.status = status
    this.avisos = avisos
  }
}

let onUnauthorized: (() => void) | null = null
export function setOnUnauthorized(fn: () => void) { onUnauthorized = fn }

export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const ses = getSesion()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  }
  if (ses) headers['Authorization'] = `Bearer ${ses.token}`
  const res = await fetch(url, { ...options, headers })
  let body: any = null
  try { body = await res.json() } catch { /* respuesta sin json */ }
  if (res.status === 401 && !url.endsWith('/login')) {
    setSesion(null)
    onUnauthorized?.()
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.error || `Error ${res.status}`, body?.avisos)
  }
  return body as T
}
