# CLAUDE.md — Raíz de operación (servidor 10.0.0.118)

> COPIAR ESTE ARCHIVO A:  `C:\apps\CLAUDE.md`
> Es el contexto raíz. Claude Code lo lee al iniciar y toma los `CLAUDE.md` anidados (`portal-src\`, `dashboards\`) al entrar en cada carpeta.

Estás operando **en el servidor 10.0.0.118** (host SERVERAPP). Esta carpeta `C:\apps` se comparte como `\\10.0.0.118\apps`, pero **acá siempre usá rutas locales `C:\apps\...`** (los servicios no deben referenciar rutas UNC).

## Sobre el proyecto

PortalDash: monorepo con el portal de dashboards internos (proxy inverso + login + permisos) y una
colección de dashboards operativos/comerciales, todos consumidos por personal de la empresa desde
`http://10.0.0.118/`. Leer antes de trabajar: `PRD.md` (panorama de producto), este árbol y los
`CLAUDE.md` anidados listados en "Leer primero" abajo — cada subproyecto documenta su propio stack,
convenciones y comandos, así que no se duplican acá.

## Stack

Monorepo con dos familias de proyectos (ver el `CLAUDE.md` de cada uno para el detalle):

- **Portal** (`portal-src/`): C# / .NET 9, ASP.NET Core, YARP (proxy inverso), SQL Server.
- **Dashboards** (`dashboards/*`): Node.js/Express + Vite/React (mayoría), un caso ASP.NET Core
  (`APCWeb`). SQL Server vía `mssql`. Cada dashboard corre como servicio Windows independiente
  (`node-windows`), con su propio `package.json`, `.env` y puerto (ver tabla de Servicios abajo).
- No hay test runner ni linter uniforme entre dashboards — no asumas comandos que no estén en el
  `package.json` de cada carpeta.

No agregues dependencias adicionales sin una justificación explícita.

## Árbol

```
C:\apps\
├── CLAUDE.md            ← este archivo (raíz)
├── portal\              Portal de Dashboards desplegado (.NET 9). Servicio "DashboardPortal", puerto 80.
│   └── deploy\          scripts de instalación (portal y dashboards)
├── portal-src\          CÓDIGO FUENTE + documentación del portal (CLAUDE.md, CONTEXT.md, OPERATIONS, etc.)
└── dashboards\          Dashboards Node.js (ver su propio CLAUDE.md). Servicios dashcomisiones/promociones/sucursal.
```

## Leer primero (contexto profundo)

- `C:\apps\portal-src\deploy\OPERATIONS-10.0.0.118.md` → **estado real de la instalación** (servicios, puertos, problemas resueltos).
- `C:\apps\portal-src\CLAUDE.md` → guía del proyecto portal (build/run, gotchas).
- `C:\apps\portal-src\CONTEXT.md` → contexto completo del portal.
- `C:\apps\dashboards\CLAUDE.md` → operación y particularidades de cada dashboard.
- `C:\apps\NUEVO-TABLERO.md` → **guía paso a paso para agregar un dashboard nuevo** (estructura de la app, puerto, servicio, alta en el portal, permisos, gotchas ya vividos).

## Acceso a los dashboards: SOLO vía el portal

Desde jul 2026 el portal es **proxy inverso** (YARP): los usuarios entran por `http://10.0.0.118/d/{id}/` con sesión y permisos del portal. Los dashboards escuchan **solo en `127.0.0.1`** (excepto el 3003, que reciben los agentes remotos), así que el acceso directo `http://10.0.0.118:PUERTO` está cerrado; para diagnóstico local usar `http://localhost:PUERTO`. Detalle en `portal-src\CLAUDE.md` y el mapa completo de puertos/IDs en `dashboards\CLAUDE.md`.

## Servicios (resumen)

| Servicio (Name real) | Puerto | Carpeta |
|---|---|---|
| `DashboardPortal` | 80 | `C:\apps\portal` |
| `dashcomisiones.exe` | 3001 | `C:\apps\dashboards\comisiones-app` |
| `dashpromociones.exe` | 3002 | `C:\apps\dashboards\DashPromocionesMP` |
| `dashsucursal.exe` | 3003 | `C:\apps\dashboards\sucursal-user-visualizer` |
| `dashmovimientoscaja.exe` | 3004 | `C:\apps\dashboards\MovimientosCaja` |
| `dashcomisionesindo.exe` | 3011 | `C:\apps\dashboards\ComisionesINDO` |
| `dashconciliacionpunitorios.exe` | 3006 | `C:\apps\dashboards\ConciliacionPunitorios` |
| `dashvalidacioncobranzas.exe` | 3007 | `C:\apps\dashboards\ValidacionCobranzas` |
| `dashestadoresultado.exe` | 3008 | `C:\apps\dashboards\EstadoResultado` |
| `dashpassreset.exe` | 3009 | `C:\apps\dashboards\PassReset` |
| `dashmeli.exe` | 3010 | `C:\apps\dashboards\DashMeLi` |
| `dashtableroobjetivos.exe` | 3012 | `C:\apps\dashboards\tablero-objetivos-web\server` |
| `dashapcweb` | 3013 | `C:\apps\dashboards\APCWeb` |
| `dashcontrolcaja.exe` | 3014 | `C:\apps\dashboards\ControlCaja` |
| `dashventaobjetivo.exe` | 3016 | `C:\apps\dashboards\VentaObjetivo` |
| `dashstockproveedormarca.exe` | 3017 | `C:\apps\dashboards\StockProveedorMarca` |
| `dashventaobjetivosucursal.exe` | 3018 | `C:\apps\dashboards\VentaObjetivoSucursal` |
| `dashmotorreposicion.exe` | 3019 | `C:\apps\dashboards\MotorReposicion` |

```powershell
Get-Service | Where-Object DisplayName -like 'Dash-*' | ft Name,DisplayName,Status
Get-Service DashboardPortal
Get-NetTCPConnection -State Listen | ? LocalPort -in 80,3001,3002,3003,3004,3006,3007,3008,3009,3010,3011,3012,3013,3014,3016,3017,3018,3019 | ft LocalAddress,LocalPort,OwningProcess
# LocalAddress debe ser 127.0.0.1 en todos salvo 3003 (agentes). 127.0.0.1:3005 es el conector de Qlik, no un dashboard.
```

## Reglas de oro

- **Pedir confirmación antes de cualquier operación destructiva** (borrar/reinstalar servicios, `sc.exe delete`, borrar `App_Data`, sobrescribir `.env`).
- Rutas **locales** `C:\apps\...`, nunca UNC.
- Los nombres reales de servicio (node-windows) llevan sufijo `.exe`: `dashcomisiones.exe`, `dashpromociones.exe`, `dashsucursal.exe`. `Get-Service Dash-*` NO los encuentra; usar `Get-Service dash*` o el nombre completo.
- No exponer/commitear secretos: `C:\apps\portal\appsettings.json` (clave de SQL) y los `.env` de cada dashboard.
- Tras cambios en la instalación, actualizar `portal-src\deploy\OPERATIONS-10.0.0.118.md`.

## Estructura de carpetas

```
C:\apps\
├── CLAUDE.md            Este archivo (raíz del monorepo)
├── PRD.md                Panorama de producto (portal + dashboards)
├── docs\                 prds/, bugs/, security/, architecture/ (flujos fmway)
├── .ways\                Estado de work items en curso (fmway-dev / fmway-bugs / fmway-vuln)
├── portal\               Portal desplegado (build de portal-src), servicio DashboardPortal
├── portal-src\           Código fuente + docs del portal (ver su CLAUDE.md)
└── dashboards\           Dashboards Node.js/ASP.NET (ver su CLAUDE.md y el de cada carpeta)
```

Nunca borres documentación bajo `docs/`.

## Convenciones de código

Cada subproyecto define las suyas en su propio `CLAUDE.md` (`portal-src\CLAUDE.md`,
`dashboards\CLAUDE.md`, y el de cada dashboard). A nivel monorepo:

- Comentarios solo cuando el "por qué" no se desprende del código. No documentar el "qué".
- No mezclar carpetas de proyectos distintos ni compartir `node_modules`/paquetes entre dashboards.

## Comandos útiles

No hay comandos globales de build/test/lint para todo el monorepo — cada dashboard y el portal
tienen los suyos, documentados en su propio `CLAUDE.md`/`package.json`/`.csproj`. Entrá a la carpeta
correspondiente antes de correr `npm run dev`, `dotnet build`, etc.

## Variables de entorno

Cada dashboard tiene su propio `.env` (no versionado) y el portal su `appsettings.json`/
`appsettings.Production.json` (el de producción tampoco se versiona). Nunca commitees ni muestres el
contenido de estos archivos — contienen credenciales reales de SQL Server.

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

Este repo usa **`master`** como única rama principal (no hay `main`/`develop`).

### Opción A — Rama en el checkout actual

```bash
git switch master && git pull --ff-only && git switch -c {tipo}/{slug}
```

Todo el trabajo ocurre en esa rama. Nunca crees archivos en `master` con la intención de moverlos
después.

### Opción B — Worktree aparte

Creá worktrees únicamente bajo `.worktrees/`. No le pidas una ruta al usuario.

```bash
git fetch origin master && mkdir -p .worktrees && git worktree add .worktrees/{slug} -b {tipo}/{slug} origin/master
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
7. **Fase 5** — PRs: `feat/{slug}` → `master`, abiertos solo cuando el usuario invoca `fmway-pr`

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
8. **Fase 7** — PR `fix/{slug}` → `master`, abierto solo cuando el usuario invoca `fmway-pr`

**Nunca escribas código del fix antes de que el usuario apruebe el FIX_PLAN.**

## Tests obligatorios

No hay una suite de tests automatizada uniforme en este monorepo hoy. Antes de dar por terminada una
feature o un fix:

- Validar manualmente el caso en el dashboard/portal afectado (ver skill `run` o correr `npm run dev`
  / `dotnet run` en la carpeta correspondiente).
- Si el subproyecto sí tiene tests (`npm test`, `dotnet test`), correrlos.
- Prestar atención especial a reglas de acceso/permisos del portal (quién puede ver qué dashboard) y
  a la integridad de datos de SQL Server (no duplicar filas, no romper cascadas de ABM).

## Datos sensibles

Varios dashboards manejan datos comerciales internos (comisiones, sueldos/objetivos, movimientos de
caja) y credenciales (PassReset). Principios universales:

- Nunca loguees credenciales, contraseñas ni datos personales en producción.
- Confirmación explícita al exportar datos sensibles.
- Los `.env` y `appsettings.Production.json` nunca se commitean ni se muestran en texto plano.

## Qué no hacer

- No mezcles lógica de negocio con lógica de presentación.
- No uses bypasses de autorización en código que corre del lado del cliente.
- No incluyas secretos en bundles del cliente ni en commits.
- No hagas `git push --force` a `master`.
- No saltees los hooks de git (`--no-verify`) sin un motivo explícito.
- No commitees, pushees ni abras un PR sin que el usuario lo pida — invocá `fmway-pr` solo cuando lo
  pida, y en el resto de los casos limitate a sugerirlo.
- No accedas a dashboards por su puerto directo desde fuera del server; el acceso real es vía el
  portal (`/d/{id}/`).

## Ante la duda

Si una decisión no está cubierta en `PRD.md` ni en `docs/`, **preguntá** en lugar de improvisar. La
opinión del usuario importa.
