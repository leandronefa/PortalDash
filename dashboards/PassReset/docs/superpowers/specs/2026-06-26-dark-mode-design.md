# Dark Mode — PassReset Dashboard

**Fecha:** 2026-06-26
**Scope:** `C:\apps\dashboards\PassReset\`

## Objetivo

Agregar un toggle manual de dark/light mode que persista la elección del usuario en `localStorage`.

## Enfoque

CSS variables + atributo `data-theme` en `<html>`. Sin librerías adicionales.

## Variables de color

| Variable | Light | Dark |
|---|---|---|
| `--bg-body` | `#f0f2f5` | `#0f1520` |
| `--bg-card` | `#ffffff` | `#1a2438` |
| `--bg-thead` | `#f8f9fa` | `#151f33` |
| `--bg-row-hover` | `#f8f9ff` | `#1e2d45` |
| `--bg-input` | `#ffffff` | `#1a2438` |
| `--bg-modal-footer` | `#f8f9fa` | `#151f33` |
| `--text-primary` | `#222222` | `#e8edf5` |
| `--text-secondary` | `#555555` | `#a0b0cc` |
| `--text-muted` | `#888888` | `#7a8fa8` |
| `--text-label` | `#444444` | `#b8c8e0` |
| `--border` | `#dee2e6` | `#2a3a55` |
| `--border-light` | `#f0f0f0` | `#1e2d45` |
| `--border-input` | `#cccccc` | `#3a4f70` |
| `--border-focus` | `#1e2d4f` | `#4a6fa5` |
| `--btn-outline-bg` | `#ffffff` | `#1a2438` |
| `--btn-outline-hover` | `#f0f4ff` | `#243354` |

Sin cambios: header (`#1e2d4f`), badges de estado (rojo/verde/amarillo), toasts.

## Archivos

| Archivo | Cambio |
|---|---|
| `src/styles.css` | Agregar `:root {}` y `[data-theme="dark"] {}`; reemplazar colores hardcodeados por `var(--...)` |
| `src/hooks/useTheme.ts` | Nuevo hook: lee `localStorage`, expone `{ theme, toggle }`, aplica atributo a `<html>` |
| `src/App.tsx` | Importar hook; agregar botón ☀️/🌙 en header |
| `index.html` | Script inline pre-React para prevenir flash en recarga |

## Hook `useTheme`

```ts
// Lee localStorage al init, default 'light'
// Al toggle: setea localStorage + document.documentElement.setAttribute('data-theme', ...)
// Expone { theme: 'light' | 'dark', toggle: () => void }
```

## Anti-flash (`index.html`)

Script inline antes del bundle que lee `localStorage.getItem('theme')` y aplica el atributo a `<html>` antes de que React pinte el DOM.

## Fuera de scope

- Leer `prefers-color-scheme` del sistema operativo.
- Dark mode en el agente (componente separado).
- Persistencia en base de datos.
