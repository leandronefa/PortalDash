# CLAUDE.md — StockProveedorMarca

## Qué es
Dashboard de **stock sumado por proveedor y marca**: cuadrícula Año (filas) × Mes (columnas) en
tres cuadros apilados (Valores / % mes a mes / % año a año), con toggle de empresa
(Tesi/Pueblo/Todas) y de métrica (unidades / valorizado $). Backend Express (`server.js`,
**CommonJS**) + frontend estático vanilla (`server/public/index.html`, sin build). Sólo lectura.

**Filtros** (28/08/2026): 6 facetas relacionales que van sumando (unión dentro de cada faceta,
intersección entre facetas) — Proveedor, Marca y el **árbol de clase** completo: Sección → Género
→ Familia → Línea. Elegir un valor en cualquiera acota las opciones de las otras 5 (y las poda si
dejan de tener sentido). Ver `FACETAS` en `server/public/index.html` y `CAMPOS_FILTRO` en
`server/consultas.js` — agregar una séptima faceta es tocar esos dos arrays, nada más.

Diseño: primero selector de período puntual + tabla plana (26/08/2026) → cuadrícula año×mes con
todo el histórico traído de una (27/08/2026) → arquitectura actual, filtrado server-side
(28/08/2026), todo a pedido del usuario.

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
(snapshot) por cada fin de mes** (55 fechas al 28/08/2026, desde 2022-01-31 — la foto de
2021-12-31 que existía el 27/08 desapareció de la tabla origen entre una sesión y la otra; el
código no asume un mínimo fijo, lee lo que haya). Cada período es inmutable una vez cerrado.

El cruce completo de las 6 dimensiones (fecha×proveedor×marca×sección×género×familia×línea) es
**≈139.000 combinaciones** — demasiado para mandarlo entero al cliente. Por eso son dos endpoints
separados en vez de uno:
- **`/api/dimensiones`**: combinaciones DISTINCT de las 6 dimensiones, SIN fecha ni números
  (≈6.200 filas, ≈900KB, ~7s en frío). El front la trae una vez por empresa y arma con eso las
  listas de filtro relacionales enteramente en el cliente (sin volver a pegarle a SQL al tildar
  una opción).
- **`/api/matriz`** (POST): agregado por fecha, YA filtrado server-side por lo que el usuario tenga
  tildado en las 6 facetas — como mucho ~55 filas por pedido, ~0,5-0,8s por consulta (el índice
  `IX_PLE_20250611_001` cubre las 6 columnas de filtro + fecha + stock). **Cada cambio de filtro
  dispara un pedido nuevo** — no hay forma de precalcular esto en el cliente dado el tamaño del
  cruce. Se cachea en memoria por la combinación exacta de `empresa` + los 6 arrays de filtro
  (clave = `JSON.stringify`), con el mismo TTL largo que el resto (`TTL_CACHE_MIN`, default 24h) —
  son fotos de fin de mes ya cerradas, no cambian una vez tomadas.

Ambos endpoints van por `TTL_CACHE_MIN` (default 24h) en `Map`s en memoria del proceso — se pierden
al reiniciar el servicio, se recalculan solos en el próximo pedido.

## Particularidades del origen
- `nomfilial` guarda **`'Tesi '` / `'Pueblo '` con espacio final** — `EMPRESAS` en `server.js`
  mapea la key normalizada (`TESI`/`PUEBLO`) al valor real. No comparar por igualdad con un
  string sin el espacio.
- `nomfilial` viene `NULL` en ~1900 filas residuales de 4+ años de histórico (stock total
  insignificante) — quedan afuera al filtrar por empresa, incluidas en "Todas" (sin `WHERE`).
- `nommarca`, `nomSec`, `nomgenero`, `nomflia` y `nomlinea` pueden venir `NULL` (~1500-1900 filas
  cada una, no siempre las mismas filas) cuando el dato no se cargó en origen — cada faceta lo
  muestra como su propio centinela `"(sin X)"` (`FACETAS[].sentinel` en el front, `CAMPOS_FILTRO[].sentinel`
  en `consultas.js`) en vez de descartar la fila. Un `IN (...)` de SQL nunca matchea `NULL`, así que
  `condicionIn()` arma `(columna IN (...) OR columna IS NULL)` cuando el centinela está tildado.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/salud` | Chequeo de conexión a SQL |
| GET | `/api/dimensiones?empresa=TESI\|PUEBLO\|TODAS` | `combos`: filas `{proveedor,marca,seccion,genero,familia,linea}` distintas (sin fecha/números), para armar los filtros |
| POST | `/api/matriz` | Body `{empresa, proveedores[], marcas[], secciones[], generos[], familias[], lineas[]}` (arrays opcionales, vacío = sin filtrar esa faceta) → `filas` `{fecha,anio,mes,stock,stockPesos}` agregadas server-side, más `recarga` |

`empresa` desconocida da 400 en los dos endpoints (nunca cae por defecto a "Todas" ni a una
empresa fija, mismo criterio que ControlCaja).

## Gotchas
- El `PORT` que inyecta el servicio pisa al del `.env`; mantener 3017 único.
- Cambios en `server/` necesitan `Restart-Service dashstockproveedormarca.exe` (no hace falta build,
  no hay paso de compilación).
- No commitear `.env` (`dashboards/**/.env` ya está en el `.gitignore` raíz).
- Pedir confirmación antes de reinstalar el servicio o tocar `.env`.
