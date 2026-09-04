# CLAUDE.md — Plantilla

> **Cómo usar esta plantilla:**
> 1. Preferí correr la skill `fmway-init`: copia y completa esta plantilla automáticamente con el
>    stack detectado, arma `docs/` y `.ways/` y, para una aplicación existente, documenta la
>    arquitectura. Los pasos manuales de abajo son solo para un arranque rápido.
> 2. Copiá este archivo como `CLAUDE.md` en la raíz del proyecto nuevo.
> 3. Completá todas las secciones marcadas con `[TODO: ...]`.
> 4. Eliminá las secciones que no apliquen al proyecto.
> 5. Borrá este bloque de instrucciones.
>
> Las secciones **Seguridad**, **Aislamiento del trabajo**, **Flujo de desarrollo** y **Flujo de
> bugs** son obligatorias y no se modifican: son el núcleo del proceso de desarrollo estructurado.

---

# CLAUDE.md

Instrucciones para Claude Code al trabajar en este repositorio.

## Sobre el proyecto

[TODO: descripción del producto, para quién es, qué problema resuelve. Mencionar la documentación
principal que Claude tiene que leer antes de trabajar (PRD.md, docs/, etc.).]

Leer antes de trabajar: `PRD.md`, la documentación de arquitectura en `docs/architecture/` (y
`docs/functional/` si existe). Si todavía no existen, generalos con la skill `fmway-docs`.

## Stack

[TODO: lenguajes, frameworks, librerías principales y restricciones. Ejemplos:]

- **Lenguaje:** TypeScript estricto (`"strict": true`) / Python / C# / Go
- **Framework:** Next.js 15 (App Router) / NestJS / FastAPI / .NET
- **Base de datos:** SQL Server / Postgres / MySQL / MongoDB + el ORM que se use
- **Testing:** Vitest + Playwright / Jest + Cypress / pytest / xUnit
- **Gestor de paquetes:** pnpm / npm / uv / NuGet

No agregues dependencias adicionales sin una justificación explícita.

## Estructura de carpetas

[TODO: estructura de directorios del proyecto, con el propósito de cada carpeta principal.]

```
[estructura acá]
/docs
  /architecture   # Arquitectura y diagramas (fmway-docs) — mantener sincronizada con el código
  /functional     # Documentación funcional o de dominio (si la app es de cara al usuario)
  /prds           # PRDs de features (fmway-dev)
  /bugs           # Reportes de bugs (fmway-bugs)
  /security       # Registros de remediación (fmway-vuln)
  /requirements   # Tickets refinados (fmway-po)
/tests
  /unit
  /e2e
```

Nunca borres documentación bajo `/docs`.

## Convenciones de código

[TODO: completar o ajustar según el lenguaje y el framework del proyecto.]

- **Nomenclatura:** camelCase para variables y funciones, PascalCase para clases y componentes,
  snake_case en la base de datos.
- **Errores:** nunca te comas un error con un catch vacío. Usá un envoltorio que devuelva
  `Result<T, Error>` o que lance excepciones con contexto.
- **Imports:** usá los alias de ruta configurados. Nada de rutas relativas con `../../../`.
- **Sin `any`:** preferí tipos estrictos y estrechamiento explícito.
- **Comentarios:** solo cuando el "por qué" no se desprende del código. NO documentes el "qué".
- [TODO: convenciones adicionales del proyecto]

## Comandos útiles

[TODO: los comandos reales del proyecto. Los flujos de validación de fmway los leen de acá — si
faltan, el agente tiene que preguntar en lugar de inventarlos.]

```bash
# Desarrollo
[comando de dev]

# Build
[comando de build]

# Tests
[comando de tests unitarios]
[comando de tests e2e]

# Lint + verificación de tipos
[comando de lint]
[comando de typecheck]

# Auditoría de dependencias
[comando de auditoría: npm audit, pip-audit, dotnet list package --vulnerable, …]

# Base de datos (si aplica)
[comando de migraciones]
[comando de seed]
```

## Variables de entorno

Ver `.env.example`. Nunca commitees `.env.local` ni archivos con credenciales reales.

[TODO: variables críticas a destacar, en especial cuáles son seguras para el cliente y cuáles son
solo del servidor.]

Regla universal: las claves secretas (API keys, tokens de servicio, contraseñas de base de datos)
**nunca** se exponen en el cliente ni en los logs.

## Seguridad (OBLIGATORIO)

Cuando se detecten vulnerabilidades (auditoría de dependencias, avisos del host de repos, reportes de
terceros o revisión manual), **siempre** invocá la skill `fmway-vuln` antes de aplicar cualquier
corrección. La skill maneja el proceso completo: relevamiento → triage → rama aislada → corrección →
re-verificación → PR.

**No apliques correcciones de seguridad directamente sin pasar por la skill.**

## Aislamiento del trabajo primero (REGLA UNIVERSAL)

**Todo trabajo —features, bugs, correcciones de seguridad, cualquier cambio— arranca eligiendo con el
usuario cómo aislarlo, antes de tocar un solo archivo.**

Preguntá siempre:

> ¿Querés que trabaje en una rama nueva del checkout actual, o que cree un worktree de git aparte?

Usá exactamente la opción que elija el usuario. Frená después de preguntar; no crees ni rama ni
worktree hasta que elija.

Si el checkout actual tiene cambios sin commitear, frená y preguntá antes de cambiar de rama o crear
un worktree.

### Opción A — Rama en el checkout actual

```bash
git switch develop && git pull --ff-only && git switch -c {tipo}/{slug}
```

Todo el trabajo ocurre en esa rama. Nunca crees archivos en `develop` o `main` con la intención de
moverlos después.

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin develop && mkdir -p .worktrees && git worktree add .worktrees/{slug} -b {tipo}/{slug} origin/develop
```

Todo el trabajo ocurre dentro de ese worktree: documentación, código, configuración, todo.

## Commits y PRs (REGLA UNIVERSAL)

**Ninguna skill ni flujo commitea, pushea o abre un PR por su cuenta.** `fmway-pr` es la única skill
que ejecuta `git add`, `git commit`, `git push` o `gh pr create`, y solo corre cuando el usuario lo
pide explícitamente (por nombre, o con "commiteá esto", "pusheá esto", "preparame el PR"). Todos los
demás flujos escriben archivos y, en los checkpoints naturales, le avisan al usuario que está listo y
le sugieren invocar `fmway-pr` — nunca ejecutan esos comandos de git ellos mismos.

## Flujo de desarrollo (OBLIGATORIO para cualquier feature nueva)

Para cualquier funcionalidad nueva o cambio significativo, **siempre** invocá la skill `fmway-dev`
antes de escribir una sola línea de código. La skill define un proceso con gates de aprobación
explícitos:

1. **Fase 0** — Orientación: leer PRD.md y docs/
2. **Aislamiento** — Preguntar si rama en el checkout actual o worktree aparte, **antes de escribir
   nada**
3. **Fase 1** — Escribir el PRD en `docs/prds/{slug}/PRD.md` → **esperar aprobación**
4. **Fase 2** — Plan de implementación en `docs/prds/{slug}/PLAN.md` → **esperar aprobación**
5. **Fase 3** — Implementación
6. **Fase 4** — Validación + guía de prueba → **esperar devolución**
7. **Fase 5** — PRs: `feat/{slug}` → `develop` → `main`, abiertos solo cuando el usuario invoca
   `fmway-pr`

**Nunca escribas código antes de que el usuario apruebe el PRD (Gate 1).**

## Flujo de corrección de bugs (OBLIGATORIO para cualquier bug)

Para cualquier bug reportado o descubierto, **siempre** invocá la skill `fmway-bugs` antes de
escribir una línea del fix. La skill define un proceso con un gate de aprobación explícito:

1. **Aislamiento** — Preguntar si rama o worktree, **antes de escribir nada**
2. **Fase 1** — Documentar en `docs/bugs/{id}-{slug}/BUG.md`
3. **Fase 2** — Análisis en `docs/bugs/{id}-{slug}/ANALYSIS.md`
4. **Fase 3** — Test de reproducción que falla antes del fix
5. **Fase 4** — Plan en `docs/bugs/{id}-{slug}/FIX_PLAN.md` → **esperar aprobación**
6. **Fase 5** — Implementar (solo lo que dice el plan)
7. **Fase 6** — Validación + revisión de seguridad
8. **Fase 7** — PR `fix/{slug}` → `develop`, abierto solo cuando el usuario invoca `fmway-pr`

**Nunca escribas código del fix antes de que el usuario apruebe el FIX_PLAN.**

## Tests obligatorios

[TODO: tests que sí o sí tienen que existir antes de dar por terminada una feature. Pensar en:]

- Casos críticos del dominio del negocio
- Casos de deduplicación o idempotencia si el sistema importa o procesa datos
- Reglas de acceso y autorización (quién puede leer, quién puede escribir)
- Contratos de API o exportaciones que consumen otros sistemas

Antes de marcar una fase como terminada, corré siempre la suite completa.

## Datos sensibles

[TODO: completar si el proyecto maneja datos personales u otra información sensible.]

Principios universales:
- Nunca loguees datos personales (correos, teléfonos, documentos) en producción.
- Confirmación explícita al exportar datos sensibles.
- En la interfaz, ocultá los campos sensibles por defecto detrás de una acción del usuario.

## Qué no hacer

[TODO: restricciones específicas del proyecto.]

Restricciones universales:
- No mezcles lógica de negocio con lógica de presentación.
- No uses bypasses de autorización en código que corre del lado del cliente.
- No incluyas secretos en bundles del cliente.
- No hagas `git push --force` a `main` ni a `develop`.
- No saltees los hooks de git (`--no-verify`) sin un motivo explícito.
- No commitees, pushees ni abras un PR sin que el usuario lo pida — invocá `fmway-pr` solo cuando lo
  pida, y en el resto de los casos limitate a sugerirlo.

## Ante la duda

Si una decisión no está cubierta en `PRD.md` ni en `docs/`, **preguntá** en lugar de improvisar. La
opinión del usuario importa.
