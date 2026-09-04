---
name: fmway-docs
version: 1.0.0
description: Usar para producir o refrescar la documentación arquitectónica y funcional de un código existente (brownfield), de modo que las personas y los flujos de fmway entiendan la aplicación. La invoca fmway-init durante la incorporación de un repo brownfield, o se corre por separado para documentar un módulo o actualizar documentación desactualizada. Especialmente importante cuando el repo tiene código real pero no tiene documentación de arquitectura viva, o cuando la documentación existente se separó del código.
---

# Proceso de documentación de un código existente

Flujo guiado por gates para convertir un **código existente** en documentación clara y trazable: qué
es la aplicación, cómo está construida, cómo encajan sus piezas y —cuando es un producto con
comportamiento de cara al usuario— qué hace funcionalmente. La salida vive en `docs/architecture/`
(y, cuando corresponde, en documentación funcional o de dominio) y es el contexto que leen los demás
flujos de fmway en su Fase 0.

Dos modos de invocación:

- **Como parte de `fmway-init` (incorporación brownfield):** escribe en la **rama o worktree de init
  actual**; la documentación viaja con el PR de inicialización. Sin rama ni PR separados.
- **Por separado (refresco o documentar un módulo):** rama propia `docs/{slug}` → PR a `develop`.

Este es un **flujo de documentación**. Igual que `fmway-init`, **no** mantiene un `.ways/state.json`
(ese modelo es para el trabajo de `feature` / `bug` / `security`).

---

## Fase 0 — Relevamiento

**Objetivo:** entender qué existe antes de decidir qué documentar. Solo lectura.

### Relevamiento inicial

1. Confirmá el alcance con el contexto disponible:
   - repo completo, o un módulo, servicio o contexto acotado
   - profundidad: **solo arquitectura**, o **arquitectura + funcional/dominio**
   - si es una pasada nueva o un **refresco** de documentación existente
2. Leé lo que ya está documentado (`README.md`, `docs/`, `PRD.md`, cualquier exportación de una wiki)
   para **no duplicar** y para detectar qué se desactualizó.

### Inventario del código

Relevá, todavía sin escribir:

- **Lenguajes / frameworks / runtime** — desde los manifiestos y la configuración.
- **Puntos de entrada** — `main`, arranque del servidor, CLI, handlers, tareas programadas.
- **Módulos / capas** — la descomposición real de primer nivel (hexagonal, MVC, carpetas por
  feature, microservicios, …).
- **Almacenamiento** — bases de datos, cachés, colas, almacenamiento de archivos; dónde viven el
  esquema y las migraciones.
- **Integraciones externas** — APIs de terceros, proveedores de pago o autenticación, servicios
  internos que llama o que lo llaman.
- **Build / ejecución / tests / despliegue** — scripts, configuración de CI, contenedores,
  infraestructura como código.
- **Aspectos transversales** — autenticación, configuración, logging y observabilidad, manejo de
  errores.

### Criterios de salida de la Fase 0

Antes del Gate 1, Claude tiene que poder enunciar:
- el alcance y la profundidad que se van a documentar
- los módulos o servicios principales y cómo parecen relacionarse
- los almacenamientos y las integraciones externas en juego
- qué documentación existente se reutiliza, cuál está desactualizada y qué huecos quedan
- qué áreas no están claras y van a quedar como preguntas abiertas en lugar de asumirse

No deduzcas el comportamiento de un componente por su nombre. Si el código no lo deja claro, se
convierte en una pregunta abierta, no en una afirmación confiada.

---

## Gate 1 — Mapa de documentación

Proponé el **conjunto de documentos** a producir, a la escala de la aplicación (una CLI chica
necesita muchísimo menos que una plataforma de varios servicios). Presentalo como checklist:

```markdown
## Mapa de documentación propuesto

### Arquitectura (docs/architecture/)
- [ ] overview.md      — contexto, propósito, arquitectura de alto nivel, stack
- [ ] components.md    — cada módulo o servicio: responsabilidad, archivos clave, dependencias
- [ ] data-model.md    — entidades, almacenamiento, esquema y migraciones, relaciones
- [ ] integrations.md  — sistemas externos y llamadas entre servicios internos
- [ ] deployment.md    — build, entornos, CI/CD, topología de ejecución   (si aplica)
- [ ] diagrams.md      — Mermaid: contexto, componentes, secuencias clave, DER

### Funcional / dominio (docs/functional/)        (solo si es de cara al usuario o pesado en dominio)
- [ ] domain.md        — conceptos de dominio, reglas de negocio, glosario
- [ ] flows.md         — flujos principales de usuario o de negocio, de punta a punta
```

- Sacá lo que la app no justifique; agregá lo específico que necesite.
- Preguntá: **"Este es el mapa de documentación para {alcance}. Confirmalo antes de que empiece a
  escribir."**
- **Frená. No escribas documentación hasta que el usuario confirme el mapa.**

---

## Configuración del aislamiento (solo en modo autónomo)

Si corrés **dentro de `fmway-init`**, saltealo: escribí en la rama de init existente.

Si corrés **por separado**, preguntale al usuario cómo quiere aislar el trabajo antes de escribir:

> ¿Querés que trabaje en una rama nueva del checkout actual, o que cree un worktree de git aparte?

Usá la respuesta tal cual. Frená después de preguntar; no crees ni rama ni worktree hasta que el
usuario elija.

Si el checkout actual tiene cambios sin commitear, frená y preguntá antes de cambiar de rama o crear
un worktree.

### Opción A — Rama en el checkout actual

```bash
git switch develop && git pull --ff-only && git switch -c docs/{slug}
```

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin develop && mkdir -p .worktrees && git worktree add .worktrees/docs-{slug} -b docs/{slug} origin/develop
```

`{slug}` es el alcance en kebab-case (por ejemplo `architecture`, `modulo-pagos`). Toda la
documentación se escribe dentro de la ubicación de trabajo elegida.

---

## Fase 2 — Redactar la documentación

**Objetivo:** escribir cada documento confirmado, anclado en el código real.

### Reglas de redacción (no negociables)

- **Trazable.** Toda afirmación no trivial apunta a su fuente — `ruta/al/archivo.ext:línea`, un
  módulo o una clave de configuración. El lector tiene que poder verificarla en el código.
- **Sin invención.** Documentá lo que el código hace, no lo que "debería" hacer. Si un
  comportamiento no está claro, va bajo **Preguntas abiertas / a verificar** — nunca lo adivines.
- **Los conflictos se registran, no se resuelven en silencio.** Si dos partes del código (o el
  código y un documento existente) se contradicen, dejá la contradicción explícita.
- **Prosa concisa.** Oraciones cortas y directas. Sin relleno. Viñetas y tablas antes que párrafos
  cuando se lean mejor.
- **Refrescar es reconciliar.** En modo refresco, actualizá lo desactualizado contra el código actual
  y señalá qué cambió; no agregues a ciegas.

### Forma sugerida por documento

`docs/architecture/overview.md`:

```markdown
# Panorama de arquitectura — {nombre de la app}

## Qué es
Un párrafo: propósito y quién la usa. (fuente: README / PRD / punto de entrada)

## Stack
Lenguajes, frameworks, almacenamiento, infraestructura — cada uno con dónde se configura.

## Arquitectura de alto nivel
La forma (capas / servicios / orientada a eventos / …) y por qué, con un diagrama de contexto en
Mermaid.

## Mapa de módulos
| Módulo | Responsabilidad | Ruta clave | Con qué habla |
|--------|-----------------|------------|---------------|

## Aspectos transversales
Autenticación, configuración, logging y observabilidad, manejo de errores — dónde vive cada uno.

## Preguntas abiertas / a verificar
- …
```

Replicá ese estilo trazable y con tablas en `components.md`, `data-model.md`, `integrations.md` y
—cuando esté en alcance— en la documentación funcional. `data-model.md` tiene que apuntar a los
archivos de esquema y migraciones; `integrations.md` tiene que nombrar cada sistema externo y el
código que lo llama.

---

## Fase 3 — Diagramas

Producí diagramas **Mermaid** en `docs/architecture/diagrams.md`, a la escala de la app:

- **Contexto / contenedores** — el sistema, sus actores externos y sus dependencias.
- **Componentes** — módulos y servicios internos y sus relaciones.
- **Secuencia** — los 1 a 3 flujos de punta a punta más importantes.
- **DER** — el modelo de datos central, cuando hay un esquema significativo.

**Validá cada diagrama contra el parser de Mermaid antes de cerrar.** Un diagrama que no renderiza es
peor que ninguno. Mantenelos legibles: partí un diagrama sobrecargado en varios más acotados.

---

## Gate 2 — Revisión

Cuando la documentación y los diagramas están escritos:

- Entregá el índice (qué se produjo y dónde) y listá las **Preguntas abiertas / a verificar** reunidas
  en todos los documentos.
- Decí: **"Documentación lista en `docs/architecture/`{ y `docs/functional/`}. Dejé listadas las
  preguntas abiertas para que las respondas. Revisala."**
- **Frená. Esperá la revisión del usuario antes de seguir.**

Si corrés dentro de `fmway-init`, el control vuelve al flujo de init en su Gate 2: la documentación se
revisa ahí y viaja con el PR de inicialización. El paso de PR autónomo de abajo se saltea.

---

## Fase 4 — PR (solo en modo autónomo)

Sugerí invocar `fmway-pr` para pushear `docs/{slug}` y abrir el PR. No pushees ni ejecutes
`gh pr create` vos.

```
Título: docs({slug}): documentar {alcance}
```

El cuerpo del PR tiene que incluir:
- **Alcance:** qué se documentó y con qué profundidad.
- **Índice:** links a cada documento producido o actualizado.
- **Preguntas abiertas:** los ítems sin resolver que necesitan definición del equipo.

Una vez abierto, compartí la URL. **Frená. No mergees hasta que el usuario apruebe.**

---

## Referencia rápida — gates

| Gate | Disparador | Qué decir | Bloquea hasta |
|------|-----------|-----------|---------------|
| 1 | Mapa propuesto | "Este es el mapa de documentación para {alcance}. Confirmalo." | El usuario confirma |
| 2 | Documentación escrita | "Documentación lista en `docs/architecture/`. Revisala." | Revisión del usuario |
| 3 | (autónomo) Revisado | Sugerir `fmway-pr` para el PR `docs/{slug} → develop`; compartir la URL | El usuario aprueba el PR |

---

## Qué se produce

```
docs/
  architecture/
    overview.md         # contexto, stack, arquitectura de alto nivel
    components.md       # desglose de módulos y servicios
    data-model.md       # entidades, almacenamiento, esquema
    integrations.md     # integraciones externas e internas
    deployment.md       # build, entornos, CI/CD, topología   (si aplica)
    diagrams.md         # diagramas Mermaid validados
  functional/           # solo si es de cara al usuario o pesado en dominio
    domain.md           # conceptos de dominio + glosario
    flows.md            # flujos principales de punta a punta
```

---

## Qué NO hacer

- No escribas documentación antes de que el Gate 1 confirme el mapa.
- No inventes comportamiento, estructura ni intención. Todo lo que no sea verificable en el código va
  bajo "Preguntas abiertas / a verificar".
- No hagas afirmaciones no trazables: toda oración no trivial apunta a un archivo, módulo o clave.
- No cierres un diagrama que falla al renderizar en el parser de Mermaid.
- No abras un PR separado cuando te invoca `fmway-init`: la documentación viaja con el PR de init.
- No escribas directamente en `develop` o `main` en modo autónomo — usá la rama `docs/{slug}`.
