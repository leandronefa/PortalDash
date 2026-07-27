# Spec — Acceso restringido para usuarios Supervisor (EVIDABLE, JROSSINI)

**Fecha**: 2026-07-27
**Módulo**: ComisionesINDO — acceso/autorización transversal (auth, todos los routers, todas las páginas del sidebar)
**Alcance**: nuevo rol "supervisor" (idPerfil=8) que ve todo el tablero pero solo lectura y solo sus sucursales asignadas.

## 1. Contexto

Hoy cualquier usuario logueado (JWT válido) ve el sidebar completo y tiene acceso total a lectura y escritura de todos los endpoints — no existe ningún control por rol en el sistema. Se necesita dar acceso a dos usuarios nuevos, EVIDABLE (Eric Vidable) y JROSSINI (Josefina Rossini), que ya existen como login en `TBL_USUARIOS_APPS` con `idPerfil = 8` (perfil "supervisor" en `TBL_USUARIOS_PERFILES`, tabla compartida entre apps).

Regla de negocio confirmada por el usuario: estos dos usuarios deben ver **todo el tablero** (Dashboard, DATOS, Cálculos — sin recortar el sidebar), pero:
1. **Filtrado por sucursal**: solo ven filas/datos de las sucursales que tienen asignadas en `tbl_CoVenAppINDO_SupervisorSucursales`.
2. **Solo lectura**: no pueden crear/editar/borrar nada (ABM) ni disparar el cálculo (`Ejecutar cálculo`, recalcular Cajeros/Operadores/Ranking, etc.).

## 2. Vínculo usuario de login ↔ registro de Supervisor

`idPerfil = 8` identifica el ROL, no CUÁL supervisor es. Se agrega una columna nueva:

```sql
ALTER TABLE dbo.tbl_CoVenAppINDO_Supervisores ADD usuario_login VARCHAR(50) NULL;
UPDATE dbo.tbl_CoVenAppINDO_Supervisores SET usuario_login = 'EVIDABLE'  WHERE nombre = 'Eric Vidable';
UPDATE dbo.tbl_CoVenAppINDO_Supervisores SET usuario_login = 'JROSSINI'  WHERE nombre = 'Josefina Rossini';
```

El backend cruza `req.user.usuario` (viene del JWT, es `descUsuario` de `TBL_USUARIOS_APPS`) contra esta columna para resolver `supervisorId` y sus sucursales asignadas.

El ABM de supervisores (`server/routes/supervisores.js`, página `src/pages/supervisores.js`) suma el campo `usuario_login` a los payloads de `POST /` y `PUT /:id` y a la tabla del ABM, para que a futuro se pueda asignar sin tocar SQL directo.

## 3. Backend — middleware de scope y bloqueo de escritura

Nuevo archivo `server/middleware/supervisorScope.js`, montado en `server/index.js` inmediatamente después del `authMiddleware` global (antes de registrar los routers):

### 3.1 `attachScope(req, res, next)`
- Si `req.user.perfil !== 8` → `req.sucursalesPermitidas = null`, `req.supervisorId = null` (sin restricción, comportamiento actual intacto).
- Si `req.user.perfil === 8`:
  - Busca en `tbl_CoVenAppINDO_Supervisores` la fila con `usuario_login = req.user.usuario`.
  - Si no existe (usuario con perfil 8 pero sin vínculo cargado) → `req.sucursalesPermitidas = []` (no ve ninguna sucursal; evita fugas por default-abierto).
  - Si existe → `req.supervisorId = <id>`, `req.sucursalesPermitidas = [ ...IDs de tbl_CoVenAppINDO_SupervisorSucursales para ese supervisor_id ]`.

### 3.2 `blockWriteIfSupervisor(req, res, next)`
- Si `req.user.perfil === 8` y `req.method !== 'GET'` → `403 { error: 'Usuario de solo lectura' }`.
- Cubre de una sola vez todo ABM y todo disparador de cálculo, sin tocar cada ruta de escritura individualmente: `montos.js`, `ranking.js` (POST/PUT), `sucursales.js` (PATCH), `supervisores.js` (POST/PUT/DELETE), `cajeros.js` (PUT sucursal), `operadores.js` (PATCH jornada, POST calcular), `millon.js` (POST/PATCH), `datos.js` (POST/PUT/DELETE), `calculo.js` (POST ejecutar, POST cajeros).

### 3.3 Filtrado de lecturas — helper `filtrarPorSucursal(rows, permitidas, campo = 'sucursal_id')`

`server/utils/scopeFiltro.js`: si `permitidas === null` devuelve `rows` sin tocar; si no, devuelve `rows.filter(r => permitidas.includes(r[campo]))`.

Se llama explícitamente antes de cada `res.json()` en los endpoints con granularidad de sucursal:

| Archivo | Endpoint | Campo |
|---|---|---|
| `cajeros.js` | `GET /` | `sucursal_id` |
| `calculo.js` | `GET /cajeros` | `sucursal_id` |
| `calculo.js` | `GET /encargados` | `sucursal_id` |
| `calculo.js` | `GET /encargados-millon` | `sucursal_id` |
| `calculo.js` | `GET /ultimo` | filtra cada sub-array (`sucursales`, `cajeros`, `operadores`, `encargados`, `encargadosMillon`) por `sucursal_id`; `supervisores` usa la regla especial (3.4) |
| `operadores.js` | `GET /` | `sucursal_id` |
| `ranking.js` | `GET /` | `sucursal_id` |
| `sucursales.js` | `GET /` | `id` |
| `datos.js` | `GET /consumo`, `GET /efectivo` | `sucursal_id` |
| `datos.js` | `GET /reporte` | `id_sucursal` (nombre de campo distinto) |
| `objetivos.js` | `GET /consumo`, `GET /efectivo` | `sucursal_id` |
| `millon.js` | `GET /sucursales` | `sucursal_id` (en el objeto padre; el sub-array `operadores` se lleva sin cambios) |
| `millon.js` | `GET /operadores/resultado`, `GET /`, `GET /resumen` | `sucursal_id` |

**No se filtran** (config global, sin granularidad de sucursal, no hay dato sensible que ocultar): `montos.js GET /:tipo`, `ranking.js GET /multiplicadores`, `calculo.js GET /historial` (solo metadata de ejecuciones).

### 3.4 Casos especiales — resultados por supervisor

`supervisores.js GET /`, `calculo.js GET /supervisores`, y la clave `supervisores` dentro de `calculo.js GET /ultimo`: en vez de "filtrar sucursales ajenas de otros supervisores" (no tiene sentido — un supervisor no debe ver el resultado de otro supervisor), cuando `req.user.perfil === 8` estos devuelven **únicamente el registro cuyo `id === req.supervisorId`** (con sus sub-arrays `sucursales`/`plazas` completos, ya que son 100% suyos). Si `req.supervisorId` es `null` (o no matchea ninguno), devuelven lista vacía.

### 3.5 Caso especial — `operadores.js GET /jornadas`

No trae `sucursal_id` propio (la jornada es por `usuario` de operador). Para un supervisor, se resuelve cruzando contra el resultado de `GET /operadores?periodo=` del mismo período (que sí trae `sucursal_id` por operador) y filtrando por los `usuario` que caen en `sucursalesPermitidas`. Si no hay cálculo guardado para ese período, devuelve `[]` (no hay forma de resolver la sucursal sin ese cruce).

## 4. Frontend — ocultar acciones de escritura

`src/pages/login.js` ya guarda `user` (incluye `perfil`) en `localStorage` tras el login. Se agrega helper `isSupervisorReadonly()` (nuevo módulo `src/auth.js` o agregado a `src/api/client.js`) que lee `perfil === 8` del usuario guardado.

El backend ya devuelve 403 ante cualquier escritura de un perfil 8 — el frontend no revalida permisos, solo mejora la UX ocultando controles que fallarían igual:

| Página | Qué se oculta si `isSupervisorReadonly()` |
|---|---|
| `visor-sucursales` | Toggles Habilitada/Deshabilitada y Efectivo |
| `visor-montos` | Inputs/botones de edición de montos |
| `visor-ranking` | Edición inline de categoría, botón "Recalcular" |
| `supervisores` (ABM) | Botones de alta/edición/borrado y el checklist de asignación de sucursales |
| `total` | Botón "▶ Ejecutar cálculo" |
| `cajeros` | Edición de jornada / override manual |
| `operadores-retail`, `operadores-millon` | Edición de jornada |
| `millon` | Toggle "¿Es operador?" |

Páginas puramente de resultado (`dashboard`, `encargados`, `encargados-millon`, `resultado-supervisores`, `visor-objetivos`, `visor-ventas`) no tienen controles de escritura — no requieren cambios; ya muestran solo lo que el backend filtró.

**No se recorta el sidebar** (`src/components/sidebar.js` no cambia): el pedido explícito del usuario es que el supervisor vea todo el tablero, filtrado.

## 5. Fuera de alcance

- No se toca la lógica de cálculo (`calcEngine.js`) ni las reglas de negocio de Supervisores ya blindadas (sesión 2026-07-16).
- No se agrega UI de gestión de `usuario_login` para el ABM más allá de sumar el campo al formulario existente (no es un flujo nuevo de "vincular cuenta").
- No se contempla que un supervisor tenga acceso a más de un `usuario_login` ni que un usuario cambie de supervisor asignado dinámicamente — es 1 login = 1 fila de `Supervisores`.
- No se audita ni loguea especialmente el acceso de supervisores (mismo nivel de logging que hoy).

## 6. Verificación

- Test manual: login como EVIDABLE y JROSSINI, recorrer cada página del sidebar y confirmar que solo aparecen sus sucursales asignadas y que los botones de escritura no están.
- Test manual de bloqueo backend: con el token de un perfil 8, intentar `POST /api/calculo/ejecutar` (u otra ruta de escritura) directo por API y confirmar `403`.
- No hay suite de tests automatizados en el repo salvo `calcEngine.supervisores.test.js` (no aplica a este cambio, que es de autorización, no de motor de cálculo).
