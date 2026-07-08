# CLAUDE.md — comisiones-app (Comisiones TESI)

## Qué es
Dashboard **Comisiones TESI**: panel de administración y consulta de comisiones (reglas, índices, escalas, licencias y cálculo de comisiones) contra SQL Server (`10.0.0.115`, base `TABLEROS`, driver `mssql`). Backend Express en `server.cjs` que sirve el frontend estático desde `public/` y expone `/api/*`.

## Servicio y acceso
- Servicio de Windows: **`dashcomisiones.exe`** (node-windows), puerto **3001**, entrada **`server.cjs`**.
- Acceso de usuarios: **SOLO vía el portal** → `http://10.0.0.118/d/5/` (proxy inverso con sesión y permisos). El puerto 3001 directo queda solo para diagnóstico local en el server.
- Logs del servicio: `daemon\dashcomisiones.err.log`.

```powershell
Get-Service dashcomisiones.exe
Restart-Service dashcomisiones.exe
# diagnóstico en primer plano (muestra el error real; Ctrl+C para cortar)
cd C:\apps\dashboards\comisiones-app; $env:PORT=3001; node server.cjs
```

## API (montada en server.cjs)
`/api/auth`, `/api/reglas`, `/api/indices`, `/api/comisiones`, `/api/licencias`, `/api/escalas`, `/api/health`. Middleware: `cors` + `express.json`; fallback SPA a `public/index.html`.

## Configuración (.env — nombres solamente, JAMÁS commitear valores)
`DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`, `NODE_ENV`. Hay `.env.example` de referencia. Ojo: el `PORT` que inyecta el servicio pisa al del `.env`.

## Estructura
- `server.cjs` — entrada del servicio (Express, CommonJS)
- `routes/` — rutas de la API (`auth`, `reglas`, `indices`, `comisiones`, `licencias`, `escalas`)
- `config/` — configuración (conexión SQL)
- `public/` — frontend estático servido en producción
- `src/`, `server/`, `dist/` — restos de un scaffold Vite/React + TS; la producción NO los usa
- `daemon/` — generada por node-windows (wrapper del servicio y logs)

## Desarrollo
No hay paso de build para producción: `server.cjs` sirve `public/` tal cual. Los scripts `dev`/`build` del `package.json` pertenecen al scaffold Vite y no reflejan el despliegue real.

## Gotchas
- **Es CommonJS**: se quitó `"type":"module"` del `package.json` (si vuelve, falla con *"require is not defined in ES module scope"*). Requiere `cors` instalado.
- `CONTEXT.md` de esta carpeta está **desactualizado**: describe el grafo sucursal-usuario (app `sucursal-user-visualizer`), no este dashboard. Confiar en `server.cjs` y en este archivo.
- El `README.md` es de un scaffold de AI Studio; ignorarlo.
- Reglas generales de servicios/reinstalación: ver `C:\apps\dashboards\CLAUDE.md`.
- Pedir confirmación antes de borrar/reinstalar el servicio o tocar el `.env` (contiene credenciales).
