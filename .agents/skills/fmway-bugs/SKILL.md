---
name: fmway-bugs
version: 1.0.0
description: Usar para reportes de bugs, regresiones, comportamiento roto o incidentes en producción que necesiten definir el comportamiento esperado, evidencia de reproducción, análisis de causa raíz o un plan de corrección antes de tocar código. Se activa cuando el reporte está incompleto, es de alto impacto, afecta a usuarios o probablemente venga de cambios recientes. No se activa para features nuevas, remediación de vulnerabilidades, pedidos solo de documentación ni parches mínimos que el usuario pide aplicar ya.
---

# Proceso de corrección de bugs

Flujo estructurado, guiado por gates, para corregir bugs sin adivinar. Arranca por el descubrimiento
y el relevamiento, y avanza por documentación del bug, análisis, reproducción, plan de corrección,
implementación, validación y PR. El gate crítico es la confirmación del plan de corrección: no se
escribe una línea del fix antes de que el usuario apruebe el plan.

---

## Fase 0 — Descubrimiento y relevamiento

Antes de tocar nada:

1. Leé `PRD.md` y la documentación relevante de `docs/` para entender la funcionalidad afectada.
2. Revisá `docs/bugs/` por reportes relacionados ya existentes. Si hay un ticket refinado para este
   problema en `docs/requirements/{slug}/TICKET.md` (producido por `fmway-po`), leelo primero y
   *verificá* —en lugar de volver a derivar— sus notas de factibilidad y su alcance.
3. Aclará el relevamiento del problema:
   - qué se reporta como roto
   - qué debería pasar en su lugar
   - a quién afecta
   - entorno, severidad e impacto para el negocio
   - qué datos siguen faltando o sin verificar
4. Descubrí el contexto del código:
   - qué área funcional o flujo se ve afectado
   - módulos, funciones, tests o integraciones relevantes
   - commits o releases recientes que puedan haber introducido la regresión
   - reportes de bugs, PRDs o decisiones previas que definan el comportamiento esperado
5. Ajustá la profundidad al caso:
   - para un bug chico y entendido, mantené la pasada liviana
   - para problemas ambiguos, de alta severidad o que afectan producción, profundizá antes de
     analizar y planificar la corrección
6. Si al reporte le faltan datos críticos, hacé preguntas concretas antes de seguir.

### Criterios de salida de la Fase 0

Antes de la Fase 1, Claude tiene que poder enunciar:
- qué está roto y cuál es el comportamiento esperado, según lo que se entiende hasta ahora
- a quién o a qué afecta
- qué documentos, módulos, commits o flujos están probablemente involucrados
- qué supuestos se están asumiendo
- qué falta confirmar durante el análisis o con el usuario

No des por sentado el comportamiento esperado, la causa raíz ni la dirección del fix solo porque el
reporte suene plausible. Si hay datos importantes poco claros, planteá la incertidumbre de forma
explícita.

---

## Configuración del aislamiento (inmediatamente después de la Fase 0)

Antes de crear cualquier archivo, preguntale al usuario cómo quiere aislar el trabajo:

> ¿Querés que trabaje en una rama nueva del checkout actual, o que cree un worktree de git aparte?

Usá la respuesta tal cual. Frená después de preguntar; no crees ni rama ni worktree hasta que el
usuario elija.

Si el checkout actual tiene cambios sin commitear, frená y preguntá antes de cambiar de rama o crear
un worktree.

### Opción A — Rama en el checkout actual

```bash
git switch develop && git pull --ff-only && git switch -c fix/{slug}
```

Todo el trabajo —BUG.md, ANALYSIS.md, tests, código del fix— ocurre en esa rama del checkout actual.
Nunca escribas archivos directamente en `develop` o `main`.

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin develop && mkdir -p .worktrees && git worktree add .worktrees/fix-{slug} -b fix/{slug} origin/develop
```

Todo el trabajo ocurre exclusivamente dentro de ese worktree.

---

## Seguimiento de estado — `.ways/state.json`

Seguí el **contrato de estado ways/v1alpha1** — el formato canónico de `.ways/state.json`
(`schemaVersion` 2), que viaja como la **regla siempre activa `state-contract`** que `ways add`
coloca en el proyecto, así que ya está en tu contexto. Su origen en este repo, para quien lo
mantiene, es `ways/rulepacks/state-contract/`. No copies ni inventes un esquema dentro de esta skill.

Valores propios de este flujo:
- `flow`: `bug`
- `way`: `fmway/bugs` · `discipline`: `development` (opcionalmente `wayVersion` del manifiesto)
- Patrón de rama: `fix/{slug}`
- `phase` inicial: `discovery`
- `isolationType`: `branch` o `worktree`, según la elección de la Fase 0
- Documentos: `docs/bugs/{slug}/BUG.md`, `docs/bugs/{slug}/ANALYSIS.md`, `docs/bugs/{slug}/FIX_PLAN.md`
- Gates: `fix-plan`, `pr`

Al inicio de la sesión, leé `.ways/state.json` si existe. Si su `branch` coincide con la rama
`fix/{slug}` actual, informá la fase actual, el próximo paso y los gates pendientes, y retomá desde
ahí. Si no existe, o su `branch` no coincide (archivo obsoleto heredado de un ítem ya mergeado),
arrancá en la Fase 0 y creá o sobrescribí el archivo justo después de configurar el aislamiento. En
cada transición actualizá también `lastPhase`.

**Puntos de actualización (fase → qué escribir):**

| Cuándo | `phase` | Documentos / gates / steps |
|--------|---------|----------------------------|
| BUG.md escrito | `document` | `BUG.md` → `approved` |
| ANALYSIS.md escrito | `analysis` | `ANALYSIS.md` → `approved` |
| Test de reproducción agregado (falla) | `reproduction` | — |
| FIX_PLAN.md redactado | `fix-plan` | `FIX_PLAN.md` → `in-review` |
| **Gate aprobado (plan de corrección)** | `implementation` | `FIX_PLAN.md` → `approved`; gate `fix-plan` → `passed`; **generá los `steps` a partir del plan — una entrada por cambio accionable, todas en `todo`** |
| Durante la implementación | `implementation` | marcá cada step `in-progress` → `done` (o `blocked`) — escribí el estado **por cada step, en el momento**, nunca todo junto al final |
| Validación | `validation` | — |
| PR fix→develop abierto | `pr` | gate `pr` → sigue `pending`; poné su `url` con el link del PR |
| PR mergeado | `done` | gate `pr` → `passed` |

No commitees `.ways/state.json` vos: solo escribilo. Cuando el usuario quiera persistir un
checkpoint, sugerí invocar `fmway-pr`.

---

## Fase 1 — Documentar el bug

**Dónde guardarlo:**

```
docs/bugs/{bug-slug}/BUG.md
```

**Formato del slug:** `{id-con-ceros}-{descripcion-en-kebab-case}`
Ejemplos: `001-totales-importacion-en-cero`, `002-falta-deduplicacion-contactos`.

Los IDs son secuenciales. Mirá los slugs existentes en `docs/bugs/` para saber cuál sigue.

### Estructura de BUG.md

```markdown
# Bug — {Descripción corta}

## Estado
Reportado | En análisis | Corrección planificada | En corrección | Corregido

## Descripción
Qué está pasando vs. qué debería pasar.

## Pasos para reproducir
1.
2.

## Comportamiento esperado

## Comportamiento actual

## Contexto
- Entorno: local / staging / producción
- Commit o versión afectada:
- Usuarios o registros afectados:
- Severidad: Baja / Media / Alta / Crítica

## Logs / traza de error
```

---

## Fase 2 — Análisis

**Dónde guardarlo:**

```
docs/bugs/{bug-slug}/ANALYSIS.md
```

### Estructura de ANALYSIS.md

```markdown
# Análisis — {Descripción del bug}

## Causa raíz
Cuál es la causa real de fondo.

## Código afectado
Archivos, funciones o módulos involucrados.

## Impacto
Cuántos usuarios o registros afectados. Riesgo de integridad de datos.

## Camino de reproducción
Cómo disparar el bug de forma confiable.
```

No trates una causa raíz sospechada como confirmada hasta que el análisis y la evidencia de
reproducción la respalden.

---

## Fase 3 — Test de reproducción

Antes de escribir una línea del fix, escribí un test que **falle** por el bug:

1. Escribí un test unitario o e2e que ejercite el comportamiento roto.
2. Corrélo: tiene que fallar sobre el código actual.
3. Sugerí invocar `fmway-pr` para commitearlo (`test(fix-{slug}): test de reproducción de {bug}`) —
   no lo commitees vos.

El test de reproducción pasando a verde es la definición de "corregido".

Si el bug no se puede reproducir en un test, documentá por qué en ANALYSIS.md y planteáselo al
usuario antes de seguir.

No aproveches la fase de reproducción para colar el fix. Acá el objetivo es demostrar que el
comportamiento actual está roto.

---

## Fase 4 — Plan de corrección

**Dónde guardarlo:**

```
docs/bugs/{bug-slug}/FIX_PLAN.md
```

### Estructura de FIX_PLAN.md

```markdown
# Plan de corrección — {Descripción del bug}

## Rama / worktree
Rama: fix/{slug}
Modo de aislamiento: rama en el checkout actual | worktree aparte

## Causa raíz (una línea)

## Enfoque de la corrección
Qué se va a cambiar y por qué.

## Archivos afectados

## Riesgos y efectos colaterales
¿Esta corrección puede romper otra cosa?

## Rollback
Cómo revertir si el fix introduce una regresión.
```

### Gate — Confirmación del plan de corrección

Después de escribir el plan:
- Decí: **"Plan de corrección listo en `docs/bugs/{slug}/FIX_PLAN.md`. Revisalo antes de que empiece
  a codear."**
- **Frená. No escribas nada del fix hasta que el usuario dé el OK.**

---

## Fase 5 — Implementación

Después de que el usuario apruebe el plan de corrección:

### Reglas

- Corregí solo lo que describe el plan — nada de limpieza extra.
- Corré los comandos de verificación del proyecto (typecheck, lint, tests, según su `CLAUDE.md`) en
  cada checkpoint, después sugerí invocar `fmway-pr` para commitear — no commitees vos.
- El test de reproducción de la Fase 3 tiene que quedar en verde después del fix.
- Sin regresiones en los tests existentes.

### Formato sugerido del commit (para que lo use `fmway-pr`)

```
fix({slug}): {descripción corta}

- Causa raíz: {una línea}
- Tests: {qué cubre la corrección}
```

---

## Fase 6 — Validación

Checklist antes de abrir el PR:

- [ ] El test de reproducción de la Fase 3 está en verde
- [ ] Todos los tests existentes pasan (unitarios y E2E)
- [ ] La verificación de tipos termina sin errores
- [ ] El linter termina sin errores
- [ ] El build se completa correctamente
- [ ] No hay regresiones
- [ ] El estado de BUG.md quedó en `Corregido`
- [ ] La auditoría de dependencias del stack no arroja vulnerabilidades nuevas
- [ ] Se hizo la revisión manual de seguridad sobre el código tocado

### Revisión de seguridad

Mismo criterio que la skill de desarrollo, adaptado al tamaño del fix:

1. **Auditoría de dependencias** con la herramienta del stack (`npm audit`, `pip-audit`,
   `dotnet list package --vulnerable`, etc.), solo si la corrección tocó dependencias.
2. **Revisión manual del código cambiado**: autorización, validación de entradas, manejo de datos
   sensibles, secretos, errores que filtran información.
3. Si el fix toca autenticación, permisos, pagos o datos personales, invocá `fmway-security` en modo
   embebido antes del PR.

Si una herramienta de verificación no está disponible, registrá en `docs/bugs/{slug}/ANALYSIS.md`
cuál faltó y el comando exacto que falló, y preguntale al usuario si la instala o si seguimos solo con
lo disponible. **Nunca reportes como limpia una verificación que no se ejecutó.**

Ciclo de corrección: resolver el problema → typecheck, lint y tests → sugerir `fmway-pr` para
commitear → volver a verificar → repetir hasta que quede limpio.

---

## Fase 7 — PR

Cuando la validación pasa, sugerí invocar `fmway-pr` para pushear `fix/{slug}` y abrir el PR. No
pushees ni ejecutes `gh pr create` vos.

```
Título: fix({slug}): {descripción corta}
```

El cuerpo del PR tiene que incluir:
- **Bug:** link a `docs/bugs/{slug}/BUG.md`
- **Causa raíz:** una línea
- **Corrección:** descripción breve de qué cambió y por qué
- **Tests:** nombre del test de reproducción más cualquier otra cobertura agregada
- **Checklist:** typecheck ✅ lint ✅ tests ✅ build ✅ auditoría de dependencias ✅ revisión de
  seguridad ✅

Una vez abierto, compartile la URL al usuario. **Frená. No mergees hasta que el usuario apruebe.**

---

## Archivos por bug

```
docs/bugs/{bug-slug}/
  BUG.md          # Reporte del bug (Fase 1)
  ANALYSIS.md     # Análisis de causa raíz (Fase 2)
  FIX_PLAN.md     # Enfoque de la corrección + gate (Fase 4)
```

---

## Referencia rápida — gates

| Gate | Disparador | Qué decir | Bloquea hasta |
|------|-----------|-----------|---------------|
| 1 | Plan de corrección escrito | "Plan de corrección listo en `docs/bugs/{slug}/FIX_PLAN.md`. Revisalo." | El usuario da el OK |
| 2 | Validación aprobada | Sugerir `fmway-pr` para el PR fix→develop; compartir la URL cuando lo corra | El usuario aprueba el PR |

---

## Qué NO hacer

- No escribas código del fix antes de que el usuario apruebe el plan de corrección.
- No corrijas más de lo que está en el plan — las mejoras extra van en una rama de feature.
- No saltees el test de reproducción: si no podés reproducir el bug, decilo en ANALYSIS.md y preguntá.
- No des por sentado el comportamiento esperado, la causa raíz ni la corrección correcta sin
  evidencia de la documentación, el análisis, los tests o una aclaración del usuario.
- No conviertas un reporte incompleto en un plan de corrección confiado: primero exponé lo que falta.
- No declares terminado sin correr typecheck, lint y tests.
- Nunca mergees de forma directa — siempre por PR.
- Nunca toques `develop` o `main` directamente — usá el modo de aislamiento que eligió el usuario.
