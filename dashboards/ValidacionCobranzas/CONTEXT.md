# CONTEXT.md — ValidacionCobranzas

## Propósito
Conciliación de cobranzas: cruza el **archivo 1167** (recaudación) contra el **Libro Mayor** (contabilidad) por cartera (Propia / No Vendible) y sucursal. El usuario sube dos archivos Excel, el sistema los procesa y genera un reporte por período.

## Stack
- **Frontend**: HTML + JavaScript vanilla (`public/`)
- **Backend**: Express 5 + CommonJS (`server.cjs`)
- **Puerto**: 3007
- **Servicio Windows**: pendiente de registrar

## Fuentes de datos
- **Excel uploadado**: archivo1167 + archivoMayor (multer → `archivos/{periodo}/`)
- **SQL Server**: `DashboardsDB` en `10.0.0.115` — usado por `generar.cjs` para reconciliación
- **Credenciales**: en `.env`

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/periodos` | Lista de períodos procesados (`data-YYYYMM.js`) |
| GET | `/api/mapeo` | Configuración de mapeo de columnas |
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
- `public/` — frontend estático
- `archivos/` — Excel subidos (no commitear)
- `.env` — cadena de conexión SQL

## Gotchas
- CommonJS puro: no usar `import`/`export` en `server.cjs` ni `generar.cjs`.
- Los resultados quedan en `public/data-YYYYMM.js`; si hay que reprocesar, usar `/api/recalcular/:periodo`.
- Timeout del spawn: 5 minutos. Archivos muy grandes pueden cortarse.
