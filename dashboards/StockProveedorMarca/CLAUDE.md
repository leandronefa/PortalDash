# CLAUDE.md — StockProveedorMarca

## Qué es
Dashboard de **stock sumado por proveedor y marca**: cuadrícula Año (filas) × Mes (columnas), con
filtros multi-selección de proveedor y marca que van sumando (unión dentro de cada filtro,
intersección entre los dos) y toggle de empresa (Tesi/Pueblo/Todas) y de métrica (unidades /
valorizado $). Backend Express (`server.js`, **CommonJS**) + frontend estático vanilla
(`server/public/index.html`, sin build). Sólo lectura.

El backend trae **todo el histórico agregado de una** (`/api/matriz`, ~19.000 filas
fecha×proveedor×marca) y el front hace el filtrado/sumado por año×mes enteramente en el cliente —
así los checkboxes de proveedor/marca responden al instante sin volver a pegarle a SQL en cada
click. Primer diseño (26/08/2026, selector de período puntual + tabla plana) reemplazado el
27/08/2026 a pedido del usuario por esta cuadrícula.

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
inmutable una vez cerrado, así que `/api/matriz` se cachea en memoria por `empresa` con TTL largo
(`TTL_CACHE_MIN`, default 24 h) — no hace falta invalidar por escritura porque no hay escritura.

Agregación real: `SUM(stock)`, `SUM(stockPesos)` agrupado por `fecha`/`nomprov`/`nommarca` sobre
**todo** el histórico (y `nomfilial` si se filtra empresa) — sobre 11.8M filas tarda ~4s en frío
(cache miss) y ~19.000 filas de resultado (~2,5MB de JSON); en caché responde en milisegundos. Los
tres universos (Todas/Tesi/Pueblo) quedan en caché por separado la primera vez que se piden — el
primer usuario del día que toca cada empresa paga esos ~2-4s, el resto sirve de memoria.

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
| GET | `/api/matriz?empresa=TESI\|PUEBLO\|TODAS` | Histórico completo: `filas` (`fecha`,`anio`,`mes`,`proveedor`,`marca`,`stock`,`stockPesos`), más `proveedores`/`marcas` (listas distintas para poblar los filtros) y `recarga` |

`empresa` desconocida da 400 (nunca cae por defecto a "Todas" ni a una empresa fija, mismo criterio
que ControlCaja). El front pide `/api/matriz` una vez por empresa (lo cachea en memoria del propio
navegador con un `Map`) y arma la cuadrícula año×mes y filtra por proveedor/marca sin más llamadas
al servidor.

## Gotchas
- El `PORT` que inyecta el servicio pisa al del `.env`; mantener 3017 único.
- Cambios en `server/` necesitan `Restart-Service dashstockproveedormarca.exe` (no hace falta build,
  no hay paso de compilación).
- No commitear `.env` (`dashboards/**/.env` ya está en el `.gitignore` raíz).
- Pedir confirmación antes de reinstalar el servicio o tocar `.env`.
