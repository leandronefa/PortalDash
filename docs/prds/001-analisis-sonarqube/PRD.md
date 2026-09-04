# PRD — Análisis de SonarQube/SonarCloud sobre todos los tableros

## Estado
Aprobado

## Problema

Hoy SonarCloud analiza `PortalDash` en modo **Automatic Analysis** (sin pipeline propio, sin
`sonar-project.properties`, sin workflow de GitHub Actions): el check "SonarCloud Code Analysis" que
corre en cada PR es superficial. Dos problemas concretos:

1. **Soporte débil para C#/.NET.** El modo automático de SonarCloud no ejecuta el build del proyecto,
   así que el análisis de `portal-src/` y `dashboards/APCWeb/` (ambos .NET) es limitado — para
   analizar C# en serio, Sonar necesita correr durante un build real vía `dotnet-sonarscanner
   begin/end`.
2. **Sin exclusiones ni configuración explícita.** Al no haber `sonar-project.properties`, no hay
   control fino sobre qué carpetas analiza ni cómo separa fuentes de artefactos de build.

El usuario quiere que SonarQube/SonarCloud analice de verdad **todos los tableros** (los ~17
dashboards Node.js/Express + Vite/React, más el portal y APCWeb en .NET), no solo lo que el modo
automático alcanza a cubrir.

## Objetivos

- Reemplazar el análisis "Automatic Analysis" por un análisis disparado desde **GitHub Actions**,
  usando `sonar-scanner` (CLI) para el código JS/TS de portal-frontend y dashboards, y
  `dotnet-sonarscanner begin/end` envolviendo el build real para los proyectos .NET
  (`portal-src/`, `dashboards/APCWeb/`).
- Mantener **un solo proyecto Sonar** para todo el repo (`vallejo-sanjuan_PortalDash`, como ya existe
  hoy en SonarCloud) — no se crean proyectos Sonar separados por dashboard en esta iteración.
- Que el análisis corra automáticamente en cada Pull Request (igual que hoy) y en pushes a `master`.
- Excluir de forma explícita del análisis lo que ya excluye `.gitignore` (build artifacts, `dist/`,
  `node_modules/`, `bin/`, `obj/`, `App_Data/`, exports de datos, etc.), para que Sonar no reporte
  ruido sobre código generado o de terceros.

## No-objetivos

- No se crean múltiples proyectos Sonar (uno por dashboard) — queda diferido a una iteración futura
  si hace falta.
- No se define ni se ajusta el Quality Gate (umbrales de cobertura, duplicación, etc.) — se usa el que
  ya está configurado en SonarCloud salvo que el usuario pida cambiarlo.
- No se agrega cobertura de tests nueva: si un dashboard no tiene tests, Sonar simplemente reportará
  0% de cobertura para ese código — no es alcance de este PRD escribir tests.
- No se modifica el modo de autenticación ni la organización de SonarCloud (`vallejo-sanjuan`), solo
  se agrega el token necesario como secret del repo.

## Historias de usuario

- Como responsable de calidad de PortalDash, quiero que cada PR dispare un análisis real de Sonar
  sobre el código que tocó (incluyendo C#), para detectar bugs/vulnerabilidades antes del merge.
- Como desarrollador de un dashboard puntual, quiero poder ver en SonarCloud los hallazgos de mi
  carpeta específica dentro del proyecto único, sin que otro dashboard le "tape" el resultado.

## Requisitos funcionales

1. Workflow de GitHub Actions (`.github/workflows/sonarcloud.yml`) que corre en `pull_request` (hacia
   `master`) y en `push` a `master`.
2. El workflow instala Node y .NET, y ejecuta el análisis en dos pasos dentro del mismo job (o dos
   jobs coordinados con el mismo `sonar-scanner`):
   - `dotnet-sonarscanner begin` → `dotnet build` (portal-src + APCWeb) → `dotnet-sonarscanner end`
   - Análisis del resto del código (todos los dashboards Node/Vite/React) vía `sonar-scanner` CLI,
     apuntando a `dashboards/**` con las exclusiones correspondientes.
   - Antes del análisis, para los 8 dashboards con frontend Vite (ComisionesINDO, EstadoResultado,
     PassReset, ControlCaja, MovimientosCaja, DashPromocionesMP, comisiones-app,
     sucursal-user-visualizer) el workflow corre `npm install && npm run build` (o `build:prod` en
     los dos últimos, que además compilan el backend TS) para que Sonar analice sobre build real. Los
     8 dashboards restantes (MotorReposicion, DashMeLi, ConciliacionPunitorios, ValidacionCobranzas,
     VentaObjetivo, StockProveedorMarca, VentaObjetivoSucursal, tablero-objetivos-web) no tienen script
     `build` — son server-only sin frontend Vite — así que el workflow solo corre `npm install` sobre
     ellos y Sonar los analiza como fuente estática, sin paso de build.
   - El workflow **nunca** ejecuta `npm run generar` (ConciliacionPunitorios, ValidacionCobranzas) ni
     ningún otro script fuera de `install`/`build`/`start` — esos scripts sí tocan datos reales
     (Excel, red interna) y no deben dispararse en CI.
3. `sonar-project.properties` en la raíz del repo con: `sonar.projectKey=vallejo-sanjuan_PortalDash`,
   `sonar.sources` apuntando a `portal-src`, `dashboards` (con subcarpetas), `sonar.exclusions` para
   `node_modules`, `dist`, `dist-server`, `bin`, `obj`, `App_Data`, `daemon`, exports de datos y
   demás carpetas ya listadas en `.gitignore`.
4. El secret `SONAR_TOKEN` se agrega a los secrets del repositorio en GitHub (Settings → Secrets and
   variables → Actions) — **esto lo hace el usuario manualmente**, ya que requiere generar el token
   desde la cuenta de SonarCloud y no es una acción que se pueda automatizar sin credenciales.
5. El check de SonarCloud sigue apareciendo en los PRs (como hoy), pero ahora reflejando un análisis
   real de build, no el modo automático.
6. Documentar el flujo en `docs/architecture/overview.md` o en un nuevo apunte breve, para que quede
   registrado cómo se dispara el análisis y dónde vive la config.

## Requisitos no funcionales

- El job de CI no debe agregar más de unos pocos minutos al tiempo total de un PR (analizar 17
  proyectos Node + 2 .NET puede ser pesado — cachear `node_modules`/paquetes NuGet donde se pueda).
- No exponer el `SONAR_TOKEN` en logs ni en el código del workflow (usar `secrets.SONAR_TOKEN`).
- El workflow no debe fallar builds existentes: si algún dashboard no tiene `npm install`/build
  reproducible en CI (por ejemplo, dependencias privadas o `.env` requeridos en build time), hay que
  detectarlo en la Fase 3 y decidir si se excluye ese dashboard del build-based scan (quedando solo
  con análisis estático de fuente, sin build) en vez de romper el pipeline.

## Cambios en el modelo de datos

Ninguno.

## Notas de UI/UX

Ninguna — es tooling de CI, no hay superficie de usuario.

## Preguntas abiertas

Todas resueltas:

1. **`SONAR_TOKEN`** — ya generado por el usuario y cargado como secret del repo
   (`vallejo-sanjuan/PortalDash` → Settings → Secrets and variables → Actions) durante esta misma
   sesión.
2. **Builds en CI sin red interna** — revisado dashboard por dashboard (ver requisito funcional 2 de
   arriba). Los 8 dashboards con Vite compilan limpio en un runner sin red interna: ninguno hace
   fetch/lectura de red durante el build; el único uso de `.env`/`loadEnv` en tiempo de build es para
   valores con fallback hardcodeado (URLs de proxy de dev) o un `define` de `GEMINI_API_KEY` que, si
   falta, mete el string literal `"undefined"` en el bundle sin romper la compilación (impacto
   cosmético, no funcional para este PRD). Los 8 dashboards restantes no tienen script `build`. Nada
   bloquea correr esto en `ubuntu-latest`.
3. **Runner** — `ubuntu-latest` hosted por GitHub, confirmado por el usuario. No hace falta
   self-hosted: el análisis es estático y los builds de arriba no requieren red interna.

## Conflictos y dependencias

- Depende de que el `SONAR_TOKEN` se cargue como secret del repo antes de que el workflow pueda
  correr con éxito (si no está, el job va a fallar en el paso de autenticación contra SonarCloud).
- No hay PRDs previos en `docs/prds/` con los que solape (es el primero del repo desde la
  inicialización de fmway).
- El PR #1 de inicialización de fmway (`chore/fmway-init`) todavía no está mergeado a `master`; esta
  rama (`feat/sonarqube-tableros`) se creó desde `master` sin ese scaffolding — no hay conflicto de
  archivos esperado entre ambos PRs.
