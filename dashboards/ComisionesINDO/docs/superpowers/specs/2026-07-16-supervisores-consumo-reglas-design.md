# Spec — Supervisores: reglas nuevas del componente consumo (Retail)

**Fecha**: 2026-07-16
**Módulo**: ComisionesINDO — Supervisores (`calcularSupervisores`)
**Alcance**: solo el componente CONSUMO (sucursales Retail, id < 100). El componente EFECTIVO (Millón) NO se toca.

## 1. Contexto

Hasta hoy (reglas 2026-07-14) el pago por sucursal Retail dependía únicamente de "llegar a los pesos" (`escalon_consumo >= 1`): si llegaba, pagaba el monto ABM completo de su categoría; el plus de plaza exigía que TODAS las Retail de la provincia llegaran por escalón.

El negocio cambió la regla (2026-07-16): ahora intervienen DOS indicadores por sucursal — los **pesos** (escalón consumo) y la **participación** (indicador G, el mismo de Encargados) — y el plus de plaza pasa a depender SOLO de la participación.

## 2. Reglas de negocio (confirmadas con el usuario 2026-07-16)

### 2.1 Indicadores por sucursal Retail

- **Pesos**: `llega_pesos = escalon_consumo >= 1` (el escalón ya incluye la tolerancia 4%: `ratio > umbral × 0.96`, vía `getEscalon`).
- **Participación**: idéntica a Encargados Retail:
  `G = (vta_vta_tot/100 − objConsumo.participacion) / objConsumo.participacion`
  `llega_particip = G > −0.04` (tolerancia 4%). Si la sucursal no tiene objetivo de participación (`participacion <= 0` o sin fila), `G = −1` → no llega (mismo criterio que Encargados).

La tolerancia es la del 4% de siempre (el "0.4%" mencionado fue confirmado como la tolerancia estándar 0.04).

### 2.2 Pago por sucursal (consumo)

| ¿Pesos? | ¿Participación? | Paga |
|---|---|---|
| Sí | Sí | Monto ABM `consumo`/`por_sucursal` de su categoría, completo (A=10.000 / B=9.000 / C=8.000), redondeado a miles |
| Sí | No | La MITAD del monto ABM, redondeada a miles con `Math.round` (A→5.000, B→5.000, C→4.000) |
| No | (cualquiera) | $0 — los pesos son condición necesaria |

Los montos ABM ya están guardados por categoría en `tbl_CoVenAppINDO_MontosSupervisor`: NO se multiplica por `mult` (regla de oro vigente).

### 2.3 Plus de plaza Retail (consumo)

- Plaza = provincia (Retail y Millón siguen siendo plazas SEPARADAS).
- **Condición**: TODAS las sucursales Retail asignadas de la provincia llegan a **participación** (`llega_particip`), sin importar los pesos.
- **Monto**: `(suma de lo efectivamente pagado por sucursal en esa plaza) × factor_plaza (0.5)`, redondeado a miles con `Math.round`. La suma incluye mitades y ceros (una sucursal puede cumplir participación y cobrar $0 por no llegar a los pesos).
- Si al menos una sucursal no llega a participación, la plaza no paga plus.

### 2.4 Millón (sin cambios)

Sigue igual que 2026-07-14: no paga por sucursal; si TODAS las Millón asignadas de la provincia llegan por efectivo (`escalon_efectivo >= 1`) la plaza paga UNA vez el monto ABM `efectivo`/`por_plaza` ($23.000), sin factor.

## 3. Diseño técnico

### 3.1 Motor — `server/services/calcEngine.js` → `calcularSupervisores()`

- Recibe en `ctx` (además de lo actual): `datosConsumo` y `objConsumo` — **ya vienen** en el ctx que arma `cargarContexto()` en `server/routes/calculo.js` (los usa `calcularEncargados`); no hay cambios en la carga de contexto.
- Para cada asignación Retail: calcular `G` localmente (mismas 4 líneas que `calcularEncargados`; NO se extrae helper compartido para no tocar el módulo Encargados, que está blindado).
- `subtotal` según la tabla 2.2; `totalPorSucursales` y `plaza.suma` acumulan lo efectivamente pagado.
- Plaza Retail: `cumplida = plaza.llegadasParticip.every(Boolean)` (se acumula `llega_particip` en vez de `llego` por escalón). Cálculo del plus sin cambios de fórmula.
- Detalle por sucursal (`sucDetails`), filas Retail: se agregan `indicador_g` (redondeado a 4 decimales), `llega_pesos`, `llega_particip`, `pago: 'completo' | 'mitad' | 'nada'`. Se conserva `escalon`, `llego` (ahora = `llega_pesos` en Retail) y `monto_por_suc` para compatibilidad con la página. Filas Millón: sin cambios (`llego` sigue siendo por `escalon_efectivo`).
- Actualizar el comentario de cabecera de la función con las reglas nuevas fechadas 2026-07-16.

### 3.2 Frontend — `src/pages/resultado-supervisores.js`

- **Tabla de Sucursales (detalle expandible)**: para filas Retail, mostrar las dos condiciones con ✓/✗ — "¿Pesos?" (escalón) y "¿Particip.?" (con el valor de G formateado en %) — y el tipo de pago (Completo / Mitad / —). Filas Millón siguen mostrando escalón efectivo / ¿llegó? como hoy.
- **Tabla de Plazas**: en el bloque Retail, "¿Cumple?" pasa a reflejar la condición de participación. Encabezado o tooltip aclara "participación en todas".
- **Formato viejo**: si el cálculo guardado no tiene `llega_particip` en las filas retail del detalle, mostrar el aviso amarillo estándar "los montos corresponden a reglas anteriores — re-ejecutá el cálculo del período" (mismo patrón que Encargados/Operadores). La página no debe romperse con historiales viejos.

### 3.3 Sin cambios

- Tablas SQL (el resultado vive como JSON en `tbl_CoVenAppINDO_CalculoHistorial`).
- ABM MontosSupervisor, endpoints (`GET /api/calculo/supervisores`, `POST /calculo/ejecutar`), sidebar.
- Millón, Encargados, Operadores, Cajeros, Total (blindados).

## 4. Verificación

1. `npm run build` + `Restart-Service dashcomisionesindo.exe` (recordar: el server sirve `dist/`, sin build no se ve nada).
2. Re-ejecutar el cálculo 2026-06 desde la página Total (portal `/d/8/`).
3. Revisar Eric Vidable y Josefina Rossini en Resultado Supervisores: los totales van a cambiar respecto de $219.000 / $118.000 (referencia con reglas viejas). El usuario valida contra la planilla `comisiones 03-2026 REFINADA.xlsx`.
4. Confirmar que un historial viejo (sin recalcular) muestra el aviso de formato y no rompe.
5. Confirmar que el componente Millón dio idéntico a antes del cambio (no se tocó).

## 5. Documentación al cierre

- Actualizar `RETOMAR.md` y `CONTEXT.md` con las reglas 2026-07-16.
- Actualizar la memoria del proyecto.
- Supervisores queda SIN blindar hasta que el usuario valide contra la planilla.
