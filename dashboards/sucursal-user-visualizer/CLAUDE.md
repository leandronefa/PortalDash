# CLAUDE.md — sucursal-user-visualizer (Dashboard "Servidores QV")

## Qué es

Panel de administración y status de servidores QlikView / usuarios por sucursal. Dos funciones:
1. **Asignaciones sucursal-usuario** — tabla/grafo (D3) de `EncargadosSucursal` (SQL `10.0.0.115`, base `TABLEROS`).
2. **Monitoreo de servidores remotos** — agentes en ~10 servidores reportan CPU, RAM, disco y procesos (`FileAppCliente`, `DOAStatus`). Sin reporte en >10 min → offline.

Stack: React 19 + Vite + TypeScript (frontend) y Express + TypeScript (`server/index.ts`, backend).

## Servicio y acceso

- **Servicio de Windows**: `dashsucursal.exe` (node-windows), puerto **3003**, entrada `dist-server\index.js` (NO usa `server.js`; el `nssm.exe` que trae la carpeta NO se usa).
- **Usuarios**: SOLO vía el portal → `http://10.0.0.118/d/6/` (proxy inverso con sesión y permisos).
- **Agentes remotos**: le pegan directo a `http://10.0.0.118:3003` (`CentralUrl`); el puerto 3003 NO puede cerrarse en el firewall sin contemplar esas IPs.
- Logs del servicio: `daemon\dashsucursal.err.log`.
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\sucursal-user-visualizer; $env:PORT=3003; node dist-server\index.js
  ```

## Build

```powershell
npm run build:prod   # vite build (dist/) + tsc backend (dist-server/)
```
Cambios en `server/` requieren `build:prod` y luego `Restart-Service dashsucursal.exe`.

## Agente remoto (breve)

- Código en `agent\`, archivos de despliegue en `agent-deploy\` (se instala como `C:\agent\` en cada servidor, corre con PM2 *en los remotos*).
- Incluye la integración **PassReset** (registro/verificación de usuarios Windows; usuarios de sistema excluidos vía `PASSRESET_EXCLUDE_USERS`).
- Autenticación: token en el body JSON (`AGENT_TOKEN`), endpoint `POST /api/agent`.
- Detalles de instalación/actualización: ver `CONTEXT.md`.

## Estructura

- `server/index.ts` — backend Express (API: `/api/data`, `/api/servers`, `/api/agent`).
- `src/` — frontend React.
- `dist/` y `dist-server/` — artefactos de build (frontend / backend).
- `agent/`, `agent-deploy/` — agente remoto y su paquete de despliegue.
- `layout-state.json` — persistencia local del layout del grafo (está en `.gitignore`).
- `.env` — variables (solo nombres): `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`, `NODE_ENV`, `REMOTE_SERVERS`, `AGENT_TOKEN`. **No commitear ni exponer valores.**

## Gotchas

- El `PORT` del servicio pisa al del `.env`.
- Falta `dist` → pantalla en blanco; falta `dist-server` → el servicio no arranca. Correr `npm run build:prod`.
- Si se reinstala el servicio, pasar `dist-server\index.js` como 4º argumento al instalador (`C:\apps\portal\deploy\dashboards\install-dashboard-service.js`).
- El `CENTRAL_URL` de los agentes apunta al puerto **3003** (el default viejo 3002 ya fue corregido).
- El README habla de "AI Studio" / `GEMINI_API_KEY`: es residuo del scaffold original, ignorarlo.
