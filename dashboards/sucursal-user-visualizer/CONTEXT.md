# CONTEXT.md — sucursal-user-visualizer

## Propósito
Dos funciones en una app:
1. **Asignaciones sucursal-usuario** — tabla/grafo de `EncargadosSucursal`.
2. **Monitoreo de servidores remotos** — agentes instalados en ~10 servidores reportan CPU, RAM, disco y estado de procesos (`FileAppCliente`, `DOAStatus`). Un servidor sin reporte en >10 min se marca offline.

## Stack
- **Frontend**: React 19 + Vite 6.2 + TypeScript + D3
- **Backend**: Express + TypeScript (`server/index.ts`)
- **Puerto**: 3003
- **Servicio Windows**: `dashsucursal.exe`
- **Build backend**: `npm run build:prod` → genera `dist-server/`

## Base de datos
- **Servidor**: `10.0.0.115`
- **Base**: `TABLEROS`
- **Tabla**: `EncargadosSucursal`
- **Credenciales**: en `.env`

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/data` | Datos de EncargadosSucursal |
| GET | `/api/servers` | Estado consolidado de servidores remotos |
| POST | `/api/agent` | Recibe reporte de agente remoto (requiere `AGENT_TOKEN`) |

## Autenticación de agentes
Los agentes remotos envían el token en el body JSON (`token: AGENT_TOKEN`). Se configura en `.env` (`AGENT_TOKEN=sucursal-agent-token`).

## Build
```powershell
npm run build:prod   # compila frontend (dist/) + backend TS (dist-server/)
```
El servicio arranca desde `dist-server\index.js`.

## Archivos clave
- `server/index.ts` — servidor Express
- `src/` — frontend React
- `layout-state.json` — persistencia de layout del grafo
- `.env` — cadena de conexión SQL + AGENT_TOKEN + REMOTE_SERVERS

## Agente remoto (`agent/`)

Cada servidor monitoreado tiene una copia del agente instalada en `C:\agent\`.

### Archivos para desplegar: `agent-deploy/`
Contiene solo los archivos necesarios (sin `node_modules`):

| Archivo | Descripción |
|---|---|
| `index.js` | El agente: mide CPU/RAM/disco, verifica procesos, reporta al central, maneja PassReset |
| `install-agent.ps1` | Instalador — configura `.env`, instala mssql, inicia PM2, crea tarea programada |
| `fix-startup.ps1` | Reconfigura el autoarranque si falla tras reinicio |
| `start-agent.ps1` | Arranque manual de emergencia |
| `package.json` | Dependencias (mssql) |
| `node-v24.11.1-x64.msi` | Node.js para servidores sin internet |

### Instalar en un servidor nuevo
```powershell
# Copiar agent-deploy\ al servidor destino como C:\agent\
# Si Node no está instalado:
msiexec /i C:\agent\node-v24.11.1-x64.msi /quiet /norestart

# Instalar (como Administrador):
cd C:\agent
.\install-agent.ps1 -PassresetSqlPass "MicroS123"
# ServerId se detecta automático por la IP local
```

### Parámetros del instalador
| Parámetro | Default | Descripción |
|---|---|---|
| `-ServerId` | IP local detectada | ID con que aparece en el dashboard |
| `-CentralUrl` | `http://10.0.0.118:3003` | URL del servidor central |
| `-AgentToken` | `sucursal-agent-token` | Token de autenticación |
| `-Processes` | `FileAppCliente.exe,DOAStatus.exe` | Procesos a monitorear |
| `-IntervalMs` | `300000` | Intervalo de reporte (5 min) |
| `-PassresetEnabled` | `true` | Habilitar integración PassReset |
| `-PassresetSqlPass` | *(vacío)* | Contraseña SQL de `db_Cegid` |
| `-PassresetExcludeUsers` | `Administrador,Administrator,SYSTEM,...` | Usuarios excluidos del PassReset |

### Verificar agente
```powershell
pm2 status
pm2 logs sucursal-agent --lines 30 --nostream
```
Líneas esperadas: `Reported OK - HTTP 200` y `[passreset] Usuarios registrados/verificados: X/X`.

### Actualizar index.js en servidor existente
```powershell
Copy-Item "\\10.0.0.118\apps\dashboards\sucursal-user-visualizer\agent-deploy\index.js" "C:\agent\" -Force
pm2 restart sucursal-agent
```

### Desinstalar
```powershell
.\install-agent.ps1 -Uninstall
```

## Gotchas
- La entrada del servicio es `dist-server\index.js`, no `server.js`. Si se reinstala, pasar ese archivo como 4º argumento al instalador.
- Cambios en `server/` requieren `npm run build:prod` antes de reiniciar el servicio.
- Los 10 servidores remotos están listados en `REMOTE_SERVERS` dentro del `.env`.
- El `CENTRAL_URL` del agente apunta al puerto **3003** (no 3002). El default incorrecto de 3002 ya fue corregido.
- `Administrador` y otros usuarios de sistema están excluidos del PassReset vía `PASSRESET_EXCLUDE_USERS`.
