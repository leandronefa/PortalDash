# Retomar — ComisionesINDO — actualizado 2026-07-30

## Sesión 2026-07-30 — Manual de uso (sección AYUDA)

Implementado con spec + plan + 6 tareas vía subagentes (spec: `docs/superpowers/specs/2026-07-30-manual-uso-design.md`, plan: `docs/superpowers/plans/2026-07-30-manual-uso.md`).

**Arquitectura**: el texto del manual vive en `docs/MANUAL.md` (Markdown plano) y lo sirve `GET /api/manual` (`server/routes/manual.js` → `server/services/manualDoc.js::leerManual()`, lee el archivo del disco en cada request). La página `src/pages/manual.js` (ruta `manual`, sidebar AYUDA → 📖 Manual) lo renderiza con un mini-parser de Markdown propio sin dependencias (`src/components/markdown.js`: encabezados, párrafos, negrita/itálica/código, listas, tabla GFM, bloque de código, blockquote, regla horizontal, escape de HTML), con índice de navegación (a partir de los `h2`), buscador client-side y estilos de impresión/modo oscuro. **Decisión de diseño clave**: no hay `attachScope` ni `blockWriteIfSupervisor` en el router — el manual no tiene datos de sucursal que filtrar y no expone escritura, así que el perfil 8 (supervisor, solo lectura) ve exactamente el mismo contenido que cualquier otro perfil.

**Archivos nuevos**: `docs/MANUAL.md`, `server/services/manualDoc.js` + `manualDoc.test.js`, `server/routes/manual.js`, `src/components/markdown.js` + `markdown.test.js`, `src/pages/manual.js`.

**Tests (30/07)**: `node --test server/services/manualDoc.test.js src/components/markdown.test.js server/services/calcEngine.supervisores.test.js` → **25/25 PASS** (2 manualDoc + 13 markdown + 10 calcEngine.supervisores, este último corrido solo para confirmar no-regresión — no se tocó el motor).

**Deploy (30/07)**: `npm run build` + `Restart-Service dashcomisionesindo.exe` → `Running`. Smoke test `GET /api/manual` sin token → 401 (router registrado, pide auth).

**Verificación por API (reemplaza la visual del plan, no había navegador disponible en el server)**:
- Token perfil 1 vs token perfil 8 (`usuario: EVIDABLE`) contra `GET /api/manual` → **ambos 200 con el mismo `markdown` byte a byte** (hash SHA-256 idéntico) — confirma que el supervisor ve el manual completo, sin recorte ni 403.
- No-regresión: mismo token de perfil 1 contra `GET /api/sucursales` y `GET /api/health` → 200, respuesta normal, el resto de la app sigue viva.
- **Edición sin build ni reinicio** (verificación pendiente de la Tarea 5, cerrada acá): con el servicio ya reiniciado, se pidió `/api/manual` (hash A, `actualizado` t1), se agregó una línea comentario temporal al final de `docs/MANUAL.md`, se volvió a pedir **sin build ni restart** → el `markdown` trajo la línea nueva y `actualizado` cambió a t2; se quitó la línea y un tercer pedido devolvió exactamente el hash A original. Confirma la arquitectura: el `.md` se lee del disco en cada request.
- Fallback de archivo ausente: se renombró `docs/MANUAL.md` a `.bak`, se pidió `/api/manual` → **200** (no 500, no error de red) con `markdown` = "Manual no disponible" + la ruta esperada (`C:\apps\dashboards\ComisionesINDO\docs\MANUAL.md`) y `actualizado: null`. Se restauró el archivo de inmediato y un pedido posterior confirmó el manual completo de nuevo (mismo hash que antes de la prueba). `git status` al final: `docs/MANUAL.md` sin cambios.

**Pendiente del usuario — verificación visual en el navegador**: esta sesión corrió sin navegador disponible en el servidor, así que **no** se verificó visualmente: índice navegable, buscador filtrando, impresión, modo claro/oscuro, ni la vista real logueado como `EVIDABLE` (perfil 8) desde `http://10.0.0.118/d/8/`. Falta que el usuario lo confirme desde su navegador.

---

## Sesión 2026-07-27 (2) — Historización de montos por período (foto congelada)

Implementado con spec + plan + 6 tareas vía subagentes (spec: `docs/superpowers/specs/2026-07-27-historizacion-montos-design.md`, plan: `docs/superpowers/plans/2026-07-27-historizacion-montos.md`).

**Regla de negocio**: la primera vez que se calcula un período (desde Total, Cajeros, Operadores Retail u Operadores Millón), se congela una foto de los 6 valores de montos vigentes en ese momento (`Montos`, `MontosVendedor`, `MontosSupervisor`, `MontosPrestamos`, `MontosCajero`, `RankingMultiplicador`) en la tabla nueva `tbl_CoVenAppINDO_MontosHistorial` (un JSON por período). Reprocesar ese mismo período SIEMPRE usa esa foto, sin importar qué se edite después en el ABM de Montos. El ABM sigue editando el valor "actual" (vivo) sin cambios — la foto es solo un insumo del motor de cálculo.

**Backend**: `server/services/montosHistorial.js` (`ensureMontosHistorialTable`, `cargarMontosDelPeriodo`, `backfillMontosHistorial`) consumido por los 4 puntos que cargan montos para un cálculo: `calculo.js::cargarContexto()` (motor completo), `calculo.js::POST /cajeros`, `operadores.js::calcularYGuardarOperadores()`, `millon.js::calcularYGuardarOperadoresMillon()`. `cargarMontosDelPeriodo` tiene guard contra condición de carrera (dos requests concurrentes calculando el mismo período nuevo — el que pierde el INSERT relee la foto del ganador en vez de tirar 500).

**Backfill**: al arrancar el servidor, crea la foto (con los montos de HOY) para todo período que ya tenía algo calculado y no tenía foto. Desplegado y confirmado: **6 períodos backfilleados** (2025-07, 2026-03, 2026-04, 2026-05, 2026-06, 2026-07).

**Verificado (27/07) directamente contra la DB real**: congelé una foto de prueba para un período ficticio (`2099-01`), edité en vivo `MontosCajero` (+12345), volví a pedir la foto del mismo período → siguió devolviendo el valor viejo (no el editado). Confirmado el mecanismo funciona. Limpieza hecha (valor revertido, fila de prueba borrada) — quedan 6 fotos reales en la tabla, ninguna de prueba.

**Nota operativa — cómo "descongelar" un período** (no hay UI para esto, es deliberado): si hace falta forzar que un período tome montos nuevos (ej. se calculó por error antes de terminar de cargar los montos correctos), hay que borrar su fila a mano: `DELETE FROM dbo.tbl_CoVenAppINDO_MontosHistorial WHERE periodo='YYYY-MM'` — el próximo cálculo de ese período va a generar una foto nueva con los valores vigentes en ese momento.

**Deferred (no bloqueante, del review final)**: el backfill es una sola query `UNION` sobre las 4 tablas de resultado — si alguna no existiera (entorno nuevo/dev) el backfill completo loguea error y no hace nada ese arranque; en producción las 4 tablas ya existen, así que es cosmético. El log dice "período(s) revisado(s)" (cuenta encontrados, no creados). Ninguno requiere acción.

---

## Estado general
Servicio `dashcomisionesindo.exe` corriendo en puerto 3011 (bind `127.0.0.1`, acceso vía portal `/d/8/`). Build hecho y servicio reiniciado con las reglas 2026-07-16 de Supervisores. **Cálculo 2026-06 re-ejecutado el 16/07 vía API** con las reglas nuevas — resultado: **Eric Vidable $159.000** ($136.000 sucursales + $23.000 plaza Millón MENDOZA), **Josefina Rossini $128.000** ($69.000 sucursales + $59.000 plazas: Retail CATAMARCA $13.000 + LA RIOJA $13.000 + SGO. DEL ESTERO $5.000 + TUCUMAN $5.000 + Millón TUCUMAN $23.000). **Falta que el usuario valide contra la planilla** `comisiones 03-2026 REFINADA.xlsx`; si cierran → blindar Supervisores.

---

## Sesión 2026-07-27 — Acceso restringido para usuarios Supervisor (EVIDABLE / JROSSINI)

Implementado con spec + plan + 16 tareas vía subagentes (spec: `docs/superpowers/specs/2026-07-27-acceso-supervisores-design.md`, plan: `docs/superpowers/plans/2026-07-27-acceso-supervisores.md`):

- **Vínculo usuario↔supervisor**: columna nueva `usuario_login` en `tbl_CoVenAppINDO_Supervisores` (migración self-healing en `server/services/supervisorLookup.js`, corre una sola vez por proceso). Cargada en producción: `id=4 Eric Vidable → EVIDABLE`, `id=5 Josefina Rossini → JROSSINI`. Confirmado que ambos usuarios existen en `TBL_USUARIOS_APPS` con `idPerfil=8`, `activo=1` (la comparación es case-insensitive por la collation de SQL Server, así que no importa que `descUsuario` esté en minúsculas ahí).
- **Backend**: middleware `attachScope` + `blockWriteIfSupervisor` (`server/middleware/supervisorScope.js`) montado en los 10 routers — perfil 8 filtra cada GET con granularidad de sucursal (`filtrarPorSucursal`, `server/utils/scopeFiltro.js`) y bloquea con 403 cualquier método no-GET. Caso especial: los endpoints de resultado de Supervisores (`GET /api/supervisores`, `GET /api/calculo/supervisores`, la clave `supervisores` de `GET /api/calculo/ultimo`) devuelven solo el propio registro del supervisor logueado, no un filtro por sucursal.
- **Frontend**: helper `isSupervisorReadonly()` (`src/api/client.js`) oculta/reemplaza controles de escritura en 8 páginas (visor-montos, ranking, sucursales, supervisores ABM, total, cajeros, operadores-millon, operadores, millon) sin recortar el sidebar — el supervisor ve todo el tablero, solo lectura.
- **Deploy y verificación (27/07)**: build hecho, servicio reiniciado, migración corrida contra la DB real (columna creada, vínculo confirmado). Verificado primero con tokens JWT de prueba y después con **login real de EVIDABLE** (`POST /api/auth/login` con la contraseña real): 26 sucursales filtradas, un único registro propio en `/api/supervisores`, `POST /api/ranking/calcular` → 403; perfil normal ve las 42 sucursales completas, los 2 supervisores, y el `POST` corre normal (200) — sin regresión. **Verificación visual confirmada por el usuario**: logueado como EVIDABLE en el portal, sidebar completo visible y sin controles de escritura.
- Cerrado: no queda pendiente de este feature. El ABM de Supervisores tiene ahora un campo `usuario_login` editable (antes solo se podía cargar por SQL directo). Falta la misma prueba visual con JROSSINI si se quiere doble confirmación, pero la lógica es idéntica para ambos usuarios (mismo código, distinto `usuario_login`).

---

## Sesión 2026-07-16

### Supervisores — componente consumo con DOS indicadores (reemplaza las reglas del 14/07)
Implementado con spec + plan + subagentes (spec: `docs/superpowers/specs/2026-07-16-supervisores-consumo-reglas-design.md`, plan: `docs/superpowers/plans/2026-07-16-supervisores-consumo-reglas.md`):

- **$ por sucursal Retail (solo consumo)**: pesos (`escalon_consumo >= 1`) **y** participación (G > −0.04, mismo indicador que Encargados) → monto ABM completo; pesos sin participación → **mitad** redondeada a miles (`Math.round`: A→5.000, B→5.000, C→4.000); sin pesos → $0. Sin objetivo de participación → G = −1 (no llega → mitad si tiene pesos).
- **Plus de plaza Retail**: cumple si TODAS las Retail de la provincia llegan a **participación** (sin importar pesos); plus = suma de lo efectivamente pagado × 0.5, redondeado a miles.
- **Millón intacto** (efectivo, $23.000 por plaza completa).
- Tolerancia 4% en todo (el "0.4%" del pedido original era la tolerancia estándar 0.04, confirmado).
- **Primer archivo de tests del repo**: `server/services/calcEngine.supervisores.test.js` — `node --test`, 10 tests que fijan el contrato (TDD: 8 RED → 10/10 GREEN).
- Página `resultado-supervisores.js`: columnas ¿Pesos? / Particip. (con G en %) / Pago (Completo/Mitad/—) en el detalle de Sucursales, tooltip de ¿Cumple? por participación, y aviso amarillo si el cálculo guardado es de formato viejo (retail sin `llega_particip`).
- Commits: `143052a` (tests), `049d8ca` (motor), `9506e1d` (página). Deploy hecho (build + restart + smoke 200).

### Pendiente
- ~~Re-ejecutar el cálculo 2026-06~~ → **HECHO 16/07 vía API** (`POST /calculo/ejecutar`, usuario `claude-api`). Falta **validar contra la planilla** `comisiones 03-2026 REFINADA.xlsx`: Eric Vidable $159.000, Josefina Rossini $128.000 (detalle en Estado general). Si cierran → blindar Supervisores.
- Limpieza opcional: quitar asignación de suc01 a Eric Vidable en el ABM.

---

## Sesión 2026-07-14

### 1. Visor Ventas → Originaciones: filtros + CSV
`src/pages/visor-ventas.js`: en la pestaña Originaciones se agregaron filtros por Operador, Sucursal y rango de fechas (client-side, sobre los datos ya cargados del período) y botón de descarga CSV (solo filas filtradas; formato es-AR: `;`, coma decimal, BOM UTF-8). Fecha ahora se muestra `dd/mm/yyyy`. Consumo/Efectivo sin cambios.

### 2. Supervisores — reglas corregidas (VERSIÓN FINAL del día, iterada 4 veces con el usuario)
⚠ El negocio cambió el cálculo el mismo 14/07. Regla vigente (implementada en `calcularSupervisores()`, `server/services/calcEngine.js`):
- **RETAIL (id < 100), SOLO consumo**:
  - **$ por sucursal**: si `escalon_consumo >= 1` paga el monto ABM `consumo`/`por_sucursal` de su categoría **SIN factor** (A=$10.000, B=$9.000, C=$8.000). No varía por escalón (el usuario aclaró: "me equivoqué, no era escalón, es categoría").
  - **Plus por plaza**: plaza = provincia. Si TODAS las Retail asignadas de esa provincia llegaron por consumo → plus = **(suma de lo pagado por las sucursales de esa plaza) × factor_plaza (0.5)**, redondeado a miles (`Math.round`). Si una no llega, sin plus.
- **MILLÓN (id >= 100), SOLO efectivo**: no paga por sucursal. Si TODAS las Millón asignadas de la provincia llegaron por efectivo (`escalon_efectivo >= 1`) → la plaza paga **UNA sola vez** el monto ABM `efectivo`/`por_plaza` (**$23.000**), **SIN factor**.
- Retail y Millón forman **plazas separadas** aunque compartan provincia (ej. MENDOZA aparece como plaza Retail y plaza Millón).
- El `factor_plaza` se lee de la fila `consumo`/`por_sucursal` categoría C.
- Cada plaza retorna `tipo ('retail'|'millon')`, `cant_sucursales` y `suma_sucursales` (null en Millón); cada sucursal del detalle lleva `tipo`.
- `src/pages/resultado-supervisores.js`: tabla Plazas en **una sola línea por provincia** con bloques Retail (Suc/¿Cumple?/$ Sucursales/$ Plus ×0,5) y Millón (Suc/¿Cumple?/$ Plaza) + columna Total plaza (suma de ambos premios; el $ Sucursales Retail NO entra, va al total por Sucursales). Provincia sin uno de los dos tipos → "—". El detalle de Sucursales quedó como estaba. Cambio solo de presentación (agrupa el array `plazas` por provincia al renderizar) — sirve para cálculos ya guardados sin recalcular.

### 3b. Página Total conectada al menú (estaba huérfana)
`src/pages/total.js` (con el botón "▶ Ejecutar cálculo", único disparador del cálculo completo desde que se quitó del Dashboard el 2026-07-06) existía pero **no estaba registrada en el router ni en el sidebar** — no había forma de ejecutar el cálculo desde la UI. Fix: import + ruta `total` en `src/app.js` y entrada "🧮 Total" primera en la sección Cálculos del sidebar (`src/components/sidebar.js`). Flujo para calcular un período: sidebar → período → Cálculos → Total → ▶ Ejecutar cálculo (Cajeros sigue aparte con botón propio por los overrides de jornada).

### 3. MontosSupervisor — limpieza (pedido del usuario)
Borradas las 6 filas en cero que no corresponden: `consumo`/`por_plaza` (A/B/C) y `efectivo`/`por_sucursal` (A/B/C). Quedan solo `consumo`/`por_sucursal` (A=10000, B=9000, C=8000) y `efectivo`/`por_plaza` (23000 en A/B/C, factor_plaza=0.5). No hay seed que las re-inserte; el motor ya no lee los conceptos borrados (`_getMontoSup` eliminada, ahora usa `filaSup` local).

### 4. Resultado 2026-06 con reglas finales (a validar por el usuario)
- **Eric Vidable: $219.000** = $169.000 por sucursales (18/21 Retail: 10 A + 5 B + 3 C) + $27.000 plaza Retail MENDOZA (suma $53.000 × 0.5 = 26.500 → ↑ 27.000) + $23.000 plaza Millón MENDOZA (suc 105 ok). No cumplen: Retail SAN JUAN/SAN LUIS, Millón SAN JUAN (110)/SAN LUIS (104).
- **Josefina Rossini: $118.000** = $69.000 por sucursales (8/11 Retail: 5 B + 3 C) + plazas Retail CATAMARCA $13.000 y LA RIOJA ($25.000 × 0.5 = 12.500 → ↑ $13.000) + $23.000 plaza Millón TUCUMAN (suc 108 ok). No cumplen: Retail SGO. DEL ESTERO/TUCUMAN, Millón CATAMARCA (101)/LA RIOJA (103, 106)/SGO. DEL ESTERO (107).

### Pendiente para mañana
- **Validar los números contra la planilla** (`comisiones 03-2026 REFINADA.xlsx`) y, si cierran, blindar el módulo Supervisores (agregarlo a la lista de blindados).
- El redondeo del plus Retail usa `Math.round` (convención del módulo): 26.500 → 27.000 y 12.500 → 13.000. Si el negocio redondea para abajo, cambiar `redondeoMil` a `Math.floor`.
- Limpieza opcional: quitar asignación de suc01 a Eric Vidable en el ABM de Supervisores (ya no afecta el cálculo).
- Todo desplegado y corriendo: build hecho, servicio reiniciado, cálculo 2026-06 regenerado con estas reglas (último historial del período).

---

## Sesión 2026-07-03

### 1. Desglose de composición del monto en Operadores (pedido del usuario: "veo 20000 en consumo en suc02 y no sé cómo se compone")
- **Motor** (`calcularOperadores`): ahora retorna los 4 componentes del consumo por separado — `comp_escalon`, `comp_particip`, `comp_ticket`, `comp_operacion` (`calc_consumo` = suma; la lógica de cálculo NO cambió).
- **Persistencia**: 4 columnas nuevas en `tbl_CoVenAppINDO_ResultadoOperadores` (vía loop de ALTER en `ensureTables`). Filas de cálculos viejos quedan `NULL` → la página muestra aviso amarillo "recalculá para ver el desglose".
- **Página Operadores Retail** (`src/pages/operadores.js`): cada fila de sucursal es clickeable y expande el desglose: componentes de consumo con ✓/✗ y motivo (escalón alcanzado, G/O/R vs −4%, bloqueos por G), efectivo, y la fórmula final `(base cons + base ef) × mult (cat) = full` con redondeo a miles. Etiquetado explícito "montos base cat. C".
- **Página Operadores Millón**: tooltip en Full $ con la fila de Préstamos usada (tipo suc, escalón, categoría — valor final, sin multiplicador adicional).

### 2. Suc01 (VALLEJO CALZADOS 01) cerrada — excluida del cálculo (decisión del usuario: "la sucursal cerró, opción 1")
- `activa=0` en `tbl_CoVenAppINDO_Sucursales` (aplicado en DB).
- El motor ahora filtra `AND activa=1` al cargar sucursales: `calculo.js` (cargarContexto + endpoint cajeros), `operadores.js` y `millon.js` (operadores millón). Antes cargaba todas las `id < 300` ignorando el flag.
- Efecto en Supervisores: `calcularSupervisores` hace `if (!sucRes) continue` sobre las asignaciones, así que la asignación vieja de suc01 a Eric Vidable se saltea sola — el grupo fantasma "SIN PROVINCIA"/plaza imposible desaparece al recalcular. **Limpieza opcional**: quitar la asignación en el ABM de Supervisores (`tbl_CoVenAppINDO_SupervisorSucursales`, supervisor_id=4).

### ⚠ Gotcha nuevo (encoding)
NO editar archivos fuente con `-replace`/`Set-Content` de PowerShell 5.1: rompe UTF-8 (mojibake en acentos + BOM). Pasó hoy con `calculo.js`; se revirtió con `git checkout` y se rehízo con el editor.

### Archivos tocados hoy (sin commitear, junto con lo del 01/02)
| Archivo | Cambio |
|---|---|
| `server/services/calcEngine.js` | `calcularOperadores`: componentes del consumo separados + expuestos en el retorno |
| `server/routes/operadores.js` | 4 columnas `comp_*` (ALTER + INSERT); filtro `activa=1` |
| `server/routes/calculo.js` | Filtro `activa=1` en las 2 cargas de sucursales |
| `server/routes/millon.js` | Filtro `activa=1` en sucursales Millón |
| `src/pages/operadores.js` | Fila expandible con desglose del monto |
| `src/pages/operadores-millon.js` | Tooltips de origen del monto en Full $ |

---

## Sesión 2026-07-02

### Objetivos sincronizados automáticamente en el cálculo completo
El usuario reportó "base efectivo todo en cero" en Operadores Retail (2026-06). Causa: `ObjEfectivo` no tenía filas para 2026-06 — el cache `ObjConsumo`/`ObjEfectivo` solo se llenaba al entrar a cada **solapa** de la página Objetivos (los GET `/objetivos/consumo|efectivo` cachean como side-effect), y nadie había entrado a la solapa Efectivo ese mes. Sin objetivo, `escalon_efectivo=0` en todas las sucursales → base efectivo $0 (afectaba también Encargados Millón, Supervisores y el semáforo efectivo).

**Fix**: extraída `sincronizarObjetivos(periodo)` (exportada en `server/routes/objetivos.js`, con `fetchConsumoBC`/`fetchEfectivoBC` reutilizadas por los GET) y llamada como **paso 0** de `POST /calculo/ejecutar`, antes del ranking. Ojo: las dos queries a BeClever van secuenciales — con `Promise.all` el pool BC tira `ECONNCLOSED`.

Verificado con corrida real 2026-06 vía API: `ObjEfectivo` 44 filas, 39 de 105 operadores con `calc_efectivo > 0` (ej. SPORTOTAL 10 esc.2 → $34.000).

### Cajeros: tolerancia -4% aplicada
`calcularCajeros()` (`server/services/calcEngine.js`) comisionaba con condición estricta `vta_vta_tot >= obj_particip_pct`. A pedido del usuario ahora usa `ratioParticip > 0.96` (mismo criterio de tolerancia 4% que `getEscalon()` y los indicadores G/O/R). Servicio reiniciado (cambio solo backend, sin build). **Falta recalcular Cajeros desde su página** para que los resultados persistidos (`ResultadoCajeros`) reflejen la tolerancia — el cálculo de Cajeros sigue siendo manual por los overrides de jornada.

Nota: Cajeros estaba blindado; este cambio fue pedido explícito del usuario y no toca nada más del módulo.

---

## Sesión de hoy (2026-07-01)

### 1. Sidebar
"Supervisores (ABM)" → "Supervisores" (sección DATOS). Sigue habiendo otra entrada "Supervisores" en Cálculos (la página de resultado) — mismo label, rutas distintas, a pedido del usuario.

### 2. Bug del Ranking no recalculado (afectaba a Supervisores, Operadores y Cajeros)
El botón **"Ejecutar cálculo completo"** del Dashboard llamaba solo a `POST /calculo/ejecutar`, que **lee** el ranking guardado pero nunca lo recalculaba. Si nadie entraba antes a la página Ranking a apretar su propio botón "Recalcular", `tbl_CoVenAppINDO_Ranking` quedaba vacío/viejo para ese período → todas las sucursales caían al fallback `'C'`. Por eso el cálculo de Supervisores de ayer (2026-06-30) mostró todo categoría C.

**Fix**: se extrajo la lógica de `POST /ranking/calcular` a una función exportada `calcularYGuardarRanking(pool, periodo)` en `server/routes/ranking.js`. `POST /calculo/ejecutar` (`server/routes/calculo.js`) la llama **siempre**, antes de `cargarContexto()`.

### 3. Operadores Retail y Operadores Millón sumados al botón principal
Estos dos módulos tenían su propio botón "Calcular" en su página, con su propia tabla de resultado (`ResultadoOperadores` / `ResultadoOpMillon`), totalmente desacoplados del botón del Dashboard. Igual que Ranking, dependían de que el usuario entrara a cada página manualmente.

Se extrajeron y exportaron `calcularYGuardarOperadores(pool, periodo)` (`server/routes/operadores.js`) y `calcularYGuardarOperadoresMillon(pool, periodo)` (`server/routes/millon.js`), y ambas se llaman desde `POST /calculo/ejecutar` después de calcular el resto.

**Cajeros queda aparte, sin cambios** — su cálculo recibe `overrides` de jornada (part/full) que vienen de la UI; no se puede auto-ejecutar ciego desde el botón principal sin perder esos overrides. Sigue con botón manual propio en su página.

### 4. `calcularSupervisores()` reescrita — lógica real de negocio confirmada por el usuario
La implementación anterior (2026-06-30) calculaba UN solo bono de plaza por supervisor usando la "mejor categoría" entre TODAS sus sucursales asignadas — no tenía nada que ver con la lógica real.

**Lógica correcta** (`server/services/calcEngine.js` → `calcularSupervisores()`):
- **"Llegar a comisionar"** en una sucursal = escalón ≥ 1 (mira `escalon_efectivo` si `tiene_efectivo`, sino `escalon_consumo`) — reutiliza el campo que ya calcula `calcularTotal()`, no se recalcula de cero.
- **$ por sucursal**: se paga por cada sucursal asignada **solo si esa sucursal llegó**. Antes se pagaba siempre, sin condición — bug corregido hoy.
- **$ por plaza = por PROVINCIA**, no por "mejor categoría del supervisor". Se paga un monto **fijo único** (confirmado con datos reales: la tabla `MontosSupervisor` tiene el mismo valor en `categoria_suc` A/B/C para `tipo='por_plaza'` — efectivo=23000, consumo=0, factor=0.5 — por eso el código toma siempre la fila `'C'` como referencia, no hace falta tocar la tabla) **una vez por cada provincia donde TODAS las sucursales asignadas al supervisor llegaron**. Si al menos una sucursal de esa provincia no llegó, esa plaza no paga nada (aunque las demás plazas del mismo supervisor sí puedan pagar si están completas).

**Página `resultado-supervisores.js`** actualizada: el detalle expandible ahora tiene dos tablas — **Plazas** (provincia / ¿cumplida? / monto) y **Sucursales** (agrega columnas provincia, escalón, ¿llegó?).

### 5. Verificación con datos reales (período 2026-06)
- Ranking recalculado: 14 sucursales A / 17 B / 11 C (antes: todo C).
- Operadores Retail y Millón se recalcularon en la misma corrida sin entrar a sus páginas.
- Supervisores: Eric Vidable y Josefina Rossini — varias sucursales sin llegar, ninguna provincia completó el 100% en este período → `total_por_plaza = 0` para ambos (correcto según la regla "alcanza con que una no llegue para que la plaza no pague").

---

## Pendiente para retomar mañana

- **Re-ejecutar el cálculo completo de 2026-06** desde el Dashboard (o ⟳ Calcular en Operadores): regenera con el desglose `comp_*` nuevo y sin la suc01.
- ~~Sucursal ID 1 cerrada~~ → **RESUELTO 2026-07-03** (`activa=0` + filtro `activa=1` en el motor, ver sesión de hoy). Queda solo la limpieza opcional de la asignación a Eric Vidable en el ABM.
- El usuario sigue con la duda de si el consumo de suc02 ($20.000) es correcto — con el desglose nuevo puede verificarlo; si la diferencia viene de la fila base C × mult vs las filas reales A/B de Montos, es el pendiente histórico de Operadores Retail (corregir con el mismo patrón que Encargados).
- Confirmar con el usuario si el resultado de Supervisores (por sucursal + por plaza, con la lógica nueva) ya es el correcto para cerrar/blindar el módulo, o si falta algo más de revisión suya.
- Una vez cerrado, agregar Supervisores a la lista de módulos blindados (junto con Cajeros, Operadores Retail/Millón, Dashboard, Total, visores DATOS, ABM Supervisores).
- Considerar re-ejecutar el cálculo completo para otros períodos ya cargados, ahora que arrastra Ranking + Operadores Retail/Millón + Supervisores corregidos en una sola corrida (antes esos períodos solo tenían el fix viejo de Encargados/doble-multiplicación).

## Archivos tocados hoy (2026-07-01)

| Archivo | Cambio |
|---|---|
| `src/components/sidebar.js` | Label "Supervisores (ABM)" → "Supervisores" |
| `server/routes/ranking.js` | Extraída `calcularYGuardarRanking()` (exportada), reutilizada por `/calcular` y por `/calculo/ejecutar` |
| `server/routes/operadores.js` | Extraída `calcularYGuardarOperadores()` (exportada), reutilizada por `/calcular` y por `/calculo/ejecutar` |
| `server/routes/millon.js` | Extraída `calcularYGuardarOperadoresMillon()` (exportada), reutilizada por `/operadores/calcular` y por `/calculo/ejecutar` |
| `server/routes/calculo.js` | `POST /ejecutar` ahora llama a las 3 funciones anteriores como parte de la misma corrida |
| `server/services/calcEngine.js` | `calcularSupervisores()` reescrita: agrupación por provincia (plaza), condición "llegó" (escalón≥1) por sucursal, plaza con monto fijo único desde fila `categoria_suc='C'` |
| `src/pages/resultado-supervisores.js` | Detalle expandible: tabla de Plazas (provincia/cumplida/monto) + columnas provincia/escalón/¿llegó? en sucursales |

---

## Contexto de sesiones anteriores (resumen, ver `CONTEXT.md` para el detalle completo)

- Badges de escalón, indicadores G/O/R en Operadores, marcador automático SI/%/$$/NO, sidebar reorganizado en DATOS/Cálculos, Operadores divididos Retail/Millón, Cajeros con acordeón, sticky headers en Cajeros/Operadores.
- Página "Sucursales Millón" con toggle ¿Es operador? y cache de BeClever (`tbl_CoVenAppINDO_MillonCache`, botón "Actualizar").
- Fix de doble multiplicación por categoría (2026-06-30) en Encargados, Encargados Millón y (hoy, más a fondo) Supervisores — ver "Regla de oro" en `CONTEXT.md`.
- Pendiente histórico sin resolver: **Operadores Retail** (`calcularOperadores()`) usa fila `'C'`+mult en vez de la fila real por categoría (A/B) que existe cargada en `Montos` — mismo patrón de bug que se corrigió en Encargados, pero decisión explícita del usuario de dejarlo para otra sesión (módulo blindado).
- **E1 ámbar** no funciona del todo en períodos no recalculados (se muestra como verde). El usuario dijo "no toquemos más" pero puede retomarse si quiere ajustar.
- El conteo de operadores por sucursal (`es_operador = TRUE` en `tbl_CoVenAppINDO_MillonOperadores`) está disponible en DB para usar en el motor de cálculo cuando sea necesario.
