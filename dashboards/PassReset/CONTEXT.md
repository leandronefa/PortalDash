# PassReset — Contexto completo

> Dashboard de monitoreo y rotación automática de contraseñas locales de Windows.
> Carpeta: `C:\apps\dashboards\PassReset\`
> Puerto: **3009** · Servicio: `dashpassreset.exe` (Dash-PassReset)
> Última sesión: **2026-06-26** — dark mode implementado y desplegado. Agente: pendiente.

---

## Arquitectura general

```
┌─────────────────────────────────────────────┐
│  Dashboard web  (este repo, puerto 3009)    │
│  Solo lectura — visualiza el estado global  │
│  React + Express + mssql → db_Cegid         │
└────────────────┬────────────────────────────┘
                 │ SQL (db_Cegid @ 10.0.0.115)
     ┌───────────┴───────────┐
     │                       │
┌────▼────────┐      ┌───────▼───────┐
│  Agente     │      │  Agente       │  ... (uno por servidor)
│  SERVERAPP  │      │  SERVIDOR2    │
│  (svc local)│      │  (svc local)  │
└─────────────┘      └───────────────┘
```

El **dashboard** solo lee (SPs `Get*`). Los **agentes** (Node.js, uno por servidor monitoreado) son quienes:
1. Se registran vía `sp_PassReset_AgentUpsertUsuario`.
2. Consultan usuarios vencidos vía `sp_PassReset_AgentGetPendientes`.
3. Cambian la contraseña en Windows con `net user`.
4. Reportan el resultado vía `sp_PassReset_AgentReportarCambio` (que a su vez envía correo por Database Mail).

---

## Base de datos — `db_Cegid` en `10.0.0.115`

### Tablas

| Tabla | Propósito |
|---|---|
| `tbl_PassReset_Usuarios` | Un registro por (Servidor, UsuarioWindows). Guarda `UltimoCambio` y `MaxDias`. |
| `tbl_PassReset_Log` | Historial de cada operación de cambio de contraseña. |

### Stored Procedures — **lectura** (usados por el dashboard)

| SP | Parámetros | Retorna |
|---|---|---|
| `sp_PassReset_GetServidores` | — | Lista de servidores distintos con usuarios activos |
| `sp_PassReset_GetResumen` | `@Servidor` (NULL=todos) | `Total, Vencidas, Proximas, Ok` |
| `sp_PassReset_GetUsuarios` | `@SoloActivos BIT`, `@Servidor` | Lista de usuarios con `Estado`, `DiasRestantes`, `FechaProximoCambio` |
| `sp_PassReset_GetLog` | `@Limite INT`, `@Servidor`, `@IdUsuario` | Historial ordenado por `Id DESC` |

### Stored Procedures — **escritura** (usados solo por los agentes)

| SP | Propósito |
|---|---|
| `sp_PassReset_AgentUpsertUsuario` | Registra o actualiza un usuario. Lo llama el agente al arrancar. |
| `sp_PassReset_AgentGetPendientes` | Devuelve usuarios de un servidor cuya contraseña venció (`DATEDIFF >= MaxDias`). |
| `sp_PassReset_AgentReportarCambio` | Actualiza `UltimoCambio` e inserta en el log. Luego llama a `sp_PassReset_EnviarCorreo`. |
| `sp_PassReset_EnviarCorreo` | Envía correo via Database Mail (lee el profile default de `msdb`). |

Estados calculados:
- `VENCIDA` — `UltimoCambio IS NULL` o `DATEDIFF >= MaxDias`
- `PROXIMA` — `DiasRestantes <= 5`
- `OK` — todo en regla

---

## API — `server.cjs` (Express, puerto 3009)

| Endpoint | Parámetros query | Descripción |
|---|---|---|
| `GET /api/servidores` | — | Lista de servidores para el filtro |
| `GET /api/resumen` | `servidor` | Métricas de las tarjetas KPI |
| `GET /api/usuarios` | `servidor`, `todos=1` | Lista de usuarios con estado |
| `GET /api/log` | `servidor`, `idUsuario`, `limite` | Historial de operaciones |

Todas las rutas no-API devuelven `dist/index.html` (SPA fallback).

Pool SQL: singleton `mssql`, se abre al iniciar el proceso. Si el SQL falla al arrancar → `process.exit(1)`.

---

## Frontend — React + Vite + TypeScript

| Archivo | Rol |
|---|---|
| `src/App.tsx` | Shell: header (con toggle dark mode), filtro de servidor, tarjetas KPI, tabs |
| `src/hooks/useTheme.ts` | Hook de dark mode: lee/escribe `localStorage`, aplica `data-theme` a `<html>` |
| `src/components/UserTable.tsx` | Tabla de usuarios con estado, días restantes, barra visual |
| `src/components/LogTable.tsx` | Historial de cambios |
| `src/components/StatusBadge.tsx` | Badge VENCIDA / PRÓXIMA / VIGENTE |
| `src/components/DiasBar.tsx` | Barra de progreso de días |

Auto-refresh cada **5 minutos**. Filtro de servidor persiste en estado React (no en URL).
Build: `npm run build` → `dist/`.

### Dark mode

Implementado con CSS variables + atributo `data-theme` en `<html>`. Botón 🌙/☀️ en el header, persiste en `localStorage`.

- Variables en `src/styles.css`: `:root` (light) y `[data-theme="dark"]` — 17 variables (`--bg-*`, `--text-*`, `--border-*`, `--btn-*`, `--accent`).
- El header (`#1e2d4f`) y badges de estado (rojo/verde/amarillo) son siempre iguales en ambos modos.
- `index.html` tiene un script IIFE inline en `<head>` que aplica el tema antes de que React monte (evita flash blanco al recargar).

---

## Estado de instalación

Servicio `dashpassreset.exe` **instalado y corriendo** en producción desde 2026-06-26.
Registrado en el portal en **Administración → Dashboards → Puerto 3009**.

### Reinstalar desde cero (si fuera necesario)

```powershell
# Ejecutar como Administrador
cd C:\apps\dashboards\PassReset
.\install-service.ps1 -Uninstall
.\install-service.ps1
```

El script limpia la carpeta `daemon\`, corre `npm run build` y registra el servicio.

### Operación habitual

```powershell
# Estado
Get-Service dashpassreset.exe

# Ver logs de error (node-windows)
Get-Content C:\apps\dashboards\PassReset\daemon\dashpassreset.exe.err.log -Tail 30

# Reiniciar tras cambios en server.cjs
Restart-Service dashpassreset.exe

# Reinstalar completo (si cambió server.cjs o el frontend)
cd C:\apps\dashboards\PassReset
.\install-service.ps1 -Uninstall
.\install-service.ps1
```

---

## Archivos clave

```
PassReset\
├── server.cjs              ← Backend Express (CommonJS, sin "type":"module")
├── package.json            ← sin "type":"module" — IMPORTANTE para CommonJS
├── index.html              ← Incluye script anti-flash dark mode en <head>
├── .env                    ← PORT=3009, SQL_*, MAIL_*  (no commitear)
├── install-service.ps1     ← Instala/desinstala dashpassreset.exe
├── dist\                   ← Frontend compilado (npm run build)
├── src\
│   ├── App.tsx             ← Shell + toggle dark mode (🌙/☀️)
│   ├── hooks\
│   │   └── useTheme.ts     ← Hook dark mode (localStorage + data-theme)
│   ├── styles.css          ← Variables CSS :root + [data-theme="dark"]
│   └── components\         ← UserTable, LogTable, StatusBadge, DiasBar
├── SQL\
│   ├── 01_Database.sql     ← Tablas (idempotente, crea si no existen)
│   └── 02_StoredProcedures.sql ← SPs lectura y escritura (idempotente)
├── docs\superpowers\       ← Specs y planes de implementación (SDD)
└── agent\                  ← (PENDIENTE) Agente por servidor
```

---

## Variables de entorno — `.env`

```
PORT=3009
SQL_SERVER=10.0.0.115
SQL_DATABASE=db_Cegid
SQL_USER=sa
SQL_PASSWORD=MicroS123

# Database Mail (configuración del agente; el SP lee el profile default)
MAIL_PROFILE=PerfilCorreo
MAIL_RECIPIENT=admin@empresa.com
```

---

## Agente por servidor

**Estado: PENDIENTE — próxima tarea a implementar.**

El agente es un proceso Node.js independiente que corre en cada servidor monitoreado como servicio de Windows. Carpeta prevista: `PassReset\agent\`.

Responsabilidades:
1. Al arrancar: `sp_PassReset_AgentUpsertUsuario` — se registra en `db_Cegid`.
2. Cada N minutos (configurable): `sp_PassReset_AgentGetPendientes(@Servidor)`.
3. Para cada usuario pendiente: `net user <usuario> <password>` → `sp_PassReset_AgentReportarCambio`.
4. El SP llama a `sp_PassReset_EnviarCorreo` automáticamente post-commit.

Referencia de diseño: `sucursal-user-visualizer\agent\install-agent.ps1` (patrón de instalación) y el plan en `docs\superpowers\plans\2026-06-26-passreset-agent.md` (aunque ese plan fue para el agente de SERVERAPP, usar como guía).

---

## Gotchas

- **CommonJS estricto**: `package.json` sin `"type":"module"`. Si se agrega esa línea → crash `require is not defined`.
- **`process.exit(1)` al no conectar SQL**: si `db_Cegid` / `10.0.0.115` no responde al arrancar, el servicio muere. Node-windows lo reintentará. Ver `.err.log`.
- **`dist/` ausente = pantalla en blanco**: ante cualquier cambio de frontend, correr `npm run build` y reiniciar el servicio (o reinstalar con `install-service.ps1`).
- **Database Mail**: `sp_PassReset_EnviarCorreo` lee el profile default de `msdb`. Si no hay profile → `OK_MAIL_ERROR` en el log (no rompe el cambio de contraseña). Fix aplicado: la SP busca la columna `name` (no `profile_name`) en `sysmail_profile`.
- **Puerto 3009**: no compartido con ningún otro servicio actualmente.
- **Dark mode**: el atributo `data-theme` vive en `<html>`. Si algo no cambia de color en dark mode, verificar que el selector en `styles.css` usa `var(--...)` y no un valor hex hardcodeado. El header es una excepción intencional.
