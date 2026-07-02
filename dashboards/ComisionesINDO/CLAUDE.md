# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Comandos de desarrollo

```bash
# Desarrollo (frontend + backend en paralelo)
npm run dev

# Solo backend (con hot-reload via --watch)
npm run server

# Solo frontend (Vite dev server)
npm run client

# Build de producción del frontend
npm run build
```

No hay tests automatizados. La verificación es manual contra los datos reales de SQL Server.

---

## Arquitectura general

**Stack**: Node.js v24, ES Modules, Express 4, Vite 6, Vanilla JS SPA, SQL Server 2012.

- **Frontend** (Vite, puerto 5173): SPA sin framework. `src/app.js` es el router: maneja rutas como strings simples (`'cajeros'`, `'visor-montos'`), renderiza la función correspondiente pasando `(container, periodoActual)`.
- **Backend** (Express, puerto 3000): API REST pura. `server/index.js` registra todos los routers bajo `/api/*`.
- **Proxy**: En dev, Vite proxea `/api/*` → `localhost:3000`. En producción el frontend se sirve estático desde el mismo origen.

### Dos bases de datos

| Pool | Archivo | Base | Propósito |
|------|---------|------|-----------|
| `getPool()` | `server/config/db.js` | `db_Cegid` (10.0.0.115) | Tablas propias de la app (montos, ranking, objetivos, resultados) |
| `getPoolBC()` | `server/config/dbBeClever.js` | `BeClever` (mismo server) | SPs de BeClever: ventas, cobranzas, objetivos Millón |

**Importante**: SQL Server 2012 — `DATEFROMPARTS` no está disponible. Para construir fechas usar:
```sql
CAST(CAST(@yr AS VARCHAR(4)) + '-' + RIGHT('0'+CAST(@mo AS VARCHAR(2)),2) + '-01' AS DATE)
```

### Nomenclatura de tablas

- Tablas **propias nuevas** (en `db_Cegid`): prefijo `tbl_CoVenAppINDO_`
- Tablas **existentes** de vendedores (en `db_Cegid`): prefijo `tbl_CoVenApp_`
- Tablas de **BeClever**: `dbo.COMERCIO`, `METRIX.dbo.OBJETIVOS_MILLON`, etc.

---

## Motor de cálculo (`server/services/calcEngine.js`)

Todas las funciones son **puras** — reciben un objeto `ctx` con los datos ya cargados y devuelven arrays de resultados. No acceden a la DB.

```
calcularTotal(ctx)          → resultados por sucursal (ranking, escalones, semáforo)
calcularCajeros(ctx, sucResultados)
calcularOperadores(ctx, sucResultados)
calcularEncargados(ctx, sucResultados)
calcularSupervisores(ctx, sucResultados)
```

El objeto `ctx` se construye en `server/routes/calculo.js` → `cargarContexto()` o en el endpoint específico (ej: POST `/calculo/cajeros` carga solo lo necesario para cajeros).

**Multiplicadores de categoría**: A=1.30, B=1.15, C=1.00. Se aplican a montos de operadores/encargados/supervisores pero **NO a cajeros**.

**Escalones**: 3 = ratio ≥ 1.0 | 2 = ratio ≥ 0.97 | 1 = resto.

---

## Datos desde BeClever

`cargarVentasBC(periodo)` en `server/routes/calculo.js` llama dos SPs en paralelo:
- `dbo.sp_ReporteVentasCobrosObjetivos(@Anio, @Mes)` → ventas/cobranzas por sucursal, filtrado por `Producto = 'CONSUMO'` o `'EFECTIVO'`
- `METRIX.dbo.OBJETIVOS_MILLON WHERE ANIO=@anio AND MES=@mes` → objetivo de participación por sucursal

Los nombres de sucursal del SP se resuelven a IDs numéricos via join con `dbo.COMERCIO`. El campo `vta_vta_tot` (VTA/VTATOT) ya viene en % directo (ej: 51.21). El campo `obj_particip_pct` también viene en % directo desde `OBJETIVOS_MILLON.OBJETIVO_PARTICIPA`.

`cargarReporteBC(periodo)` llama `dbo.sp_ReporteOriginacionesCreditos(@Anio, @Mes)`.

---

## Cajeros — lógica de comisión

```
comisiona = vta_vta_tot >= obj_particip_pct
```
Ambos valores en % directo. Si comisiona: monto full = `montosCajero[categoria]`; monto part-time = redondeo a múltiplos de 1000 del 50%.

Jornada: `GCL_TEMPSPARTIEL = 'X'` → part-time. Puede sobreescribirse manualmente desde el frontend (campo `parcial_override`).

Los resultados se persisten en `tbl_CoVenAppINDO_ResultadoCajeros` (una fila por cajero/período). El GET `/calculo/cajeros?periodo=` lee los resultados guardados.

---

## Frontend — convenciones

**API client** (`src/api/client.js`): `api.get('/ruta')` — el cliente agrega `/api` internamente. Los paths de frontend **no deben incluir** `/api/`.

**Período**: string `'YYYY-MM'`, guardado en `localStorage`. El sidebar tiene un selector que llama `setPeriodo()` en `app.js`, lo que re-renderiza la página activa.

**Formato de números**:
- Display: `toLocaleString('es-AR')` (separador de miles con punto)
- Inputs editables: `type="text" inputmode="numeric"` — usar `parseNum(s)` para parsear (strip de `.` como separador de miles antes de convertir a número)
- Porcentajes ya en %: usar `fmtPctDir(v)` → `v.toFixed(2) + '%'`
- Porcentajes en ratio (0-1): usar `fmtPct(v)` → `(v*100).toFixed(1) + '%'`

**Páginas**: cada página exporta una función `renderXxx(container, periodo)`. El container llega vacío; la función escribe el HTML directamente vía `container.innerHTML`.

**Páginas "visor"** (solo lectura de datos maestros): `visor-montos`, `visor-ranking`, `visor-objetivos`, `visor-ventas`, `visor-sucursales`.

---

## Variables de entorno (`.env`)

```
DB_SERVER=10.0.0.115
DB_NAME=db_Cegid
DB_USER=sa
DB_PASSWORD=MicroS123
DB_PORT=1433
JWT_SECRET=comisiones-indo-secret-2026
PORT=3000
```

---

## Auth

JWT Bearer token. Login contra `dbo.TBL_USUARIOS_APPS` (campos: `descUsuario`, `contraseña`, `nombre`, `apellido`, `idPerfil`, `activo`). El middleware `authMiddleware` se aplica a todos los routers excepto `/api/auth`.
