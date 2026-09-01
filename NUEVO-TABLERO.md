# NUEVO-TABLERO.md — Cómo agregar un dashboard nuevo

> Guía práctica, basada en cómo se armaron los dashboards reales de este server
> (VentaObjetivo, VentaObjetivoSucursal, StockProveedorMarca, ControlCaja, etc.).
> Antes de arrancar, leer `C:\apps\CLAUDE.md` (raíz) y `C:\apps\dashboards\CLAUDE.md`
> — ahí está el mapa de puertos/servicios actual y las reglas de oro del server.

## Resumen (8 pasos)

1. Crear la app Node/Express en `C:\apps\dashboards\<Nombre>\`
2. `.env` con las credenciales de SQL Server
3. Probar en primer plano (local, sin servicio todavía)
4. Instalar como servicio de Windows
5. Dar de alta en el portal (Administración → Dashboards)
6. Otorgar permisos a los usuarios que lo van a usar
7. (Opcional) Saber quién está logueado — header `X-Portal-User`
8. Documentar: `CLAUDE.md` propio del dashboard + actualizar los dos raíz

---

## 1. Estructura de la app

Todos los dashboards Node de este server siguen el mismo patrón (Express CommonJS,
sin build, frontend vanilla en `public/index.html`):

```
C:\apps\dashboards\<Nombre>\
├── server\
│   ├── server.js          ← entrada, rutas Express, conexión SQL
│   ├── consultas.js        ← todas las queries SQL como strings, exportadas
│   ├── objetivos-store.js  ← (si hace falta borrador local) patrón key-value por mes
│   ├── public\
│   │   └── index.html      ← frontend entero (HTML+CSS+JS), sin bundler
│   ├── .env                ← credenciales reales (NUNCA se commitea)
│   ├── .env.example         ← mismo archivo sin los valores sensibles, SÍ se commitea
│   └── package.json
├── data-store\              ← si hay borradores locales, en .gitignore
├── sql\                     ← si el dashboard necesita objetos SQL propios (SP, tipos)
└── CLAUDE.md                ← doc propia de este dashboard (ver sección 8)
```

- **CommonJS** (`require`), no ESM — evita el gotcha de `"type":"module"` en
  `package.json` rompiendo `require`.
- Dependencias mínimas: `express`, `mssql`, `dotenv`. Si hace falta CORS,
  `cors` (sólo si el frontend pega a otro origen, no es el caso normal acá).
- El frontend es HTML+JS plano servido por `express.static`, no un build de
  Vite/React salvo que el dashboard lo justifique (la mayoría no lo necesita).

### `server.js` — puntos clave

```js
require('dotenv').config();
const path = require('path');
const express = require('express');
const sql = require('mssql');

const PORT = Number(process.env.PORT || 30XX);
const HOST = process.env.HOST || '127.0.0.1';   // NUNCA 0.0.0.0 (ver Gotchas)

const cfgBase = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === '1',
    trustServerCertificate: process.env.DB_TRUST_CERT !== '0'
  },
  connectionTimeout: Number(process.env.DB_TIMEOUT_MS || 60000),
  requestTimeout: Number(process.env.DB_TIMEOUT_MS || 60000)
};

// UN pool por base de datos que se use — ver Gotchas si son varias.
let poolX = null;
async function getPoolX() {
  if (!poolX) poolX = await new sql.ConnectionPool({ ...cfgBase, database: 'NombreBase' }).connect();
  return poolX;
}

const app = express();
app.use(express.json());
// ... rutas ...
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, HOST, () => console.log(`http: escuchando en http://${HOST}:${PORT}`));
```

### `.env.example` (commitear esto, no el `.env` real)

```
PORT=30XX
HOST=127.0.0.1
DB_SERVER=10.0.0.115
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=
DB_ENCRYPT=0
DB_TRUST_CERT=1
DB_TIMEOUT_MS=60000
```

La password real de `sa` es la misma que usan los demás dashboards contra
10.0.0.115 — pedirla al usuario o copiarla del `.env` real de otro dashboard
existente (nunca commitearla).

## 2. Elegir puerto

Mirar la tabla de `C:\apps\dashboards\CLAUDE.md` y `C:\apps\CLAUDE.md` — usar el
siguiente libre (al momento de escribir esto, el último asignado es 3019). Un
puerto único por dashboard evita `EADDRINUSE`.

## 3. Probar en primer plano (antes de instalar el servicio)

```powershell
cd C:\apps\dashboards\<Nombre>\server
npm install
$env:PORT=30XX
node server.js
```

Abrir `http://localhost:30XX` desde el propio server. Si tira error, ahí se ve
la traza real — mucho más fácil que leer los logs del servicio después.

## 4. Instalar como servicio de Windows

```powershell
cd C:\apps\portal\deploy\dashboards
node install-dashboard-service.js "Dash-<Nombre>" "C:\apps\dashboards\<Nombre>\server" <PUERTO>
```

- El nombre real del servicio queda con sufijo `.exe` (ej. `dashventaobjetivo.exe`)
  aunque se lo haya pasado como `"Dash-<Nombre>"` — `Get-Service dash*` lo
  encuentra, `Get-Service Dash-*` no.
- El `PORT` que inyecta el servicio **pisa** al del `.env` — no hace falta que
  coincidan, pero mejor que sí, para no confundirse en diagnóstico.
- Logs: `C:\apps\dashboards\<Nombre>\server\daemon\Dash-<Nombre>.out.log` / `.err.log`.
- Si hay que reinstalar: **pedir confirmación primero** (borra el registro del
  servicio). Limpiar la carpeta `daemon\` antes de reinstalar si `node-windows`
  dice "ya existe" pero `Get-Service` no lo muestra.

## 5. Dar de alta en el portal

`http://10.0.0.118/` → **Administración → Dashboards → + Nuevo**: nombre,
puerto, ícono. Esto crea una fila en `portal.db` (`Dashboards`, con un `Id`
numérico) — ese `Id` es el que arma la URL final: `http://10.0.0.118/d/{id}/`.

**`portal.db` no está en git** (es estado runtime, en `C:\apps\portal\App_Data\`)
— si se pierde sin backup, este alta hay que repetirla a mano.

## 6. Otorgar permisos a usuarios

Mismo lugar (Administración), por usuario: qué dashboards puede ver. Sin esto,
un usuario con cuenta válida en el portal igual recibe 403 al intentar abrir
`/d/{id}/`.

Si hace falta dar de alta gente nueva: además de esto, cada persona necesita
existir en **`USUARIOS_APPS`** (la tabla que valida el login corporativo real,
ver `portal-src/CLAUDE.md`) — el alta en `portal.db` sola no alcanza para que
se pueda loguear.

## 7. (Opcional) Saber quién está logueado

Desde el 28/08/2026 el portal manda el username real en el header
**`X-Portal-User`** al reenviar cualquier request hacia el dashboard
(`portal-src/Services/DashboardProxy.cs`, `ForwardAsync`) — esto ya está
andando, **no hay que tocar el portal de nuevo** para usarlo en un dashboard
nuevo, sólo leer el header:

```js
function usuarioDe(req) {
  return String(req.headers['x-portal-user'] || '').trim();
}
```

Sin el header (alguien le pega directo al puerto para diagnóstico, sin pasar
por el portal) el valor es `''` — diseñar cualquier lógica de permisos
**fail-closed**: sin usuario identificado, asumir el caso más restrictivo
(solo lectura / sin acceso), nunca "ve todo".

Ver `VentaObjetivo/server.js` (`puedeEditar`, `exigirEdicion`,
`SUPERVISORES_RESTRINGIDOS`) para un ejemplo real de permisos por usuario
sobre este mismo mecanismo.

## 8. Documentar

- **`CLAUDE.md` propio** del dashboard nuevo (`C:\apps\dashboards\<Nombre>\CLAUDE.md`):
  qué es, servicio/puerto, dependencias SQL, flujos de escritura si los hay,
  gotchas puntuales. Usar el de `VentaObjetivo/CLAUDE.md` como plantilla — es
  el más completo.
- Agregar la fila a la tabla de `C:\apps\dashboards\CLAUDE.md` (mapa de
  servicios) y a la de `C:\apps\CLAUDE.md` (raíz) si aplica.
- Si el dashboard usa objetos SQL propios (SP, tipos, tablas), documentar en su
  propio `CLAUDE.md` cómo recrearlos si el server se pierde (ver
  `VentaObjetivo/sql/crear-sp-dashboard.sql` como ejemplo — el script de
  creación SÍ va en el repo, ejecutarlo contra prod no).

---

## Gotchas ya vividos en este repo (evitan repetir el error)

- **`0.0.0.0` vs `127.0.0.1`**: todos los dashboards escuchan sólo en loopback
  desde jul 2026 — el portal es quien expone todo por `/d/{id}/`. La única
  excepción real es `sucursal-user-visualizer` (3003), porque agentes remotos
  le pegan directo. Un dashboard nuevo casi seguro **no** necesita `0.0.0.0`.

- **`d.setMonth(d.getMonth()+1)` desborda el mes** el último día de cualquier
  mes de 31 cuyo mes siguiente tenga menos días (ej. 31 de agosto → "31 de
  septiembre" no existe → JS lo tira a 1° de octubre). Si hay que calcular
  "el mes que viene", construir la fecha con **día 1** primero:
  `new Date(anio, mes + 1, 1)`, no sumarle un mes a la fecha de hoy.

- **`mssql`'s `sql.connect()` (API global) cachea UN pool por proceso** —
  llamarlo dos veces con distinta `database` en el mismo script devuelve el
  mismo pool ya conectado a la primera base. Usar siempre
  `new sql.ConnectionPool(cfg).connect()` por base que se necesite, con su
  propia variable de pool (`poolTableros`, `poolDwVallejo`, etc.).

- **TVP (parámetros de tipo tabla) y `EXEC base.dbo.SP` cruzando bases**: si
  un SP recibe un parámetro de tipo tabla (`dbo.MiTipoType READONLY`) definido
  en la base `X`, la conexión que hace el `EXEC` tiene que tener a `X` como
  base **actual** — no alcanza con calificar `X.dbo.SP_...` desde una conexión
  a otra base, SQL Server no resuelve el tipo. Si hace falta, abrir un pool
  aparte apuntando directo a `X`.

- **SQL Server 2008 R2** (el de 10.0.0.115): sin `OPENJSON`, sin `STRING_SPLIT`
  — nada de parsear JSON en el SP. Para pasar un conjunto de filas como
  parámetro, usar un **Table-Valued Parameter** (soportado desde 2008), no
  JSON. Y las columnas con datos mixtos (numéricos y con letras) necesitan el
  patrón `CASE WHEN col NOT LIKE '%[^0-9]%' THEN CAST(col AS INT) END` en vez
  de un `CAST` directo — el motor no garantiza evaluar el `WHERE`/`JOIN` en
  orden, así que un `CAST` sin guardia puede tirar error sobre una fila que
  el filtro debería haber descartado.

- **`portal.db` en modo WAL**: si se copia el archivo para leerlo aparte (ej.
  un script de diagnóstico), copiar también `portal.db-wal` y `portal.db-shm`
  al lado — si no, se lee data vieja (lo más reciente puede estar sólo en el
  `-wal`, todavía sin "checkpointear" al `.db` principal).

- **`appsettings.json` del portal**: el que está en el repo (`portal-src/`)
  tiene la password de SQL como placeholder (`<CHANGE_ME>`) a propósito — el
  real, con la password de producción, sólo vive en
  `C:\apps\portal\appsettings.json` (no versionado). Al desplegar una
  actualización del portal (`dotnet publish` + copiar a `C:\apps\portal`),
  **nunca** sobreescribir `appsettings*.json` ni la carpeta `App_Data\` — ya
  pasó un incidente de login roto por esto.

- **No asumir que el username del portal coincide con algún campo de negocio**
  (nombre de encargado, email, legajo). Ya hubo un caso real donde no
  coincidía (`GastonG` en una tabla de negocio vs. `ggrillo` como username
  real del portal) — siempre confirmar el mapeo con el usuario, no adivinarlo.

---

Relacionado: `C:\apps\CLAUDE.md` (raíz), `C:\apps\dashboards\CLAUDE.md` (mapa
de servicios), `C:\apps\portal-src\CLAUDE.md` (portal), y
`C:\apps\dashboards\VentaObjetivo\CLAUDE.md` como ejemplo más completo de
`CLAUDE.md` propio de un dashboard.
