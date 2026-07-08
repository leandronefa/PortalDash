# CLAUDE.md — MovimientosCaja (Movimientos de Caja INDO)

## Qué es
Dashboard de consulta y filtrado de **movimientos de caja** desde `dbo.CajasMovimientosTipoCartera` (base `BeClever`, servidor SQL `10.0.0.115`). Filtra por fecha, sucursal, medio de pago, estado, tipo de cartera, tipo de producto y tipo de movimiento; muestra débitos, créditos y balance, y exporta a CSV. Detalle de endpoints y parámetros en `CONTEXT.md`.

## Servicio y acceso
- **Servicio de Windows**: `dashmovimientoscaja.exe` (node-windows), **puerto 3004**. Entrada: `server.js`.
- **Acceso de usuarios**: SOLO vía el portal → `http://10.0.0.118/d/7/` (proxy inverso con sesión y permisos). El puerto 3004 directo queda solo para diagnóstico local.

```powershell
Get-Service dashmovimientoscaja.exe
Restart-Service dashmovimientoscaja.exe
Get-Content C:\apps\dashboards\MovimientosCaja\daemon\dashmovimientoscaja.err.log -Tail 30
```

Diagnóstico en primer plano (muestra el error real al instante; Ctrl+C para cortar):
```powershell
cd C:\apps\dashboards\MovimientosCaja; $env:PORT=3004; node server.js
```

## Desarrollo / build
- Stack: React 19 + Vite 6 + TypeScript (frontend) y Express en `server.js` (**ESM**, `"type": "module"`).
- `npm run build` → genera `dist/` (el `server.js` lo sirve como estáticos y expone `/api/*`).
- `npm run dev` → Vite en puerto 3000 (solo frontend). `npm run lint` → `tsc --noEmit`.
- Tras cambiar frontend: `npm run build` y `Restart-Service dashmovimientoscaja.exe`. Tras cambiar `server.js`: solo reiniciar el servicio.

## Estructura
- `server.js` — servidor Express (ESM), toda la lógica de API (`/api/filtros`, `/api/movimientos`).
- `src/` — frontend React + TypeScript.
- `dist/` — build del frontend (generado, servido por Express).
- `daemon/` — servicio node-windows y sus logs.
- `.env` — variables (solo nombres): `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`, `NODE_ENV`. Nunca commitear ni exponer valores. Hay `.env.example` como template.

## Gotchas
- Módulo **ESM**: no usar `require()`.
- El `PORT` del servicio pisa al del `.env`; este dashboard debe quedar en 3004.
- Límite hardcoded de 10.000 filas en `/api/movimientos` (`LIMIT = 10000` en `server.js`); la respuesta trae `truncated: true` si hay más.
- Los filtros son multi-valor (arrays en query string) → internamente `IN (...)` con parámetros nombrados.
- No editar archivos UTF-8 con `Get-Content`/`Set-Content` (corrompe tildes); usar Edit/Write o Node.
- Pedir confirmación antes de borrar/reinstalar el servicio o tocar `.env`.
