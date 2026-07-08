# CLAUDE.md — PassReset (puerto 3009)

> Contexto anidado: aplica al trabajar dentro de `C:\apps\dashboards\PassReset`.
> Contexto profundo: `CONTEXT.md` (arquitectura completa, SPs, gotchas históricos).

## Qué es

Dashboard de **rotación automática de contraseñas locales de Windows** en servidores remotos.
El dashboard es **solo lectura** (visualiza estado global + asigna correo / fuerza reset); quienes
cambian las contraseñas son los **agentes** que corren en cada servidor monitoreado.

Stack: Express + `mssql` (CommonJS, `server.cjs`) sirviendo un frontend React/Vite desde `dist\`.

## Servicio y acceso

- Servicio de Windows: **`dashpassreset.exe`** (node-windows), puerto **3009**, entrada `server.cjs`.
- Acceso de usuarios: **SOLO vía el portal** → `http://10.0.0.118/d/12/` (proxy inverso con sesión y permisos).
  El puerto 3009 directo queda solo para diagnóstico local.
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\PassReset; $env:PORT=3009; node server.cjs
  ```
- Logs del servicio: `daemon\dashpassreset.err.log`.
- Reiniciar: `Restart-Service dashpassreset.exe`. Reinstalar: `.\install-service.ps1 -Uninstall` y luego `.\install-service.ps1`.

## Arquitectura (breve)

- **Agente por servidor remoto**: código compartido en `..\sucursal-user-visualizer\agent\`
  con `PASSRESET_ENABLED=true`. Registra usuarios, detecta vencidos y ejecuta `net user`.
- **BD `db_Cegid` en 10.0.0.115**: tablas `tbl_PassReset_Usuarios` y `tbl_PassReset_Log`;
  SPs de lectura (dashboard) y de agente (escritura) en `SQL\`.
- **Correo**: vía Database Mail (`sp_send_dbmail`) desde `sp_PassReset_EnviarCorreo`.
- **Sin correo asignado al usuario, el agente NO cambia la contraseña** (los SPs excluyen `CorreoDestino = ''`).

## Estructura

```
PassReset\
├── server.cjs           ← backend Express (API /api/*, SPA fallback a dist\index.html)
├── package.json         ← SIN "type":"module" (CommonJS estricto)
├── .env                 ← variables: PORT, SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD, MAIL_PROFILE, MAIL_RECIPIENT (no commitear valores)
├── install-service.ps1  ← instala/desinstala dashpassreset.exe (limpia daemon\, corre build)
├── SQL\                 ← 01_Database.sql (tablas) y 02_StoredProcedures.sql (SPs, idempotentes)
├── src\                 ← React + TS (App.tsx, components\, hooks\useTheme.ts, styles.css)
├── dist\                ← frontend compilado (npm run build)
├── daemon\              ← logs/wrapper de node-windows
└── docs\superpowers\    ← specs y planes (SDD)
```

## Gotchas

- **CommonJS estricto**: agregar `"type":"module"` al package.json rompe con `require is not defined`.
- **`process.exit(1)` si SQL no responde al arrancar** → el servicio muere; node-windows reintenta. Ver `.err.log`.
- **Cambios de frontend** requieren `npm run build` + reinicio del servicio (sin `dist\` → pantalla en blanco).
- **Dark mode**: variables CSS + `data-theme` en `<html>`; no hardcodear colores hex (el header es excepción intencional).
- **`ResetDesde`**: se setea a mañana 00:00 solo al asignar correo por primera vez; el botón Reset la limpia (ejecución inmediata).
- Tras cambios de instalación, actualizar `portal-src\deploy\OPERATIONS-10.0.0.118.md`.
