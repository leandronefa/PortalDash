# Motor de Reposición — CLAUDE.md

Tablero web de reposición/quiebre de stock para Cegid, con conexión directa a SQL Server (sin capa intermedia SQLite). 100% datos reales, no simulados.

## Stack y estructura

- **Backend:** Node.js + Express (`server.js`, ~740 líneas, archivo único). Conexión a SQL Server vía `mssql` (pool de conexiones), variables de entorno en `.env` (no versionado) con `dotenv`.
- **Base de datos:** SQL Server 2008 R2, servidor `10.0.0.115`, base `db_Cegid`. **Ojo con las limitaciones de esta versión** (ver sección abajo).
- **Frontend:** una sola página estática (`public/tablero_motor_quiebre.html`, ~3.600 líneas, HTML+CSS+JS vanilla sin build step) servida por Express (`express.static`).
- **Precálculo nocturno:** un stored procedure (`sql/MotorReposicion_sp_PreCalcularStockSemanal.sql`) corrido por un SQL Agent Job ("MotorReposicion - PreCalcular DiasConStock", 06:30 diario) que puebla tablas `MotorReposicion_*` para que el backend nunca calcule en vivo lo que es pesado.
- **Scripts de mantenimiento/diagnóstico:** `scripts/precalc/*.js` — scripts Node sueltos (backup de SPs, pruebas aisladas, verificación de impacto), no forman parte de la app en runtime.
- **Docs:** `docs/superpowers/{specs,plans}/` — specs y planes de cambios grandes hechos con el flujo brainstorming → plan → implementación (ver `docs/superpowers/specs/` para el historial de decisiones de diseño ya tomadas antes de proponer algo que pueda solaparse).
- **Backups:** `backups/<fecha>-<descripcion>/` — snapshots de `server.js`/HTML/definición de SP tomados antes de cambios riesgosos. Ver regla de trabajo más abajo: seguir haciendo esto SIEMPRE antes de un `ALTER PROCEDURE` o cambio de esquema.
- **Git:** repo local, sin remoto (`git init` hecho el 2026-08-18). Se sigue usando de acá en adelante para todo cambio de código de este proyecto.
- **Servicio:** `dashmotorreposicion.exe`, puerto **3019**, instalado el 2026-09-01 (`node C:\apps\portal\deploy\dashboards\install-dashboard-service.js "Dash-MotorReposicion" "C:\apps\dashboards\MotorReposicion" 3019`). Escucha solo en `127.0.0.1` — se agregó `HOST=process.env.HOST || '127.0.0.1'` y `app.listen(PORT, HOST, ...)` en `server.js` (antes no bindeaba HOST y quedaba en todas las interfaces). Dado de alta en el portal el 2026-09-01 (Dashboard **Id 21**, URL vía proxy `/d/21/`) con permisos otorgados a los usuarios que lo van a usar.

## Convenciones de nombres

- **Tablas precalculadas:** `dbo.MotorReposicion_<Nombre>` (`MotorReposicion_StockSemanal`, `MotorReposicion_VelocidadAmplia`, `MotorReposicion_DiasConStockPorSemana`, `MotorReposicion_CatalogoValido`, `MotorReposicion_UniversoHoy`, `MotorReposicion_DepositoHoy`, `MotorReposicion_UltimaRecepcion`).
- **Stored procedures:** `dbo.MotorReposicion_sp_<Verbo><Objeto>` (ej. `MotorReposicion_sp_PreCalcularStockSemanal`). Un solo SP hace las 5 etapas del precálculo nocturno.
- **Tablas temporales dentro del SP:** `#<NombreTablaReal>Nuevo`/`Nueva` (género según el nombre) — patrón `TRUNCATE tabla_real` + `INSERT ... SELECT FROM #TablaNueva`, todo dentro de una transacción explícita (`BEGIN/COMMIT TRANSACTION`). Ej.: `#StockSemanalNuevo`, `#StockAmplioNuevo`, `#VelocidadAmpliaNueva`, `#CatalogoValidoNuevo`, `#UniversoHoyNuevo`, `#DepositoHoyNuevo`, `#UltimaRecepcionNueva`.
- **CTEs:** nombres descriptivos en español, PascalCase (`RangoPorCombo`, `SemanasEsperadas`, `Huecos`, `ConAnteriorA`, `BaseA`). Tablas de números chicas para evitar funciones no soportadas en 2008 R2 se llaman `E1`/`Nums`.
- **Queries embebidas en `server.js`:** constantes en mayúsculas con prefijo `QUERY_` (`QUERY_QUIEBRE_DETALLE`, `QUERY_ARTICULO_COMPLETO`).
- **Scripts de `scripts/precalc/`:** verbo_objeto en snake_case español (`verificar_impacto.js`, `desplegar_sp.js`, `probar_relleno_huecos.js`) — cada uno es de un solo uso/diagnóstico puntual, no una librería reusable.

## Cómo ejecutar/probar

**Levantar el servidor:**
```
npm install        # primera vez
npm start           # node server.js, puerto 3050 (3000 está ocupado por otra app)
```
Requiere `.env` con `DB_USER`, `DB_PASSWORD`, `DB_SERVER`, `DB_DATABASE` (y opcionalmente `USE_MOCK=true` para no conectar a SQL real, `PORT`, `PEDIDOS_ANTIGUEDAD_MESES`).
Si el proceso se corta solo al levantarlo en segundo plano dentro de una tarea del harness: usar `Start-Process -FilePath "node" -ArgumentList "server.js" -WindowStyle Hidden` en vez del mecanismo normal de `run_in_background` — ese sí sobrevive al reciclado de tareas.

**No hay test suite automatizado** (no hay `npm test`, ni carpeta `tests/`). La validación de cambios se hace con scripts Node ad-hoc contra la base real:
```
node scripts/precalc/verificar_impacto.js     # ejemplos de scripts de verificación ya existentes
```
Patrón estándar de estos scripts: `require('dotenv').config()` + `mssql` + `async function main() { const pool = await sql.connect(dbConfig); ...; await pool.close(); } main().catch(e => { console.error(e); process.exit(1); })`.

**Cambios al stored procedure de precálculo:**
1. Backup de la definición actual (`OBJECT_DEFINITION`) antes de tocar nada.
2. Editar `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` (el archivo versionado).
3. Desplegar contra la base real convirtiendo `CREATE PROCEDURE` → `ALTER PROCEDURE` (ver `scripts/precalc/desplegar_sp.js` como referencia del patrón de despliegue + verificación exacta post-deploy).
4. Correr el SP manualmente una vez (no esperar a las 06:30) y medir tiempo.
5. Verificar impacto con un script de un solo uso contra datos reales, no solo leer el código.

## Popover "Cálculo de la necesidad de compra" (Reposición/Edición de recompra)

Al hacer clic en "Sugerido"/un talle, se abre un popover armado por `pintarFormulaDesglose` +
`formulaBoxesHtml` (buscar esos nombres en `tablero_motor_quiebre.html`). Piezas clave:

- **Escenario conservador vs. real:** `AJUSTES_FORMULA` (lista genérica de ajustes conocidos —
  hoy solo el piso de 7 días en días con stock) + `vdReal`/`itemsConVdReal` recalculan la fórmula
  completa sin el ajuste. Si algún ajuste se disparó en al menos una sucursal, `d.escenarioReal`
  no es null y se muestran las dos columnas lado a lado (conservador gris, real celeste).
- **Formato en bloques, no una sola ecuación:** Objetivo/Stock/GAP bruto NO se dibujan como una
  resta continua (`Objetivo − Stock = GAP bruto` es matemáticamente falso cuando hay más de una
  sucursal, porque GAP bruto es la suma de `máx(0, objetivo−stock)` por sucursal). Van en bloques
  separados ("Demanda" / "Stock actual" / "Resultado"), con las notas explicativas compartidas
  una sola vez arriba de las dos columnas.
- **Lupita (🔎) = detalle por sucursal:** solo aparece con `nSucursales>1 && porSucursal` — con 1
  sola sucursal el número ya es una cuenta directa visible, no hay nada nuevo que desglosar.
- **Ventana de detalle:** `abrirDetalleCajita`/`#desglose-detalle-popover`, arrastrable
  (`habilitarDragPopover`), separada del popover principal (los dos quedan visibles a la vez).
- **Botón "Volver a la cobertura"** (desde Reposición, tras venir de "Ver propuesta de recompra"):
  nace `position:absolute` pegado al recuadro de la tarjeta (sigue el scroll normal de la
  página), y se congela a `position:fixed` en su posición actual justo después del scroll
  automático hacia la tarjeta (`fijarBotonVolverEnPantalla`) — así queda "cerca del recuadro" al
  aparecer, pero no desaparece si después se sigue bajando mucho más.

## Botón "Ver en detalle" (home)

Clase `.ver-detalle-btn` en `tablero_motor_quiebre.html`. Agrandado y recoloreado el 2026-09-01
a pedido explícito de la usuaria: antes fondo `#1a2730` (gris casi negro), `font-size:13px`,
`padding:10px 22px`; ahora fondo `#0e5a6b` (el mismo verde azulado que ya usa el hover y el botón
"Volver"), `font-size:15px`, `padding:12px 26px`, `border-radius:24px`, con hover `#0a4552`.

## Reglas de trabajo (seguir siempre)

- **Los cambios son siempre quirúrgicos: tocar solo la sección que se pide, sin refactorizar el resto.** No reordenar, renombrar ni "mejorar de paso" código que no forma parte del pedido puntual, aunque se vea una oportunidad de limpieza — proponerla aparte, no mezclarla en el mismo cambio.
- Backup antes de cambios grandes en la base o el SP de precálculo (`backups/<fecha>-<descripcion>/`).
- Verificar con datos/pruebas reales antes de afirmar que algo está arreglado — no alcanza con razonamiento teórico.
- Decisiones de producto/UX (qué ve el usuario, no solo velocidad interna) se preguntan con opciones concretas antes de implementar. Fixes invisibles se pueden implementar directo.
- SQL Server 2008 R2 no soporta `CONCAT`, `CREATE OR ALTER`, `LAG()`/funciones de ventana modernas, ni generadores nativos de secuencias de fechas — usar tablas de números vía `ROW_NUMBER() OVER (ORDER BY (SELECT NULL))` sobre un cross join chico.
- **Nunca adivinar un offset de píxeles para `position:fixed`/`sticky` en elementos anidados dentro de otro contenedor con su propio encabezado fijo** (ej. el modal con `.modal-hd` sticky) — la altura real varía con el contenido (título largo → 2 líneas) y un número fijo se queda corto. Medir en vivo con `getBoundingClientRect()`/`ResizeObserver` y guardar el resultado en una CSS variable (ver `--modal-hd-alto` en el CSS). Perdimos 2 rondas de ida y vuelta con la usuaria por adivinar en vez de medir.
- **`overflow:hidden`/`auto` en un ancestro (incluso solo en un eje) rompe `position:sticky` de los descendientes** — cualquier valor de `overflow` distinto de `visible` convierte a ese ancestro en el contenedor de referencia del sticky, y si ese ancestro no scrollea por sí mismo, el sticky queda inerte. Si un sticky "no se queda fijo", revisar overflow en los ancestros antes que nada.
