---
name: fmway-arch
version: 1.0.0
description: Usar para evaluar la arquitectura de software de un código, de un módulo o de los cambios de la rama actual contra atributos de calidad y principios de diseño (acoplamiento y cohesión, respeto de capas o arquitectura hexagonal, separación de responsabilidades, escalabilidad, mantenibilidad, testabilidad). Produce un informe de evaluación trazable, con hallazgos calificados y recomendaciones priorizadas. Se invoca por separado para auditar un sistema o un diseño, o desde otro flujo (fmway-dev al planificar, fmway-docs, fmway-init) para evaluar un diseño propuesto o existente antes de comprometerse con él. Especialmente importante antes de un cambio grande, de una decisión de refactor, o cuando hay que hacer explícitos la deuda técnica y el riesgo estructural.
---

# Proceso de evaluación arquitectónica

Flujo guiado por gates para evaluar una arquitectura —un sistema entero, un módulo o los cambios de
la rama actual— contra atributos de calidad y principios de diseño explícitos, y convertir eso en una
**evaluación trazable y priorizada** sobre la que el equipo pueda actuar. La salida vive en
`docs/assessments/arch/{slug}/ASSESSMENT.md`.

Dos modos de invocación:

- **Autónomo (auditar un sistema o un diseño):** rama propia `assess/arch-{slug}` → PR a `develop`.
- **Embebido en otro flujo:** escribe en la **rama o worktree de quien llama**; la evaluación viaja
  con el PR de ese flujo. Sin rama ni PR separados. Ejemplos: `fmway-dev` evaluando un diseño
  planificado en su Gate 2, `fmway-docs` señalando riesgo estructural mientras documenta,
  `fmway-init` dimensionando un repo brownfield.

Es un **flujo de evaluación**. Igual que `fmway-docs`, **no** mantiene un `.ways/state.json`. Evalúa y
recomienda; **no** implementa correcciones. Actuar sobre una recomendación es un work item aparte de
`fmway-dev` o `fmway-bugs`.

---

## Fase 0 — Alcance y relevamiento

**Objetivo:** entender qué se evalúa y bajo qué lente, antes de juzgar nada. Solo lectura.

### Relevamiento inicial

1. Confirmá el **objetivo** con el contexto disponible:
   - repo completo, un módulo, servicio o contexto acotado, o **el diff de la rama actual** (un
     cambio propuesto o código nuevo — `git diff develop...HEAD`)
   - si es una auditoría de lo **construido** (código existente) o una revisión de lo **diseñado**
     (un plan, PRD o propuesta todavía sin implementar)
2. Leé primero la documentación de arquitectura existente (`docs/architecture/`, `README.md`,
   `PRD.md`, ADRs) para anclar la evaluación y no volver a derivar lo que ya está escrito. Si falta o
   está desactualizada, anotalo: eso ya es un hallazgo.

### Relevar el objetivo

Relevá, todavía sin juzgar:

- **Descomposición** — la estructura real de primer nivel (capas, puertos y adaptadores, carpetas por
  feature, microservicios) y si el código coincide con la intención documentada.
- **Dependencias** — dirección de las dependencias entre módulos y paquetes; ciclos; focos de
  acoplamiento; qué depende de qué.
- **Fronteras** — dónde vive la lógica de dominio frente al código de infraestructura o framework;
  filtraciones a través de las fronteras.
- **Aspectos transversales** — autenticación, configuración, logging y observabilidad, manejo de
  errores, transacciones: dónde vive cada uno y si es consistente.
- **Datos e integraciones** — almacenamientos, sistemas externos y cómo los alcanza el código.
- **Tests** — qué capas están cubiertas, qué forma tienen los tests, qué queda sin poder testearse.

### Criterios de salida de la Fase 0

Antes del Gate 1, Claude tiene que poder enunciar:
- el objetivo, y si es sobre lo construido o sobre lo diseñado
- los componentes principales y sus relaciones de dependencia reales
- qué documentación existente se usó y cuál falta o está desactualizada
- los atributos de calidad candidatos que importan para este sistema
- qué áreas no están claras y van a quedar como preguntas abiertas en lugar de asumirse

No infieras una propiedad de diseño a partir de un nombre. Si el código no deja claro un hecho
estructural, se convierte en pregunta abierta, no en una afirmación confiada.

---

## Gate 1 — Alcance y criterios de la evaluación

Proponé **qué se evalúa** y **contra qué criterios**, a la escala del objetivo (un módulo suelto pide
una lente más liviana que una plataforma de varios servicios):

```markdown
## Evaluación propuesta

- **Objetivo:** {repo | módulo X | diff de la rama actual}
- **Modo:** auditoría de lo construido | revisión de lo diseñado
- **Atributos de calidad (calificados):**
  - [ ] Mantenibilidad / modularidad
  - [ ] Acoplamiento y cohesión
  - [ ] Integridad de capas y fronteras (hexagonal, separación de responsabilidades)
  - [ ] Escalabilidad y postura de performance
  - [ ] Testabilidad
  - [ ] Postura de seguridad (estructural — las verificaciones profundas van a fmway-security)
  - [ ] Observabilidad y operabilidad
  - [ ] Consistencia con la arquitectura documentada
- **Fuera de alcance:** {lo que esta pasada no va a cubrir}
- **Preguntas abiertas:** {lo ambiguo sobre el objetivo o la intención}
```

- Sacá los atributos que el objetivo no justifique; agregá los específicos que necesite.
- Preguntá: **"Este es el alcance y los criterios de evaluación para {objetivo}. Confirmalo antes de
  que arranque."**
- **Frená. No produzcas la evaluación hasta que el usuario confirme el alcance y los criterios.**

---

## Configuración del aislamiento (solo en modo autónomo)

Si corrés **embebido en otro flujo**, salteálo: escribí en la rama o worktree existente.

Si corrés **por separado**, preguntale al usuario cómo quiere aislar el trabajo antes de escribir:

> ¿Querés que trabaje en una rama nueva del checkout actual, o que cree un worktree de git aparte?

Usá la respuesta tal cual. Frená después de preguntar; no crees ni rama ni worktree hasta que el
usuario elija.

Si el checkout actual tiene cambios sin commitear, frená y preguntá antes de cambiar de rama o crear
un worktree.

### Opción A — Rama en el checkout actual

```bash
git switch develop && git pull --ff-only && git switch -c assess/arch-{slug}
```

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin develop && mkdir -p .worktrees && git worktree add .worktrees/assess-arch-{slug} -b assess/arch-{slug} origin/develop
```

`{slug}` es el objetivo en kebab-case (por ejemplo `core-pagos`, `rediseno-checkout`). Toda la salida
se escribe dentro de la ubicación de trabajo elegida.

---

## Fase 2 — Redactar la evaluación

**Objetivo:** producir `ASSESSMENT.md`, anclado en el código o el diseño real.

### Reglas de evaluación (no negociables)

- **Trazable.** Todo hallazgo apunta a su evidencia — `ruta/al/archivo.ext:línea`, un módulo, una
  arista de dependencia o una clave de configuración. El lector tiene que poder verificarlo.
- **Sin invención.** Evaluá lo que existe, no lo que "debería" existir. Si una propiedad no está
  clara, va bajo **Preguntas abiertas / a verificar**; nunca adivines una calificación.
- **Calificá, no solo describas.** Cada atributo de calidad recibe una calificación y la evidencia
  que la sostiene, no un adjetivo vago.
- **La severidad refleja riesgo, no gusto.** La severidad de un hallazgo es el riesgo arquitectónico
  que carga (radio de impacto, probabilidad de causar defectos, costo de cambiarlo después), no una
  preferencia de estilo.
- **Recomendá, no implementes.** Las recomendaciones son concretas y priorizadas; este flujo no
  cambia código.
- **Los conflictos se registran.** Si el código contradice la arquitectura documentada, enunciá la
  contradicción en lugar de elegir un lado en silencio.

### Estructura de ASSESSMENT.md

```markdown
# Evaluación arquitectónica — {objetivo}

## Alcance
- Objetivo: {repo | módulo | diff de rama}
- Modo: construido | diseñado
- Fecha: {AAAA-MM-DD}
- Criterios: {los atributos confirmados en el Gate 1}

## Resumen ejecutivo
3 a 5 oraciones: salud general, la o las dos cosas que más importan, los riesgos principales.

## Calificación por atributo de calidad
| Atributo | Calificación | Evidencia | Notas |
|----------|--------------|-----------|-------|
| Mantenibilidad | Sólida / Adecuada / En riesgo / Pobre | `ruta:línea`, módulo | … |
| Acoplamiento y cohesión | … | … | … |
| Capas y fronteras | … | … | … |
| Escalabilidad | … | … | … |
| Testabilidad | … | … | … |

## Fortalezas
Lo que está genuinamente bien estructurado y conviene preservar (cada punto con evidencia).

## Hallazgos
| # | Área | Severidad | Hallazgo | Evidencia | Recomendación |
|---|------|-----------|----------|-----------|---------------|
| 1 | Acoplamiento | Alta | La capa de dominio importa el framework HTTP directamente | `src/domain/orden.ts:12` | Introducir un puerto; mover la dependencia al adaptador |
| 2 | … | … | … | … | … |

Severidad: Crítica / Alta / Media / Baja — riesgo arquitectónico, no estilo.

## Registro de deuda técnica
Ítems de deuda que conviene seguir, cada uno con un costo aproximado de corrección y un costo de
postergarlo.

## Preguntas abiertas / a verificar
- …
```

Mantené la prosa ajustada: oraciones cortas y directas, tablas antes que párrafos cuando se lean
mejor.

---

## Fase 3 — Diagramas y priorización

- **Diagramas (cuando aclaren):** un diagrama **Mermaid** de componentes o dependencias del objetivo
  que resalte las áreas problemáticas, y un diagrama del estado objetivo si se recomienda una
  reestructuración. **Validá cada diagrama contra el parser de Mermaid antes de cerrar**: un diagrama
  que no renderiza es peor que ninguno.
- **Recomendaciones priorizadas:** ordená las recomendaciones de los hallazgos en una lista corta de
  **hacer ahora / hacer después / considerar**, cada una atada al número de su hallazgo. Ese es el
  traspaso accionable: un ítem de "hacer ahora" normalmente se convierte en un work item de
  `fmway-dev` o `fmway-bugs`.

---

## Gate 2 — Revisión

Cuando la evaluación, los diagramas y la priorización están escritos:

- Entregá la ruta, el resumen ejecutivo, los hallazgos principales por severidad y las **Preguntas
  abiertas / a verificar**.
- Decí: **"Evaluación arquitectónica lista en `docs/assessments/arch/{slug}/ASSESSMENT.md`. Dejé
  listadas las preguntas abiertas para que las respondas. Revisala."**
- **Frená. Esperá la revisión del usuario antes de seguir.**

Si corrés **embebido**, el control vuelve al flujo que llamó, en su propio gate de revisión: la
evaluación se revisa ahí y viaja con el PR de ese flujo. El paso de PR autónomo se saltea.

---

## Fase 4 — PR (solo en modo autónomo)

Sugerí invocar `fmway-pr` para pushear `assess/arch-{slug}` y abrir el PR. No pushees ni ejecutes
`gh pr create` vos.

```
Título: assess(arch): {objetivo}
```

El cuerpo del PR tiene que incluir:
- **Alcance:** objetivo, modo y criterios evaluados.
- **Resumen:** el resumen ejecutivo y los hallazgos principales por severidad.
- **Recomendaciones:** la lista de hacer ahora / hacer después / considerar.
- **Preguntas abiertas:** los ítems sin resolver que necesitan definición del equipo.

Una vez abierto, compartí la URL. **Frená. No mergees hasta que el usuario apruebe.**

---

## Referencia rápida — gates

| Gate | Disparador | Qué decir | Bloquea hasta |
|------|-----------|-----------|---------------|
| 1 | Alcance y criterios propuestos | "Este es el alcance y los criterios para {objetivo}. Confirmalo." | El usuario confirma |
| 2 | Evaluación escrita | "Evaluación lista en `docs/assessments/arch/{slug}/ASSESSMENT.md`. Revisala." | Revisión del usuario |
| 3 | (autónomo) Revisado | Sugerir `fmway-pr` para el PR `assess/arch-{slug} → develop`; compartir la URL | El usuario aprueba el PR |

---

## Qué se produce

```
docs/assessments/arch/{slug}/
  ASSESSMENT.md   # calificaciones, hallazgos, deuda técnica, recomendaciones priorizadas, diagramas
```

---

## Qué NO hacer

- No produzcas la evaluación antes de que el Gate 1 confirme el alcance y los criterios.
- No inventes estructura, intención ni una calificación. Todo lo no verificable va bajo "Preguntas
  abiertas / a verificar".
- No dejes hallazgos sin trazabilidad: cada uno apunta a un archivo, módulo, dependencia o clave.
- No fijes la severidad por preferencia de estilo: la severidad es riesgo arquitectónico.
- No implementes correcciones acá: recomendá, y dejá que un ítem posterior de `fmway-dev` o
  `fmway-bugs` cargue el cambio.
- No cierres un diagrama que falla al renderizar en el parser de Mermaid.
- No abras un PR separado cuando corrés embebido en otro flujo: la evaluación viaja con el PR de quien
  llamó.
- No escribas directamente en `develop` o `main` en modo autónomo — usá `assess/arch-{slug}`.
