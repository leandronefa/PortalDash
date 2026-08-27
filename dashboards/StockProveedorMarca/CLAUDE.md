# CLAUDE.md — StockProveedorMarca

## Qué es
Dashboard de **stock sumado por proveedor y marca**, navegable por mes/año y por empresa
(Tesi/Pueblo/Todas). Backend Express (`server.js`, **CommonJS**) + frontend estático vanilla
(`server/public/index.html`, sin build). Sólo lectura.

## Servicio y acceso
- Servicio de Windows: **`dashstockproveedormarca.exe`** (node-windows), puerto **3017**,
  entrada `server.js`.
- **Los usuarios acceden SOLO vía el portal**: `http://10.0.0.118/d/19/` (dado de alta el
  27/08/2026, `Dashboards.Id=19` en `portal.db`).
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\StockProveedorMarca\server; $env:PORT=3017; node server.js
  ```
- Logs: `daemon\Dash-StockProveedorMarca.out.log` (y `.err.log`).
- `.env` (solo nombres): `PORT`, `HOST`, `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`,
  `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_CERT`, `DB_POOL_MAX`, `DB_TIMEOUT_MS`, `TBL_FOTOSTOCK`,
  `TTL_CACHE_MIN`.

## Flujo de datos (SOLO LECTURA)
Consulta `db_Cegid.dbo.FotoStockMES2` en 10.0.0.115 (mismas credenciales que DashMeLi/
VentaObjetivo/ComisionesINDO): una fila por artículo/color/talle/sucursal, con una **foto
(snapshot) por cada fin de mes** (56 fechas al 27/08/2026, desde 2021-12-31). Cada período es
inmutable una vez cerrado, así que `/api/stock` se cachea en memoria por `(fecha, empresa)` con
TTL largo (`TTL_CACHE_MIN`, default 24 h) — no hace falta invalidar por escritura porque no hay
escritura. `/api/periodos` tiene su propia caché de 1 h (por si se agrega la foto del mes en
curso mientras el servicio sigue corriendo).

Agregación real: `SUM(stock)`, `SUM(stockPesos)`, `COUNT(DISTINCT artprove)` agrupado por
`nomprov`/`nommarca` para la `fecha` pedida (y `nomfilial` si se filtra empresa). Con los índices
existentes (`IX_PLE_20250611_001` cubre fecha+nomprov+nommarca+stock) tarda ~250ms sobre 11.8M
filas.

## Particularidades del origen
- `nomfilial` guarda **`'Tesi '` / `'Pueblo '` con espacio final** — `EMPRESAS` en `server.js`
  mapea la key normalizada (`TESI`/`PUEBLO`) al valor real. No comparar por igualdad con un
  string sin el espacio.
- `nomfilial` viene `NULL` en ~1900 filas residuales de 4+ años de histórico (stock total
  insignificante) — quedan afuera al filtrar por empresa, incluidas en "Todas" (sin `WHERE`).
- `nommarca` viene `NULL` para ~70 proveedores (no tienen marca cargada en origen, ej.
  "CALZADOS GUNAR", "SALDOS PUEBLO TESI"). El front los muestra como **"(sin marca)"**, agrupados
  igual bajo su proveedor — no se descartan filas por marca nula.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/salud` | Chequeo de conexión a SQL |
| GET | `/api/periodos` | Fechas de foto disponibles (`fecha`, `anio`, `mes`, `etiqueta`) |
| GET | `/api/stock?fecha=YYYY-MM-DD&empresa=TESI\|PUEBLO\|TODAS` | Filas proveedor+marca con `stock`, `stockPesos`, `articulos`, más `totales` |

`fecha` tiene que ser una de las que devuelve `/api/periodos` (fin de mes exacto) — cualquier otra
da 400. `empresa` desconocida también da 400 (nunca cae por defecto a "Todas" ni a una empresa
fija, mismo criterio que ControlCaja).

## Gotchas
- El `PORT` que inyecta el servicio pisa al del `.env`; mantener 3017 único.
- Cambios en `server/` necesitan `Restart-Service dashstockproveedormarca.exe` (no hace falta build,
  no hay paso de compilación).
- No commitear `.env` (`dashboards/**/.env` ya está en el `.gitignore` raíz).
- Pedir confirmación antes de reinstalar el servicio o tocar `.env`.
