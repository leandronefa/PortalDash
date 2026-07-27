# Acceso restringido para usuarios Supervisor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los usuarios EVIDABLE y JROSSINI (idPerfil=8, "supervisor") ven todo el tablero de ComisionesINDO pero solo lectura y solo las sucursales que tienen asignadas.

**Architecture:** Middleware backend (`attachScope` + `blockWriteIfSupervisor`) montado en cada router, que resuelve `req.sucursalesPermitidas`/`req.supervisorId` desde una columna nueva `usuario_login` en `tbl_CoVenAppINDO_Supervisores`, y bloquea toda escritura con 403. Cada endpoint GET con granularidad de sucursal filtra su array de resultado con un helper puro `filtrarPorSucursal`. En el frontend, un helper `isSupervisorReadonly()` oculta los controles de escritura ya identificados en cada página.

**Tech Stack:** Node.js v24 ES Modules, Express 4, `mssql`, `node --test` (única suite existente en el repo: `calcEngine.supervisores.test.js`), Vite 6 SPA vanilla JS.

## Global Constraints

- SQL Server 2012 — no usar `DATEFROMPARTS` (no aplica en este plan, no se tocan fechas).
- No modificar la lógica del motor de cálculo (`calcEngine.js`) ni las reglas de negocio ya blindadas de Supervisores.
- No editar archivos fuente con PowerShell `-replace`/`Set-Content` (corrompe UTF-8/acentos) — usar el editor (Edit/Write tool) o Node.
- No tocar `src/pages/montos.js`, `src/pages/visor-sucursales.js`, `src/pages/sucursales-millon.js` — son código huérfano (no importados en `src/app.js`), no forman parte del sidebar real.
- Cambios en `server/` no requieren build, solo reiniciar el servicio (`Restart-Service dashcomisionesindo.exe`). Cambios en `src/` requieren `npm run build` antes de reiniciar.
- Toda ruta de escritura ya sigue el patrón `try { ... } catch (err) { console.error(err); res.status(500)... }` — no cambiar ese estilo, solo insertar el middleware/filtro.

---

### Task 1: Vínculo usuario↔supervisor — migración + resolver

**Files:**
- Create: `server/services/supervisorLookup.js`

**Interfaces:**
- Produces: `ensureUsuarioLoginColumn(pool)` (agrega la columna si falta + carga los 2 valores conocidos), `resolverSupervisor(pool, usuarioLogin)` → `Promise<{ supervisorId: number, sucursales: number[] } | null>`.

- [ ] **Step 1: Crear el archivo con la migración self-healing y el resolver**

```js
// server/services/supervisorLookup.js
import { sql } from '../config/db.js';

// Migración self-healing (mismo patrón que ranking.js/sucursales.js ensureColumns):
// agrega la columna si falta y carga el vínculo conocido de los 2 supervisores existentes.
export async function ensureUsuarioLoginColumn(pool) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.tbl_CoVenAppINDO_Supervisores') AND name = 'usuario_login'
    )
    ALTER TABLE dbo.tbl_CoVenAppINDO_Supervisores ADD usuario_login VARCHAR(50) NULL
  `);
  await pool.request().query(`
    UPDATE dbo.tbl_CoVenAppINDO_Supervisores SET usuario_login = 'EVIDABLE'
    WHERE nombre = 'Eric Vidable' AND usuario_login IS NULL
  `);
  await pool.request().query(`
    UPDATE dbo.tbl_CoVenAppINDO_Supervisores SET usuario_login = 'JROSSINI'
    WHERE nombre = 'Josefina Rossini' AND usuario_login IS NULL
  `);
}

// Resuelve el supervisor_id y sus sucursales asignadas a partir del usuario de login (JWT).
// Devuelve null si el usuario no tiene ningún supervisor vinculado (evita fugas por default-abierto).
export async function resolverSupervisor(pool, usuarioLogin) {
  const supR = await pool.request()
    .input('usuario', sql.VarChar, usuarioLogin)
    .query('SELECT id FROM dbo.tbl_CoVenAppINDO_Supervisores WHERE usuario_login = @usuario');
  if (!supR.recordset.length) return null;

  const supervisorId = supR.recordset[0].id;
  const asigR = await pool.request()
    .input('sup', sql.Int, supervisorId)
    .query('SELECT sucursal_id FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales WHERE supervisor_id = @sup');

  return { supervisorId, sucursales: asigR.recordset.map(r => r.sucursal_id) };
}
```

- [ ] **Step 2: Verificar manualmente que la migración corre sin errores**

Desde `C:\apps\dashboards\ComisionesINDO`, en una consola Node rápida (o agregando un log temporal en el próximo task donde se llama `ensureUsuarioLoginColumn`), confirmar contra SQL Server que la columna se creó:

```sql
SELECT id, nombre, usuario_login FROM dbo.tbl_CoVenAppINDO_Supervisores;
```

Expected: 2 filas, `Eric Vidable` con `usuario_login = 'EVIDABLE'`, `Josefina Rossini` con `usuario_login = 'JROSSINI'` (se confirma en el Task 3, que es el primero que invoca esta función a través del middleware).

- [ ] **Step 3: Commit**

```bash
git add server/services/supervisorLookup.js
git commit -m "feat(comisiones-indo): resolver supervisor por usuario_login (migracion self-healing)"
```

---

### Task 2: Helper de filtrado por sucursal (puro, con test)

**Files:**
- Create: `server/utils/scopeFiltro.js`
- Test: `server/utils/scopeFiltro.test.js`

**Interfaces:**
- Consumes: nada (función pura).
- Produces: `filtrarPorSucursal(rows, permitidas, campo = 'sucursal_id')` — usada por todos los routers en el Task 4 en adelante.

- [ ] **Step 1: Escribir el test (falla porque el archivo no existe)**

```js
// server/utils/scopeFiltro.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarPorSucursal } from './scopeFiltro.js';

test('sin restriccion (permitidas=null) devuelve todas las filas sin tocar', () => {
  const rows = [{ sucursal_id: 1 }, { sucursal_id: 2 }];
  assert.deepEqual(filtrarPorSucursal(rows, null), rows);
});

test('filtra por el campo por defecto sucursal_id', () => {
  const rows = [{ sucursal_id: 1 }, { sucursal_id: 2 }, { sucursal_id: 3 }];
  assert.deepEqual(filtrarPorSucursal(rows, [2, 3]), [{ sucursal_id: 2 }, { sucursal_id: 3 }]);
});

test('permitidas vacio devuelve array vacio', () => {
  const rows = [{ sucursal_id: 1 }];
  assert.deepEqual(filtrarPorSucursal(rows, []), []);
});

test('acepta un nombre de campo distinto (ej. id_sucursal)', () => {
  const rows = [{ id_sucursal: 10 }, { id_sucursal: 20 }];
  assert.deepEqual(filtrarPorSucursal(rows, [20], 'id_sucursal'), [{ id_sucursal: 20 }]);
});

test('acepta el campo "id" (tabla de sucursales, donde la fila ES la sucursal)', () => {
  const rows = [{ id: 1, nombre: 'A' }, { id: 5, nombre: 'B' }];
  assert.deepEqual(filtrarPorSucursal(rows, [5], 'id'), [{ id: 5, nombre: 'B' }]);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test server/utils/scopeFiltro.test.js`
Expected: FAIL — `Cannot find module './scopeFiltro.js'`

- [ ] **Step 3: Implementación mínima**

```js
// server/utils/scopeFiltro.js
export function filtrarPorSucursal(rows, permitidas, campo = 'sucursal_id') {
  if (permitidas === null) return rows;
  return rows.filter(r => permitidas.includes(r[campo]));
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test server/utils/scopeFiltro.test.js`
Expected: PASS — 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/utils/scopeFiltro.js server/utils/scopeFiltro.test.js
git commit -m "feat(comisiones-indo): filtrarPorSucursal helper puro + tests"
```

---

### Task 3: Middleware de scope y bloqueo de escritura + primer router (cajeros.js)

**Files:**
- Create: `server/middleware/supervisorScope.js`
- Modify: `server/routes/cajeros.js`

**Interfaces:**
- Consumes: `resolverSupervisor(pool, usuarioLogin)` y `ensureUsuarioLoginColumn(pool)` (Task 1), `getPool` (`server/config/db.js`), `filtrarPorSucursal` (Task 2).
- Produces: `attachScope(req, res, next)` — setea `req.sucursalesPermitidas: number[] | null` y `req.supervisorId: number | null`; `blockWriteIfSupervisor(req, res, next)` — 403 si `req.user.perfil === 8` y el método no es GET. Ambos se importan y encadenan en cada router de aquí en adelante.

- [ ] **Step 1: Crear el middleware**

```js
// server/middleware/supervisorScope.js
import { getPool } from '../config/db.js';
import { ensureUsuarioLoginColumn, resolverSupervisor } from '../services/supervisorLookup.js';

export async function attachScope(req, res, next) {
  if (req.user?.perfil !== 8) {
    req.sucursalesPermitidas = null;
    req.supervisorId = null;
    return next();
  }
  try {
    const pool = await getPool();
    await ensureUsuarioLoginColumn(pool);
    const info = await resolverSupervisor(pool, req.user.usuario);
    if (!info) {
      req.supervisorId = null;
      req.sucursalesPermitidas = [];
      return next();
    }
    req.supervisorId = info.supervisorId;
    req.sucursalesPermitidas = info.sucursales;
    next();
  } catch (err) {
    console.error('[attachScope]', err);
    res.status(500).json({ error: 'Error de servidor' });
  }
}

export function blockWriteIfSupervisor(req, res, next) {
  if (req.user?.perfil === 8 && req.method !== 'GET') {
    return res.status(403).json({ error: 'Usuario de solo lectura' });
  }
  next();
}
```

- [ ] **Step 2: Wire + filtrar en cajeros.js**

```js
// server/routes/cajeros.js — imports
import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';

const router = Router();
router.use(authMiddleware);
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

Y en el handler `GET /`, filtrar antes de responder:

```js
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT v.NRO_VENDEDOR AS nro_vendedor,
             LTRIM(RTRIM(ISNULL(v.APELLIDO,'')+' '+ISNULL(v.NOMBRE,''))) AS nombre,
             v.GCL_TEMPSPARTIEL AS parcial_tipo,
             v.FECHAING AS fecha_ingreso,
             CAST(CAST(dd.Sucursal AS INT) AS INT) AS sucursal_id,
             dd.Sucursal AS sucursal_codigo
      FROM dbo.tbl_CoVenApp_Vendedores v
      INNER JOIN dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
        ON dd.VEND = v.NRO_VENDEDOR
      WHERE v.TIPO = 'CAJERO'
        AND dd.Sucursal <> '0'
        AND ISNULL(dd.Sucursal,'') <> ''
        AND ISNUMERIC(dd.Sucursal) = 1
      ORDER BY dd.Sucursal, v.APELLIDO, v.NOMBRE
    `);
    res.json(filtrarPorSucursal(r.recordset, req.sucursalesPermitidas));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});
```

(El resto del archivo, incluido `PUT /:nroVendedor/sucursal`, queda igual — `blockWriteIfSupervisor` ya lo bloquea para perfil 8 antes de llegar al handler.)

- [ ] **Step 3: Verificación manual end-to-end**

Con el servicio corriendo en dev (`npm run server` desde `C:\apps\dashboards\ComisionesINDO`, puerto por defecto del `.env`):

```bash
# 1. Login como EVIDABLE (asume la contraseña real del usuario)
curl -s -X POST http://localhost:3011/api/auth/login -H "Content-Type: application/json" -d "{\"usuario\":\"EVIDABLE\",\"contrasena\":\"<password>\"}"
# copiar el token de la respuesta

# 2. GET /api/cajeros con ese token — debe devolver SOLO las sucursales de Eric Vidable
curl -s http://localhost:3011/api/cajeros -H "Authorization: Bearer <token>"

# 3. Intentar una escritura — debe devolver 403
curl -s -X PUT http://localhost:3011/api/cajeros/12345/sucursal -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"sucursal_id\":5}"
```

Expected: paso 2 devuelve un array recortado a las sucursales asignadas a Eric Vidable en `tbl_CoVenAppINDO_SupervisorSucursales`; paso 3 devuelve `{"error":"Usuario de solo lectura"}` con status 403. Repetir con un usuario normal (perfil ≠ 8) y confirmar que ve todo sin bloqueo (comportamiento actual intacto).

- [ ] **Step 4: Commit**

```bash
git add server/middleware/supervisorScope.js server/routes/cajeros.js
git commit -m "feat(comisiones-indo): middleware de scope/bloqueo para supervisores, aplicado a cajeros.js"
```

---

### Task 4: Wire + filtro en calculo.js

**Files:**
- Modify: `server/routes/calculo.js`

**Interfaces:**
- Consumes: `attachScope`, `blockWriteIfSupervisor` (Task 3), `filtrarPorSucursal` (Task 2).

- [ ] **Step 1: Agregar imports y wiring**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
```

Después de `router.use(authMiddleware);` (línea existente cerca del import de `authMiddleware`):

```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

- [ ] **Step 2: Filtrar `GET /cajeros`**

Reemplazar el bloque de respuesta (línea ~338-348) por:

```js
    if (!r.recordset.length) return res.status(404).json({ error: 'Sin cálculo guardado para este período' });
    const rows = filtrarPorSucursal(r.recordset, req.sucursalesPermitidas);
    res.json({
      periodo,
      fecha_calculo: r.recordset[0].fecha_calculo,
      total:         rows.length,
      comisionan:    rows.filter(c => c.comisiona).length,
      no_comisionan: rows.filter(c => !c.comisiona).length,
      total_monto:   rows.reduce((s, c) => s + (+c.monto || 0), 0),
      resultado:     rows
    });
```

- [ ] **Step 3: Filtrar `GET /encargados` y `GET /encargados-millon`**

En ambos handlers (líneas ~448-459 y ~477-487), después de `const encargados = res_obj.encargados || [];` (o `encargadosMillon`), insertar el filtro antes de usarlo en el `res.json`:

```js
    const encargados = filtrarPorSucursal(res_obj.encargados || [], req.sucursalesPermitidas);
```
```js
    const encargadosMillon = filtrarPorSucursal(res_obj.encargadosMillon || [], req.sucursalesPermitidas);
```

(El resto de cada bloque — `total`, `total_monto`, `resultado` — ya usa esas variables, así que quedan filtradas automáticamente.)

- [ ] **Step 4: Filtrar `GET /supervisores` — caso especial (solo el propio registro)**

Reemplazar (línea ~507):

```js
    const res_obj = JSON.parse(row.resultado_json);
    let supervisores = res_obj.supervisores || [];
    if (req.user.perfil === 8) {
      supervisores = req.supervisorId
        ? supervisores.filter(s => s.id === req.supervisorId)
        : [];
    }
    res.json({
      periodo,
      fecha_calculo: row.fecha_calculo,
      usuario:       row.usuario,
      total:         supervisores.length,
      total_monto:   supervisores.reduce((s, e) => s + (e.monto || 0), 0),
      resultado:     supervisores,
    });
```

(Confirmado en `server/services/calcEngine.js` → `calcularSupervisores()`: cada objeto del array retornado usa el campo `id` — `{ id: sup.id, nombre: sup.nombre, sucursales: [...], plazas: [...] }` — mismo `id` que `tbl_CoVenAppINDO_Supervisores.id`, coincide con `req.supervisorId`.)

- [ ] **Step 5: Filtrar `GET /ultimo` — objeto anidado con 5 sub-arrays**

Reemplazar el `res.json` (línea ~422-428):

```js
    const resultado = JSON.parse(row.resultado_json);
    const filtrado = {
      ...resultado,
      sucursales:      filtrarPorSucursal(resultado.sucursales || [], req.sucursalesPermitidas),
      cajeros:         filtrarPorSucursal(resultado.cajeros || [], req.sucursalesPermitidas),
      operadores:      filtrarPorSucursal(resultado.operadores || [], req.sucursalesPermitidas),
      encargados:      filtrarPorSucursal(resultado.encargados || [], req.sucursalesPermitidas),
      encargadosMillon: filtrarPorSucursal(resultado.encargadosMillon || [], req.sucursalesPermitidas),
      supervisores: req.user.perfil === 8
        ? (resultado.supervisores || []).filter(s => req.supervisorId && s.id === req.supervisorId)
        : (resultado.supervisores || []),
    };
    res.json({
      id:            row.id,
      periodo:       row.periodo,
      fecha_calculo: row.fecha_calculo,
      usuario:       row.usuario,
      resultado:     filtrado
    });
```

- [ ] **Step 6: Verificación manual**

```bash
curl -s "http://localhost:3011/api/calculo/supervisores?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s "http://localhost:3011/api/calculo/ultimo?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
```

Expected: `/supervisores` devuelve un array con un único elemento (el de Eric Vidable, con sus `sucursales`/`plazas` completas); `/ultimo` devuelve los 5 sub-arrays recortados a las sucursales de Eric Vidable, y `supervisores` con solo su propio registro. Con un usuario normal (perfil≠8), ambos devuelven todo sin cambios.

- [ ] **Step 7: Commit**

```bash
git add server/routes/calculo.js
git commit -m "feat(comisiones-indo): filtrado por sucursal en calculo.js (cajeros/encargados/ultimo/supervisores)"
```

---

### Task 5: Wire + filtro en operadores.js

**Files:**
- Modify: `server/routes/operadores.js`

**Interfaces:**
- Consumes: `attachScope`, `blockWriteIfSupervisor`, `filtrarPorSucursal`.

- [ ] **Step 1: Imports + wiring**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
```
Después de `router.use(authMiddleware);`:
```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

- [ ] **Step 2: Filtrar `GET /`**

Reemplazar (línea ~101-108):

```js
    if (!r.recordset.length)
      return res.status(404).json({ error: 'Sin cálculo guardado para este período' });

    const rows = filtrarPorSucursal(r.recordset, req.sucursalesPermitidas);
    res.json({
      periodo,
      fecha_calculo: r.recordset[0].fecha_calculo,
      total:         rows.length,
      total_monto:   rows.reduce((s, c) => s + (+c.monto || 0), 0),
      resultado:     rows
    });
```

- [ ] **Step 3: Filtrar `GET /jornadas` — cruce contra el resultado del período**

`OperadoresJornada` no tiene `sucursal_id` propio. Para un supervisor, se resuelve cruzando `usuario` contra `tbl_CoVenAppINDO_ResultadoOperadores` del mismo período (requiere `?periodo=` como query param nuevo en este endpoint — hoy no lo tiene, agregarlo):

```js
// ── GET /api/operadores/jornadas?periodo= — todas las jornadas persistentes ──
// Sin periodo (o perfil sin restricción): devuelve todas. Con perfil supervisor,
// requiere periodo para poder resolver a qué sucursal pertenece cada operador
// (jornada no tiene sucursal propia) y filtrar por sus sucursales asignadas.
router.get('/jornadas', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const r = await pool.request()
      .query('SELECT usuario, jornada, fecha_modificacion, usuario_modificacion FROM dbo.tbl_CoVenAppINDO_OperadoresJornada ORDER BY usuario');

    if (req.sucursalesPermitidas === null) return res.json(r.recordset);

    const { periodo } = req.query;
    if (!periodo) return res.json([]);

    const sucPorUsuario = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`SELECT usuario, sucursal_id FROM dbo.tbl_CoVenAppINDO_ResultadoOperadores WHERE periodo = @periodo`);
    const permitidos = new Set(
      sucPorUsuario.recordset
        .filter(x => req.sucursalesPermitidas.includes(x.sucursal_id))
        .map(x => x.usuario.toUpperCase())
    );
    res.json(r.recordset.filter(j => permitidos.has(j.usuario.toUpperCase())));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 4: Verificación manual**

```bash
curl -s "http://localhost:3011/api/operadores?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s "http://localhost:3011/api/operadores/jornadas?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s -X PATCH http://localhost:3011/api/operadores/ALGUNUSUARIO/jornada -H "Authorization: Bearer <token-EVIDABLE>" -H "Content-Type: application/json" -d "{\"jornada\":\"part\"}"
```

Expected: ambos GET recortados a sucursales de Eric Vidable; el PATCH devuelve 403.

- [ ] **Step 5: Commit**

```bash
git add server/routes/operadores.js
git commit -m "feat(comisiones-indo): filtrado por sucursal en operadores.js (incluye cruce de jornadas)"
```

---

### Task 6: Wire + filtro en ranking.js

**Files:**
- Modify: `server/routes/ranking.js`

- [ ] **Step 1: Imports + wiring**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
```
Después de `router.use(authMiddleware);`:
```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

- [ ] **Step 2: Filtrar `GET /`**

Reemplazar (línea ~55):

```js
    res.json(filtrarPorSucursal(r.recordset, req.sucursalesPermitidas));
```

(`GET /multiplicadores` no se toca — config global sin sucursal, según el spec §3.3. `POST /`, `POST /calcular`, `PUT /multiplicadores/:categoria` quedan bloqueados automáticamente por `blockWriteIfSupervisor`.)

- [ ] **Step 3: Verificación manual**

```bash
curl -s "http://localhost:3011/api/ranking?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s -X POST http://localhost:3011/api/ranking/calcular -H "Authorization: Bearer <token-EVIDABLE>" -H "Content-Type: application/json" -d "{\"periodo\":\"2026-06\"}"
```

Expected: GET recortado a sus sucursales; POST devuelve 403.

- [ ] **Step 4: Commit**

```bash
git add server/routes/ranking.js
git commit -m "feat(comisiones-indo): filtrado por sucursal en ranking.js"
```

---

### Task 7: Wire + filtro en sucursales.js

**Files:**
- Modify: `server/routes/sucursales.js`

- [ ] **Step 1: Imports + wiring**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
```
Después de `router.use(authMiddleware);`:
```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

- [ ] **Step 2: Filtrar `GET /` — campo `id`, no `sucursal_id`**

Reemplazar (línea ~55):

```js
    res.json(filtrarPorSucursal(r.recordset, req.sucursalesPermitidas, 'id'));
```

(`PATCH /:id/activa` y `PATCH /:id/efectivo` quedan bloqueados por `blockWriteIfSupervisor`.)

- [ ] **Step 3: Verificación manual**

```bash
curl -s "http://localhost:3011/api/sucursales?periodo=2026-06&todas=1" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s -X PATCH http://localhost:3011/api/sucursales/1/activa -H "Authorization: Bearer <token-EVIDABLE>" -H "Content-Type: application/json" -d "{\"activa\":false}"
```

Expected: GET recortado; PATCH devuelve 403.

- [ ] **Step 4: Commit**

```bash
git add server/routes/sucursales.js
git commit -m "feat(comisiones-indo): filtrado por sucursal en sucursales.js"
```

---

### Task 8: Wire + filtro en datos.js

**Files:**
- Modify: `server/routes/datos.js`

- [ ] **Step 1: Imports + wiring**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
```
Después de `router.use(authMiddleware);`:
```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

- [ ] **Step 2: Filtrar `GET /consumo` y `GET /efectivo`**

En ambos handlers, reemplazar la línea `res.json(rows.filter(r => !inactivas.has(r.sucursal_id)));` por:

```js
    res.json(filtrarPorSucursal(rows.filter(r => !inactivas.has(r.sucursal_id)), req.sucursalesPermitidas));
```

- [ ] **Step 3: Filtrar `GET /reporte` — campo `id_sucursal`**

Reemplazar la línea final `res.json(rows);` (dentro de `GET /reporte`) por:

```js
    res.json(filtrarPorSucursal(rows, req.sucursalesPermitidas, 'id_sucursal'));
```

(Todos los POST/PUT/DELETE de este archivo quedan bloqueados por `blockWriteIfSupervisor`.)

- [ ] **Step 4: Verificación manual**

```bash
curl -s "http://localhost:3011/api/datos/consumo?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s "http://localhost:3011/api/datos/reporte?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s -X DELETE "http://localhost:3011/api/datos/reporte/periodo/2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
```

Expected: ambos GET recortados; el DELETE (destructivo, borra todo el período) devuelve 403.

- [ ] **Step 5: Commit**

```bash
git add server/routes/datos.js
git commit -m "feat(comisiones-indo): filtrado por sucursal en datos.js"
```

---

### Task 9: Wire + filtro en objetivos.js

**Files:**
- Modify: `server/routes/objetivos.js`

- [ ] **Step 1: Imports + wiring**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
```
Después de `router.use(authMiddleware);`:
```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

(Este archivo no tiene POST/PUT/DELETE propios — `blockWriteIfSupervisor` no bloquea nada nuevo aquí, se agrega solo por consistencia con el resto de los routers.)

- [ ] **Step 2: Filtrar `GET /consumo` y `GET /efectivo`**

En ambos handlers, reemplazar `res.json(rows.filter(r => !inactivas.has(r.sucursal_id)));` por:

```js
    res.json(filtrarPorSucursal(rows.filter(r => !inactivas.has(r.sucursal_id)), req.sucursalesPermitidas));
```

- [ ] **Step 3: Verificación manual**

```bash
curl -s "http://localhost:3011/api/objetivos/consumo?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
```

Expected: recortado a sus sucursales.

- [ ] **Step 4: Commit**

```bash
git add server/routes/objetivos.js
git commit -m "feat(comisiones-indo): filtrado por sucursal en objetivos.js"
```

---

### Task 10: Wire + filtro en millon.js

**Files:**
- Modify: `server/routes/millon.js`

- [ ] **Step 1: Imports + wiring**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
```
Después de `router.use(authMiddleware);`:
```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

- [ ] **Step 2: Filtrar `GET /sucursales` (`sucursal_id` en el objeto padre)**

Reemplazar `res.json(await buildResponse(pool, periodo));` (ambas apariciones, en `GET /sucursales` y `POST /cache/refresh` — la segunda queda bloqueada por `blockWriteIfSupervisor` antes de llegar a esta línea, así que solo importa la de `GET /sucursales`):

```js
router.get('/sucursales', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const check = await pool.request()
      .input('periodo', sql.VarChar(7), periodo)
      .query(`SELECT TOP 1 1 FROM dbo.tbl_CoVenAppINDO_MillonCache WHERE periodo = @periodo`);
    if (!check.recordset.length) {
      const rows = await fetchResumenFromBC(periodo);
      await saveCache(pool, periodo, rows);
    }
    const resp = await buildResponse(pool, periodo);
    resp.sucursales = filtrarPorSucursal(resp.sucursales, req.sucursalesPermitidas);
    res.json(resp);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 3: Filtrar `GET /operadores/resultado`**

Reemplazar (dentro del handler, tras `const rows = r.recordset;`):

```js
    const rows = filtrarPorSucursal(r.recordset, req.sucursalesPermitidas);
    res.json({
      periodo,
      fecha_calculo: rows[0]?.fecha_calculo,
      total:         rows.length,
      comisionan:    rows.filter(r => r.comisiona).length,
      total_monto:   rows.reduce((s, r) => s + (+r.monto || 0), 0),
      resultado:     rows,
    });
```

(Si `rows.length === 0` tras el filtro pero `r.recordset.length > 0` antes, el 404 de "sin cálculo" ya se evaluó antes con `r.recordset.length` — dejar esa condición como está, solo se ajusta el bloque de respuesta.)

- [ ] **Step 4: Filtrar `GET /` (legacy) y `GET /resumen`**

En ambos, reemplazar `res.json(rows);` por:

```js
    res.json(filtrarPorSucursal(rows, req.sucursalesPermitidas));
```

- [ ] **Step 5: Filtrar `PATCH /operadores` — no aplica (queda bloqueado por `blockWriteIfSupervisor`)**

Sin cambios en ese handler.

- [ ] **Step 6: Verificación manual**

```bash
curl -s "http://localhost:3011/api/millon/sucursales?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s "http://localhost:3011/api/millon/operadores/resultado?periodo=2026-06" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s -X PATCH http://localhost:3011/api/millon/operadores -H "Authorization: Bearer <token-EVIDABLE>" -H "Content-Type: application/json" -d "{\"sucursal_id\":105,\"operador\":\"X\",\"es_operador\":false,\"periodo\":\"2026-06\"}"
```

Expected: los dos GET recortados; el PATCH devuelve 403.

- [ ] **Step 7: Commit**

```bash
git add server/routes/millon.js
git commit -m "feat(comisiones-indo): filtrado por sucursal en millon.js"
```

---

### Task 11: Wire (solo bloqueo) en montos.js

**Files:**
- Modify: `server/routes/montos.js`

**Interfaces:**
- Consumes: `attachScope`, `blockWriteIfSupervisor`.

- [ ] **Step 1: Imports + wiring — sin filtro (config global sin granularidad de sucursal, spec §3.3)**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
```
Después de `router.use(authMiddleware);`:
```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

(`GET /:tipo` no se toca. `PUT /vendedor-pivot/:escalon` y `PUT /:tipo/:id` quedan bloqueados automáticamente.)

- [ ] **Step 2: Verificación manual**

```bash
curl -s "http://localhost:3011/api/montos/supervisor" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s -X PUT "http://localhost:3011/api/montos/supervisor/1" -H "Authorization: Bearer <token-EVIDABLE>" -H "Content-Type: application/json" -d "{\"monto\":9999}"
```

Expected: GET devuelve la tabla completa (sin filtrar, es config global); PUT devuelve 403.

- [ ] **Step 3: Commit**

```bash
git add server/routes/montos.js
git commit -m "feat(comisiones-indo): bloqueo de escritura para supervisores en montos.js"
```

---

### Task 12: supervisores.js — caso especial (solo el propio registro) + campo usuario_login en el ABM

**Files:**
- Modify: `server/routes/supervisores.js`

**Interfaces:**
- Consumes: `attachScope`, `blockWriteIfSupervisor`.

- [ ] **Step 1: Imports + wiring**

```js
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
```
Después de `router.use(authMiddleware);`:
```js
router.use(attachScope);
router.use(blockWriteIfSupervisor);
```

- [ ] **Step 2: `GET /` — devolver solo el propio registro para perfil 8**

Reemplazar el handler completo:

```js
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const sups = await pool.request().query(
      'SELECT id, nombre, activo, usuario_login FROM dbo.tbl_CoVenAppINDO_Supervisores ORDER BY nombre'
    );
    const asigs = await pool.request().query(
      'SELECT supervisor_id, sucursal_id FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales'
    );
    const asigMap = {};
    for (const a of asigs.recordset) {
      if (!asigMap[a.supervisor_id]) asigMap[a.supervisor_id] = [];
      asigMap[a.supervisor_id].push(a.sucursal_id);
    }
    let lista = sups.recordset.map(s => ({ ...s, sucursales: asigMap[s.id] || [] }));
    if (req.user.perfil === 8) {
      lista = req.supervisorId ? lista.filter(s => s.id === req.supervisorId) : [];
    }
    res.json(lista);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});
```

- [ ] **Step 3: Agregar `usuario_login` a POST y PUT (para el ABM, uso admin)**

En `POST /`:

```js
router.post('/', async (req, res) => {
  const { nombre, usuario_login } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('nombre', sql.VarChar, nombre.trim())
      .input('usuario_login', sql.VarChar, usuario_login?.trim() || null)
      .query('INSERT INTO dbo.tbl_CoVenAppINDO_Supervisores (nombre, activo, usuario_login) OUTPUT INSERTED.id VALUES (@nombre, 1, @usuario_login)');
    res.json({ id: r.recordset[0].id, nombre: nombre.trim(), activo: true, usuario_login: usuario_login?.trim() || null, sucursales: [] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});
```

En `PUT /:id`:

```js
router.put('/:id', async (req, res) => {
  const { nombre, activo, usuario_login } = req.body;
  const id = parseInt(req.params.id);
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .input('nombre', sql.VarChar, nombre.trim())
      .input('activo', sql.Bit, activo ?? 1)
      .input('usuario_login', sql.VarChar, usuario_login?.trim() || null)
      .query('UPDATE dbo.tbl_CoVenAppINDO_Supervisores SET nombre=@nombre, activo=@activo, usuario_login=@usuario_login WHERE id=@id');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});
```

(`PUT /:id/sucursales` y `DELETE /:id` quedan sin cambios; `blockWriteIfSupervisor` ya bloquea todo POST/PUT/DELETE para perfil 8.)

- [ ] **Step 4: Verificación manual**

```bash
curl -s "http://localhost:3011/api/supervisores" -H "Authorization: Bearer <token-EVIDABLE>"
curl -s "http://localhost:3011/api/supervisores" -H "Authorization: Bearer <token-admin>"
```

Expected: con token EVIDABLE, un único elemento (Eric Vidable) con `usuario_login: "EVIDABLE"`; con un token admin, la lista completa con la columna `usuario_login` en cada fila.

- [ ] **Step 5: Commit**

```bash
git add server/routes/supervisores.js
git commit -m "feat(comisiones-indo): supervisores.js devuelve solo el propio registro a perfil supervisor; usuario_login en el ABM"
```

---

### Task 13: Frontend — helper isSupervisorReadonly()

**Files:**
- Modify: `src/api/client.js`

**Interfaces:**
- Produces: `isSupervisorReadonly(): boolean` — usado por las Tasks 14 y 15.

- [ ] **Step 1: Agregar el helper**

```js
// src/api/client.js — agregar al final del archivo existente
export function isSupervisorReadonly() {
  try {
    const user = JSON.parse(localStorage.getItem('user'));
    return user?.perfil === 8;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Verificación manual**

En la consola del navegador (F12) tras loguearse como EVIDABLE, en `http://localhost:3011`:

```js
JSON.parse(localStorage.getItem('user')).perfil // debe imprimir 8
```

- [ ] **Step 3: Commit**

```bash
git add src/api/client.js
git commit -m "feat(comisiones-indo): helper isSupervisorReadonly() en el cliente API"
```

---

### Task 14: Frontend — ocultar edición en visor-montos.js, ranking.js, sucursales.js

**Files:**
- Modify: `src/pages/visor-montos.js`
- Modify: `src/pages/ranking.js`
- Modify: `src/pages/sucursales.js`

**Interfaces:**
- Consumes: `isSupervisorReadonly()` (Task 13).

- [ ] **Step 1: visor-montos.js — gatear los dos helpers compartidos por las 6 pestañas**

```js
// src/pages/visor-montos.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

Reemplazar `inputNum`:

```js
function inputNum(val, cls, extra = '') {
  const display = (val != null && val !== '' && !isNaN(val))
    ? Number(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : '0';
  if (isSupervisorReadonly()) {
    return `<span style="display:inline-block;width:90px;text-align:center;font-size:12px">${display}</span>`;
  }
  return `<input type="text" inputmode="numeric" class="${cls} inp-miles" value="${display}" ${extra}
    style="width:90px;padding:3px 6px;border:1px solid var(--color-border);border-radius:4px;
           background:var(--color-input);color:var(--color-text);font-size:12px;text-align:center">`;
}
```

Reemplazar `saveBtn`:

```js
function saveBtn(dataAttrs = '') {
  if (isSupervisorReadonly()) return '';
  return `<button class="btn-save btn" ${dataAttrs}
    style="font-size:12px;padding:3px 10px">💾</button>`;
}
```

- [ ] **Step 2: ranking.js — ocultar "Calcular Ranking Automático", el lápiz de override por fila, y "Guardar" de multiplicadores**

```js
// src/pages/ranking.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

En `renderRanking`, el botón `#btn-calcular`:

```js
        <button id="btn-calcular" class="btn btn-primary" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>⟳ Calcular Ranking Automático</button>
```

En `renderGrupoTabla`, la celda del lápiz de override:

```js
        <td>
          ${isSupervisorReadonly() ? '' : `
          <button class="btn-override" data-suc="${r.sucursal_id}" data-cat="${r.categoria}"
            style="background:none;border:none;cursor:pointer;color:var(--color-muted);font-size:11px;
                   padding:2px 6px;border-radius:4px;border:1px solid var(--color-border)"
            title="Cambiar manualmente">✏</button>`}
        </td>
```

En `loadMultiplicadores`, el botón de guardar:

```js
            <button class="btn btn-sm btn-primary btn-save-mult" data-cat="${m.categoria}" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>Guardar</button>
```

(Los inputs numéricos de multiplicador quedan visibles pero sin efecto porque el backend ya bloquea el `PUT`; ocultar solo el botón alcanza para la UX pedida — no ABM.)

- [ ] **Step 3: sucursales.js — reemplazar los toggles clickeables por badges planos**

```js
// src/pages/sucursales.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

En `renderTabla`, dentro del `rows = data.map(...)`:

```js
    const readonly = isSupervisorReadonly();
    const rows = data.map(s => `
      <tr style="${s.activa ? '' : 'opacity:.45'}">
        <td style="font-weight:600">${s.id}</td>
        <td>${s.nombre ?? '—'}</td>
        <td>${s.provincia ?? '—'}</td>
        <td style="text-align:center">${catBadge(s.categoria)}</td>
        <td style="text-align:center">
          ${readonly ? efectivoBadge(s.con_efectivo) : `
          <button class="btn-efect" data-id="${s.id}" data-val="${s.con_efectivo ? 1 : 0}"
            style="border:none;background:none;cursor:pointer;padding:0">
            ${efectivoBadge(s.con_efectivo)}
          </button>`}
        </td>
        <td style="text-align:center">
          ${readonly ? activaBadge(s.activa) : `
          <button class="btn-activa" data-id="${s.id}" data-val="${s.activa ? 1 : 0}"
            style="border:none;background:none;cursor:pointer;padding:0"
            title="${s.activa ? 'Clic para deshabilitar: desaparece de todas las páginas y del cálculo' : 'Clic para volver a habilitarla'}">
            ${activaBadge(s.activa)}
          </button>`}
        </td>
      </tr>
    `).join('');
```

(Los `tbl.querySelectorAll('.btn-efect'/'.btn-activa').forEach(...)` que agregan los listeners quedan igual — con `readonly`, esos selectores no matchean nada, no hace falta envolverlos en un `if`.)

- [ ] **Step 4: Build y verificación manual**

```bash
npm run build
```

Loguearse como EVIDABLE en `http://localhost:3011` (o el dev server) y confirmar visualmente: en "Sucursales" los badges de Efectivo/Estado ya no son clickeables; en "Ranking" no aparece el botón "Calcular Ranking Automático" ni el lápiz de override, y en "Multiplicadores" no aparece "Guardar"; en "Montos" (si esa pestaña llega a ser visible) las celdas de categoría C se ven como texto plano sin el botón 💾.

- [ ] **Step 5: Commit**

```bash
git add src/pages/visor-montos.js src/pages/ranking.js src/pages/sucursales.js
git commit -m "feat(comisiones-indo): ocultar edicion para supervisores en visor-montos/ranking/sucursales"
```

---

### Task 15: Frontend — ocultar edición en supervisores.js (ABM), total.js, cajeros.js, operadores-millon.js, millon.js

**Files:**
- Modify: `src/pages/supervisores.js`
- Modify: `src/pages/total.js`
- Modify: `src/pages/cajeros.js`
- Modify: `src/pages/operadores-millon.js`
- Modify: `src/pages/millon.js`

**Interfaces:**
- Consumes: `isSupervisorReadonly()` (Task 13).

- [ ] **Step 1: supervisores.js — ocultar "+ Nuevo supervisor", "Editar", "Eliminar"**

```js
// src/pages/supervisores.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

En el template inicial de `renderSupervisores`:

```js
      <button class="btn btn-primary" id="btn-nuevo-sup" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>+ Nuevo supervisor</button>
```

En `renderTable`, la celda de acciones:

```js
              <td>
                ${isSupervisorReadonly() ? '' : `
                <button class="btn btn-sm btn-secondary btn-edit-sup" data-id="${s.id}">Editar</button>
                <button class="btn btn-sm btn-danger btn-del-sup" data-id="${s.id}">Eliminar</button>`}
              </td>
```

- [ ] **Step 2: total.js — ocultar "▶ Ejecutar cálculo"**

```js
// src/pages/total.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

En el template inicial:

```js
      <button class="btn btn-primary" id="btn-calc" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>▶ Ejecutar cálculo</button>
```

(`#btn-reload` y `#btn-export` quedan visibles, son de solo lectura.)

- [ ] **Step 3: cajeros.js — reemplazar el `<select class="sel-jornada">` por texto plano**

```js
// src/pages/cajeros.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

Localizar el bloque que arma el `<select class="sel-jornada" ...>` (alrededor de la línea 158-163) y envolverlo:

```js
                ${isSupervisorReadonly()
                  ? `<span class="badge ${jornada === 'part' ? 'badge-c' : 'badge-a'}">${jornada === 'part' ? 'Part-time' : 'Full-time'}</span>`
                  : `<select class="sel-jornada" data-nro="${c.nro_vendedor}" ...>
                       <option value="full" ${jornada === 'full' ? 'selected' : ''}>Full-time</option>
                       <option value="part" ${jornada === 'part' ? 'selected' : ''}>Part-time</option>
                     </select>`}
```

(Conservar los atributos/estilos exactos del `<select>` original — solo se agrega la rama `readonly` con un badge equivalente. El botón `#btn-calcular` de esta página también debe ocultarse igual que en Task 15 Step 2: `<button class="btn btn-primary" id="btn-calcular" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>▶ Calcular comisiones</button>`.)

- [ ] **Step 4: operadores-millon.js — ocultar "⟳ Calcular" y el `<select class="sel-jornada-opm">`**

```js
// src/pages/operadores-millon.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

```js
          <button id="btn-calcular" class="btn btn-primary" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>⟳ Calcular</button>
```

En el bloque que arma `<select class="sel-jornada-opm" ...>` (línea ~159-164), aplicar el mismo patrón que en cajeros.js: si `isSupervisorReadonly()`, renderizar `<span class="badge ...">${esPart ? 'Part' : 'Full'}</span>` en vez del `<select>`.

- [ ] **Step 5: operadores.js (retail) — ocultar "⟳ Calcular"**

```js
// src/pages/operadores.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

```js
          <button id="btn-calcular" class="btn btn-primary" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>⟳ Calcular</button>
```

- [ ] **Step 6: millon.js — ocultar "↻ Actualizar" y el checkbox `.op-toggle`**

```js
// src/pages/millon.js
import { api, isSupervisorReadonly } from '../api/client.js';
```

```js
        <button class="btn btn-secondary" id="btn-refresh" title="Actualizar datos desde BeClever" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>↻ Actualizar</button>
```

En el bloque que arma `<input type="checkbox" class="op-toggle" ...>` (línea ~59), envolverlo: si `isSupervisorReadonly()`, renderizar un ícono estático (✓/✗) en vez del checkbox editable.

- [ ] **Step 7: Build y verificación manual completa**

```bash
npm run build
Restart-Service dashcomisionesindo.exe
```

Loguearse como EVIDABLE y luego como JROSSINI, recorrer TODO el sidebar (Dashboard, DATOS: Sucursales/Millón/Montos/Ranking/Objetivos/Ventas/Supervisores, Cálculos: Cajeros/Operadores Retail/Operadores Millón/Encargados/Encargados Millón/Total/Resultado Supervisores) y confirmar:
1. Cada página muestra solo las sucursales asignadas a ese supervisor.
2. Ningún botón de escritura/cálculo/ABM es visible.
3. Loguearse con un usuario normal (perfil ≠ 8) y confirmar que no cambió nada (ve todo, puede editar).

- [ ] **Step 8: Commit**

```bash
git add src/pages/supervisores.js src/pages/total.js src/pages/cajeros.js src/pages/operadores-millon.js src/pages/operadores.js src/pages/millon.js
git commit -m "feat(comisiones-indo): ocultar controles de escritura/calculo para supervisores en el resto de las paginas"
```

---

### Task 16: Deploy y checklist final de verificación

**Files:** ninguno (solo build + restart + verificación)

- [ ] **Step 1: Build de producción**

```bash
cd C:\apps\dashboards\ComisionesINDO
npm run build
```

- [ ] **Step 2: Reiniciar el servicio**

```powershell
Restart-Service dashcomisionesindo.exe
Get-Service dashcomisionesindo.exe
```

Expected: `Status: Running`.

- [ ] **Step 3: Smoke test HTTP local**

```bash
curl -s http://localhost:3011/api/health
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Checklist funcional (vía portal, `http://10.0.0.118/d/8/`, o `http://localhost:3011` para diagnóstico)**

- [ ] Login EVIDABLE → ve solo sucursales de Eric Vidable en todas las páginas del sidebar.
- [ ] Login JROSSINI → ve solo sucursales de Josefina Rossini en todas las páginas del sidebar.
- [ ] Ningún botón de escritura/ABM/recálculo visible para ninguno de los dos.
- [ ] Intento de escritura directo por API con token de perfil 8 → 403 en al menos 3 endpoints distintos (ej. `POST /calculo/ejecutar`, `PUT /sucursales/:id/activa`, `POST /ranking/calcular`).
- [ ] Login con un usuario de perfil normal (no 8) → sin cambios respecto al comportamiento actual (ve todo, puede editar).
- [ ] `SELECT id, nombre, usuario_login FROM dbo.tbl_CoVenAppINDO_Supervisores` confirma el vínculo cargado.

- [ ] **Step 5: Actualizar `RETOMAR.md` con el resultado de esta sesión**

Agregar una entrada nueva en `C:\apps\dashboards\ComisionesINDO\RETOMAR.md` (sesión de hoy) resumiendo: acceso restringido implementado para EVIDABLE/JROSSINI, spec en `docs/superpowers/specs/2026-07-27-acceso-supervisores-design.md`, plan en `docs/superpowers/plans/2026-07-27-acceso-supervisores.md`, y el resultado del checklist de verificación (qué quedó validado y qué pendiente, si algo).

- [ ] **Step 6: Commit final**

```bash
git add RETOMAR.md
git commit -m "docs(comisiones-indo): acceso restringido para supervisores implementado y verificado"
```
