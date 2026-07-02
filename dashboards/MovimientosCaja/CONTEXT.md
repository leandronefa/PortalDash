# CONTEXT.md — MovimientosCaja

## Propósito
Consulta y filtrado de **movimientos de caja** desde la tabla `dbo.CajasMovimientosTipoCartera` (BeClever). Permite filtrar por fecha, sucursal, medio de pago, estado, tipo de cartera, tipo de producto y tipo de movimiento. Muestra débitos, créditos, balance y permite exportar a CSV.

## Stack
- **Frontend**: React 19 + Vite 6.2.3 + TypeScript
- **Backend**: Express (`server.js`) — ESM (`import/export`)
- **Puerto**: 3004
- **Servicio Windows**: instalado (carpeta `daemon/` presente)

## Base de datos
- **Servidor**: `10.0.0.115`
- **Base**: `BeClever`
- **Tabla principal**: `dbo.CajasMovimientosTipoCartera`
- **Credenciales**: en `.env`

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/filtros` | Valores distintos de cada columna para poblar dropdowns |
| GET | `/api/movimientos?...` | Registros con filtros aplicados (máximo 10.000 filas) |

### Parámetros de `/api/movimientos`
| Parámetro | Columna SQL | Tipo |
|-----------|-------------|------|
| `fechaDesde` / `fechaHasta` | `FechaImpacto` | DATE |
| `tipoproducto` | `DesProducto` | multi-valor |
| `sucursal` | `DesSuc` | multi-valor |
| `tipocartera` | `TipoCartera` | multi-valor |
| `mediopago` | `DesMedPag` | multi-valor |
| `estadopago` | `EstadoPago` | multi-valor |
| `estado` | `IdTipEst` | multi-valor |
| `tipomovcaja` | `DesTipMovCaja` | multi-valor |

La respuesta incluye `{ rows, limit: 10000, truncated: bool }`. Si `truncated = true`, hay más filas que el límite.

## Build
```powershell
npm run build        # genera dist/ (frontend)
```
El `server.js` sirve `dist/` como estáticos y expone `/api/*`.

## Archivos clave
- `server.js` — servidor Express (ESM), toda la lógica de API
- `src/` — frontend React + TypeScript
- `.env` — `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=BeClever`, `PORT=3004`
- `.env.example` — template de variables de entorno

## Gotchas
- Módulo ESM: no usar `require()`.
- Los filtros admiten múltiples valores (array en query string). Internamente se construye `IN (...)` con parámetros nombrados.
- Límite hardcoded de 10.000 filas (`LIMIT = 10000` en `server.js`). Si se necesita más, ajustar esa constante.
