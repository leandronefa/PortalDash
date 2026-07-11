import { createContext, useCallback, useContext, useState, ReactNode } from 'react'

// ── Toasts ──────────────────────────────────────────────────────────────────
type ToastKind = 'success' | 'error' | 'warn'
interface Toast { id: number; kind: ToastKind; msg: string }

const ToastCtx = createContext<(kind: ToastKind, msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: ToastKind, msg: string) => {
    const id = nextId++
    setToasts(t => [...t, { id, kind, msg }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

// ── Modal ───────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer }: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// ── Formato ─────────────────────────────────────────────────────────────────
export function fmtFecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtHace(iso: string | null): string {
  if (!iso) return ''
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}
