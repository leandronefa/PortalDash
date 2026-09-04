---
name: fmway-dev
version: 1.0.0
description: Usar para trabajo de features de producto que necesite explícitamente descubrimiento, un PRD, planificación de la implementación con gates o aprobación del referente antes de tocar código. Se activa con cambios de funcionalidad ambiguos, transversales, pedidos por un cliente o de alto riesgo. No se activa para ediciones chicas y directas de código, refactors de rutina, corrección de bugs, revisiones de seguridad, trabajo solo de documentación ni preguntas sobre código existente.
---

# Proceso de desarrollo

Flujo estructurado, guiado por gates, para entregar features nuevas sin adivinar. Arranca por el
descubrimiento y el relevamiento, y avanza por PRD, planificación, implementación, validación y PRs,
con aprobación explícita del usuario en cada gate crítico.

---

## Fase 0 — Descubrimiento y relevamiento (antes que nada)

Antes de escribir una sola línea de código o de documentación del proyecto, juntá suficiente
contexto de producto y de código como para no redactar el PRD equivocado.

### Checklist de descubrimiento

1. Leé `PRD.md` (raíz del proyecto).
2. Leé toda la documentación existente en `docs/` y todos los PRDs en `docs/prds/`.
   Si existe un ticket refinado para este pedido en `docs/requirements/{slug}/TICKET.md`
   (producido por `fmway-po`), leelo primero: tomá sus criterios de aceptación como los requisitos
   funcionales iniciales del PRD, y *verificá* —en lugar de volver a derivar— sus notas de
   factibilidad y su mapa de módulos afectados.
3. Aclará el pedido en términos de producto:
   - qué cambio se está pidiendo
   - para quién es
   - qué espera el cliente o el referente
   - cómo se ve el éxito
   - qué restricciones o no-objetivos ya existen
4. Descubrí el contexto del código:
   - comportamiento actual relacionado con el pedido
   - módulos, puntos de entrada, integraciones y tests que probablemente se vean afectados
   - patrones existentes que hay que preservar
   - conflictos, superposiciones o dependencias con funcionalidad existente
5. Ajustá la profundidad del descubrimiento al pedido:
   - para cambios chicos y bien especificados, mantené la pasada liviana
   - para pedidos ambiguos, transversales o sensibles para el cliente, profundizá antes de redactar
     nada
6. Si quedan incógnitas críticas, hacé preguntas concretas antes de pasar al PRD.

### Criterios de salida de la Fase 0

Antes de la Fase 1, Claude tiene que poder enunciar:
- el problema que se resuelve y el cambio pedido
- para quién es el cambio y qué espera el cliente o referente
- los criterios de éxito o la definición de terminado que se conocen hasta ahora
- qué documentos, módulos, flujos o integraciones se ven afectados
- qué supuestos se están asumiendo
- qué preguntas abiertas todavía necesitan respuesta del usuario

Si Claude no puede responder esos puntos con confianza razonable, todavía no redactes el PRD. Primero
preguntá.

---

## Configuración del aislamiento (inmediatamente después de la Fase 0)

**Antes de escribir cualquier archivo**, preguntale al usuario cómo quiere aislar el trabajo:

> ¿Querés que trabaje en una rama nueva del checkout actual, o que cree un worktree de git aparte?

Usá la respuesta tal cual. Frená después de preguntar; no crees ni rama ni worktree hasta
que el usuario elija.

Si el checkout actual tiene cambios sin commitear, frená y preguntá antes de cambiar de rama o crear
un worktree.

### Opción A — Rama en el checkout actual

```bash
git switch develop && git pull --ff-only && git switch -c feat/{slug}
```

Todo el trabajo posterior —PRD, plan, código, documentación, commits— ocurre en esa rama del checkout
actual. Nunca escribas archivos directamente en `develop` o `main`.

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin develop && mkdir -p .worktrees && git worktree add .worktrees/{slug} -b feat/{slug} origin/develop
```

Todo el trabajo posterior ocurre exclusivamente dentro de ese worktree. Nunca escribas archivos
directamente en `develop` o `main`.

---

## Seguimiento de estado — `.ways/state.json`

Seguí el **contrato de estado ways/v1alpha1** — el formato canónico de `.ways/state.json`
(`schemaVersion` 2), que viaja como la **regla siempre activa `state-contract`** que `ways add`
coloca en el proyecto, así que ya está en tu contexto (no hay ninguna ruta que seguir). Su origen en
este repo, para quien lo mantiene, es `ways/rulepacks/state-contract/`. No copies ni inventes un
esquema dentro de esta skill.

Valores propios de este flujo:
- `flow`: `feature`
- `way`: `fmway/dev` · `discipline`: `development` (opcionalmente `wayVersion` desde el manifiesto)
- Patrón de rama: `feat/{slug}`
- `phase` inicial: `discovery`
- `isolationType`: `branch` o `worktree`, según la elección de aislamiento de la Fase 0
- Documentos: `docs/prds/{slug}/PRD.md`, `docs/prds/{slug}/PLAN.md`, `docs/prds/{slug}/TESTING.md`
- Gates: `prd`, `plan`, `testing`, `pr-develop`, `pr-main`

Al inicio de la sesión, leé `.ways/state.json` si existe. Si su `branch` coincide con la rama
`feat/{slug}` actual, informá la fase actual, el próximo paso y los gates pendientes, y retomá desde
ese estado. Si no existe, o existe pero su `branch` no coincide (archivo obsoleto heredado de una
feature ya mergeada), arrancá en la Fase 0 y creá o sobrescribí el archivo en `.ways/state.json`
justo después de configurar el aislamiento elegido. En cada transición actualizá también `lastPhase`
(la fase que estás dejando).

**Puntos de actualización (fase → qué escribir):**

| Cuándo | `phase` | Documentos / gates / steps |
|--------|---------|----------------------------|
| PRD redactado | `prd` | `PRD.md` → `in-review` |
| **Gate 1 aprobado** | `plan` | `PRD.md` → `approved`; gate `prd` → `passed` |
| Plan redactado | `plan` | `PLAN.md` → `in-review` |
| **Gate 2 aprobado** | `implementation` | `PLAN.md` → `approved`; gate `plan` → `passed`; **generá los `steps` a partir de las tareas del PLAN.md — una entrada por tarea accionable, todas en `todo`** |
| Durante la implementación | `implementation` | marcá cada step `in-progress` → `done` (o `blocked`) — escribí el archivo de estado **por cada step, en el momento**, nunca todo junto al final de la fase |
| Validación | `validation` | `TESTING.md` → `approved` una vez escrito |
| **Gate 3 aprobado** | `validation` | gate `testing` → `passed` |
| PR feat→develop abierto | `pr-develop` | gate `pr-develop` → sigue `pending`; poné su `url` con el link del PR |
| PR mergeado a develop | `pr-develop` | gate `pr-develop` → `passed` |
| PR develop→main abierto | `pr-main` | gate `pr-main` → sigue `pending`; poné su `url` con el link del PR |
| PR mergeado a main | `done` | gate `pr-main` → `passed` |

El array `steps` que se genera en el Gate 2 es lo que el tablero muestra como progreso (p. ej. `3/7`).
Los ids de los steps pueden espejar las etiquetas de fase del plan (`A1`, `A2`, `B1`, …).

No commitees `.ways/state.json` vos: solo escribilo. Cuando el usuario quiera persistir un
checkpoint, sugerí invocar `fmway-pr`, que lo commitea junto con la documentación y el código de esa
transición.

---

## Fase 1 — Redactar el PRD

**Objetivo:** producir un PRD acotado para la feature nueva, en base al descubrimiento de la Fase 0.

### Dónde guardarlo

```
docs/prds/{prd-slug}/PRD.md
```

**Formato del slug:** `{id-con-ceros}-{nombre-en-kebab-case}`
Ejemplos: `003-exportar-contactos`, `007-reglas-de-etiquetado`.

Los IDs son secuenciales entre `docs/prds/` **y** `docs/requirements/` — mirá ambos para encontrar el
próximo. Si la feature viene de un ticket de `fmway-po`, reusá el slug del ticket para que
`docs/requirements/{slug}/` y `docs/prds/{slug}/` queden alineados.

### Estructura del PRD

```markdown
# PRD — {Nombre de la feature}

## Estado
Borrador | En revisión | Aprobado | En curso | Terminado

## Problema
Un párrafo. ¿Qué dolor resuelve? ¿Quién lo sufre?

## Objetivos
Lista. Resultados medibles donde se pueda.

## No-objetivos
Qué queda explícitamente fuera de alcance.

## Historias de usuario
- Como [rol], quiero [acción] para [beneficio].

## Requisitos funcionales
Lista numerada. Concretos y verificables.

## Requisitos no funcionales
Restricciones de performance, seguridad y accesibilidad.

## Cambios en el modelo de datos
Tablas, columnas o relaciones agregadas o modificadas. Referenciar `docs/database-schema.md`.

## Notas de UI/UX
Pantallas o flujos clave. Enlazar wireframes si los hay.

## Preguntas abiertas
Decisiones sin resolver que necesitan respuesta del usuario antes de implementar.

## Conflictos y dependencias
Conflictos con PRDs o features existentes detectados en la Fase 0.
```

### Gate 1 — Revisión del PRD

Después de escribir el PRD:
- Asegurate de que los supuestos sin resolver y las preguntas abiertas queden explícitos, en lugar de
  adivinados.
- Exponé las preguntas abiertas de forma explícita.
- Decí: **"Borrador del PRD listo en `docs/prds/{slug}/PRD.md`. Revisalo antes de que siga."**
- **Frená. No avances hasta que el usuario dé el OK.**

---

## Fase 2 — Plan de implementación

**Objetivo:** producir un plan paso a paso que mapee los requisitos del PRD a cambios de código.

### Dónde guardarlo

```
docs/prds/{prd-slug}/PLAN.md
```

### Estructura del plan

```markdown
# Plan de implementación — {Nombre de la feature}

## Rama / worktree
Nombre de la rama: `feat/{slug}`
Modo de aislamiento: rama en el checkout actual | worktree aparte

## Etapas

### Etapa A — {nombre}
- [ ] Tarea 1 (archivo o módulo afectado)
- [ ] Tarea 2

### Etapa B — {nombre}
...

## Plan de pruebas
- Tests unitarios: qué cubrir
- Tests E2E: caminos críticos
- Checklist de validación manual

## Notas de rollback
Cómo revertir si algo sale mal.
```

### Gate 2 — Revisión del plan

Después de escribir el plan:
- No trates supuestos no enunciados como requisitos aprobados. Si hay criterios de aceptación clave
  todavía ambiguos, corregí primero el PRD.
- Decí: **"Plan de implementación listo en `docs/prds/{slug}/PLAN.md`. Revisalo antes de que empiece
  a codear."**
- **Frená. No avances hasta que el usuario dé el OK.**

---

## Fase 3 — Implementación

**Objetivo:** implementar la feature en la rama o el worktree que eligió el usuario.

### Preparación

Seguí en el modo de aislamiento elegido antes de la Fase 1. No crees una segunda rama ni un segundo
worktree salvo que el usuario pida cambiar de modo.

### Reglas durante la implementación

- Respetá estrictamente las convenciones del `CLAUDE.md` del proyecto (nomenclatura, tipado,
  estructura de carpetas, etc.).
- Trabajá en checkpoints lógicos (esquema, API, UI, tests). En cada checkpoint corré los comandos de
  verificación del proyecto (los que declare su `CLAUDE.md`: typecheck, lint, tests), después avisale
  al usuario que el checkpoint está listo y sugerile invocar `fmway-pr` para commitearlo — no
  ejecutes `git add`/`git commit` vos.
- Todo requisito funcional del PRD tiene que mapear al menos a un test.

### Formato sugerido del mensaje de commit (para que lo use `fmway-pr`)

```
feat({slug}): {descripción corta}

- Requisito RF-N implementado
- Tests agregados: {cuáles}
```

---

## Fase 4 — Validación

**Objetivo:** verificar la implementación contra el PRD antes de pasársela al usuario.

### Checklist (correr antes de pedirle al usuario que pruebe)

- [ ] Todos los requisitos funcionales del PRD están implementados.
- [ ] Todo el plan de pruebas está en verde (tests unitarios y E2E del proyecto).
- [ ] La verificación de tipos termina sin errores.
- [ ] El linter termina sin errores.
- [ ] El build se completa correctamente.
- [ ] No hay regresiones en los tests existentes.
- [ ] Las preguntas abiertas del PRD están resueltas (o documentadas como diferidas).
- [ ] El estado del PRD quedó actualizado (`En curso → Terminado`, o `Listo para revisión`).
- [ ] La auditoría de dependencias del stack corrió sin vulnerabilidades nuevas.
- [ ] Se hizo la revisión manual de seguridad sobre el código nuevo (ver abajo).

Los comandos exactos salen del `CLAUDE.md` del proyecto. Si el proyecto no los declara, preguntale al
usuario cuáles son y anotalos ahí — no los inventes ni los des por corridos.

### Revisión de seguridad (obligatoria antes del Gate 3)

GrupoFM no tiene hoy un escáner SAST/SCA contratado, así que esta etapa es explícita y se hace a
mano:

1. **Auditoría de dependencias** con la herramienta nativa del stack: `npm audit --omit=dev`,
   `pnpm audit`, `pip-audit`, `dotnet list package --vulnerable`, `composer audit`, etc. Corregí lo
   que introduce esta feature; lo preexistente queda fuera de alcance salvo que la corrección sea
   trivial.
2. **Revisión manual del código nuevo**, con foco en: autorización y control de acceso, validación y
   saneamiento de entradas, consultas construidas por concatenación, manejo de datos sensibles,
   secretos embebidos y mensajes de error que filtran información.
3. Para cambios sensibles (autenticación, permisos, pagos, datos personales), invocá
   `fmway-security` en modo embebido: hace la revisión control por control contra OWASP y deja
   evidencia trazable.

Si una herramienta de verificación no está disponible, registrá en `docs/prds/{slug}/TESTING.md` cuál
faltó y el comando exacto que falló, y preguntale al usuario si la instala o si seguimos solo con lo
disponible. **Nunca reportes como limpia una verificación que no se ejecutó.**

**Ciclo de corrección:**
1. Resolvé cada problema detectado (actualizar dependencia vulnerable, sanear entradas, etc.).
2. Volvé a correr typecheck, lint y tests para confirmar que no se rompió nada.
3. Sugerí invocar `fmway-pr` para commitear la corrección (`fix({slug}): correcciones de la revisión
   de seguridad`) — no la commitees vos.
4. Repetí hasta que no queden hallazgos nuevos.

### Gate 3 — Prueba del usuario

Cuando la validación pasa:
- Escribí una **guía de prueba** corta en `docs/prds/{slug}/TESTING.md`:
  - cómo levantar la feature (URL, comando, etc.)
  - escenarios paso a paso para ejercitarla (camino feliz + casos borde)
  - limitaciones conocidas o ítems diferidos
- Decí: **"Implementación completa y validada. Guía de prueba en `docs/prds/{slug}/TESTING.md`.
  Probala y contame."**
- **Frená. Esperá la devolución del usuario.**

---

## Fase 5 — Integración vía Pull Requests

**Objetivo:** integrar la feature a `develop` y después a `main` mediante PRs revisados. Nunca
mergees ramas de forma directa: siempre por PR.

### Flujo de ramas

```
feat/{slug}  →  develop  →  main
               (PR 1)      (PR 2)
```

### PR 1 — feat/{slug} → develop

Después de que el usuario valide (Gate 3 aprobado), avisale que la rama está lista y sugerile invocar
`fmway-pr` para pushear `feat/{slug}` y abrir el PR a `develop`. No pushees ni ejecutes
`gh pr create` vos: `fmway-pr` es la única skill que hace eso, y solo cuando el usuario se lo pide.

**Título y cuerpo sugeridos para que use `fmway-pr`:**

```
Título: feat({slug}): {nombre corto de la feature}
```

El cuerpo del PR tiene que incluir:
- **Resumen:** 2 a 4 viñetas sobre qué se construyó y por qué.
- **PRD:** link a `docs/prds/{slug}/PRD.md`.
- **Pruebas:** link a `docs/prds/{slug}/TESTING.md`.
- **Checklist:** typecheck ✅, lint ✅, tests ✅, build ✅, auditoría de dependencias ✅, revisión de
  seguridad ✅, validado por el usuario ✅.

Una vez abierto, compartile la URL del PR al usuario. **Frená. No mergees hasta que el usuario apruebe
el PR.**

### PR 2 — develop → main

Después de que el PR 1 se mergea a `develop`, sugerí invocar `fmway-pr` de nuevo para abrir el PR de
`develop` → `main`.

```
Título: release: {slug} — {nombre corto de la feature}
```

El cuerpo del PR tiene que incluir:
- qué features y correcciones entran en esta release
- link al PR anterior para el diff completo

Una vez abierto, compartile la URL al usuario. **Frená. No mergees hasta que el usuario apruebe.**

---

## Referencia rápida — gates

| Gate | Disparador | Qué decir | Bloquea hasta |
|------|-----------|-----------|---------------|
| 1 | PRD escrito | "Borrador del PRD listo en `docs/prds/{slug}/PRD.md`. Revisalo." | El usuario da el OK |
| 2 | Plan escrito | "Plan de implementación listo en `docs/prds/{slug}/PLAN.md`. Revisalo." | El usuario da el OK |
| 3 | Validación y revisión de seguridad OK | "Implementación completa. Guía de prueba en `docs/prds/{slug}/TESTING.md`. Probala." | Devolución del usuario |
| 4 | Usuario validó | Sugerir `fmway-pr` para el PR feat→develop; compartir la URL cuando lo corra | El usuario aprueba el PR |
| 5 | PR 1 mergeado | Sugerir `fmway-pr` para el PR develop→main; compartir la URL cuando lo corra | El usuario aprueba el PR |

---

## Archivos por feature

```
docs/prds/{prd-slug}/
  PRD.md        # Especificación de la feature (Fase 1)
  PLAN.md       # Plan de implementación (Fase 2)
  TESTING.md    # Guía de prueba (Fase 4)
```

---

## Qué NO hacer

- No escribas código antes de superar el Gate 1.
- No empieces la implementación antes de superar el Gate 2.
- No mergees a `main` sin la aprobación del usuario después del Gate 3.
- **Nunca mergees ramas de forma directa** — siempre por PR, por chico que sea el cambio.
- No inventes requisitos del cliente, alcance implícito ni criterios de aceptación durante el
  descubrimiento, la redacción del PRD o la planificación.
- No redactes el PRD si el pedido sigue siendo tan ambiguo que no quedan claras las expectativas del
  cliente, las restricciones o las áreas afectadas.
- No inventes requisitos que no estén en el PRD: si algo no está claro, sumalo a Preguntas abiertas y
  planteálo en el Gate 1.
- No declares la implementación terminada sin correr antes typecheck, lint y tests.
