# CLAUDE.md — VentaObjetivoSucursal

## Qué es

Clon **100% solo lectura** de [VentaObjetivo](../VentaObjetivo/CLAUDE.md), para encargados
que manejan **una sola sucursal** — ven sólo esa sucursal, sin poder cargar ni editar nada.
Mismo `server.js`/`consultas.js`/`public/index.html` de base (creado 31/08/2026), con estas
diferencias puntuales respecto al original:

- `puedeEditar(req)` fijo en `false` — todas las rutas POST/DELETE devuelven 403 siempre,
  para cualquier usuario (no hay usuario "admin/vallejo" acá).
- La sucursal se resuelve **dinámicamente por usuario**, no con un mapa hardcodeado: nueva
  query `SUCURSAL_UNICA_DE_USUARIO` en `consultas.js` — matchea el username del portal
  (header `X-Portal-User`, case-insensitive) contra la columna **`Usuario`** (no
  `NombreApellido`) de `TABLEROS.dbo.EncargadosSucursalObjetivos`, **sólo si ese Usuario
  tiene EXACTAMENTE una fila** (`HAVING COUNT(*) = 1`). Encargados de más de una sucursal
  no matchean acá — ya tienen acceso al VentaObjetivo original. Fail-closed: sin match, no
  ve ninguna sucursal (nunca "ve todo").
- Sidebar de Filtros (Empresa/Sucursal) y de Cargar/Editar Objetivos ocultos por completo
  (la sucursal ya viene fija) — sólo queda visible el filtro de Años.
- En "Totales", los botones de grupo (Pueblo/Tesi/Digitales) que no correspondan a la
  empresa real de la sucursal del usuario se ocultan solos
  (`ajustarGruposSucursalUnica()`).
- Sin botón/modal de ayuda, sin desglose por sucursal al hacer clic en una celda (no
  aportan nada viendo una sola sucursal).
- **Histórico limitado a 2 años atrás** (`HISTORICO_MAX_ANIOS`/`mesLimiteHistorico()` en
  `server.js`, rolling — no una fecha fija), aplica a TODO el tablero: `filtrarGrilla`
  (Comparativas) y el endpoint de "Totales" (`GET /api/margenes-empresa?mes=` rechaza con
  400 un mes anterior al límite). El selector de Años y el selector de mes de Totales se
  arman en el cliente a partir de lo que ya vino filtrado del server, así que no hace falta
  tocar nada del frontend para que respeten el límite.

Para todo lo demás (flujo de datos, dependencias SQL, columnas "x Día", selector de mes
histórico en Totales, gotchas de despliegue) es idéntico a
[VentaObjetivo/CLAUDE.md](../VentaObjetivo/CLAUDE.md) — no se duplica acá.

## Servicio y acceso

- Servicio de Windows: **`dashventaobjetivosucursal.exe`** (node-windows), puerto **3018**,
  entrada `server.js`, carpeta de trabajo `server/`.
- **Los usuarios acceden SOLO vía el portal**: `http://10.0.0.118/d/20/` (`Dashboards.Id=20`
  en `portal.db`, no versionado).
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\VentaObjetivoSucursal\server; $env:PORT=3018; node server.js
  ```
- Reinstalar el servicio desde cero:
  ```powershell
  cd C:\apps\portal\deploy\dashboards
  node install-dashboard-service.js "Dash-VentaObjetivoSucursal" "C:\apps\dashboards\VentaObjetivoSucursal\server" 3018
  ```
- `.env`: mismas variables que VentaObjetivo (ver `server/.env.example`), mismo SQL Server
  10.0.0.115, mismas bases (`TABLEROS`/`dw_vallejo`).

## Alta de usuarios (31/08/2026) — no versionada, hay que repetirla a mano si se pierde

40 usuarios (encargados de sucursal única, ver query abajo) dados de alta en `portal.db`
con permiso **sólo** a este dashboard (Id 20) — Users + Permissions, vía un script
standalone (`Microsoft.Data.Sqlite`, no forma parte del repo, corrido una sola vez). Se
excluyó `JIA` (fila con `Sucursal="*"` en la tabla, no bridgea a ninguna sucursal real).

Query para volver a identificar el universo (si hace falta repetir el alta tras perder
`portal.db`, o dar de alta un encargado nuevo):
```sql
SELECT UPPER(ESO.Usuario)
FROM TABLEROS.dbo.EncargadosSucursalObjetivos AS ESO
GROUP BY ESO.Usuario
HAVING COUNT(*) = 1;
```
Además de este alta en `portal.db`, cada usuario necesita existir en **`USUARIOS_APPS`**
(la tabla que valida el login corporativo real — ver
[proxy-dashboards](../../portal-src/CLAUDE.md) y la corrección documentada ahí: el login
NO es AD/dominio, es esa tabla mantenida a mano) — sin eso, el alta en `portal.db` no
alcanza para que la persona pueda loguearse.

## Qué NO está en este repo

Igual que VentaObjetivo (`.env`, `portal.db`/Users/Permissions, `USUARIOS_APPS`) — ver esa
sección en [VentaObjetivo/CLAUDE.md](../VentaObjetivo/CLAUDE.md). Acá además: la lista de
los 40 usuarios dados de alta y el script que los cargó tampoco están versionados — si se
necesita reconstruir, correr de nuevo la query de arriba y recrear Users/Permissions
(por UI de Administración del portal, o un script equivalente).

## Gotchas

- El `PORT` que inyecta el servicio pisa al del `.env` — mantener 3018 único.
- Cambios en `server/` necesitan `Restart-Service dashventaobjetivosucursal.exe`. Cambios
  sólo en `server/public/index.html` se sirven directo desde disco, sin reinicio.
- Si se agrega un encargado nuevo de sucursal única, no hay automatización de alta — hay
  que repetir el proceso de arriba a mano.
- Pedir confirmación antes de reinstalar el servicio, tocar `.env`, o dar de alta/borrar
  usuarios en `portal.db`.
