# CONTEXT.md — DashPromocionesMP

## Propósito
Cruce de **ventas vs liquidaciones de MercadoPago** (TESI y PUEBLO). Muestra promociones, medios de pago, desglose por sucursal, cuotas y emisores. Conciliación entre lo vendido y lo acreditado por MP.

## Stack
- **Frontend**: React 19 + Vite 6.2.3 + TypeScript + Recharts + PapaParse
- **Backend**: Express (`server.js`) — ESM (`import/export`)
- **Puerto**: 3002
- **Servicio Windows**: `dashpromociones.exe`

## Fuentes de datos
- **SQL Server**: `10.0.0.115` / base `db_Cegid` — ventas (SP `sp_GrillaPromosMP`, sobre tabla `CGD_CONDCOM_OPERACION`)
- **FTP**: `c2490045.ferozo.com` — archivos de liquidación MercadoPago (descarga automática)
- **Credenciales**: en `.env` (no commitear)

## Datos de cliente en ventas (2026-07-23)
El CSV `CONDCOMER_OPERACIONES.CSV` (cargado por el SP `spCapturaCSVcegid` en la base `dw_vallejo`, server `10.0.0.115`) sumó 3 columnas: `DNI_CLIENTE`, `APE_CLIENTE`, `NOM_CLIENTE`. Se agregaron a:
- `tmpCGD_CONDCOM_OPERACION` y `CGD_CONDCOM_OPERACION` (ALTER TABLE, varchar nullable) — `spCapturaCSVcegid` usa `SELECT *` así que no necesitó cambios.
- `sp_GrillaPromosMP` (ALTER PROC) — ahora expone `DNI_CLIENTE`, `APE_CLIENTE`, `NOM_CLIENTE` al final del recordset.
- Frontend (`src/lib/data-processing.ts`): `Venta.dniCliente/apeCliente/nomCliente`, parseados en `parseVentas`.
- `App.tsx`: columna **"Cliente"** en la tabla de cruce (pestaña "cruce") y en el CSV exportable (`downloadCruceCsv`).

`server.js` no necesitó cambios: `/api/ventas` vuelca `Object.keys(rows[0])` dinámicamente, así que cualquier columna nueva del SP pasa sola al CSV.

## Datos de cliente en Reporte Ventas Histórico (2026-07-24)
`sp_ReporteVentasHistorico` (usado por `/api/reporte-ventas-historico`) lee de `dw_vallejo.f_vta_cabecera`, que **no tiene datos de cliente**. Se agregó `DNI_CLIENTE`/`APE_CLIENTE`/`NOM_CLIENTE` vía dos `LEFT JOIN` (por sucursal+ticket, normalizando `l_sucursal.desc_sucursal` sin ceros a la izquierda contra `SUC`/`SUCURSAL` con padding a 6 dígitos, con `COLLATE Modern_Spanish_CI_AS` por conflicto de collation entre bases):
- `CGD_CONDCOM_OPERACION` (deduplicado por `SUCURSAL+NUMERO` con `ROW_NUMBER()`, ya que ~117 tickets tienen más de una fila por varias promos aplicadas — siempre mismo DNI) → aporta DNI/Apellido/Nombre **solo si la venta tuvo una condición comercial aplicada** (~1.5% de las filas en la muestra probada).
- `Vta_cab_HORA` (`CODCLIENTE`/`NOMCLIENTE`, sin DNI, nombre completo sin separar) → fallback para `NOM_CLIENTE` cuando no hubo promo (cubre ~94% de las filas).
Verificado que el join no duplica filas (mismo conteo y mismo total de venta antes/después). `server.js` no necesitó cambios (misma lógica dinámica de columnas).

## DNI en ventas WEB/MercadoLibre (2026-07-24)
Las ventas WEB/ML no tenían DNI: en `dw_vallejo.f_vta_cabecera` esas ventas se agrupan bajo 3 "sucursales virtuales" (`WEB Tesi`/`WEB Pueblo`/`WEB FK`, `id_sucursal` 63/64/74) que **no existen** como `SUC` en `db_Cegid` (0 filas siempre, ni en `Vta_cab_HORA` ni en `CGD_CONDCOM_OPERACION`). La venta real sí está en `Vta_cab_HORA`, pero registrada bajo la **sucursal física** que la despachó, con `ORIGEN='ECO'` y `NROTICKET` vacío (solo `NRO` poblado).

Se agregó a `sp_ReporteVentasHistorico` un tercer LEFT JOIN (`EcoDedup`) contra `Vta_cab_HORA` filtrado a `ORIGEN='ECO'`, cruzando **solo por `NRO` (ticket) + fecha, sin filtrar por `SUC`**, deduplicado con `ROW_NUMBER()` (mismo patrón que `CondComDedup`) para evitar fan-out. Se usa como último fallback: `ISNULL(C.DNI_CLIENTE, ISNULL(V.CODCLIENTE, VE.CODCLIENTE))`.

Motivo de no filtrar por SUC en este join: el `NRO` de operación **no es único globalmente** (hay ~4000-7000 colisiones NRO+fecha entre sucursales distintas en 6-12 meses), así que no se puede aplicar como reemplazo general del join existente — solo es seguro restringido a `ORIGEN='ECO'` (34 colisiones en 180 días entre sí, riesgo mínimo aceptado). Verificado: cobertura de DNI en ventas WEB/ML pasó de 0% a ~99.8% (751/752 en muestra de 10 días), sin duplicar filas.

Investigado y descartado como fuente: tablas viejas de ecommerce (`TBL_TICKETS_ECOM_CAB`/`_HISTORICOS`, `OrdenesMercadoLibre`, `TBL_VTEX_ORDENES`) — todas abandonadas desde ~2022, no sirven para ventas actuales.

## Endpoints API
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/ventas` | CSV de ventas desde SQL |
| GET | `/api/tesi` | CSV de MP TESI (descargado de FTP) |
| GET | `/api/pueblo` | CSV de MP PUEBLO (descargado de FTP) |
| GET | `/api/status` | Timestamps de última actualización |
| POST | `/api/refresh` | Forzar descarga de archivos FTP |

## Build
```powershell
npm run build        # genera dist/ (frontend)
```
El `server.js` sirve `dist/` y expone `/api/*`.

## Archivos clave
- `server.js` — servidor Express (ESM)
- `src/` — frontend React
- `.env` — credenciales SQL + FTP
- `import_local_csv.mjs` — utilidad para importar CSVs locales (uso manual)

## Gotchas
- Módulo ESM: usa `import`, no `require`. No agregar `"type":"commonjs"` al package.json.
- Los archivos descargados del FTP se cachean localmente; `/api/refresh` los fuerza a rebajar.
