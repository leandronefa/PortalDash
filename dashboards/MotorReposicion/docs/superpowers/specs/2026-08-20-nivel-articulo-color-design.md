# Bajar el nivel de listado/control de artículo+color+talle a artículo+color

**Fecha:** 2026-08-20
**Estado:** Aprobado por Claudia, pendiente de implementar.

## Contexto

Hoy, en el frontend (`public/tablero_motor_quiebre.html`), cada combinación real vendible es un
`sku = artículo-COLOR-talle` (ver comentario en `server.js` sobre `Sku`). Las pantallas que listan
artículos usan ese nivel de forma inconsistente:

- **Atención Prioritaria, Ver quiebres, Ver riesgos**: cada fila es un `sku` (artículo+color+**talle**),
  agrupado por `agruparPorSku()` (suma sucursales, promedia velocidad, toma el mínimo de días hasta
  quiebre). Un mismo color con 5 tallas rotas hoy aparece como 5 filas separadas.
- **Reposición**: cada tarjeta es un **artículo completo** (todos los colores mezclados adentro,
  agrupados por `modelo` en `renderReposicion`). Al expandir se ven todos los colores juntos.
- **Favoritos** (catálogo): igual que Reposición, una tarjeta por artículo completo
  (`renderCatalogoFavoritos`, agrupado por `modelo`).
- **Edición de recompra**: consolida, para un artículo agregado desde Reposición, **todos sus
  colores** en una sola pantalla de edición (`abrirEdicionRecompra(modelo, ...)`).

Ninguna pantalla hoy lista o controla exactamente a nivel artículo+color. El detalle (la grilla de
talles × sucursales, dentro del modal de Cobertura o dentro de Reposición/Edición expandida) ya
existe y funciona bien — el problema es solo el nivel de la fila/tarjeta de arriba.

## Objetivo

Unificar las 5 pantallas (Atención Prioritaria, Ver quiebres, Ver riesgos, Favoritos, Reposición)
para que cada fila/tarjeta sea **un artículo+color**, nunca más fino (talle) ni más grueso
(artículo completo con varios colores mezclados). El detalle interno (grilla de talles) no cambia
de comportamiento, solo de punto de entrada.

## Diseño aprobado

### 1. Nueva función de agrupación

`agruparPorArticuloColor(items)` — paralela a la `agruparPorSku()` existente (que se deja intacta,
por si algo más la sigue necesitando), pero agrupa por `modelo+color` en vez de por `sku` completo,
fusionando todas las tallas de ese color. Se usa en Atención Prioritaria, Ver quiebres y Ver
riesgos (reemplazando el uso de `agruparPorSku` ahí). Reposición y Favoritos ya tienen su propio
agrupador por `modelo` (`porModelo` inline en cada `render*`) — se cambia la clave de agrupación de
esos dos de `modelo` a `modelo+color`.

### 2. Cómo se combinan los campos al fusionar tallas de un mismo color

| Campo | Antes (por talla) | Ahora (por color) |
|---|---|---|
| Sucursales | cuenta filas talla×sucursal | **sucursales distintas** (deduplicadas) donde ese color está roto — no se suma por talla |
| Margen perdido/día (`impacto`) | suma | sigue sumando |
| Días mín. hasta quiebre (`diasVida`) | mínimo | sigue siendo el mínimo, ahora sobre más filas |
| Velocidad (`vd`) | promedio simple de las barras (talla×sucursal) | **suma de `vd` de todas las barras fusionadas ÷ cantidad de sucursales distintas** — equivale a la velocidad promedio por sucursal afectada, ya no se diluye si una sucursal aporta varias tallas rotas |
| SKU de la curva en quiebre/riesgo (`_curvaRota`/`_curvaTotal`) | de todo el artículo (todos los colores) | **sin cambio** — sigue siendo del artículo completo, da contexto de qué tan roto está en general |
| Tallas afectadas | implícita (una sola, la de la fila) | **campo nuevo**: lista de tallas de ese color en quiebre/riesgo, para no perder el detalle al fusionar |

### 3. Click-through (Atención Prioritaria / Ver quiebres / Ver riesgos)

Al hacer clic en una fila artículo+color se abre el **mismo modal de Cobertura de siempre**, con
todos los colores del artículo (sin cambios ahí) — pero:
- Hace scroll automático directo al bloque de ESE color.
- Resalta **todas** las columnas de talle de ese color que están en quiebre/riesgo (antes resaltaba
  una sola columna; ahora puede ser más de una, ya que la fila que la trajo puede agrupar varias).

### 4. Reposición

Cada tarjeta pasa a representar un artículo+color (antes: artículo completo). El total "unidades a
comprar" que muestra es solo de ese color. Al expandir, la grilla muestra solo los talles de ese
color (antes mostraba todos los colores apilados dentro de una tarjeta).

### 5. Edición de recompra

✏️ en una tarjeta de Reposición abre Edición de recompra **solo para ese color** (antes: todos los
colores del artículo). Para editar dos colores del mismo artículo, se agregan por separado desde
sus propias tarjetas — mismo patrón que ya existe hoy para acumular artículos distintos
(`edicionModelos`). La clave interna de "artículos en edición" pasa de `modelo` a `modelo+color`.

### 6. Favoritos

El catálogo de Favoritos separa sus tarjetas por color (antes: una por artículo completo). Marcar
⭐ en una fila de color sigue marcando **todo el artículo** como favorito (no se introduce un nivel
de favorito "por color" — se mantiene el modelo existente de `favModelo`/`favSku`, sin cambios).

### 6b. Estrella de favorito por SKU exacto en las listas (hallazgo durante la planificación)

Además de la estrella de "artículo completo" (`favModelo`), hoy `filaBarraHtml` (la fila que
comparten Atención Prioritaria, Ver quiebres y Ver riesgos) tiene una segunda estrella que marca
favorito a nivel **SKU exacto** (artículo+color+talla, vía `favSku`) — mecanismo separado, con su
propia persistencia y migración de formato (`FAV_SKU_FORMAT_VERSION`). Al fusionar la fila en
artículo+color, ya no hay una talla única a la que apuntar.

**Decisión:** esa estrella pasa a marcar `favModelo` (todo el artículo), igual que en Favoritos y
Reposición — una sola granularidad de favorito en toda la app. `favSku` deja de recibir marcas
nuevas desde estas pantallas (el Set, su persistencia y su migración de formato se dejan intactos
en el código — datos viejos guardados no se tocan ni se borran, simplemente ninguna pantalla los
sigue generando de acá en adelante).

### 7. Detalles menores

- El "Top 10" de Atención Prioritaria sigue limitando por **artículo distinto** (`top10PorArticulo`,
  sin cambios) — no por artículo+color, para que un solo artículo no ocupe varios de los 10 lugares
  aunque tenga muchos colores rotos.
- La exportación a CSV (`exportarQuiebresCSV`/`exportarRiesgosCSV`) no cambia — ya exporta el
  detalle real SKU×sucursal, no las filas agrupadas que se ven en pantalla.

## No-objetivos (fuera de alcance de este cambio)

- No se toca el backend (`server.js`) ni el precálculo nocturno — este cambio vive enteramente en
  el frontend, sobre datos que el backend ya entrega a nivel SKU×sucursal.
- No se introduce un nivel de favorito "por color" (ver punto 6).
- No se cambia la exportación a CSV.
- No se cambia el modal de Cobertura en sí (su grilla, sus bloques por color) — solo cómo se llega
  a él y qué se resalta al llegar.

## Riesgos / puntos de atención para la implementación

- Varias piezas de estado global usan `modelo` como clave hoy y van a necesitar pasar a
  `modelo+color`: `repoExpandido`, `volverACobertura`, `edicionModelos`, `edicionOverrides`,
  `desgloseSugerido`, `cacheArticuloCompleto` (este último puede seguir siendo por `modelo` ya que
  cachea el artículo completo, no hace falta partirlo). Revisar cada uso concreto durante la
  implementación en vez de asumir.
- El campo nuevo "tallas afectadas" necesita definirse en el layout de la fila (`filaBarraHtml`,
  `PC_GRID_COLS`) sin romper el alineado de columnas existente.
- Las pruebas deben hacerse contra datos reales (artículos con varios colores y varias tallas
  rotas simultáneamente), no solo con el simulador — verificar sucursales dedupeadas y velocidad
  ponderada con un caso real antes de dar por cerrado.
