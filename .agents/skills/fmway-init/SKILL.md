---
name: fmway-init
version: 1.0.0
description: Usar cuando se adopta fmway en un repositorio por primera vez, para dejarlo listo con lo que necesitan los flujos de desarrollo, bugs y vulnerabilidades. Detecta si el repo es nuevo (greenfield) o si ya tiene una aplicación existente (brownfield — el caso habitual), arma el CLAUDE.md, el árbol docs/, el modelo de ramas y el directorio .ways/, y conduce la documentación arquitectónica y funcional del código existente. También sirve para reinicializar o refrescar un proyecto que ya usa fmway.
---

# Proceso de inicialización de un repositorio

Flujo guiado por gates para incorporar un repositorio a fmway. Prepara el terreno que las demás
skills dan por sentado: un `CLAUDE.md` completo, un `PRD.md`, el árbol `docs/`, el modelo de ramas
`develop`/`main` y el directorio `.ways/`. Para una **aplicación existente** (brownfield, el caso
habitual) también conduce la **documentación arquitectónica y funcional**, para que las personas y
los flujos de fmway entiendan de verdad qué contiene el repo.

Este es un **flujo de bootstrap**, no un flujo de work item. **No** crea un `.ways/state.json` (ese
modelo es para el trabajo de `feature` / `bug` / `security` — ver el contrato de estado
ways/v1alpha1, que viaja como la regla siempre activa `state-contract`). Lo que sí hace es **crear el
directorio `.ways/`** que después pueblan los flujos de work item.

---

## Fase 0 — Orientación y detección de modo

**Objetivo:** decidir si el repositorio es greenfield o brownfield, y si fmway ya está (parcialmente)
configurado. Todavía no escribas nada.

### Checklist de detección

Hacé un relevamiento de solo lectura desde la raíz del repo:

```bash
git rev-parse --is-inside-work-tree 2>/dev/null; git log --oneline -1 2>/dev/null; git branch -a; ls -A
```

Después buscá las señales de abajo.

1. **¿Hay código de aplicación?** Directorios de fuente (`src/`, `app/`, `lib/`, `pkg/`, …) con
   código real, no de andamiaje.
2. **¿Hay manifiestos de dependencias o de build?** `package.json`, `pnpm-lock.yaml`, `pom.xml`,
   `build.gradle`, `go.mod`, `requirements.txt`/`pyproject.toml`, `Cargo.toml`, `*.csproj`,
   `Gemfile`, etc.
3. **¿Hay historial de git?** Cero commits o árbol vacío, contra un historial real.
4. **¿Ya está fmway?** Un `CLAUDE.md` que referencia los flujos de fmway, un directorio `.ways/` o
   `docs/architecture/`.
5. **¿Modelo de ramas?** Si `main` y `develop` ya existen.

### Clasificar el repo

- **Greenfield** — vacío o casi vacío (todavía sin código de aplicación; a lo sumo un README o una
  licencia). El trabajo es capturar la **intención**: la visión de producto y la arquitectura que el
  equipo planea construir.
- **Brownfield** — una aplicación existente con código e historial (**asumilo como el caso por
  defecto**). El trabajo es **reconstruir el entendimiento**: documentar la arquitectura y, cuando
  corresponde, el comportamiento funcional de lo que ya existe.
- **Ya inicializado** — la estructura de fmway está presente. Pasá a **modo refresco**: completar
  huecos, actualizar secciones desactualizadas y (en brownfield) volver a correr la pasada de
  documentación.

### Criterios de salida de la Fase 0

Antes del Gate 1, Claude tiene que poder enunciar:
- si el repo es greenfield, brownfield o ya inicializado
- el stack detectado (lenguajes, frameworks, gestor de paquetes, runner de tests, herramienta de
  build) — en brownfield, derivado de los manifiestos y de la estructura, no asumido
- si existen `main` y `develop` (y si git siquiera está inicializado)
- qué piezas de fmway ya existen y cuáles faltan
- el plan de inicialización propuesto (archivos a crear, estrategia de ramas, profundidad de la
  documentación)

No adivines el stack ni el propósito del producto. Si los manifiestos son ambiguos o la intención del
repo no está clara, anotalo como pregunta abierta para el Gate 1 en lugar de inventarlo.

---

## Gate 1 — Confirmar modo y alcance

Presentá el resultado de la detección y el plan propuesto, y confirmalo con el usuario.

```markdown
## Plan de inicialización

- **Modo:** greenfield | brownfield | refresco
- **Stack detectado:** {lenguajes / frameworks / gestor de paquetes / runner de tests}
- **Modelo de ramas:** {existen: main, develop} | {se van a crear: main, develop}
- **Se va a crear / actualizar:**
  - CLAUDE.md (desde la plantilla, completado con el stack detectado)
  - PRD.md (raíz) — {visión de producto (greenfield) | panorama reconstruido (brownfield)}
  - árbol docs/: prds/, bugs/, security/, architecture/
  - .ways/ (acá vive después el state.json de los work items)
- **Profundidad de documentación (brownfield):** {solo estructural | arquitectura | arquitectura + funcional}
- **Preguntas abiertas:** {lo que quede ambiguo del stack o de la intención del producto}
```

- Preguntá: **"Este es el plan de inicialización. Confirmame el modo y la profundidad de la
  documentación antes de que cree nada."**
- **Frená. No avances hasta que el usuario confirme el modo y el alcance.**

La detección del repo no es, por sí sola, una aprobación para andamiar. El Gate 1 fija el modo y la
profundidad de la documentación.

---

## Configuración del aislamiento (inmediatamente después del Gate 1)

**Antes de escribir cualquier archivo**, establecé el modelo de ramas y preguntale al usuario cómo
quiere aislar el trabajo de inicialización:

> ¿Querés que trabaje en una rama nueva del checkout actual, o que cree un worktree de git aparte?

Usá la respuesta tal cual. Frená después de preguntar; no crees ni rama ni worktree hasta que el
usuario elija.

Si el checkout actual tiene cambios sin commitear, frená y preguntá antes de cambiar de rama o crear
un worktree.

### Greenfield sin git todavía

Usá una rama en el checkout actual, salvo que el usuario pida explícitamente un worktree aparte
después de inicializar git. Este repo todavía no tiene commits, así que `main`/`develop` no pueden
existir sin uno — preguntá primero: **"Este repo todavía no tiene commits. ¿Creo un commit inicial vacío para establecer `main`?"** Recién después de que el usuario confirme:

```bash
git init && git checkout -b main && git commit --allow-empty -m "chore: commit inicial" && git checkout -b develop && git checkout -b chore/fmway-init
```

### Brownfield (git ya existe)

Si falta `develop`, hay que crearlo desde `main` (es una decisión que afecta a todo el repo:
confirmala en el Gate 1 si no se hizo antes) y pushearlo para que exista en el remoto. Preguntá
primero: **"`develop` todavía no existe. ¿Lo creo desde `main` y lo pusheo?"** Recién después de la
confirmación:

```bash
git checkout main && git checkout -b develop && git push -u origin develop
```

### Opción A — Rama en el checkout actual

```bash
git switch develop && git pull --ff-only && git switch -c chore/fmway-init
```

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin develop && mkdir -p .worktrees && git worktree add .worktrees/fmway-init -b chore/fmway-init origin/develop
```

Todo el trabajo posterior —CLAUDE.md, documentación, el andamiaje de `.ways/`, commits— ocurre ahí.
Nunca escribas directamente en `develop` o `main`.

---

## Fase 2 — Armar la estructura de fmway

**Objetivo:** crear los archivos y directorios que los flujos de fmway dan por sentados, completados
con información real y detectada (no con marcadores, cuando el repo da la respuesta).

### 2.1 — `CLAUDE.md`

Copiá la plantilla `claude.template.md` que trae esta skill (está al lado de este SKILL.md, así que
viaja con la skill en `ways add`) a la raíz del repo como `CLAUDE.md` y **completá cada
`[TODO: ...]`** con lo detectado en la Fase 0:

- **Sobre el proyecto** — en brownfield, derivalo del README, los manifiestos y el código; en
  greenfield, de la visión que el usuario dio en el Gate 1.
- **Stack** — lenguajes, frameworks, base de datos, testing, gestor de paquetes (detectados).
- **Estructura de carpetas** — el layout real de primer nivel, con el propósito de cada una en una
  línea.
- **Convenciones de código** — inferilas de la configuración existente (`.eslintrc`,
  `.editorconfig`, `tsconfig.json`, linters, formateadores) en brownfield; de los valores por defecto
  de la plantilla en greenfield.
- **Comandos útiles** — sacalos de los scripts del manifiesto (`scripts` de `package.json`,
  `Makefile`, `pom.xml`, etc.). **No** inventes comandos que no existen.
- Dejá las secciones obligatorias de **Seguridad**, **Aislamiento del trabajo**, **Flujo de
  desarrollo** y **Flujo de bugs** exactamente como las define la plantilla.

Lo que no puedas derivar, dejalo como un `[TODO: ...]` explícito y listalo en el Gate 2 — no lo
fabriques.

### 2.2 — `PRD.md` (raíz)

Los flujos de fmway leen `PRD.md` primero en su Fase 0. Crealo:

- **Greenfield:** capturá la visión de producto acordada en el Gate 1 — problema, usuarios
  objetivo, objetivos, no-objetivos y la arquitectura de alto nivel prevista.
- **Brownfield:** un **panorama de producto reconstruido** — qué hace hoy la aplicación, para quién,
  y cuáles son sus capacidades principales, trazable al código. Si `fmway-docs` entra en alcance (ver
  Fase 3), esto puede ser un puntero corto a `docs/architecture/` y a la documentación funcional,
  deliberadamente breve.

### 2.3 — Árbol `docs/` y `.ways/`

Creá la estructura de directorios en la que escriben los flujos:

```
docs/
  prds/          # acá escribe fmway-dev
  bugs/          # acá escribe fmway-bugs
  security/      # acá escribe fmway-vuln
  architecture/  # acá escribe fmway-docs (brownfield)
.ways/           # acá aterriza después el state.json de los work items (poné un .gitkeep)
```

Agregá `.gitkeep` a los directorios vacíos para que se commiteen. **No** crees acá un
`.ways/state.json`: le pertenece a los flujos de work item.

> `.ways/` es la raíz canónica del estado de los ways (`ways/v1alpha1`). Si el proyecto además usa la
> CLI `ways`, esa herramienta mantiene una **caché** en `.ways/cache/` — ver higiene del repo abajo.

### 2.4 — Higiene del repo (solo cuando haga falta)

- Agregá `.worktrees/` al `.gitignore` si todavía no está ignorado y vive dentro del repo.
- **Regla de gitignore para `.ways/`.** `.ways/state.json` **tiene que quedar versionado** (retomar
  por rama y el tablero dependen de que se commitee vía `fmway-pr`). Si se usa la CLI `ways`, ignorá
  solo su caché — agregá `.ways/cache/` (no todo `.ways/`) al `.gitignore`. Nunca ignores `.ways/`
  entero.
- Registrá en el `CLAUDE.md` los comandos reales de verificación del proyecto (tests, lint,
  typecheck, build, auditoría de dependencias). Los flujos de validación los leen de ahí; si no
  están, preguntale al usuario en lugar de inventarlos.

Avisale al usuario que el andamiaje está listo y sugerile invocar `fmway-pr` para commitearlo — no lo
commitees vos:

```
Mensaje sugerido: chore(fmway-init): CLAUDE.md, árbol docs/ y .ways/
```

---

## Fase 3 — Documentación de la aplicación

**Objetivo:** producir la documentación arquitectónica (y, cuando corresponda, funcional) que permite
a las personas y a los flujos de fmway entender la aplicación.

### Brownfield — invocar `fmway-docs`

Si la profundidad acordada en el Gate 1 es **arquitectura** o **arquitectura + funcional**, pasale el
trabajo a la skill **`fmway-docs`**, indicándole que escriba en la **rama o worktree de init actual**
(sin PR separado — su salida viaja con el PR de esta inicialización). `fmway-docs` produce, a la
escala de la app:

- `docs/architecture/` — panorama, componentes, modelo de datos, integraciones, despliegue y
  operación
- documentación funcional o de dominio y un glosario (cuando la app es de cara al usuario o tiene
  mucho dominio)
- diagramas Mermaid (validados)

Si la profundidad acordada es **solo estructural**, saltá la pasada profunda: la estructura de
carpetas del `CLAUDE.md` más el panorama del `PRD.md` alcanzan por ahora. Dejá anotado en `PRD.md`
que la documentación profunda quedó diferida y se puede generar después con `fmway-docs`.

### Greenfield — capturar la arquitectura prevista

No hay código para reconstruir. En su lugar, registrá la **intención** en
`docs/architecture/overview.md`: la arquitectura planificada, los componentes principales, las
decisiones tecnológicas clave y su fundamento (estilo ADR). Mantenelo liviano; va a evolucionar a
medida que se escriba el código con `fmway-dev`.

---

## Gate 2 — Revisión de la inicialización

Después del andamiaje (y de la documentación, cuando esté en alcance):

- Resumí qué se creó o se actualizó y listá cada `[TODO: ...]` que quede en `CLAUDE.md`, más las
  preguntas abiertas.
- Decí: **"Inicialización completa en `chore/fmway-init`. CLAUDE.md, PRD.md, el árbol docs/ y .ways/
  están en su lugar{, más la documentación de arquitectura y funcional}. Revisalo antes de que abra
  el PR."**
- **Frená. No abras el PR hasta que el usuario apruebe.**

---

## Fase 4 — Integración vía Pull Request

**Objetivo:** llevar la inicialización a `develop` (y después a `main`) mediante un PR revisado.
Nunca mergees de forma directa.

Después de la aprobación del Gate 2, sugerí invocar `fmway-pr` para pushear `chore/fmway-init`
(incluyendo el primer push de `main`/`develop` si el repo no tenía remoto ni historial) y abrir el PR.
No pushees ni ejecutes `gh pr create` vos.

```
Título: chore: inicializar fmway
```

El cuerpo del PR tiene que incluir:
- **Modo:** greenfield / brownfield / refresco.
- **Creado o actualizado:** CLAUDE.md, PRD.md, árbol docs/, .ways/ y (si los hay) los documentos de
  arquitectura y funcionales, con sus links.
- **Ítems abiertos:** los `[TODO: ...]` que quedan y las preguntas abiertas para el equipo.

Una vez abierto, compartile la URL al usuario. **Frená. No mergees hasta que el usuario apruebe.**

Si el equipo también usa gate en `main`, abrí el PR de seguimiento `develop → main` una vez mergeado
el primero, igual que en el flujo de desarrollo.

---

## Referencia rápida — gates

| Gate | Disparador | Qué decir | Bloquea hasta |
|------|-----------|-----------|---------------|
| 1 | Modo y plan detectados | "Este es el plan de inicialización. Confirmame el modo y la profundidad." | El usuario confirma |
| 2 | Andamiaje (+ docs) listo | "Inicialización completa en `chore/fmway-init`. Revisalo antes del PR." | El usuario aprueba |
| 3 | Revisado | Sugerir `fmway-pr` para el PR `chore/fmway-init → develop`; compartir la URL | El usuario aprueba el PR |

---

## Qué NO hacer

Las reglas de cada fase mandan; el único punto que no está enunciado en otro lado:

- Los comandos de bootstrap de greenfield y brownfield son la **única** excepción a la regla de no
  commitear automáticamente, y aun así requieren preguntar primero. Todo lo demás (el commit del
  andamiaje, el PR) ocurre únicamente vía `fmway-pr`.
