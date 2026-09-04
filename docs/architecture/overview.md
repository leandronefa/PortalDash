# Arquitectura — PortalDash (puntero)

Este monorepo ya tiene documentación de arquitectura viva y detallada fuera de `docs/architecture/`;
este archivo es solo un índice para no duplicarla. Profundidad de documentación elegida en la
inicialización de fmway: **solo estructural**.

## Dónde está la arquitectura real

- **Portal** (.NET 9 + YARP, login, permisos, proxy inverso):
  - `portal-src/ARCHITECTURE.md`
  - `portal-src/CONTEXT.md`
  - `portal-src/CLAUDE.md`
  - `portal-src/deploy/OPERATIONS-10.0.0.118.md` (estado real de la instalación en el servidor)
- **Dashboards** (Node.js/Express + Vite/React, un servicio Windows por dashboard):
  - `dashboards/CLAUDE.md` (mapa completo: carpeta, servicio, puerto, proxy `/d/{id}/`)
  - `dashboards/{Nombre}/CLAUDE.md` (particularidades de cada dashboard)
- **Cómo agregar un dashboard nuevo:** `NUEVO-TABLERO.md`
- **Panorama de producto:** `PRD.md` (raíz)

## Análisis de calidad (SonarCloud)

El repo se analiza con [SonarCloud](https://sonarcloud.io/dashboard?id=vallejo-sanjuan_PortalDash)
(`vallejo-sanjuan_PortalDash`, organización `vallejo-sanjuan`), en modo **CI-based**, no Automatic
Analysis:

- **Qué lo dispara:** `.github/workflows/sonarcloud.yml`, en cada `push` a `master` y en cada Pull
  Request hacia `master`.
- **Cómo:** un solo job (`ubuntu-latest`) usa `dotnet-sonarscanner begin`/`dotnet build`/`end` para
  envolver TODO el análisis en una sola corrida: el build real de `portal-src/DashboardPortal.sln` y
  `dashboards/APCWeb/src/APCWeb/APCWeb.csproj` le da a Sonar la información necesaria para analizar
  C#, y `sonar.sources=portal-src,dashboards` (pasado explícito como `/d:` en el `begin`, porque
  `dotnet-sonarscanner` no lee `sonar-project.properties`) cubre además el JS/TS de todos los
  dashboards Node.
- **Builds de los dashboards con frontend Vite** (ComisionesINDO, EstadoResultado, PassReset,
  ControlCaja, MovimientosCaja, DashPromocionesMP, comisiones-app, sucursal-user-visualizer) corren
  antes del análisis. Los dashboards sin frontend Vite (server-only: MotorReposicion, DashMeLi,
  ConciliacionPunitorios, ValidacionCobranzas, VentaObjetivo, StockProveedorMarca,
  VentaObjetivoSucursal, tablero-objetivos-web) solo pasan por `npm install` — no tienen script
  `build`. El workflow nunca ejecuta scripts que toquen datos reales (`generar.cjs`, etc.).
- **Config:** `sonar-project.properties` en la raíz queda como referencia de las mismas propiedades
  (fuentes, exclusiones) por si alguien corre `sonar-scanner` local, aunque el workflow no lo lee
  directamente.
- **Secret:** `SONAR_TOKEN` está cargado en Settings → Secrets and variables → Actions del repo.
- Detalle completo de la decisión: `docs/prds/001-analisis-sonarqube/PRD.md` y `PLAN.md`.

## Si hace falta una pasada formal

Invocar la skill `fmway-docs` apuntada a un subproyecto puntual (por ejemplo, un dashboard sin
`CLAUDE.md` completo, o para generar diagramas Mermaid formales) en vez de regenerar todo el monorepo
de una vez.
