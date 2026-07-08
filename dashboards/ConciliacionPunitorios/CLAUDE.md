# CLAUDE.md — Conciliación Punitorios (puerto 3006)

Dashboard **Conciliación Punitorios**: concilia el **archivo 1400** (detalle de pagos) contra el **Libro Mayor** por período (YYYYMM). El usuario sube ambos Excel, `server.cjs` spawnea `generar.cjs`, que procesa los archivos + consulta SQL Server (`DashboardsDB` en `10.0.0.115`) y escribe `public/data-{YYYYMM}.js` que el frontend carga como script. Ver `CONTEXT.md` para el detalle completo (endpoints, flujo).

## Servicio y acceso

- Servicio de Windows: **`dashconciliacionpunitorios.exe`** (node-windows), puerto **3006**.
- Acceso de usuarios: **SOLO vía el portal** → `http://10.0.0.118/d/9/` (proxy inverso con sesión y permisos). El puerto 3006 directo queda solo para diagnóstico local.

```powershell
Get-Service dashconciliacionpunitorios.exe
Restart-Service dashconciliacionpunitorios.exe
Get-Content C:\apps\dashboards\ConciliacionPunitorios\daemon\dashconciliacionpunitorios.err.log -Tail 30
```

## Desarrollo / diagnóstico

- Entrada: `server.cjs` (`npm start`). Sin paso de build: frontend estático en `public/` (HTML + JS vanilla).
- Diagnóstico en primer plano:

```powershell
cd C:\apps\dashboards\ConciliacionPunitorios; $env:PORT=3006; node server.cjs
```

- Procesamiento manual: `node generar.cjs <archivo1400> <archivoMayor>` (o `npm run generar`).
- Dependencias: `express` 5, `mssql`, `multer`, `xlsx`.

## Estructura

- `server.cjs` — servidor Express (upload multipart, API, sirve `public/`).
- `generar.cjs` — motor de procesamiento (Excel + SQL); lo spawnea `server.cjs` con timeout de 5 min.
- `mapeo.json` — mapeo de columnas del Excel (editable vía `GET/POST /api/mapeo`).
- `public/` — frontend estático + `data-{YYYYMM}.js` generados.
- `archivos/` — Excel subidos por período (no commitear).
- `sql/` — queries de referencia.
- `daemon/` — logs y wrapper del servicio node-windows.

## Gotchas

- **CommonJS puro** (`"type": "commonjs"`): no usar `import`/`export`.
- No hay `.env`: la conexión SQL está **hardcodeada en `generar.cjs`** (server/user/password/database). No exponer ni commitear esos valores fuera del repo.
- El `PORT` del servicio pisa cualquier otra configuración; mantener 3006.
- Diferencia con `ValidacionCobranzas`: acá se usa **archivo1400** (no archivo1167).
- Los `.xlsx` grandes en la raíz (`1400DetalledePagosMarzo.xlsx`, `LibroMayorMarzo.xlsx`) son de prueba: no commitearlos.
- Timeout del spawn de `generar.cjs`: 5 minutos; si demora más, `POST /api/procesar` falla.
- Reglas generales de operación/instalación de servicios: ver `C:\apps\dashboards\CLAUDE.md`.
