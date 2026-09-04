# Plan de implementación — Análisis de SonarQube/SonarCloud sobre todos los tableros

## Estado
Aprobado

## Rama / worktree
Nombre de la rama: `feat/sonarqube-tableros`
Modo de aislamiento: rama en el checkout actual (creada desde `master`)

## Etapas

### Etapa A — `sonar-project.properties`

- [ ] Crear `sonar-project.properties` en la raíz (`C:\apps\sonar-project.properties`) con:
  - `sonar.projectKey=vallejo-sanjuan_PortalDash`, `sonar.organization=vallejo-sanjuan`
  - `sonar.sources=portal-src,dashboards`
  - `sonar.exclusions` espejando `.gitignore`: `**/node_modules/**`, `**/dist/**`,
    `**/dist-server/**`, `**/bin/**`, `**/obj/**`, `**/App_Data/**`, `**/daemon/**`,
    `dashboards/EstadoResultado/sap-inbox/**`, `dashboards/EstadoResultado/data-store/**`,
    `dashboards/EstadoResultado/SAPResultProcesado/**`, `dashboards/EstadoResultado/data-cache/**`,
    `dashboards/ConciliacionPunitorios/archivos/**`, `dashboards/ValidacionCobranzas/archivos/**`,
    `**/*.min.js`
  - `sonar.exclusions` de los proyectos .NET propios (`portal-src/**`, `dashboards/APCWeb/**`) del
    escaneo genérico de `sonar-scanner`, porque esos los cubre el paso `dotnet-sonarscanner`
    (evitar doble análisis del mismo código).
  - `sonar.javascript.lcov.reportPaths` / `sonar.testExecutionReportPaths` dejados vacíos por ahora
    (no hay tests unitarios uniformes — ver No-objetivos del PRD).

### Etapa B — Workflow de GitHub Actions

- [ ] Crear `.github/workflows/sonarcloud.yml` con:
  - Triggers: `pull_request` (hacia `master`) y `push` a `master`.
  - `permissions: contents: read` (mínimo necesario).
  - Un solo job `sonar` en `ubuntu-latest` con `fetch-depth: 0` en el checkout (Sonar lo requiere
    para el análisis de blame/nuevas líneas).
  - Setup de Node 18+ (`actions/setup-node@v4`, con `cache: npm` por carpeta donde aplique) y de
    .NET 9 (`actions/setup-dotnet@v4`).
  - Paso .NET: instalar la herramienta `dotnet-sonarscanner` (`dotnet tool install --global
    dotnet-sonarscanner`), `begin` con las claves del proyecto, `dotnet build
    portal-src/DashboardPortal.sln` y `dotnet build dashboards/APCWeb/src/APCWeb/APCWeb.csproj`,
    `end`.
  - Paso Node: para los 8 dashboards con Vite (`ComisionesINDO`, `EstadoResultado`, `PassReset`,
    `ControlCaja`, `MovimientosCaja`, `DashPromocionesMP`, `comisiones-app`,
    `sucursal-user-visualizer`), un loop o steps explícitos que corran `npm install --no-audit
    --no-fund && npm run build` (`build:prod` en `comisiones-app` y `sucursal-user-visualizer`) en
    cada carpeta. Para los 8 sin Vite, solo `npm install --no-audit --no-fund` (sin invocar
    `build`, `generar` ni ningún otro script).
  - Paso final: `sonar-scanner` (Java, vía `SonarSource/sonarqube-scan-action@v4` o el CLI oficial)
    usando `sonar-project.properties`, con `SONAR_TOKEN` y `GITHUB_TOKEN` como env vars desde
    `secrets`.
  - Cachear `~/.sonar/cache` y los `node_modules` de cada dashboard (clave por
    `hashFiles('**/package-lock.json')`) para no repetir instalaciones completas en cada corrida.
- [ ] Confirmar que el workflow **nunca** ejecuta `npm run generar` ni scripts fuera de
  `install`/`build` (ver Etapa D, verificación de seguridad).

### Etapa C — Documentación

- [ ] Actualizar `docs/architecture/overview.md` con una sección corta "Análisis de calidad
  (SonarCloud)": qué dispara el análisis, dónde vive la config (`sonar-project.properties`,
  `.github/workflows/sonarcloud.yml`), y el link al proyecto en SonarCloud.
- [ ] Actualizar `PRD.md` → Estado `Terminado` una vez validado.

### Etapa D — Validación

- [ ] Abrir un PR de prueba (o usar el propio PR de esta feature) y confirmar que el workflow corre
  de punta a punta sin fallar: build .NET, build de los 8 dashboards Vite, install de los 8
  restantes, y que el `sonar-scanner` termina y reporta el análisis en SonarCloud.
- [ ] Confirmar en el dashboard de SonarCloud
  (`sonarcloud.io/dashboard?id=vallejo-sanjuan_PortalDash`) que aparecen archivos de `portal-src`,
  `dashboards/APCWeb` y de varios dashboards Node distintos (no solo uno) — evidencia de que el
  alcance real cubre "todos los tableros", no solo el que tocó el PR.
- [ ] Verificar que el check en el PR sigue llamándose "SonarCloud Code Analysis" (o el nombre que
  tome el nuevo job) y que reemplaza/convive sin duplicar con el check automático anterior — si
  SonarCloud sigue disparando también el modo Automatic Analysis en paralelo, hay que desactivarlo
  desde la configuración del proyecto en sonarcloud.io (Administration → Analysis Method →
  desactivar "Automatic Analysis"), **el usuario lo hace manualmente** (requiere acceso a esa
  cuenta).
- [ ] Revisión de seguridad manual (obligatoria antes del Gate 3):
  - Confirmar que `SONAR_TOKEN` solo se referencia como `secrets.SONAR_TOKEN`, nunca en texto plano
    en el workflow ni en logs (`echo`/`run` que lo imprima).
  - Confirmar que el workflow no ejecuta scripts que toquen datos reales (`generar.cjs` u otros) ni
    necesita el `.env` real de ningún dashboard.
  - `npm audit --omit=dev` no es alcance de este PRD (no se está tocando código de negocio ni
    dependencias) — se deja fuera salvo que el usuario pida incluirlo.

## Plan de pruebas

- **No aplica test unitario/E2E nuevo** — esta feature es tooling de CI, no lógica de negocio (ver
  No-objetivos del PRD).
- **Validación manual:** correr el workflow en el propio PR de esta rama y revisar el log completo de
  GitHub Actions + el dashboard de SonarCloud, según el checklist de la Etapa D.

## Notas de rollback

- Si el workflow falla de forma persistente o rompe el flujo de PRs, revertir el commit que agrega
  `.github/workflows/sonarcloud.yml` (o deshabilitar el workflow desde GitHub Actions → workflow →
  "Disable workflow") — no afecta código de producción, ningún dashboard ni el portal, así que el
  rollback es de bajo riesgo y no requiere coordinación con los servicios en 10.0.0.118.
- Si se desactivó "Automatic Analysis" en SonarCloud y hay que volver atrás, se reactiva desde la
  misma pantalla de administración del proyecto.
