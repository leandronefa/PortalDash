# CLAUDE.md — ValidacionCobranzas (puerto 3007)

## Qué es
Dashboard **Validación Cobranzas**: concilia el **informe 1167** (recaudación) contra el **Libro Mayor** (contabilidad) por cartera (**Propia / No Vendible**) y por sucursal. El usuario sube los Excel (1167, 1400 y Libro Mayor SAP) por período `YYYYMM`; `generar.cjs` los procesa (Excel + SQL Server `DashboardsDB` en 10.0.0.115) y escribe `public/data-YYYYMM.js`, que el frontend estático carga como script.

## Servicio y acceso
- **Servicio de Windows**: `dashvalidacioncobranzas.exe` (node-windows), puerto **3007**, entrada `server.cjs`.
- **Acceso de usuarios: SOLO vía el portal** → `http://10.0.0.118/d/10/` (proxy inverso con sesión y permisos). El puerto 3007 directo queda solo para diagnóstico local.
- Logs del servicio: `daemon\dashvalidacioncobranzas.err.log`.

```powershell
Get-Service dashvalidacioncobranzas.exe
Restart-Service dashvalidacioncobranzas.exe
Get-Content C:\apps\dashboards\ValidacionCobranzas\daemon\dashvalidacioncobranzas.err.log -Tail 30
```

## Desarrollo / diagnóstico
Sin build (frontend vanilla en `public/`, backend Express 5 CommonJS). Diagnóstico en primer plano:

```powershell
cd C:\apps\dashboards\ValidacionCobranzas; $env:PORT=3007; node server.cjs
```

Dependencias: `express`, `mssql`, `multer`, `xlsx` (`npm install` si falta alguna).

## Estructura
- `server.cjs` — servidor Express: sirve `public/` y expone la API.
- `generar.cjs` — motor de procesamiento (Excel + SQL); lo spawnea `server.cjs` con `execFile` (timeout 5 min).
- `public/` — frontend estático + resultados `data-YYYYMM.js`.
- `archivos/{periodo}/` — Excel subidos vía multer (no commitear).
- `CONTEXT.md` — contexto funcional (algo desactualizado, ver Gotchas).

### API
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/periodos` | Períodos procesados (detecta `public/data-YYYYMM.js`) |
| POST | `/api/procesar` | Upload multipart (`archivo1167`, `archivo1400`, `archivoMayor` + `periodo`, `fecha` opcional) y lanza `generar.cjs` |
| POST | `/api/recalcular/:periodo` | Reprocesa un período ya subido |

## Gotchas
- **CommonJS puro**: no usar `import`/`export` en `server.cjs` ni `generar.cjs`.
- El `PORT` del servicio pisa cualquier otro valor; default 3007 si no está definido.
- El upload exige **los tres archivos** (1167, 1400 y Libro Mayor SAP) y período `YYYYMM` válido.
- Timeout del spawn de `generar.cjs`: 5 minutos; archivos muy grandes pueden cortarse.
- Para reprocesar, usar `/api/recalcular/:periodo` (no volver a subir si los Excel ya están en `archivos/`).
- Hoy **no existe `.env`** en la carpeta (aunque CONTEXT.md lo menciona); la conexión SQL vive en `generar.cjs`. Si se agrega un `.env`, no commitear ni exponer sus valores.
- CONTEXT.md menciona endpoints `/api/mapeo` que ya no están en `server.cjs`.
