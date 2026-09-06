---
name: fmway-po
version: 1.0.0
description: Usar para convertir una necesidad cruda, una idea o un pedido de un cliente en tickets listos para desarrollo antes de arrancar cualquier flujo de desarrollo — validando la factibilidad contra el código real, mapeando los repos afectados y los contratos entre repos, y cerrando las preguntas abiertas de entrada. Se activa con "refiná este ticket", "escribime los requisitos de X", "¿es factible X?", "preparame los tickets para esto", o cuando un pedido abarca varios repositorios. No se activa para tickets ya bien especificados, para reportes de defectos (usar fmway-bugs) ni cuando el usuario pide empezar a construir ya.
---

# Proceso de Product Ownership

Flujo guiado por gates para convertir una necesidad cruda en uno o más **tickets listos para
desarrollo**, cada uno validado contra el código real: qué es posible, qué no, qué toca y qué
necesita todavía una decisión humana. El objetivo es que las preguntas abiertas se respondan *antes*
de que arranque `fmway-dev` o `fmway-bugs`, no durante.

Este flujo va **aguas arriba** de los flujos de desarrollo:

```
necesidad cruda ──▶ fmway-po ──▶ TICKET.md (Listo) ──▶ fmway-dev (su Fase 0 lo consume)
                                                      └▶ fmway-bugs (para ítems con forma de defecto)
```

Es un **flujo analítico**. Igual que `fmway-docs` y las evaluaciones, **no** mantiene un
`.ways/state.json`. Escribe documentos de requisitos, nunca código. La salida vive en
`docs/requirements/{slug}/TICKET.md` — una carpeta por ticket, y el slug del ticket está pensado para
convertirse en el slug del PRD cuando arranque el desarrollo.

Mantenelo **a la escala de la necesidad**. Un cambio chico en un solo repo necesita una pasada corta
de factibilidad y un ticket, no un proyecto de descubrimiento. La profundidad sigue a la ambigüedad y
al radio de impacto.

---

## Fase 0 — Relevamiento y pasada de factibilidad (solo lectura)

**Objetivo:** entender la necesidad y el estado real del código lo suficiente como para decir qué es
posible, qué no y qué tiene que decidir una persona. En esta fase no se escribe ningún archivo.

### Relevamiento

1. Capturá la necesidad en términos de producto:
   - qué problema se resuelve y quién lo sufre
   - qué resultado espera el cliente o el referente
   - restricciones y no-objetivos ya conocidos
   - cómo se mediría el éxito
2. Leé el contexto de producto existente: `PRD.md`, `docs/`, tickets previos en
   `docs/requirements/` y PRDs relacionados en `docs/prds/`.

### Identificar los repositorios afectados

3. Preguntale al usuario qué repositorios entran en alcance para este producto, o leé la lista del
   `CLAUDE.md` del repo central (una sección `repos:`) si existe. Para productos de un solo repo es
   trivial; para productos multi-repo (por ejemplo una app web + API + workers), listá cada repo que
   la necesidad pueda tocar antes de relevar.

### Pasada de factibilidad (por repo, anclada en el código)

4. Relevá cada repo en alcance **en modo solo lectura**: comportamiento actual relacionado con la
   necesidad, módulos probablemente afectados, puntos de entrada, integraciones y patrones existentes
   a preservar.
5. Registrá el panorama de factibilidad, trazable a `repo:ruta:línea` — sin inventar:
   - qué soporta hoy el sistema
   - qué es posible con un esfuerzo razonable
   - qué **no** es posible sin cambios mayores (y por qué)
   - qué contratos entre repos cambian: APIs, eventos, esquemas, paquetes compartidos — y las
     restricciones de orden entre repos que eso implica
6. Juntá cada incógnita como **pregunta abierta** explícita, nunca como supuesto. Etiquetá cada una:
   la necesita responder el usuario o el referente ahora, o se puede resolver relevando más.

### Criterios de salida de la Fase 0

Antes del Gate 1, Claude tiene que poder enunciar:
- el problema y el resultado esperado, en términos de producto
- los repositorios y módulos probablemente afectados
- el panorama de factibilidad: soportado hoy / posible / no posible sin cambios mayores
- los cambios de contrato entre repos y sus restricciones de orden (necesidades multi-repo)
- las preguntas abiertas, cada una etiquetada según quién puede responderla

No infieras comportamiento a partir de un nombre ni de una afirmación del README. Si el código no lo
deja claro, es una pregunta abierta, no un supuesto.

---

## Gate 1 — Alcance y partición en tickets

Proponé, antes de escribir ningún ticket:

```markdown
## Alcance y partición propuestos

- **Necesidad:** {reformulación en una línea}
- **Dentro / fuera de alcance:** {explícito}
- **Partición en tickets:** {uno o varios — por repo, por incremento, o feature vs bug —
  cada uno entregable de forma independiente, con sus slugs y su orden de dependencia}
- **Resumen de factibilidad:** {soportado hoy / posible / no posible sin cambios mayores}
- **Preguntas abiertas que necesito que respondas ahora:** {lista}
- **Preguntas abiertas que todavía puedo resolver relevando:** {lista}
```

- Preguntá: **"Este es el alcance y la partición en tickets propuestos para {necesidad}. Confirmalo
  antes de que redacte los tickets."**
- **Frená. No redactes tickets hasta que el usuario confirme el alcance y la partición.**

---

## Configuración del aislamiento (después del Gate 1)

Antes de escribir cualquier archivo, preguntale al usuario cómo quiere aislar el trabajo:

> ¿Querés que trabaje en una rama nueva del checkout actual, o que cree un worktree de git aparte?

Usá la respuesta tal cual. Frená después de preguntar; no crees ni rama ni worktree hasta que el
usuario elija.

Si el checkout actual tiene cambios sin commitear, frená y preguntá antes de cambiar de rama o crear
un worktree.

Los tickets se escriben en el **repo central** del producto (el que es dueño de `docs/`), aun cuando
la necesidad abarque varios repositorios: los demás repos solo se leen durante el relevamiento.

### Opción A — Rama en el checkout actual

```bash
git switch develop && git pull --ff-only && git switch -c po/{slug}
```

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin develop && mkdir -p .worktrees && git worktree add .worktrees/po-{slug} -b po/{slug} origin/develop
```

Acá `{slug}` es el slug de la necesidad (por ejemplo `po/exportar-contactos`). Toda la salida se
escribe dentro de la ubicación de trabajo elegida. Nunca escribas archivos directamente en `develop`
o `main`.

---

## Fase 2 — Redactar los tickets

**Objetivo:** un `docs/requirements/{ticket-slug}/TICKET.md` por cada ticket de la partición
aprobada.

**Formato del slug:** `{id-con-ceros}-{nombre-en-kebab-case}` (por ejemplo
`004-api-exportar-contactos`). Los IDs son secuenciales entre `docs/requirements/` **y**
`docs/prds/` — mirá ambos para encontrar el próximo, porque el slug del ticket se convierte en el
slug del PRD cuando el desarrollo lo toma.

### Estructura de TICKET.md

```markdown
# Ticket — {título}

## Estado
Borrador | En revisión | Listo | Entregado

## Problema / resultado
Qué dolor, para quién, qué cambia cuando se entrega.

## Alcance
Dentro / fuera. No-objetivos explícitos.

## Notas de factibilidad
Qué soporta ya el código, qué requiere esto, qué no es posible sin cambios mayores — cada punto
trazable a `repo:ruta:línea`.

## Repositorios y módulos afectados
| Repo | Módulos tocados | Naturaleza del cambio (código / contrato / configuración) |
|------|-----------------|----------------------------------------------------------|

## Dependencias entre repos
Contratos de API, eventos o esquemas que cambian, y las restricciones de orden entre tickets o
repos. "Ninguna" para tickets de un solo repo.

## Criterios de aceptación
Numerados, concretos, verificables. Se convierten en los requisitos funcionales del PRD.

## Riesgos y supuestos
Etiquetados de forma explícita; todo supuesto tiene que confirmarse o promoverse a pregunta abierta.

## Preguntas abiertas
Tiene que quedar vacía —o cada ítem restante marcado explícitamente como "diferido, aceptado por
{quién}"— antes de que el ticket pueda pasar a Listo.

## Flujo sugerido
fmway-dev | fmway-bugs (con el slug sugerido)
```

### Reglas de redacción (no negociables)

- **Trazable.** Toda afirmación de factibilidad cita `repo:ruta:línea`. Si no se puede citar, es una
  pregunta abierta.
- **Verificable.** Todo criterio de aceptación es lo bastante concreto como para convertirse en un
  test.
- **Sin invención.** No agregues requisitos, alcance ni criterios de aceptación que el usuario no
  haya enunciado o confirmado en el Gate 1.
- **Multi-repo explícito.** Para necesidades que abarcan varios repos, los cambios de contrato y las
  restricciones de orden van en el ticket, no en la cabeza de Claude.

---

## Gate 2 — Revisión de la Definición de Listo

Para cada ticket, presentá el **checklist de Definición de Listo**:

- [ ] Problema y resultado enunciados en términos de producto
- [ ] Alcance y no-objetivos explícitos
- [ ] Factibilidad validada contra el código real (trazable)
- [ ] Repos y módulos afectados mapeados; contratos entre repos identificados
- [ ] Criterios de aceptación concretos y verificables
- [ ] Preguntas abiertas resueltas, o diferidas explícitamente con la aceptación del usuario

- Decí: **"Ticket(s) listo(s) en `docs/requirements/{slug}/`. Incluí el checklist de Definición de
  Listo para tu revisión."**
- **Frená. Esperá la revisión del usuario.**

Un ticket no sale de este gate como `Listo` mientras su sección de Preguntas abiertas tenga ítems sin
resolver. Iterá acá —resolver una pregunta puede cambiar la partición, las notas de factibilidad o
los criterios de aceptación— hasta que el usuario marque cada ticket como Listo o acepte
explícitamente los ítems diferidos.

---

## Fase 3 — Entrega

Cuando el usuario aprueba en el Gate 2:

- Actualizá el estado de cada ticket a `Listo`.
- **Sincronización con el gestor de tickets (opcional, solo a pedido del usuario):** si el usuario lo
  pide explícitamente (por ejemplo "creá los tickets en Jira", "sincronizá esto con Jira"), creá o
  actualizá las incidencias desde el TICKET.md con las herramientas disponibles, y registrá la clave
  de la incidencia en el ticket. Nunca crees, actualices ni transiciones incidencias sin ese pedido
  explícito — la misma filosofía que aplica `fmway-pr` con la persistencia en git.
- Señalá el próximo paso: para cada ticket, su **Flujo sugerido**. Cuando arranque `fmway-dev` (o
  `fmway-bugs`), su Fase 0 lee el TICKET.md y toma los criterios de aceptación como los requisitos
  funcionales iniciales.

---

## Gate 3 — PR

Sugerí invocar `fmway-pr` para pushear `po/{slug}` y abrir el PR a `develop`. No pushees ni abras el
PR vos.

```
Título: po({slug}): {nombre corto de la necesidad}
```

El cuerpo del PR tiene que incluir:
- **Necesidad:** el problema y el resultado esperado.
- **Tickets:** la lista de archivos `docs/requirements/{slug}/TICKET.md` y su estado.
- **Fundamento de la partición:** por qué esta partición y cuál es el orden de dependencia.
- **Preguntas abiertas:** cuántas se resolvieron y qué ítems quedaron diferidos, con quién los aceptó.

Una vez abierto, compartí la URL. **Frená. No mergees hasta que el usuario apruebe.**

---

## Referencia rápida — gates

| Gate | Disparador | Qué decir | Bloquea hasta |
|------|-----------|-----------|---------------|
| 1 | Alcance y partición propuestos | "Este es el alcance y la partición para {necesidad}. Confirmalo." | El usuario confirma |
| 2 | Tickets redactados | "Ticket(s) listo(s) en `docs/requirements/{slug}/`, con el checklist de Definición de Listo." | Revisión del usuario |
| 3 | Tickets en Listo | Sugerir `fmway-pr` para el PR `po/{slug} → develop`; compartir la URL | El usuario aprueba el PR |

---

## Qué se produce

```
docs/requirements/{ticket-slug}/
  TICKET.md   # Problema, alcance, factibilidad, mapa de repos, criterios de aceptación, preguntas abiertas
```

---

## Qué NO hacer

- No redactes tickets antes de que el Gate 1 confirme el alcance y la partición.
- No marques un ticket como `Listo` con preguntas abiertas sin resolver: resolvelas o conseguí la
  aceptación explícita del usuario para diferirlas.
- No hagas afirmaciones de factibilidad no trazables: citá `repo:ruta:línea` o registrá una pregunta
  abierta.
- No inventes requisitos, alcance ni criterios de aceptación que el usuario no haya confirmado.
- No crees, actualices ni transiciones incidencias en el gestor de tickets salvo que el usuario lo
  pida explícitamente en ese momento.
- No escribas código, PRDs ni planes acá: este flujo termina donde empiezan `fmway-dev` y
  `fmway-bugs`.
- No escribas en los repositorios relevados: durante el relevamiento son de solo lectura; los tickets
  viven en el repo central.
- No escribas directamente en `develop` o `main` — usá `po/{slug}`.
