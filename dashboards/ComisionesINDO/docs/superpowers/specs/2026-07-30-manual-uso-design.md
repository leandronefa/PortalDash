# Manual de uso integrado — ComisionesINDO

**Fecha**: 2026-07-30
**Estado**: spec aprobado, pendiente de plan de implementación

---

## 1. Problema

La aplicación de Comisiones INDO concentra reglas de negocio que cambiaron varias veces (Supervisores se redefinió el 14/07 y otra vez el 16/07), tiene un orden de operación no evidente (el cálculo se dispara desde **Total**, pero **Cajeros** va aparte), y comportamientos que sorprenden a quien no siguió el desarrollo (la foto congelada de montos por período, el aviso de "formato viejo", las sucursales deshabilitadas).

Toda esa información hoy vive en documentación técnica del repo (`CONTEXT.md`, `RETOMAR.md`, `CLAUDE.md`), inaccesible para quien usa la app.

## 2. Objetivo

Un manual de uso consultable **desde la propia aplicación**, con dos partes: cómo se opera la app y cuáles son las reglas y restricciones del cálculo. Debe poder corregirse rápido cuando el negocio cambia una regla.

### Fuera de alcance

- Ayuda contextual por pantalla (implicaría tocar las 20+ páginas, la mayoría blindadas).
- Editor del manual dentro de la app.
- Generación de un PDF como archivo en el servidor (se resuelve con impresión del navegador).
- Cualquier cambio de lógica de cálculo o de las páginas existentes de datos/resultados.

## 3. Decisiones de diseño

| Decisión | Elegido | Motivo |
|---|---|---|
| Audiencia | Liquidador + supervisor lector, en secciones separadas | Un solo documento evita que dos versiones se desincronicen. |
| Acceso | Entrada `📖 Manual` en el sidebar, sección nueva `AYUDA` | Vive dentro de la app, hereda tema y sesión, y funciona igual detrás del proxy `/d/8/`. |
| Fuente del texto | `docs/MANUAL.md` servido por endpoint | Corregir una regla = editar el `.md` y recargar. Sin `npm run build`, sin reinicio del servicio. Versionado en git. |
| Renderizado | Mini-parser Markdown propio | Cero dependencias nuevas en un repo vanilla JS. |
| Perfil 8 (supervisor) | Mismo manual para todos | Nada que ocultar y nada que filtrar: menos código y una sola verdad. Una sección explica el modo solo lectura. |
| Limitaciones conocidas | Documentadas | Son justamente lo que genera consultas al equipo técnico. |

## 4. Arquitectura

Tres piezas nuevas y tres archivos existentes tocados de forma mínima. **Ninguna página blindada se modifica.**

### 4.1 Contenido — `docs/MANUAL.md` (nuevo)

Markdown plano, versionado en git. Única fuente de verdad del texto. Estructura obligatoria:

- `#` una sola vez: el título del manual.
- `##` por cada sección de primer nivel → **cada `##` genera automáticamente una entrada del índice**. Agregar una sección al `.md` la agrega al índice sin tocar código.
- `###` para subsecciones (no aparecen en el índice).

### 4.2 Endpoint — `server/routes/manual.js` (nuevo)

```
GET /api/manual  →  200 { markdown: string, actualizado: string(ISO) }
```

- Middlewares: `authMiddleware` únicamente. **No** monta `attachScope` ni `blockWriteIfSupervisor`: no hay datos de sucursal que filtrar y el router no expone métodos de escritura. Perfil 8 lo consume igual que cualquier otro usuario autenticado.
- Lee el archivo del disco en cada request (`fs/promises.readFile` + `stat` para `actualizado`). **Sin cache**: es lo que permite editar el `.md` y ver el cambio al recargar la página. El costo es despreciable (un archivo de decenas de KB, consultado a mano).
- Ruta del archivo resuelta relativa a `import.meta.url`, no al `cwd` del servicio.
- Si el archivo no existe o no se puede leer: responde **200** con un `markdown` que explica el problema en texto legible (`## Manual no disponible` + la ruta esperada) y `actualizado: null`. Nunca 500 — una página de ayuda caída con un error crudo es peor que una página que explica qué falta.

Registro en `server/index.js`: `app.use('/api/manual', manualRoutes)` junto a los demás routers, antes del `express.static`.

### 4.3 Página — `src/pages/manual.js` (nuevo)

Exporta `renderManual(container, periodo)` siguiendo la convención del repo (recibe el container vacío y escribe `innerHTML`). Ignora `periodo`: el manual no depende del período activo.

**Layout**

```
┌─ Manual de uso ─────────────────────────────────────────┐
│ [🔍 buscar en el manual...]              [🖨 Imprimir]  │
├──────────────────┬──────────────────────────────────────┤
│ ÍNDICE (sticky)  │ contenido renderizado                │
│  1. Qué hace     │                                      │
│  2. Período      │  ## 1. Qué hace la app               │
│  3. Pantallas    │  ...                                 │
│  ...             │                                      │
└──────────────────┴──────────────────────────────────────┘
```

- **Índice**: se arma en runtime a partir de los `##` del markdown. Cada entrada ancla a la sección (`id` slug derivado del título, con desduplicado por sufijo numérico si dos títulos colisionan). Sticky en desktop; arriba del contenido en pantallas angostas.
- **Buscador**: filtra client-side sobre el texto ya renderizado, muestra solo las secciones con coincidencias y resalta los matches. Sin resultados → mensaje explícito ("Sin coincidencias para «x»"), nunca contenido vacío.
- **Botón `🖨 Imprimir / PDF`**: `window.print()`. Un bloque `@media print` oculta sidebar, índice, buscador y el propio botón, expande todo el contenido y fuerza colores de impresión. Cubre el pedido de "llevarse el manual" sin generar archivos.
- **Pie**: fecha de última modificación del `.md` (`actualizado`), para que se vea si el manual quedó viejo.
- **Errores**: fallo de red al pedir `/api/manual` → mensaje en la página con botón "Reintentar". Un 401 lo maneja el `client.js` existente (evento `unauthorized`).

**Mini-parser Markdown** (dentro de `src/pages/manual.js`, ~90 líneas, sin dependencias)

1. Escapa `&`, `<`, `>` sobre todo el texto **antes** de parsear. El `.md` es de confianza (repo, no input de usuario), pero el escape es gratis y elimina la clase de bug entera.
2. Bloque por bloque, en este orden: bloques de código ```` ``` ````, tablas GFM (`| a | b |` + fila separadora), encabezados `#`/`##`/`###`, `---` (regla horizontal), blockquotes `>`, listas `-`/`*` y numeradas, párrafos.
3. Inline dentro de cada bloque: `**negrita**`, `` `código` ``, `*itálica*`.
4. **Regla de robustez**: cualquier construcción que el parser no reconoce se emite como párrafo plano. El parser nunca lanza excepción ni deja la página en blanco por un markdown mal formado.

### 4.4 Archivos existentes tocados

| Archivo | Cambio |
|---|---|
| `server/index.js` | `import manualRoutes` + `app.use('/api/manual', manualRoutes)`. |
| `src/app.js` | `import { renderManual }` + entrada `manual: renderManual` en `ROUTES`. |
| `src/components/sidebar.js` | Sección nueva `{ section: 'AYUDA' }` al final del `MENU` + `{ route: 'manual', icon: '📖', label: 'Manual' }`. |
| `src/styles/components.css` | Clases `.manual-*` (layout, índice, tablas, resaltado de búsqueda, `@media print`), usando las variables CSS existentes para que funcione en claro y oscuro. |
| `CONTEXT.md` | Nota: al cambiar una regla del motor, actualizar `docs/MANUAL.md`. |

## 5. Contenido del manual

### Parte A — Uso de la aplicación

1. **Qué hace y qué no hace**: calcula y liquida comisiones de cajeros, operadores, encargados y supervisores de sucursales Retail y Millón. **No** paga, no emite recibos y no envía nada a sueldos: produce el cálculo y sus exportaciones.
2. **Período activo**: selector del sidebar, formato `YYYY-MM`, se recuerda entre sesiones. Es lo primero que hay que fijar: todas las pantallas leen ese período.
3. **Flujo de una liquidación** (orden correcto, con qué verificar en cada paso):
   1. Revisar datos maestros del período (Sucursales, Montos, Objetivos, Supervisores y sus sucursales asignadas).
   2. **Cálculos → Total → ▶ Ejecutar cálculo**: sincroniza objetivos desde BeClever, recalcula el ranking A/B/C, corre el motor completo (Total, Operadores Retail/Millón, Encargados Retail/Millón, Supervisores) y guarda el resultado.
   3. **Cajeros → botón propio**: va aparte porque recibe los overrides de jornada (full/part-time) que se cargan en esa pantalla.
   4. Leer los resultados por rol y exportar los CSV.
4. **Pantalla por pantalla** — para cada una: qué muestra, qué se puede editar y qué no.
   - DATOS: Sucursales Retail (con toggle Habilitada/Deshabilitada), Sucursales Millón, Montos, Ranking, Objetivos, Ventas, Supervisores (ABM + asignación de sucursales + `usuario_login`).
   - Cálculos: Total, Cajeros, Operadores Retail, Operadores Millón, Encargados Retail, Encargados Millón, Supervisores (resultado).
5. **Exportaciones**: dónde está cada CSV y su formato es-AR (`;`, coma decimal, BOM UTF-8).
6. **Problemas frecuentes y qué hacer**: una pantalla en cero, un resultado que no refleja un cambio de montos, un supervisor sin plaza pagada, el aviso amarillo de formato viejo.

### Parte B — Reglas y restricciones del cálculo

1. **Retail vs Millón**: id < 100 Retail; id ≥ 100 Millón (originación de créditos). Reglas distintas por tipo.
2. **Categoría de sucursal A/B/C** y el ranking que la asigna por período.
3. **Escalones**: E1 = 100%, E2 = 110%, E3 = 126,5% (110% × 1,15). **Tolerancia 4%**: un faltante menor al 4% del umbral cuenta como alcanzado. Aplica en todo el sistema.
4. **Multiplicador de categoría** A = 1,30 · B = 1,15 · C = 1,00, y la regla de que **se aplica una sola vez**: al editar la categoría C en el ABM de Montos, el sistema graba ya multiplicados los valores de B y A.
5. **Cajeros**: comisiona si `VTA/VTATOT ≥ objetivo de participación` (ambos en % directo, con la misma tolerancia). Part-time cobra el 50% redondeado a múltiplos de 1.000. La jornada sale del sistema pero se puede sobreescribir a mano en la pantalla. Los cajeros **nunca** llevan multiplicador de categoría.
6. **Operadores Retail**: indicadores G / O / R; **G es puerta** de O y R (sin G no cobra los otros).
7. **Operadores Millón**: solo efectivo. El objetivo de la sucursal se divide en full-equivalentes (full = 1, part-time = 0,5); el part-time compara su venta × 2 contra ese objetivo y cobra el 50% del monto.
8. **Encargados Retail**: escalón de consumo + participación (indicador G), **componentes independientes**.
9. **Encargados Millón**: solo escalón de efectivo, **sin** participación.
10. **Supervisores** (reglas vigentes desde 2026-07-16):
    - Retail (solo consumo), dos indicadores por sucursal: pesos (`escalón consumo ≥ 1`) y participación (G > −4%).
      - Pesos **y** participación → monto completo de su categoría (A $10.000 · B $9.000 · C $8.000), sin factor.
      - Pesos sin participación → **la mitad**, redondeada a miles (A $5.000 · B $5.000 · C $4.000).
      - Sin pesos → **$0**. Los pesos son condición necesaria.
      - Sin objetivo de participación cargado → no llega a participación.
    - Plus por plaza Retail (plaza = provincia): si **todas** las Retail asignadas de esa provincia llegan a participación (sin importar pesos) → plus = suma de lo efectivamente pagado por esas sucursales × 0,5, redondeado a miles. Si una falla, no hay plus.
    - Millón (solo efectivo): no paga por sucursal. Si **todas** las Millón asignadas de la provincia llegaron por efectivo → la plaza paga **$23.000 una sola vez**.
    - Retail y Millón son **plazas separadas** aunque compartan provincia.
11. **Foto congelada de montos por período**: la primera vez que se calcula un período se guarda una foto de los montos vigentes en ese momento. Reprocesar ese mismo período **siempre** usa esa foto, sin importar qué se edite después en el ABM de Montos. El ABM sigue editando el valor vivo, que se usará para períodos nuevos.
12. **Sucursales deshabilitadas**: quedan fuera del cálculo y ocultas en las pantallas; los resultados ya guardados las conservan hasta recalcular.
13. **Usuarios supervisores (perfil 8)**: ven el tablero completo pero **solo lectura** — sin controles de edición ni botones de cálculo — y solo con los datos de sus sucursales asignadas. En el resultado de Supervisores ven únicamente su propio registro.

### Parte C — Limitaciones conocidas

1. **Cajeros no se recalcula con el botón de Total** — necesita los overrides de jornada que se cargan en su pantalla.
2. **Descongelar un período** no tiene interfaz: es deliberado. Si un período se calculó antes de terminar de cargar los montos correctos, hay que pedirle al equipo técnico que borre su foto para que el próximo cálculo tome los valores nuevos.
3. **Aviso "cálculo en formato viejo"** en Supervisores: el resultado guardado se generó con reglas anteriores. Se resuelve re-ejecutando el cálculo del período desde Total.
4. **E1 en ámbar** puede mostrarse en verde en períodos que no se recalcularon con la versión actual.
5. **Operadores Retail** reconstruye el monto desde la fila de categoría C multiplicada, en lugar de leer las filas A/B cargadas en Montos. Es una inconsistencia conocida frente al resto del motor; puede dar diferencias respecto de lo esperado en sucursales A y B.

## 6. Errores y casos borde

| Caso | Comportamiento |
|---|---|
| `docs/MANUAL.md` ausente o ilegible | 200 con markdown explicativo. La página muestra el mensaje, no un error crudo. |
| Fallo de red en `GET /api/manual` | Mensaje en la página + botón "Reintentar". |
| Token vencido (401) | Lo maneja `client.js`: evento `unauthorized` → pantalla de login. |
| Markdown mal formado | El bloque no reconocido cae a párrafo plano. La página nunca queda en blanco. |
| Dos secciones `##` con el mismo título | El slug del ancla se desduplica con sufijo numérico. |
| Búsqueda sin coincidencias | Mensaje explícito, no contenido vacío. |
| Perfil 8 | Mismo contenido; el manual explica el modo solo lectura. |

## 7. Verificación

No se agregan tests automatizados: el repo solo tiene los de `calcEngine.supervisores` y esta feature no toca el motor. Verificación manual, con evidencia registrada:

1. `GET /api/manual` con token de perfil normal → 200 con `markdown` no vacío.
2. `GET /api/manual` con token de perfil 8 → 200, mismo contenido (sin 403).
3. `GET /api/manual` con `docs/MANUAL.md` renombrado temporalmente → 200 con el markdown de "no disponible".
4. En la página: índice completo con todos los `##`, los anclajes navegan, el buscador filtra y resalta, la vista previa de impresión sale sin sidebar ni índice.
5. Claro y oscuro: contraste correcto en texto, tablas y bloques de código.
6. Editar una línea del `.md` y recargar la página → el cambio se ve **sin** `npm run build` ni reinicio del servicio.
7. `npm run build` + `Restart-Service dashcomisionesindo.exe` + smoke en `http://localhost:3011` y por el proxy `http://10.0.0.118/d/8/`.
8. Sin regresión: el resto del sidebar navega igual y ninguna página existente cambió de comportamiento.

## 8. Riesgo principal

El manual se desactualiza cuando el negocio vuelve a cambiar una regla (ya pasó dos veces en julio con Supervisores). Mitigaciones: el `.md` se corrige sin build ni deploy, la página muestra la fecha de última modificación, y `CONTEXT.md` queda con la nota de actualizar `docs/MANUAL.md` junto con cualquier cambio del motor.
