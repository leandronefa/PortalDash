---
name: fmway-vuln
version: 1.0.0
description: >-
  Usar para trabajo de remediación de vulnerabilidades: relevar vulnerabilidades del proyecto
  (auditoría de dependencias del stack, avisos de Dependabot, reportes de terceros o hallazgos de
  revisión manual), revisarlas, acordar el alcance y producir un plan de remediación aprobado antes
  de corregir. Se activa cuando el usuario menciona vulnerabilidades, CVEs, dependencias inseguras,
  avisos de seguridad o remediación de hallazgos. No se activa para revisiones de arquitectura de
  seguridad, modelos de amenazas, validación control por control contra OWASP ni corrección de bugs
  funcionales.
---

# Proceso de remediación de vulnerabilidades

Flujo guiado por gates para encontrar y corregir vulnerabilidades de seguridad sin adivinar el
alcance ni el riesgo aceptable. Arranca por el relevamiento, y sigue con hallazgos, triage, plan,
remediación, validación y PRs, con confirmación explícita del usuario en los puntos de decisión. No
se aplica ninguna corrección sin un plan aprobado.

> **Nota GrupoFM.** El flujo original de este paquete estaba atado a Snyk. Acá es agnóstico de
> herramienta: la fuente de hallazgos puede ser la auditoría nativa del stack, un aviso automático
> del host de repos, un reporte de un tercero o una revisión manual. Cuando GrupoFM incorpore un
> escáner, se agrega su invocación en la Fase 0 y su re-verificación en la Fase 5 sin cambiar el
> resto del flujo.

---

## Fase 0 — Relevamiento

**Objetivo:** juntar todas las vulnerabilidades vigentes del proyecto, con evidencia.

### Pasos

1. Confirmá el contexto antes de relevar:
   - ruta absoluta del proyecto a revisar
   - si el usuario quiere solo revisar, hacer triage o remediar
   - urgencias, entorno o restricciones de negocio ya conocidas
   - resultados de relevamientos previos que el usuario quiera considerar
2. Identificá el stack y corré la **auditoría de dependencias** que corresponda:
   - Node: `npm audit --json` / `pnpm audit --json` / `yarn npm audit`
   - Python: `pip-audit -f json`
   - .NET: `dotnet list package --vulnerable --include-transitive`
   - PHP: `composer audit --format=json`
   - Java: `mvn dependency-check:check` o `gradle dependencyCheckAnalyse` si están configurados
3. Sumá las fuentes externas disponibles: avisos de Dependabot o del host de repos, reportes de
   auditorías de terceros, hallazgos de una revisión previa de `fmway-security`.
4. Para el código propio (no dependencias), hacé una pasada dirigida sobre las áreas de riesgo:
   autenticación, autorización, consultas armadas por concatenación, deserialización, subida de
   archivos, manejo de secretos y renderizado de contenido del usuario.
5. Consolidá todos los hallazgos en una sola lista.

Si una herramienta de auditoría no está disponible o falla antes de devolver resultados, frená antes
del Gate 1, informá exactamente qué faltó o qué falló, y preguntale al usuario si la instala o si
seguimos con las fuentes disponibles. **No inventes hallazgos ni armes un plan de remediación sobre
datos viejos.**

### Resguardos de la Fase 0

- No asumas que el usuario quiere corregir todo. El relevamiento aporta la evidencia; el alcance lo
  define el usuario.
- No deduzcas la prioridad de negocio solo de la severidad técnica.
- Si la ruta, el objetivo del relevamiento o el alcance deseado no están claros, aclaralo antes de
  seguir.

### Criterios de salida de la Fase 0

Antes de la Fase 1, Claude tiene que poder enunciar:
- qué proyecto y qué alcance se relevaron, y con qué herramientas
- si el usuario quiere revisar, hacer triage o remediar
- qué restricciones de negocio o de entorno se conocen
- que la lista de hallazgos refleja evidencia real y no supuestos

---

## Fase 1 — Informe de hallazgos

**Objetivo:** presentarle al usuario todos los hallazgos en un formato claro y accionable.

### Formato del informe

Armá una tabla Markdown con una fila por hallazgo:

```markdown
# Hallazgos de seguridad — {AAAA-MM-DD}

## Resumen
- Hallazgos en código propio: {N} (Críticos: X, Altos: X, Medios: X, Bajos: X)
- Hallazgos en dependencias: {N} (Críticos: X, Altos: X, Medios: X, Bajos: X)
- Total: {N}

## Hallazgos

| # | Tipo | Severidad | Título | Archivo / Paquete | CWE / CVE | Impacto | Corrección disponible |
|---|------|-----------|--------|-------------------|-----------|---------|----------------------|
| 1 | Código | Alta | Inyección SQL | `lib/db/queries/contactos.ts:42` | CWE-89 | Un atacante puede extraer datos de la base con una entrada armada | Sí — sanear la entrada |
| 2 | Dependencia | Crítica | Prototype pollution | `lodash@4.17.15` | CVE-2019-10744 | Ejecución remota de código con un payload armado | Sí — actualizar a `lodash@4.17.21` |
```

**Definición de las columnas:**
- **Tipo:** `Código` (código propio) o `Dependencia` (paquete de terceros)
- **Severidad:** Crítica / Alta / Media / Baja
- **Título:** el nombre del problema
- **Archivo / Paquete:** para código, `ruta:línea`; para dependencias, `paquete@versión`
- **CWE / CVE:** CWE para código, CVE para dependencias (cuando esté disponible)
- **Impacto:** una oración — qué podría hacer un atacante si lo explota
- **Corrección disponible:** Sí (con descripción breve) o No

### Gate 1 — Confirmación de alcance

Después de presentar la tabla:
- Preguntá: **"Estos son los hallazgos. ¿Qué niveles de severidad querés corregir? (por ejemplo,
  Críticos + Altos, o todos). Ajusto el plan de remediación a tu respuesta."**
- **Frená. No avances hasta que el usuario defina el alcance.**

El resultado de un relevamiento no es, por sí solo, una aprobación para remediar. El Gate 1 define
qué hallazgos entran realmente en alcance.

---

## Configuración del aislamiento (inmediatamente después del Gate 1)

**Antes de escribir cualquier archivo**, preguntale al usuario cómo quiere aislar el trabajo:

> ¿Querés que trabaje en una rama nueva del checkout actual, o que cree un worktree de git aparte?

Usá la respuesta tal cual. Frená después de preguntar; no crees ni rama ni worktree hasta que el
usuario elija.

Si el checkout actual tiene cambios sin commitear, frená y preguntá antes de cambiar de rama o crear
un worktree.

### Opción A — Rama en el checkout actual

```bash
git switch develop && git pull --ff-only && git switch -c fix/security-{slug}
```

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin develop && mkdir -p .worktrees && git worktree add .worktrees/security-{slug} -b fix/security-{slug} origin/develop
```

Todo el trabajo posterior —documentación, código, commits— ocurre exclusivamente ahí. Nunca escribas
archivos directamente en `develop` o `main`.

---

## Seguimiento de estado — `.ways/state.json`

Seguí el **contrato de estado ways/v1alpha1** — el formato canónico de `.ways/state.json`
(`schemaVersion` 2), que viaja como la **regla siempre activa `state-contract`**, así que ya está en
tu contexto. Su origen en este repo es `ways/rulepacks/state-contract/`. No copies ni inventes un
esquema dentro de esta skill.

Valores propios de este flujo:
- `flow`: `security`
- `way`: `fmway/vuln` · `discipline`: `security` (opcionalmente `wayVersion` del manifiesto)
- Patrón de rama: `fix/security-{slug}`
- `phase` inicial: `findings`
- `isolationType`: `branch` o `worktree`, según la elección de aislamiento
- Documentos: `docs/security/{slug}/FINDINGS.md`, `docs/security/{slug}/PLAN.md`,
  `docs/security/{slug}/RESOLUTION.md`
- Gates: `plan`, `resolution`, `pr-develop`, `pr-main`

Al inicio de la sesión, leé `.ways/state.json` si existe. Si su `branch` coincide con la rama
`fix/security-{slug}` actual, informá la fase, el próximo paso y los gates pendientes, y retomá. Si
no existe o su `branch` no coincide, arrancá en la Fase 0 y creá o sobrescribí el archivo justo
después de configurar el aislamiento posterior al Gate 1. En cada transición actualizá `lastPhase`.

**Puntos de actualización (fase → qué escribir):**

| Cuándo | `phase` | Documentos / gates / steps |
|--------|---------|----------------------------|
| FINDINGS.md escrito | `findings` | `FINDINGS.md` → `approved` |
| PLAN.md redactado | `plan` | `PLAN.md` → `in-review` |
| **Gate 2 aprobado (plan)** | `implementation` | `PLAN.md` → `approved`; gate `plan` → `passed`; **generá los `steps` — una entrada por hallazgo en alcance, todas en `todo`** |
| Corrigiendo cada hallazgo | `implementation` | marcá su step `in-progress` → `done` (o `blocked`) — escribí el estado **por hallazgo, en el momento**, nunca todo junto al final |
| RESOLUTION.md escrito | `validation` | `RESOLUTION.md` → `approved` |
| **Gate 3 aprobado (resolución)** | `validation` | gate `resolution` → `passed` |
| PR fix→develop abierto | `pr-develop` | gate `pr-develop` → sigue `pending`; poné su `url` |
| PR mergeado a develop | `pr-develop` | gate `pr-develop` → `passed` |
| PR develop→main abierto | `pr-main` | gate `pr-main` → sigue `pending`; poné su `url` |
| PR mergeado a main | `done` | gate `pr-main` → `passed` |

No commitees `.ways/state.json` vos: solo escribilo. Cuando el usuario quiera persistir un
checkpoint, sugerí invocar `fmway-pr`.

---

## Fase 2 — Documentar los hallazgos

**Objetivo:** dejar el informe persistido como punto de entrada de la traza de auditoría.

### Dónde guardarlo

Dentro de la ubicación de trabajo elegida:

```
docs/security/{AAAA-MM-DD}-{slug-corto}/FINDINGS.md
```

**Slug:** resumen en kebab-case de 2 a 4 palabras del tipo de problema principal, por ejemplo
`2026-05-15-xss-sqli-consultas` o `2026-03-10-prototype-pollution-deps`.

### Estructura de FINDINGS.md

```markdown
# Hallazgos de seguridad — {AAAA-MM-DD}

## Metadatos del relevamiento
- Fecha: {AAAA-MM-DD}
- Fuentes: {auditoría de dependencias, avisos del host, revisión manual, …}
- Rama relevada: {nombre de la rama}
- Alcance acordado: {p. ej. Críticos + Altos}

## Tabla de hallazgos
{pegar la tabla completa de la Fase 1}

## Fuera de alcance
{Listar los hallazgos que el usuario decidió NO corregir, con un motivo breve}
```

Después de guardarlo:
- Decí: **"Hallazgos documentados en `docs/security/{slug}/FINDINGS.md`. Paso a redactar el plan de
  remediación para el alcance acordado."**
- Seguí directo a la Fase 3 (sin gate — el alcance ya se confirmó en el Gate 1).

---

## Fase 3 — Plan de remediación

**Objetivo:** diseñar una corrección concreta y revisable para cada hallazgo en alcance.

### Dónde guardarlo

```
docs/security/{slug}/PLAN.md
```

### Estructura de PLAN.md

```markdown
# Plan de remediación — {AAAA-MM-DD}

## Rama
`fix/security-{slug}`

## Modo de aislamiento
rama en el checkout actual | worktree aparte

## Hallazgos a corregir

### Hallazgo #1 — {Título} ({Severidad})
- **Tipo:** Código / Dependencia
- **Ubicación:** {archivo:línea o paquete@versión}
- **Causa raíz:** {una oración}
- **Enfoque de la corrección:** {acción concreta: actualizar X a Y / sanear la entrada en la línea Z / reemplazar la llamada / etc.}
- **Riesgo de la corrección:** Bajo / Medio / Alto — {por qué}
- **Verificación:** {cómo confirmar que quedó corregido: re-verificación + test específico}

### Hallazgo #2 — ...
```

### Gate 2 — Aprobación del plan

Después de escribir el plan:
- Decí: **"Plan de remediación listo en `docs/security/{slug}/PLAN.md`. Revisá el enfoque de cada
  hallazgo antes de que empiece a codear."**
- **Frená. No avances hasta que el usuario dé el OK.**

---

## Fase 4 — Implementación

**Objetivo:** aplicar las correcciones en la rama o el worktree elegido.

### Reglas

- Corregí de a un hallazgo. Después de cada uno, sugerí invocar `fmway-pr` para commitearlo — no
  commitees vos:

  ```
  fix(security): {título del hallazgo} — {CWE o CVE}

  Resuelve el hallazgo #{N} de docs/security/{slug}/FINDINGS.md
  Corrección: {descripción en una línea de qué cambió}
  ```
- Para **actualizaciones de dependencias:** actualizá el manifiesto de paquetes, reinstalá y
  verificá que no se rompan dependencias pares ni el build.
- Para **correcciones en código propio:** aplicá el cambio y agregá o actualizá un test que ejercite
  el camino vulnerable.
- Corré typecheck, lint y tests después de cada corrección, antes de sugerir el commit.

### Seguimiento del progreso

Actualizá `PLAN.md` a medida que avanzás — marcá cada hallazgo con el SHA de su commit una vez
corregido:

```markdown
- **Estado:** Corregido en `abc1234`
```

---

## Fase 5 — Validación

**Objetivo:** confirmar que las correcciones son efectivas y que no se introdujeron regresiones.

### Pasos

1. Volvé a correr la auditoría de dependencias con la misma herramienta de la Fase 0 y compará los
   resultados.
2. Volvé a revisar a mano cada hallazgo de código propio: releé el código corregido y verificá que el
   camino vulnerable ya no exista.
3. Corré la suite completa del proyecto: typecheck, lint, tests y build.

### Documento de resolución

Guardá `docs/security/{slug}/RESOLUTION.md`:

```markdown
# Informe de resolución — {AAAA-MM-DD}

## Resultados de la re-verificación
- Código propio: {N hallazgos restantes} (antes: {N})
- Dependencias: {N hallazgos restantes} (antes: {N})
- Corregidos: {lista de hallazgos resueltos}
- Restantes (fuera de alcance): {lista}

## Suite de verificación
- Typecheck: ✅ / ❌
- Lint: ✅ / ❌
- Tests: ✅ / ❌
- Build: ✅ / ❌

## Evidencia
{Pegar la salida clave de la re-verificación — confirmación de cero hallazgos, o los ítems fuera de
alcance que quedan}
```

### Gate 3 — Cierre de validación

Después de escribir el documento de resolución:
- Decí: **"Correcciones aplicadas y validadas. Informe de resolución en
  `docs/security/{slug}/RESOLUTION.md`. Todos los hallazgos en alcance quedaron resueltos y los tests
  están en verde. Revisalo antes de que abra el PR."**
- **Frená. Esperá la confirmación del usuario.**

---

## Fase 6 — Pull Request

### Flujo de ramas

```
fix/security-{slug}  →  develop  →  main
                         (PR 1)     (PR 2)
```

### PR 1 — fix/security-{slug} → develop

Superado el Gate 3, sugerí invocar `fmway-pr` para pushear la rama y abrir el PR a `develop`. No
pushees ni ejecutes `gh pr create` vos.

```
Título: fix(security): {resumen corto de lo corregido}
```

El cuerpo del PR tiene que incluir:
- **Resumen:** qué vulnerabilidades se corrigieron (tipo, severidad, cantidad).
- **Hallazgos:** link a `docs/security/{slug}/FINDINGS.md`.
- **Plan:** link a `docs/security/{slug}/PLAN.md`.
- **Resolución:** link a `docs/security/{slug}/RESOLUTION.md`.
- **Checklist:** auditoría de dependencias ✅, revisión de código ✅, typecheck ✅, lint ✅, tests ✅,
  build ✅.

Una vez abierto, compartí la URL. **Frená. No mergees hasta que el usuario apruebe.**

### PR 2 — develop → main

Después de mergear el PR 1, sugerí invocar `fmway-pr` de nuevo:

```
Título: release(security): {slug}
Cuerpo: Promueve las remediaciones de fix/security-{slug}. Traza completa en docs/security/{slug}/.
```

Una vez abierto, compartí la URL y esperá la aprobación del usuario.

---

## Referencia rápida — gates

| Gate | Disparador | Qué decir | Bloquea hasta |
|------|-----------|-----------|---------------|
| 1 | Tabla de hallazgos presentada | "¿Qué niveles de severidad querés corregir?" | El usuario define el alcance |
| 2 | PLAN.md escrito | "Plan listo en `docs/security/{slug}/PLAN.md`. Revisalo." | El usuario da el OK |
| 3 | RESOLUTION.md escrito | "Correcciones validadas. Revisá el informe antes del PR." | El usuario da el OK |
| 4 | Usuario confirma | Sugerir `fmway-pr` para el PR fix→develop; compartir la URL | El usuario aprueba el PR |
| 5 | PR 1 mergeado | Sugerir `fmway-pr` para el PR develop→main; compartir la URL | El usuario aprueba el PR |

---

## Archivos por relevamiento

```
docs/security/{AAAA-MM-DD}-{slug}/
  FINDINGS.md    — hallazgos crudos + alcance acordado  (Fase 2)
  PLAN.md        — enfoque de corrección por hallazgo    (Fase 3)
  RESOLUTION.md  — evidencia de re-verificación + tests  (Fase 5)
```

---

## Qué NO hacer

- No apliques ninguna corrección antes de superar el Gate 2 (aprobación del plan).
- No corrijas hallazgos fuera de alcance sin preguntarle antes al usuario.
- No asumas el alcance de la remediación, el riesgo aceptable ni la prioridad de negocio sin
  indicación explícita del usuario.
- No conviertas un resultado de relevamiento directamente en un plan de corrección si el alcance o el
  compromiso de riesgo todavía no están claros.
- No saltees la re-verificación de la Fase 5: que los tests pasen no confirma que la vulnerabilidad
  esté cerrada.
- No abras un PR sin un `RESOLUTION.md` que muestre los resultados de la re-verificación.
- No mergees de forma directa — siempre por PR, incluso para una actualización trivial de
  dependencias.
- No silencies hallazgos con reglas de exclusión sin instrucción explícita del usuario.
- No escribas FINDINGS.md, PLAN.md ni ningún otro archivo en `develop`/`main` antes de elegir el modo
  de aislamiento: la rama o el worktree se configuran inmediatamente después del Gate 1, y desde ese
  momento todos los archivos van dentro de la ubicación de trabajo elegida.
