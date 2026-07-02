# Retomar — ComisionesINDO — actualizado 2026-07-02

## Estado general
Servicio `dashcomisionesindo.exe` corriendo en puerto 3005. Build hecho y servicio reiniciado con todos los cambios de hoy. Probado contra datos reales del período 2026-06.

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

- **Sucursal ID 1 (VALLEJO CALZADOS 01) está CERRADA** — el usuario aclaró que ya no aplica. Hoy apareció con `provincia = NULL` ("SIN PROVINCIA") todavía asignada al supervisor Eric Vidable (id 4) en `tbl_CoVenAppINDO_SupervisorSucursales`. **No se tocó nada todavía** — falta decidir con el usuario: ¿se desactiva en Sucursales (`activa=0`), se le quita la asignación de supervisor, o ambas? Mientras siga asignada sin provincia, cae en un grupo "SIN PROVINCIA" que nunca puede completar una plaza real.
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
