# CONTEXT.md — comisiones-app

## Propósito
Visualización de asignaciones sucursal-usuario mediante un **grafo interactivo** (force-directed, hierarchical, radial). Permite auditar qué usuarios están asignados a qué sucursales y navegar la jerarquía.

## Stack
- **Frontend**: React 19 + Vite 6.2 + TypeScript + D3
- **Backend**: Express + TypeScript (`server/index.ts`)
- **Puerto**: 3001
- **Servicio Windows**: `dashcomisiones.exe`

## Base de datos
- **Servidor**: `10.0.0.115`
- **Base**: `TABLEROS`
- **Tabla principal**: `EncargadosSucursal`
- **Credenciales**: en `.env` (no commitear)

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/data` | Datos de EncargadosSucursal |
| GET | `/api/layout` | Layout persistido del usuario |
| POST | `/api/layout` | Guardar estado del layout |

## Build
```powershell
npm run build        # genera dist/
```
El servidor sirve `dist/` como estáticos y expone `/api/*`.

## Archivos clave
- `server/index.ts` — servidor Express
- `src/` — frontend React
- `layout-state.json` — persistencia local del estado del grafo
- `.env` — cadena de conexión SQL

## Gotchas
- `layout-state.json` se modifica en runtime; está en `.gitignore`.
- El backend está en TypeScript: cambios en `server/` requieren recompilar o usar `ts-node`.
