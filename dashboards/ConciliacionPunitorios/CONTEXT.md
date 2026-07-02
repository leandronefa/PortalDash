# CONTEXT.md — ConciliacionPunitorios

## Propósito
Conciliación de **punitorios**: cruza el **archivo 1400** (detalle de pagos) contra el **Libro Mayor** por período. El usuario sube dos archivos Excel, el sistema los procesa con `generar.cjs` y produce un reporte por período (YYYYMM).

## Stack
- **Frontend**: HTML + JavaScript vanilla (`public/`)
- **Backend**: Express 5 + CommonJS (`server.cjs`)
- **Puerto**: 3006
- **Servicio Windows**: instalado (carpeta `daemon/` presente)

## Fuentes de datos
- **Excel uploadado**: archivo1400 + archivoMayor → `archivos/{periodo}/`
- **SQL Server**: `DashboardsDB` en `10.0.0.115` — usado por `generar.cjs`
- **Credenciales**: en `.env`

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/periodos` | Lista de períodos procesados (`data-YYYYMM.js`) |
| GET | `/api/mapeo` | Configuración de mapeo de columnas (`mapeo.json`) |
| POST | `/api/mapeo` | Guardar mapeo |
| POST | `/api/procesar` | Upload multipart + lanza `generar.cjs` (timeout 5 min) |
| POST | `/api/recalcular/:periodo` | Reprocesar período ya subido |

## Flujo de procesamiento
1. Upload → `archivos/{periodo}/` (multer)
2. `server.cjs` spawnea `generar.cjs` con los paths como argumentos
3. `generar.cjs` procesa Excel + consulta SQL → escribe `public/data-{YYYYMM}.js`
4. El frontend carga ese `.js` como script para mostrar los resultados

## Archivos clave
- `server.cjs` — servidor Express
- `generar.cjs` — motor de procesamiento (Excel + SQL)
- `mapeo.json` — mapeo de columnas del Excel
- `public/` — frontend estático
- `archivos/` — Excel subidos (no commitear; los xlsx de ejemplo en raíz son de prueba)
- `sql/` — queries de referencia
- `.env` — cadena de conexión SQL

## Gotchas
- CommonJS puro: no usar `import`/`export`.
- Diferencia con `ValidacionCobranzas`: usa **archivo1400** (no archivo1167).
- Los xlsx grandes en la raíz (`1400DetalledePagosMarzo.xlsx`, `LibroMayorMarzo.xlsx`) son archivos de prueba, no deben commitarse.
- Timeout del spawn: 5 minutos. Si `generar.cjs` demora más, el endpoint falla.
