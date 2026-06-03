# CLAUDE.md — Dashboards Node.js (servidor 10.0.0.118)

> COPIAR ESTE ARCHIVO A:  `C:\apps\dashboards\CLAUDE.md`
> Contexto anidado: aplica al trabajar dentro de `C:\apps\dashboards`.

Cada dashboard es una app **Node.js / Express** (sirve un frontend Vite/React desde `dist` y consulta SQL Server con `mssql` vía su propio `.env`). Corren como **servicios de Windows** creados con `node-windows`, con arranque automático y reinicio.

## Mapa

| Carpeta | Servicio (Name real) | Puerto | Entrada | Notas |
|---|---|---|---|---|
| `comisiones-app` | `dashcomisiones.exe` | 3001 | `server.cjs` | CommonJS; se quitó `"type":"module"` del package.json; requiere `cors`. |
| `DashPromocionesMP` | `dashpromociones.exe` | 3002 | `server.js` | ESM (usa `import`). Funciona tal cual. |
| `sucursal-user-visualizer` | `dashsucursal.exe` | 3003 | `dist-server\index.js` | Backend TS compilado con `npm run build:prod`. Trae un `nssm.exe` propio que NO se usa. |

## Operación

```powershell
# estado / escucha
Get-Service dash* | ft Name,Status
Get-NetTCPConnection -State Listen | ? LocalPort -in 3001,3002,3003 | ft LocalPort,OwningProcess

# reiniciar / detener (nombre real, con sufijo .exe)
Restart-Service dashpromociones.exe
Stop-Service dashcomisiones.exe

# ver el error de uno que falla (log de node-windows)
Get-Content C:\apps\dashboards\<carpeta>\daemon\<servicio>.err.log -Tail 30

# diagnóstico en primer plano (muestra el error real al instante; Ctrl+C para cortar)
cd C:\apps\dashboards\<carpeta>
$env:PORT=<puerto> ; node <entrada>     # ej: node server.cjs  /  node server.js  /  node dist-server\index.js
```

## Instalar / reinstalar un dashboard como servicio

```powershell
# 1) limpiar restos (si reinstala) — node-windows deja la carpeta daemon\
sc.exe delete <servicio>.exe 2>$null   # el name real incluye .exe (ej: dashpromociones.exe)
Remove-Item C:\apps\dashboards\<carpeta>\daemon -Recurse -Force -ErrorAction SilentlyContinue

# 2) instalar (4º arg opcional = archivo de entrada; por defecto server.js)
cd C:\apps\portal\deploy\dashboards
node install-dashboard-service.js "Dash-Nombre" "C:\apps\dashboards\<carpeta>" <PUERTO> ["entrada.js"]

# 3) registrar/ajustar en el portal: http://10.0.0.118/  → Administración → Dashboards (con su PUERTO)
```

## Gotchas

- **El `PORT` del servicio pisa al del `.env`** → cada dashboard con puerto único evita `EADDRINUSE`.
- Si `node-windows` dice **"ya existe"** pero `Get-Service` no lo muestra → quedó la carpeta `daemon\`; borrarla y reinstalar.
- App CommonJS (`require`) con `"type":"module"` en package.json → error *"require is not defined in ES module scope"*. Solución: quitar esa línea del package.json (o renombrar a `.cjs`).
- Falta `dist` → pantalla en blanco (correr `npm run build`). Falta `dist-server` (apps con backend TS) → `npm run build:prod`.
- `Cannot find module 'X'` → `npm install X` en la carpeta de la app.
- **PM2 no se usa** (en Windows su autostart depende de sesión iniciada). Si reaparece un daemon: `pm2 kill`.
- Los dashboards escuchan en `0.0.0.0`; el firewall está abierto por puerto; el iframe lo carga el navegador del cliente.

## Regla

Pedir confirmación antes de borrar/reinstalar servicios o tocar archivos `.env`.
