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
| Puerto | **3011** desde 08/07/2026 (servicio Windows `dashcomisionesindo.exe`; antes 3005 — Qlik ocupa `127.0.0.1:3005`). Bind `127.0.0.1`; acceso vía portal `/d/8/` |
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
PORT=3011
```
> El `PORT` real lo inyecta el servicio (`server\daemon\dashcomisionesindo.xml`); el default en código también es 3011.

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
| `calcularSupervisores` (`por_sucursal`, solo Retail) | categoría real | No (fix 2026-06-30; sin factor desde 2026-07-14) |
| `calcularSupervisores` (plaza Retail / plaza Millón) | fila `categoria_suc='C'` | No (plus Retail usa `factor_plaza`; plaza Millón sin factor) |
| `calcularOperadores` (Retail) | siempre `'C'` | **Sí** — único caso correcto hoy; pendiente de unificar criterio |
| `calcularOperadoresMillon` | categoría real (`MontosPrestamos`) | No |
| `calcularCajeros` | categoría real (`MontosCajero`) | No (cajeros nunca llevan multiplicador) |

---

## Motor de cálculo (`server/services/calcEngine.js`)

Funciones puras — reciben `ctx` con datos ya cargados (sin acceso a DB):

| Función | Granularidad | Resumen |
|---|---|---|
| `calcularTotal(ctx)` | Por sucursal (Retail + Millón) | Escalones, semáforo, ratios de consumo y efectivo — **base para todo lo demás** |
| `calcularCajeros(ctx, sucResultados)` | Por cajero | `ratio_particip > 0.96` — tolerancia 4% igual que escalones/G-O-R (agregada 2026-07-02) |
| `calcularOperadores(ctx, sucResultados)` | Por operador (Retail) | Indicadores G/O/R; G es puerta de O y R |
| `calcularOperadoresMillon(ctx)` | Por operador (Millón) | Solo efectivo; jornada pondera la división del objetivo (full=1, part=0.5): `obj_individual = obj_sucursal / peso_total` (full-equivalente); part-time compara `venta × 2` contra ese objetivo; part-time cobra 50% del monto (2026-07-06) |
| `calcularEncargados(ctx, sucResultados)` | Por sucursal Retail (id<100) | Escalón consumo + participación (G) — **componentes independientes** |
| `calcularEncargadosMillon(ctx, sucResultados)` | Por sucursal Millón (id≥100) | Solo escalón efectivo — **sin** participación |
| `calcularSupervisores(ctx, sucResultados)` | Por supervisor | Retail: $ por sucursal según pesos+participación (completo/mitad/nada) + plus por plaza con participación en todas (suma pagada × 0.5) · Millón: $23.000 por plaza completa (efectivo) — ver detalle abajo |

**Escalones**: umbrales E1=100%, E2=110%, E3=110%×1.15=126.5%; tolerancia: shortfall < 4% del umbral cuenta como alcanzado (`getEscalon()`).

### Lógica de cálculo — Supervisores (reglas del negocio 2026-07-16, reemplazan a las del 14/07)

El negocio volvió a cambiar el componente consumo el 16/07 (Retail pasa a mirar DOS indicadores). Regla vigente:

- **RETAIL (id < 100), mirando SOLO consumo — dos indicadores por sucursal**:
  - **Pesos**: `llega_pesos = escalon_consumo >= 1` (tolerancia 4% vía `getEscalon`).
  - **Participación**: mismo indicador G de Encargados — `G = (vta_vta_tot/100 − objConsumo.participacion) / objConsumo.participacion`, llega si `G > −0.04`; sin objetivo → `G = −1` (no llega).
  - **$ por sucursal**: pesos + participación → monto ABM `consumo`/`por_sucursal` de su categoría completo, **SIN factor** (A=$10.000, B=$9.000, C=$8.000); pesos sin participación → la **MITAD** redondeada a miles (`Math.round`: A→$5.000, B→$5.000, C→$4.000); sin pesos → **$0** (los pesos son condición necesaria).
  - **Plus por plaza** (= PROVINCIA): si TODAS las Retail asignadas de la provincia llegan a **PARTICIPACIÓN** (sin importar pesos) → plus = **(suma de lo efectivamente pagado por esas sucursales) × `factor_plaza` (0.5)**, redondeado a miles. Si una falla participación, sin plus.
- **MILLÓN (id >= 100), mirando SOLO efectivo (sin cambios desde el 14/07)**: no paga por sucursal. Si TODAS las Millón asignadas de la provincia llegaron por efectivo (`escalon_efectivo >= 1`) → la plaza paga **UNA sola vez** el monto ABM `efectivo`/`por_plaza` (**$23.000**), **SIN factor**.
- Retail y Millón forman **plazas separadas** aunque compartan provincia.
- `MontosSupervisor` quedó con 6 filas (limpieza 2026-07-14: se borraron las 6 filas en cero de `consumo`/`por_plaza` y `efectivo`/`por_sucursal`): `consumo`/`por_sucursal` A/B/C y `efectivo`/`por_plaza` A/B/C (mismo valor, se lee la C). El `factor_plaza` se lee de la fila `consumo`/`por_sucursal` C.
- Resultado por supervisor: `plazas` (`provincia`, `tipo` retail|millon, `cumplida`, `cant_sucursales`, `suma_sucursales` — null en Millón, `monto`) + `sucursales` (con `tipo`, `provincia`, `escalon`, `llego`, y en Retail `indicador_g`, `llega_pesos`, `llega_particip`, `pago` completo|mitad|nada, `monto_por_suc`). La página muestra las plazas en una sola línea por provincia (bloques Retail y Millón + Total plaza) y avisa si el cálculo guardado es de formato viejo (sin `llega_particip`).
- **Tests**: `server/services/calcEngine.supervisores.test.js` (`node --test`, 10 tests) fija el contrato de estas reglas — primer archivo de tests del repo.

Suc01 (cerrada): `activa=0` desde 2026-07-03, el motor la filtra; queda la limpieza opcional de su asignación vieja en el ABM.

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
| `vendedores.js` | `/api/vendedores` | `GET /` (resultado del período, con `attachScope`/`filtrarPorSucursal`), `GET /importes` (vigencias), `POST /importes`, `PUT /importes/:anio/:mes`, `DELETE /importes/:anio/:mes` — los tres últimos con `blockWriteIfSupervisor` (403 para perfil 8) |

`GET /calculo/encargados`, `/encargados-millon` y `/supervisores` leen del **último `CalculoHistorial` guardado** — no recalculan al vuelo. Si se agrega un campo nuevo al resultado de `/ejecutar`, hay que re-ejecutar el cálculo completo desde la página **Total** para que el historial lo tenga.

### Botón "Ejecutar cálculo completo" (2026-07-01) — qué corre realmente

`POST /calculo/ejecutar` **ya no es solo** `calcularTotal` + el resto del motor. Antes de cargar el contexto, encadena los recálculos que antes vivían aislados en sus propias páginas con su propio botón:

0. `sincronizarObjetivos(periodo)` (`objetivos.js`, agregado 2026-07-02) — baja los objetivos de consumo y efectivo desde `METRIX.dbo.OBJETIVOS_MILLON` (BeClever) y los persiste en `ObjConsumo`/`ObjEfectivo`. **Antes ese cache solo se llenaba al entrar a cada solapa de la página Objetivos** → si nadie visitaba la solapa Efectivo, `ObjEfectivo` quedaba vacío para el período, todo `escalon_efectivo` daba 0 y la base efectivo de Operadores/Encargados salía en cero (pasó con 2026-06). Las dos queries a BeClever van **secuenciales**: el pool de BeClever tira `ECONNCLOSED` si se le pegan queries en paralelo.
1. `calcularYGuardarRanking(pool, periodo)` (`ranking.js`) — recategoriza A/B/C todas las sucursales. **Antes no se llamaba nunca desde el botón principal** → si nadie entraba a la página Ranking a mano, toda sucursal cae al fallback `'C'` (bug que afectó a Supervisores el 2026-06-30).
2. Resto del motor (`calcularTotal`, cajeros, operadores, encargados, encargados millón, supervisores) → se guarda en `CalculoHistorial` como siempre.
3. `calcularYGuardarOperadores(pool, periodo)` (`operadores.js`) y `calcularYGuardarOperadoresMillon(pool, periodo)` (`millon.js`) — recalculan y persisten en sus tablas propias (`ResultadoOperadores` / `ResultadoOpMillon`), leídas por las páginas Operadores Retail/Millón. Antes solo corrían si el usuario entraba a esas páginas y apretaba su botón "Calcular".

**Cajeros queda fuera** de este encadenado: su cálculo (`POST /calculo/cajeros`) recibe `overrides` de jornada que vienen de la UI, así que sigue siendo manual desde su propia página.

---

## Módulo Vendedores (`server/routes/vendedores.js`, `server/services/vendedoresView.js`)

**El cálculo lo hace enteramente un job batch de SQL Server (`SP_ComisionesINDO`)**, que además genera un `.xls` de comisiones y lo manda por mail. El dashboard **solo lee** el resultado — no hay endpoint de recálculo.

- **Umbrales por sucursal** (`sp_CoVenApp_LlenarEscalonesINDO`): objetivo de ventas × 0,97 = primer escalón, × 1,10 = segundo, × 1,15 sobre el segundo = tercero; los tres divididos por la cantidad de vendedores (full time pesa 1, part time 0,5), contando solo a quienes tienen más de 5 días de venta.
- **Comisión** (`sp_CoVenApp_CalcularComisionesINDO`): compara `venta calculada + proporcional` contra los umbrales de mayor a menor con `>=`; part time cobra la mitad del importe del escalón alcanzado.
- **Vigencias de importes**: los importes de cada escalón funcionan por vigencia — una vigencia rige desde su `(año, mes)` en adelante hasta que aparece otra posterior (`vigenciaParaPeriodo()` en `vendedoresView.js` resuelve cuál aplica a un período dado). El ABM nuevo (`POST`/`PUT`/`DELETE /api/vendedores/importes`) permite crear, editar y borrar vigencias desde la web — antes solo se cargaban por SQL directo. Es la **única** escritura del módulo.
- **El ⚠️** que puede mostrar la vista (`armarVista()`) significa que la comisión guardada (`GrillaComisionesINDO.comision`) no coincide con el importe del escalón alcanzado según la vigencia vigente: se editaron importes y ese período no fue reprocesado por el job.
- La vista usa la jornada **congelada** del período (columna `parcial` de la grilla), no la actual del legajo (`Vendedores.GCL_TEMPSPARTIEL`) — si difieren, `armarVista()` lo señala.

### Tablas involucradas (prefijo `tbl_CoVenApp_`, sin el `INDO` de las tablas propias del dashboard)

| Tabla | Descripción |
|---|---|
| `tbl_CoVenApp_GrillaVendedoresINDO` | Venta por vendedor/período (venta real, días de venta, venta calculada, proporcional, días de licencia, jornada congelada). **Su columna `comision` está siempre en 0** — no es la comisión real |
| `tbl_CoVenApp_GrillaComisionesINDO` | La comisión real pagada por vendedor/período |
| `tbl_CoVenApp_EscalonesINDO` | Por sucursal/período: cantidad de vendedores (ya ponderada), los 3 umbrales y los 3 importes congelados que se pagaron |
| `tbl_CoVenApp_ImportesEscalonesINDO` | Las vigencias de importes — la única tabla que el dashboard escribe |
| `tbl_CoVenApp_Vendedores` | Nombres y jornada actual del legajo (`GCL_TEMPSPARTIEL`) |
| `tbl_CoVenAppINDO_Sucursales` | Nombre de sucursal (join, tabla propia del dashboard) |

Página `src/pages/vendedores.js` (ruta `vendedores`, sidebar Cálculos entre Total y Cajeros) + modal de vigencias. **El mismo ABM está también como pestaña "Vendedores" en el visor de Montos** (`src/pages/visor-montos.js`, tipo de tab `vendedores`, agregada 2026-08-03 a pedido del usuario: los montos de todos los otros roles se editan ahí y este era el único que no). Las dos UIs consumen los mismos endpoints; si se cambia el contrato, hay que tocar las dos. Igual que el resto del módulo Cálculos, respeta `attachScope`/`blockWriteIfSupervisor`: perfil 8 ve menos sucursales (filtro por scope) y no puede tocar vigencias.

---

## Páginas (`src/pages/`) y sidebar

| Sección sidebar | Ruta | Estado |
|---|---|---|
| Principal | `dashboard` | KPIs (el botón "Ejecutar cálculo completo" se quitó el 2026-07-06; el cálculo se dispara desde la página Total) — **blindado, no tocar** |
| DATOS | `visor-sucursales` (con toggle Habilitada/Deshabilitada), `millon`, `visor-montos`, `visor-ranking`, `visor-objetivos`, `visor-ventas`, `supervisores` (ABM, label "Supervisores") | Datos maestros — **blindado, no tocar** |
| Cálculos | `cajeros`, `operadores-retail`, `operadores-millon` (con ponderación por jornada 2026-07-06) | Resultado de cálculo individual — **blindado, no tocar** |
| Cálculos | `encargados`, `encargados-millon` | Resultado por sucursal, sin nombres de personas — **blindado, no tocar** |
| Cálculos | `total` | Ejecuta el cálculo completo (botón "▶ Ejecutar cálculo") + pestañas de resultado y CSV. **Conectada al menú el 2026-07-14** — existía huérfana (sin ruta ni link) desde que se quitó el botón del Dashboard |
| Cálculos | `resultado-supervisores` | Resultado por supervisor, plazas en una línea por provincia (Retail + Millón), detalle por sucursal — **ÚNICO módulo abierto** (2026-07-06) |
| Cálculos | `vendedores` (entre Total y Cajeros) | Resultado del job SQL `SP_ComisionesINDO` por sucursal, con modal de vigencias de importes — agregado 2026-08-03 — **blindado, no tocar** |
| AYUDA | `manual` | Manual de uso. El texto vive en `docs/MANUAL.md` y lo sirve `GET /api/manual` — editar el `.md` y recargar la página alcanza, **sin** `npm run build` ni reinicio del servicio |

El ABM de Supervisores (`pages/supervisores.js`) vive en "DATOS" (se movió desde "Cálculos" sin tocar su lógica); la página de resultado (`resultado-supervisores.js`) es la que reemplaza ese rol en "Cálculos".

---

## Build / deploy

```powershell
npm run build              # genera dist/ — el server SIEMPRE sirve dist/, nunca src/ directo
Restart-Service dashcomisionesindo.exe
```

- Cambios en `src/` (frontend) requieren `npm run build` **antes** de reiniciar el servicio, o la página sigue mostrando la versión vieja.
- Cambios en `server/` (backend) **no** requieren build, solo reiniciar el servicio.

> **Al cambiar una regla del motor de cálculo, actualizar `docs/MANUAL.md`.** Es el manual que ven los usuarios desde la app (sección AYUDA); no requiere build ni deploy, solo editar el archivo.
>
> `server/services/manualCoherencia.test.js` es el guardarraíl: deriva del motor los umbrales que el manual afirma (escalones E1/E2/E3 con la tolerancia del 4%, el 96% de cajeros y su part-time, el −4% del indicador G) y falla si el motor y el texto divergen. Cubre solo lo que es constante del código — los montos en pesos viven en la DB y no se pueden verificar sin ella.

---

## Gotchas

- **Puerto 3011, no 3005** (desde 08/07/2026): el dashboard escucha en `127.0.0.1:3011`. El 3005 quedó libre de este dashboard porque un conector ODBC de Qlik (proceso `dotnet`, gateway) ocupa `127.0.0.1:3005` — no volver a ese puerto. Para probar la API desde el servidor: `http://localhost:3011`.
- El JWT se firma con `JWT_SECRET` del `.env` — para pruebas manuales de API se puede generar un token propio con `jsonwebtoken` sin pasar por `/login`.
- Cualquier dashboard nuevo, atención a no colisionar `PORT` con el `.env` — el servicio Windows lo pisa.

---

## Pendientes

- **Operadores Retail** (`calcularOperadores`): revisar con el mismo criterio de no-doble-multiplicación — hoy ignora las filas reales A/B cargadas en `OPER_CON_EFECT`/`OPER_SIN_EFECT` y reconstruye desde `'C'` × `mult`. Decisión explícita del usuario: dejarlo para otra sesión.
- **Encargados INDO** (sucursales con efectivo): aclarado por el usuario que para estas solo cuenta EFECTIVO — sin resolver si va dentro de Encargados Retail o es una sección aparte.
- ~~Sucursal id 1 cerrada~~ → resuelto 2026-07-03: `activa=0` en el ABM y el motor filtra `activa=1` al cargar sucursales (`calculo.js`, `operadores.js`, `millon.js`). Limpieza opcional pendiente: quitar la asignación de suc01 al supervisor Eric Vidable en `tbl_CoVenAppINDO_SupervisorSucursales` (hoy el motor la saltea sola).
- 2026-07-06: las sucursales `activa=0` se ocultan también en TODO el front: `GET /sucursales` filtra activas por defecto (`?todas=1` para el ABM), y filtran inactivas los GET de `datos.js` (consumo/efectivo/reporte), `objetivos.js`, `ranking.js` y `millon.js` (`buildResponse`). Toggle Habilitada/Deshabilitada en la página Sucursales (`PATCH /sucursales/:id/activa`). Los resultados ya persistidos conservan la sucursal hasta recalcular.
- **Supervisores es el ÚNICO módulo abierto** (confirmado por el usuario el 2026-07-06: "el resto está todo OK, blindar hasta mi próximo aviso"). Todo lo demás — Cajeros, Operadores Retail/Millón, Encargados Retail/Millón, Dashboard, Total, visores de DATOS — está cerrado y no se toca sin pedido explícito. Ver `RETOMAR.md` para el detalle de Supervisores (lógica por provincia/plaza, 2026-07-01).
