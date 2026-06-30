# Comisiones INDO — Contexto del Proyecto

## Descripción general
Aplicación web interna para calcular y liquidar comisiones del personal de sucursales INDO (créditos): cajeros, operadores, encargados y supervisores, tanto para sucursales **Retail** (id < 100) como **Millón** (id ≥ 100, originación de créditos). Carga ventas/objetivos desde BeClever, aplica reglas de escalones por categoría de sucursal, y persiste cada ejecución del cálculo como historial.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js v24, ES Modules |
| Backend | Express 4 + `mssql` (`server/index.js`) |
| Frontend | Vite 6 SPA vanilla JS (sin framework), router simple en `src/app.js` |
| Puerto | **3005** (servicio Windows `dashcomisionesindo.exe`) |
| Auth | JWT (`jsonwebtoken`), middleware en todas las rutas excepto `/api/auth` |
| Dev | `npm run dev` (server + client en paralelo), `npm run server` (solo backend, `--watch`), `npm run client` (solo Vite) |

### Variables de entorno (`.env`)
```
DB_SERVER=10.0.0.115
DB_NAME=db_Cegid
DB_USER=...
DB_PASSWORD=...
DB_PORT=1433
JWT_SECRET=...
PORT=3005
```

---

## Bases de datos

| Pool | Config | Base | Uso |
|---|---|---|---|
| `getPool()` | `server/config/db.js` | `db_Cegid` (10.0.0.115) | Tablas propias `tbl_CoVenAppINDO_*` (montos, ranking, objetivos, resultados, historial) |
| `getPoolBC()` | `server/config/dbBeClever.js` | `BeClever` (mismo server) | SPs: `sp_ReporteVentasCobrosObjetivos`, `sp_ReporteOriginacionesCreditos`, `METRIX.dbo.OBJETIVOS_MILLON` |

SQL Server 2012 — sin `DATEFROMPARTS`; construir fechas con `CAST(CAST(@yr AS VARCHAR(4))+'-'+RIGHT('0'+CAST(@mo AS VARCHAR(2)),2)+'-01' AS DATE)`.

### Tablas principales (prefijo `dbo.tbl_CoVenAppINDO_`)

| Tabla | Descripción |
|---|---|
| `Sucursales` | id, nombre, supervisor, provincia, `con_efectivo` (incluye Retail y Millón, id<300) |
| `Montos` | Montos por sección (`OPER_CON_EFECT`, `OPER_SIN_EFECT`, `ENCARGADO`, `ENC_MILLON`) / escalón / `categoria_suc` (A/B/C) |
| `MontosVendedor`, `MontosSupervisor`, `MontosPrestamos`, `MontosCajero` | Montos por rol, ya diferenciados por categoría donde aplica |
| `RankingMultiplicador` | Multiplicador por categoría: A=1.30, B=1.15, C=1.00 |
| `Ranking` | Categoría asignada por sucursal y período |
| `ObjConsumo`, `ObjEfectivo` | Objetivos por sucursal/período (incluye sucursales Millón) |
| `CalculoHistorial` | JSON completo de cada ejecución del motor (`POST /calculo/ejecutar`) — única fuente que leen las páginas de resultado |
| `Supervisores`, `SupervisorSucursales` | ABM de supervisores + asignación N:M de sucursales |
| `ResultadoCajeros` | Resultado persistido de Cajeros (tabla separada, no va en `CalculoHistorial`) |

---

## ⚠️ Regla de oro del motor: el multiplicador de categoría NO se aplica dos veces

`RankingMultiplicador` (A=1.30, B=1.15, C=1.00) tiene **un solo punto de aplicación** en todo el sistema, y depende de cómo está armada la tabla de montos:

- **ABM de Montos** (`server/routes/montos.js`, página `visor-montos.js`): al editar el valor de categoría **C**, el cascade calcula y graba B/A como `round(C × mult / 1000) × 1000` (ver `PUT /api/montos/vendedor-pivot/:escalon` y `PUT /api/montos/:tipo/:id`). Es decir: **el multiplicador ya queda aplicado y guardado en la fila de cada categoría.**
- Por lo tanto, en el motor de cálculo (`calcEngine.js`), cuando una función busca la fila por la **categoría real** de la sucursal (`categoria_suc === cat`, con fallback a `'C'`), **no debe multiplicar el resultado por `mult` de nuevo** — ya está incluido.
- La única excepción es `calcularOperadores()` (Operadores Retail), que busca **siempre** `categoria_suc === 'C'` y aplica `mult` explícitamente — ahí sí corresponde, porque deliberadamente ignora las filas A/B y reconstruye el monto desde la base. **Esto es inconsistente** con el resto del motor (hay filas A/B reales cargadas en `OPER_CON_EFECT`/`OPER_SIN_EFECT` que el código no usa) — pendiente de revisión, ver sección Pendientes.

| Función | Busca fila por | ¿Multiplica por `mult`? |
|---|---|---|
| `calcularEncargados` (Retail) | categoría real | No (fix 2026-06-30) |
| `calcularEncargadosMillon` | categoría real | No (implementado 2026-06-30) |
| `calcularSupervisores` (`por_sucursal`) | categoría real | No (fix 2026-06-30) |
| `calcularSupervisores` (`por_plaza`) | mejor categoría asignada | No (usa `factor_plaza` propio, sin relación con `mult`) |
| `calcularOperadores` (Retail) | siempre `'C'` | **Sí** — único caso correcto hoy; pendiente de unificar criterio |
| `calcularOperadoresMillon` | categoría real (`MontosPrestamos`) | No |
| `calcularCajeros` | categoría real (`MontosCajero`) | No (cajeros nunca llevan multiplicador) |

---

## Motor de cálculo (`server/services/calcEngine.js`)

Funciones puras — reciben `ctx` con datos ya cargados (sin acceso a DB):

| Función | Granularidad | Resumen |
|---|---|---|
| `calcularTotal(ctx)` | Por sucursal (Retail + Millón) | Escalones, semáforo, ratios de consumo y efectivo — **base para todo lo demás** |
| `calcularCajeros(ctx, sucResultados)` | Por cajero | `vta_vta_tot >= obj_particip_pct` (sin tolerancia) |
| `calcularOperadores(ctx, sucResultados)` | Por operador (Retail) | Indicadores G/O/R; G es puerta de O y R |
| `calcularOperadoresMillon(ctx)` | Por operador (Millón) | Solo efectivo; objetivo individual = objetivo sucursal / n operadores activos |
| `calcularEncargados(ctx, sucResultados)` | Por sucursal Retail (id<100) | Escalón consumo + participación (G) — **componentes independientes** |
| `calcularEncargadosMillon(ctx, sucResultados)` | Por sucursal Millón (id≥100) | Solo escalón efectivo — **sin** participación |
| `calcularSupervisores(ctx, sucResultados)` | Por supervisor | Suma por sucursales asignadas + bono por plaza (mejor categoría entre sus sucursales) |

**Escalones**: umbrales E1=100%, E2=110%, E3=110%×1.15=126.5%; tolerancia: shortfall < 4% del umbral cuenta como alcanzado (`getEscalon()`).

---

## Endpoints (`server/routes/`)

| Router | Prefijo | Contenido |
|---|---|---|
| `auth.js` | `/api/auth` | `POST /login` — JWT contra `TBL_USUARIOS_APPS` (sin middleware) |
| `calculo.js` | `/api/calculo` | `POST /ejecutar` (corre todo el motor y guarda `CalculoHistorial`), `GET /ultimo`, `GET /historial`, `POST/GET /cajeros`, `GET /encargados`, `GET /encargados-millon`, `GET /supervisores` |
| `montos.js` | `/api/montos` | ABM con cascade de categorías (ver regla de oro arriba) |
| `supervisores.js` | `/api/supervisores` | CRUD de supervisores + asignación de sucursales |
| `sucursales.js`, `ranking.js`, `objetivos.js` | `/api/*` | ABM de datos maestros |
| `operadores.js`, `millon.js`, `datos.js` | `/api/*` | Datos auxiliares (jornadas, sucursales Millón, cache de originaciones) |

`GET /calculo/encargados`, `/encargados-millon` y `/supervisores` leen del **último `CalculoHistorial` guardado** — no recalculan al vuelo. Si se agrega un campo nuevo al resultado de `/ejecutar`, hay que re-ejecutar el cálculo completo desde el Dashboard para que el historial lo tenga.

---

## Páginas (`src/pages/`) y sidebar

| Sección sidebar | Ruta | Estado |
|---|---|---|
| Principal | `dashboard` | KPIs + botón "Ejecutar cálculo completo" |
| DATOS | `visor-sucursales`, `millon`, `visor-montos`, `visor-ranking`, `visor-objetivos`, `visor-ventas`, `supervisores` (ABM) | Datos maestros — **blindado, no tocar** |
| Cálculos | `cajeros`, `operadores-retail`, `operadores-millon` | Resultado de cálculo individual — **blindado, no tocar** |
| Cálculos | `encargados`, `encargados-millon` | Resultado por sucursal, sin nombres de personas — 2026-06-30 |
| Cálculos | `resultado-supervisores` | Resultado por supervisor, fila expandible con detalle por sucursal — 2026-06-30 |

El ABM de Supervisores (`pages/supervisores.js`) vive en "DATOS" (se movió desde "Cálculos" sin tocar su lógica); la página de resultado (`resultado-supervisores.js`) es la que reemplaza ese rol en "Cálculos".

---

## Build / deploy

```powershell
npm run build              # genera dist/ — el server SIEMPRE sirve dist/, nunca src/ directo
Restart-Service dashcomisionesindo.exe
```

- Cambios en `src/` (frontend) requieren `npm run build` **antes** de reiniciar el servicio, o la página sigue mostrando la versión vieja.
- Cambios en `server/` (backend) **no** requieren build, solo reiniciar el servicio.

---

## Gotchas

- **`localhost:3005` no llega al dashboard** en este servidor (10.0.0.118): un conector ODBC de Qlik (proceso `dotnet`, gateway) escucha en `127.0.0.1:3005` y tiene prioridad sobre el bind `0.0.0.0:3005` de Node. Para probar la API desde el propio servidor, usar `10.0.0.118:3005`, no `localhost`.
- El JWT se firma con `JWT_SECRET` del `.env` — para pruebas manuales de API se puede generar un token propio con `jsonwebtoken` sin pasar por `/login`.
- Cualquier dashboard nuevo, atención a no colisionar `PORT` con el `.env` — el servicio Windows lo pisa.

---

## Pendientes

- **Operadores Retail** (`calcularOperadores`): revisar con el mismo criterio de no-doble-multiplicación — hoy ignora las filas reales A/B cargadas en `OPER_CON_EFECT`/`OPER_SIN_EFECT` y reconstruye desde `'C'` × `mult`. Decisión explícita del usuario: dejarlo para otra sesión.
- **Encargados INDO** (sucursales con efectivo): aclarado por el usuario que para estas solo cuenta EFECTIVO — sin resolver si va dentro de Encargados Retail o es una sección aparte.
