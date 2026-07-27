# Historización de Montos por período — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando se calcula un período por primera vez (desde cualquiera de los 4 botones que disparan cálculo), se congela una foto de los 6 valores de montos vigentes en ese momento; recalcular ese mismo período siempre usa esa foto, nunca los valores actuales del ABM.

**Architecture:** Tabla nueva `tbl_CoVenAppINDO_MontosHistorial` (un JSON por período, mismo patrón que `CalculoHistorial`). Función compartida `cargarMontosDelPeriodo(pool, periodo)` en `server/services/montosHistorial.js` que devuelve la foto (creándola la primera vez), consumida por los 4 puntos del backend que hoy leen montos directo de las tablas vivas. Backfill self-healing al arrancar el servidor para períodos ya calculados sin foto.

**Tech Stack:** Node.js v24 ES Modules, Express 4, `mssql`, SQL Server 2012.

## Global Constraints

- No modificar la lógica de ningún motor de cálculo (`server/services/calcEngine.js`) — solo cambia de dónde vienen los datos de montos en `ctx`.
- No agregar UI nueva (sin avisos, sin indicadores) — decisión explícita del usuario.
- No tocar el ABM de Montos (`server/routes/montos.js`, `src/pages/visor-montos.js`) — sigue editando/leyendo el valor "actual" (vivo) como hoy.
- No permitir forzar un re-snapshot desde la UI — si hace falta corregir una foto ya tomada, es una operación manual sobre la tabla (fuera de este plan).
- Nombres de campo del objeto de montos: EXACTOS a como ya los usa `ctx` en el motor, incluido el typo histórico `montosPrestamaos` (no "montosPrestamos") — cambiar ese nombre rompería `calcEngine.js`.
- Cambios en `server/` no requieren build; reiniciar el servicio alcanza.
- No editar archivos fuente con PowerShell `-replace`/`Set-Content` (corrompe UTF-8/acentos) — usar el editor (Edit/Write) o Node.

---

### Task 1: Servicio de historización — tabla + carga con foto congelada

**Files:**
- Create: `server/services/montosHistorial.js`

**Interfaces:**
- Consumes: `sql` de `mssql` (mismo patrón que el resto del proyecto, `import { sql } from '../config/db.js'` — no crea su propio pool, recibe `pool` como parámetro en cada función, igual que `supervisorLookup.js` y `ranking.js::calcularYGuardarRanking`).
- Produces: `ensureMontosHistorialTable(pool)`, `cargarMontosDelPeriodo(pool, periodo)` → `Promise<{ montos, montosVendedor, montosSupervisor, montosPrestamaos, montosCajero, multiplicadores }>` (cada clave es un array de filas). Estas dos funciones las usan las Tasks 2-6.

- [ ] **Step 1: Crear el archivo**

```js
// server/services/montosHistorial.js
import { sql } from '../config/db.js';

// Migración self-healing (mismo patrón que ranking.js/sucursales.js): crea la
// tabla de fotos de montos por período si no existe.
export async function ensureMontosHistorialTable(pool) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.objects
      WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_MontosHistorial') AND type = 'U'
    )
    CREATE TABLE dbo.tbl_CoVenAppINDO_MontosHistorial (
      periodo         VARCHAR(7) PRIMARY KEY,
      montos_json     NVARCHAR(MAX),
      fecha_snapshot  DATETIME DEFAULT GETDATE()
    )
  `);
}

// Lee las 6 fuentes de montos "vivas" (valor actual del ABM) tal cual las
// carga hoy calculo.js::cargarContexto — sin filtro de período, son tablas
// de configuración global por categoría/escalón.
async function leerMontosVivos(pool) {
  const [montosR, montosVendR, montoSupR, montosPresR, montosCajR, multR] = await Promise.all([
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Montos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosVendedor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosSupervisor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosPrestamos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosCajero'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
  ]);
  return {
    montos:            montosR.recordset,
    montosVendedor:    montosVendR.recordset,
    montosSupervisor:  montoSupR.recordset,
    montosPrestamaos:  montosPresR.recordset,
    montosCajero:      montosCajR.recordset,
    multiplicadores:   multR.recordset,
  };
}

// Devuelve la foto congelada de montos de un período: si ya existe, la lee
// y la devuelve tal cual (sin importar qué se haya editado después en el
// ABM); si es la primera vez que se calcula ese período, la crea a partir
// de los valores vivos actuales y la persiste.
export async function cargarMontosDelPeriodo(pool, periodo) {
  await ensureMontosHistorialTable(pool);

  const existente = await pool.request()
    .input('periodo', sql.VarChar, periodo)
    .query('SELECT montos_json FROM dbo.tbl_CoVenAppINDO_MontosHistorial WHERE periodo = @periodo');

  if (existente.recordset.length) {
    return JSON.parse(existente.recordset[0].montos_json);
  }

  const snapshot = await leerMontosVivos(pool);
  await pool.request()
    .input('periodo', sql.VarChar, periodo)
    .input('json', sql.NVarChar(sql.MAX), JSON.stringify(snapshot))
    .query(`
      INSERT INTO dbo.tbl_CoVenAppINDO_MontosHistorial (periodo, montos_json)
      VALUES (@periodo, @json)
    `);
  return snapshot;
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check server/services/montosHistorial.js`
Expected: sin salida (sin errores).

- [ ] **Step 3: Commit**

```bash
git add server/services/montosHistorial.js
git commit -m "feat(comisiones-indo): servicio de historizacion de montos por periodo (foto congelada)"
```

---

### Task 2: Backfill de períodos ya calculados + wiring en el arranque del servidor

**Files:**
- Modify: `server/services/montosHistorial.js`
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `cargarMontosDelPeriodo(pool, periodo)` (Task 1) — reutilizada tal cual, no duplica lógica de creación de foto.
- Produces: `backfillMontosHistorial(pool)` exportada.

- [ ] **Step 1: Agregar la función de backfill al final de `server/services/montosHistorial.js`**

```js
// Para cada período que ya tiene algo calculado (en cualquiera de las 4
// tablas de resultado) y todavía no tiene foto en MontosHistorial, crea una
// con los montos vivos de HOY (mejor dato disponible — no es retroactivamente
// exacto, pero evita que a futuro un reproceso tome valores que ni existían
// cuando ese período se calculó originalmente). Corre en cada arranque del
// servidor; es barato e idempotente (cargarMontosDelPeriodo no hace nada si
// la foto ya existe).
export async function backfillMontosHistorial(pool) {
  await ensureMontosHistorialTable(pool);

  const r = await pool.request().query(`
    SELECT periodo FROM dbo.tbl_CoVenAppINDO_CalculoHistorial
    UNION
    SELECT periodo FROM dbo.tbl_CoVenAppINDO_ResultadoCajeros
    UNION
    SELECT periodo FROM dbo.tbl_CoVenAppINDO_ResultadoOperadores
    UNION
    SELECT periodo FROM dbo.tbl_CoVenAppINDO_ResultadoOpMillon
  `);

  const periodos = [...new Set(r.recordset.map(x => x.periodo))];
  for (const periodo of periodos) {
    await cargarMontosDelPeriodo(pool, periodo);
  }
  return periodos.length;
}
```

- [ ] **Step 2: Wirear en `server/index.js`**

Leé el archivo actual primero (importa routers y arranca `app.listen`). Agregá, cerca de los demás imports:

```js
import { getPool } from './config/db.js';
import { backfillMontosHistorial } from './services/montosHistorial.js';
```

Y después del bloque de `app.listen(...)` (o antes, no bloqueante — no debe demorar el arranque del servidor):

```js
getPool()
  .then(pool => backfillMontosHistorial(pool))
  .then(n => { if (n) console.log(`[MontosHistorial] backfill: ${n} período(s) revisado(s)`); })
  .catch(err => console.error('[MontosHistorial backfill]', err));
```

No debe usar `await` a nivel de módulo de forma que bloquee `app.listen` — es un fire-and-forget que corre en paralelo al arranque.

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check server/services/montosHistorial.js && node --check server/index.js`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add server/services/montosHistorial.js server/index.js
git commit -m "feat(comisiones-indo): backfill de MontosHistorial para periodos ya calculados, al arrancar el servidor"
```

---

### Task 3: Integrar en `calculo.js` → `cargarContexto()` (motor completo)

**Files:**
- Modify: `server/routes/calculo.js`

**Interfaces:**
- Consumes: `cargarMontosDelPeriodo(pool, periodo)` (Task 1).

- [ ] **Step 1: Import**

```js
import { cargarMontosDelPeriodo } from '../services/montosHistorial.js';
```

- [ ] **Step 2: Reemplazar las 5 queries de Montos + la de RankingMultiplicador dentro de `cargarContexto()`**

El array desestructurado pasa de:
```js
const [
    sucursalesR, rankingR, multR,
    objConsumoR, objEfectivoR,
    montosR, montosVendR, montoSupR, montosPresR, montosCajR,
    encargadosR, vendedoresR, cakerosR,
    supervisoresR, supSucursalesR,
    qlikUsuariosR, jornadasR
  ] = await Promise.all([
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@periodo'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Montos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosVendedor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosSupervisor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosPrestamos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosCajero'),
    pool.request().query('SELECT idEncargado, apellido_nombre, codSucursal FROM dbo.tbl_CoVenApp_encargados'),
    pool.request().query("SELECT NRO_VENDEDOR, LTRIM(RTRIM(ISNULL(APELLIDO,'')+' '+ISNULL(NOMBRE,''))) as nombre, TIPO, GCL_TEMPSPARTIEL as gclTemps FROM dbo.tbl_CoVenApp_Vendedores WHERE COMISIONA=1"),
    pool.request()
      .query(`
        SELECT v.NRO_VENDEDOR,
               LTRIM(RTRIM(ISNULL(v.APELLIDO,'')+' '+ISNULL(v.NOMBRE,''))) AS nombre,
               v.GCL_TEMPSPARTIEL AS gclTemps,
               CAST(dd.Sucursal AS INT) AS sucursal_id
        FROM dbo.tbl_CoVenApp_Vendedores v
        INNER JOIN dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
          ON dd.VEND = v.NRO_VENDEDOR
        WHERE v.TIPO = 'CAJERO'
          AND ISNULL(dd.Sucursal,'') <> ''
          AND dd.Sucursal <> '0'
          AND ISNUMERIC(dd.Sucursal) = 1
        ORDER BY dd.Sucursal, v.APELLIDO, v.NOMBRE
      `),
    pool.request().query('SELECT id, nombre, activo FROM dbo.tbl_CoVenAppINDO_Supervisores'),
    pool.request().query('SELECT supervisor_id, sucursal_id FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales'),
    pool.request().query("SELECT UPPER(LTRIM(RTRIM(Usuario))) AS id_usuario, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.tbl_QlikData_Usuarios"),
    pool.request().query("SELECT usuario, jornada FROM dbo.tbl_CoVenAppINDO_OperadoresJornada"),
  ]);
```

a (quitando las 6 queries de montos/multiplicador y agregando `cargarMontosDelPeriodo(pool, periodo)` en su lugar — el resto de las queries, en el mismo orden relativo entre sí, no cambia):

```js
const [
    sucursalesR, rankingR,
    objConsumoR, objEfectivoR,
    montosDelPeriodo,
    encargadosR, vendedoresR, cakerosR,
    supervisoresR, supSucursalesR,
    qlikUsuariosR, jornadasR
  ] = await Promise.all([
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@periodo'),
    cargarMontosDelPeriodo(pool, periodo),
    pool.request().query('SELECT idEncargado, apellido_nombre, codSucursal FROM dbo.tbl_CoVenApp_encargados'),
    pool.request().query("SELECT NRO_VENDEDOR, LTRIM(RTRIM(ISNULL(APELLIDO,'')+' '+ISNULL(NOMBRE,''))) as nombre, TIPO, GCL_TEMPSPARTIEL as gclTemps FROM dbo.tbl_CoVenApp_Vendedores WHERE COMISIONA=1"),
    pool.request()
      .query(`
        SELECT v.NRO_VENDEDOR,
               LTRIM(RTRIM(ISNULL(v.APELLIDO,'')+' '+ISNULL(v.NOMBRE,''))) AS nombre,
               v.GCL_TEMPSPARTIEL AS gclTemps,
               CAST(dd.Sucursal AS INT) AS sucursal_id
        FROM dbo.tbl_CoVenApp_Vendedores v
        INNER JOIN dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
          ON dd.VEND = v.NRO_VENDEDOR
        WHERE v.TIPO = 'CAJERO'
          AND ISNULL(dd.Sucursal,'') <> ''
          AND dd.Sucursal <> '0'
          AND ISNUMERIC(dd.Sucursal) = 1
        ORDER BY dd.Sucursal, v.APELLIDO, v.NOMBRE
      `),
    pool.request().query('SELECT id, nombre, activo FROM dbo.tbl_CoVenAppINDO_Supervisores'),
    pool.request().query('SELECT supervisor_id, sucursal_id FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales'),
    pool.request().query("SELECT UPPER(LTRIM(RTRIM(Usuario))) AS id_usuario, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.tbl_QlikData_Usuarios"),
    pool.request().query("SELECT usuario, jornada FROM dbo.tbl_CoVenAppINDO_OperadoresJornada"),
  ]);
```

(El punto de este step es SOLO sacar las 6 queries de montos del array y agregar `cargarMontosDelPeriodo(pool, periodo)` en su lugar — las demás queries son copia literal del archivo actual, sin ningún cambio de texto ni de orden relativo entre sí.)

- [ ] **Step 3: Actualizar el objeto `return` de `cargarContexto()`**

Cambiar:
```js
    multiplicadores:      multR.recordset,
    ...
    montos:               montosR.recordset,
    montosVendedor:       montosVendR.recordset,
    montosSupervisor:     montoSupR.recordset,
    montosPrestamaos:     montosPresR.recordset,
    montosCajero:         montosCajR.recordset,
```
por:
```js
    multiplicadores:      montosDelPeriodo.multiplicadores,
    ...
    montos:               montosDelPeriodo.montos,
    montosVendedor:       montosDelPeriodo.montosVendedor,
    montosSupervisor:     montosDelPeriodo.montosSupervisor,
    montosPrestamaos:     montosDelPeriodo.montosPrestamaos,
    montosCajero:         montosDelPeriodo.montosCajero,
```
(el resto de las claves del objeto `return` — `sucursales`, `rankingMap`, `datosConsumo`, `datosEfectivo`, `datosReporte`, `objConsumo`, `objEfectivo`, `encargados`, `grilla`, `operadorMap`, `jornadasMap`, `cajerosSucursal`, `supervisores`, `supervisorSucursales` — quedan exactamente igual, sin tocar).

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check server/routes/calculo.js`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add server/routes/calculo.js
git commit -m "feat(comisiones-indo): calculo.js usa la foto congelada de montos (cargarContexto)"
```

---

### Task 4: Integrar en `calculo.js` → `POST /cajeros`

**Files:**
- Modify: `server/routes/calculo.js`

- [ ] **Step 1: Reemplazar las queries de `MontosCajero` y `RankingMultiplicador` en el handler `POST /cajeros`**

De:
```js
    const [
      sucursalesR, rankingR, multR,
      objConsumoR, montosCajR, cakerosR
    ] = await Promise.all([
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
      pool.request().input('periodo', sql.VarChar, periodo).query('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
      pool.request().input('periodo', sql.VarChar, periodo).query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosCajero'),
      pool.request()
        .query(`
          SELECT v.NRO_VENDEDOR,
                 LTRIM(RTRIM(ISNULL(v.APELLIDO,'')+' '+ISNULL(v.NOMBRE,''))) AS nombre,
                 v.GCL_TEMPSPARTIEL AS gclTemps,
                 CAST(dd.Sucursal AS INT) AS sucursal_id
          FROM dbo.tbl_CoVenApp_Vendedores v
          INNER JOIN dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
            ON dd.VEND = v.NRO_VENDEDOR
          WHERE v.TIPO = 'CAJERO'
            AND ISNULL(dd.Sucursal,'') <> ''
            AND dd.Sucursal <> '0'
            AND ISNUMERIC(dd.Sucursal) = 1
          ORDER BY dd.Sucursal, v.APELLIDO, v.NOMBRE
        `)
    ]);
```
a:
```js
    const [
      sucursalesR, rankingR,
      objConsumoR, montosDelPeriodo, cakerosR
    ] = await Promise.all([
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
      pool.request().input('periodo', sql.VarChar, periodo).query('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
      pool.request().input('periodo', sql.VarChar, periodo).query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
      cargarMontosDelPeriodo(pool, periodo),
      pool.request()
        .query(`
          SELECT v.NRO_VENDEDOR,
                 LTRIM(RTRIM(ISNULL(v.APELLIDO,'')+' '+ISNULL(v.NOMBRE,''))) AS nombre,
                 v.GCL_TEMPSPARTIEL AS gclTemps,
                 CAST(dd.Sucursal AS INT) AS sucursal_id
          FROM dbo.tbl_CoVenApp_Vendedores v
          INNER JOIN dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
            ON dd.VEND = v.NRO_VENDEDOR
          WHERE v.TIPO = 'CAJERO'
            AND ISNULL(dd.Sucursal,'') <> ''
            AND dd.Sucursal <> '0'
            AND ISNUMERIC(dd.Sucursal) = 1
          ORDER BY dd.Sucursal, v.APELLIDO, v.NOMBRE
        `)
    ]);
```

- [ ] **Step 2: Actualizar el `ctx` del mismo handler**

De:
```js
    const ctx = {
      sucursales:       sucursalesR.recordset,
      rankingMap,
      multiplicadores:  multR.recordset,
      datosConsumo:     ventasBC.datosConsumo,
      datosEfectivo:    [],
      datosReporte:     [],
      objConsumo:       objConsumoR.recordset,
      objEfectivo:      [],
      montos:           [],
      montosVendedor:   [],
      montosSupervisor: [],
      montosPrestamaos: [],
      montosCajero:     montosCajR.recordset,
      cajerosSucursal,
    };
```
a:
```js
    const ctx = {
      sucursales:       sucursalesR.recordset,
      rankingMap,
      multiplicadores:  montosDelPeriodo.multiplicadores,
      datosConsumo:     ventasBC.datosConsumo,
      datosEfectivo:    [],
      datosReporte:     [],
      objConsumo:       objConsumoR.recordset,
      objEfectivo:      [],
      montos:           [],
      montosVendedor:   [],
      montosSupervisor: [],
      montosPrestamaos: [],
      montosCajero:     montosDelPeriodo.montosCajero,
      cajerosSucursal,
    };
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check server/routes/calculo.js`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add server/routes/calculo.js
git commit -m "feat(comisiones-indo): calculo.js POST /cajeros usa la foto congelada de montos"
```

---

### Task 5: Integrar en `operadores.js` → `calcularYGuardarOperadores()`

**Files:**
- Modify: `server/routes/operadores.js`

- [ ] **Step 1: Import**

```js
import { cargarMontosDelPeriodo } from '../services/montosHistorial.js';
```

- [ ] **Step 2: Reemplazar las queries de `Montos`, `MontosPrestamos` y `RankingMultiplicador` dentro de `calcularYGuardarOperadores()`**

De:
```js
    const [
      sucursalesR, rankingR, multR,
      objConsumoR, objEfectivoR,
      montosR, montosPresR,
      jornadasR, qlikUsuariosR
    ] = await Promise.all([
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@periodo'),
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Montos'),
      pool.request().query("SELECT * FROM dbo.tbl_CoVenAppINDO_MontosPrestamos WHERE tipo='suc'"),
      pool.request().query('SELECT usuario, jornada FROM dbo.tbl_CoVenAppINDO_OperadoresJornada'),
      pool.request().query("SELECT UPPER(LTRIM(RTRIM(Usuario))) AS id_usuario, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.tbl_QlikData_Usuarios"),
    ]);
```
a:
```js
    const [
      sucursalesR, rankingR,
      objConsumoR, objEfectivoR,
      montosDelPeriodo,
      jornadasR, qlikUsuariosR
    ] = await Promise.all([
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@periodo'),
      cargarMontosDelPeriodo(pool, periodo),
      pool.request().query('SELECT usuario, jornada FROM dbo.tbl_CoVenAppINDO_OperadoresJornada'),
      pool.request().query("SELECT UPPER(LTRIM(RTRIM(Usuario))) AS id_usuario, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.tbl_QlikData_Usuarios"),
    ]);
```

Nota: la query vieja de `MontosPrestamos` tenía `WHERE tipo='suc'`, pero la foto congelada (`cargarMontosDelPeriodo`) guarda la tabla `MontosPrestamos` COMPLETA sin ese filtro (mismo criterio que ya usa `calculo.js::cargarContexto` hoy). Esto es seguro: `calcEngine.js` ya filtra internamente por `tipo === 'suc'` en sus `.find(...)` (confirmado en `calcularOperadoresMillon`/`calcularOperadores`, líneas que hacen `montosPrestamaos.find(m => m.tipo === 'suc' && ...)`) — pasar la tabla completa en vez de la pre-filtrada no cambia el resultado.

- [ ] **Step 3: Actualizar el `ctx` de la misma función**

De:
```js
    const ctx = {
      sucursales:       sucursalesR.recordset,
      rankingMap,
      multiplicadores:  multR.recordset,
      datosConsumo,
      datosEfectivo,
      datosReporte,
      objConsumo:       objConsumoR.recordset,
      objEfectivo:      objEfectivoR.recordset,
      montos:           montosR.recordset,
      montosVendedor:   [],
      montosSupervisor: [],
      montosPrestamaos: montosPresR.recordset,
      montosCajero:     [],
      jornadasMap,
      operadorMap,
    };
```
a:
```js
    const ctx = {
      sucursales:       sucursalesR.recordset,
      rankingMap,
      multiplicadores:  montosDelPeriodo.multiplicadores,
      datosConsumo,
      datosEfectivo,
      datosReporte,
      objConsumo:       objConsumoR.recordset,
      objEfectivo:      objEfectivoR.recordset,
      montos:           montosDelPeriodo.montos,
      montosVendedor:   [],
      montosSupervisor: [],
      montosPrestamaos: montosDelPeriodo.montosPrestamaos,
      montosCajero:     [],
      jornadasMap,
      operadorMap,
    };
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check server/routes/operadores.js`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add server/routes/operadores.js
git commit -m "feat(comisiones-indo): operadores.js usa la foto congelada de montos (calcularYGuardarOperadores)"
```

---

### Task 6: Integrar en `millon.js` → `calcularYGuardarOperadoresMillon()`

**Files:**
- Modify: `server/routes/millon.js`

- [ ] **Step 1: Import**

```js
import { cargarMontosDelPeriodo } from '../services/montosHistorial.js';
```

- [ ] **Step 2: Reemplazar las queries de `MontosPrestamos` y `RankingMultiplicador` dentro de `calcularYGuardarOperadoresMillon()`**

De:
```js
    const [
      cacheR, flagsR, objEfR, sucR, multR, rankingR, montosPresR, qlikR, jornadaR
    ] = await Promise.all([
      pool.request()
        .input('periodo', sql.VarChar(7), periodo)
        .query(`SELECT sucursal_id, sucursal, operador, total_importe
                FROM dbo.tbl_CoVenAppINDO_MillonCache
                WHERE periodo = @periodo`),
      pool.request()
        .input('periodo', sql.VarChar(7), periodo)
        .query(`SELECT sucursal_id, operador, es_operador
                FROM dbo.tbl_CoVenAppINDO_MillonOperadores
                WHERE periodo = @periodo`),
      pool.request()
        .input('periodo', sql.VarChar(7), periodo)
        .query(`SELECT sucursal_id, primer_escalon
                FROM dbo.tbl_CoVenAppINDO_ObjEfectivo
                WHERE periodo = @periodo`),
      pool.request()
        .query(`SELECT id, nombre FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id >= 100 AND activa=1 ORDER BY id`),
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
      pool.request()
        .input('periodo', sql.VarChar(7), periodo)
        .query(`SELECT sucursal_id, categoria FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo = @periodo`),
      pool.request().query(`SELECT * FROM dbo.tbl_CoVenAppINDO_MontosPrestamos WHERE tipo = 'suc'`),
      pool.request().query(`SELECT UPPER(LTRIM(RTRIM(Usuario))) AS id_usuario, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.tbl_QlikData_Usuarios`),
      pool.request().query(`SELECT usuario, jornada FROM dbo.tbl_CoVenAppINDO_OperadoresJornada`),
    ]);
```
a:
```js
    const [
      cacheR, flagsR, objEfR, sucR, rankingR, montosDelPeriodo, qlikR, jornadaR
    ] = await Promise.all([
      pool.request()
        .input('periodo', sql.VarChar(7), periodo)
        .query(`SELECT sucursal_id, sucursal, operador, total_importe
                FROM dbo.tbl_CoVenAppINDO_MillonCache
                WHERE periodo = @periodo`),
      pool.request()
        .input('periodo', sql.VarChar(7), periodo)
        .query(`SELECT sucursal_id, operador, es_operador
                FROM dbo.tbl_CoVenAppINDO_MillonOperadores
                WHERE periodo = @periodo`),
      pool.request()
        .input('periodo', sql.VarChar(7), periodo)
        .query(`SELECT sucursal_id, primer_escalon
                FROM dbo.tbl_CoVenAppINDO_ObjEfectivo
                WHERE periodo = @periodo`),
      pool.request()
        .query(`SELECT id, nombre FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id >= 100 AND activa=1 ORDER BY id`),
      pool.request()
        .input('periodo', sql.VarChar(7), periodo)
        .query(`SELECT sucursal_id, categoria FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo = @periodo`),
      cargarMontosDelPeriodo(pool, periodo),
      pool.request().query(`SELECT UPPER(LTRIM(RTRIM(Usuario))) AS id_usuario, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.tbl_QlikData_Usuarios`),
      pool.request().query(`SELECT usuario, jornada FROM dbo.tbl_CoVenAppINDO_OperadoresJornada`),
    ]);
```

(Misma nota que en Task 5: la query vieja tenía `WHERE tipo = 'suc'`, la foto congelada guarda la tabla completa — seguro por el mismo motivo, `calcEngine.js` filtra por `tipo==='suc'` internamente.)

- [ ] **Step 3: Actualizar el `ctx` de la misma función**

De:
```js
    const ctx = {
      cacheRows:        cacheR.recordset.map(r => ({ ...r, total_importe: +r.total_importe })),
      objEfectivo:      objEfR.recordset,
      operadoresMillon: flagsR.recordset.map(r => ({ ...r, es_operador: !!r.es_operador })),
      sucursalesMillon: sucR.recordset,
      montosPrestamaos: montosPresR.recordset,
      rankingMap,
      multiplicadores:  multR.recordset,
      jornadasMap,
      operadorMap,
    };
```
a:
```js
    const ctx = {
      cacheRows:        cacheR.recordset.map(r => ({ ...r, total_importe: +r.total_importe })),
      objEfectivo:      objEfR.recordset,
      operadoresMillon: flagsR.recordset.map(r => ({ ...r, es_operador: !!r.es_operador })),
      sucursalesMillon: sucR.recordset,
      montosPrestamaos: montosDelPeriodo.montosPrestamaos,
      rankingMap,
      multiplicadores:  montosDelPeriodo.multiplicadores,
      jornadasMap,
      operadorMap,
    };
```

- [ ] **Step 4: Verificar sintaxis**

Run: `node --check server/routes/millon.js`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add server/routes/millon.js
git commit -m "feat(comisiones-indo): millon.js usa la foto congelada de montos (calcularYGuardarOperadoresMillon)"
```

---

### Task 7: Deploy y verificación end-to-end

**Files:** ninguno (solo restart + verificación contra la DB real).

- [ ] **Step 1: Reiniciar el servicio**

```powershell
Restart-Service dashcomisionesindo.exe
Get-Service dashcomisionesindo.exe
```
Expected: `Status: Running`. No hace falta `npm run build` (esta tarea no toca `src/`).

- [ ] **Step 2: Confirmar el backfill en el log**

```powershell
Get-Content C:\apps\dashboards\ComisionesINDO\server\daemon\dashcomisionesindo.err.log -Tail 20
```
Expected: si había períodos sin foto, una línea `[MontosHistorial] backfill: N período(s) revisado(s)`. Confirmar contra la DB:
```sql
SELECT periodo, fecha_snapshot FROM dbo.tbl_CoVenAppINDO_MontosHistorial ORDER BY periodo;
```
Expected: una fila por cada período que ya tenía algo calculado antes de este cambio.

- [ ] **Step 3: Verificar el caso nuevo (foto se congela al primer cálculo)**

1. Anotar el valor actual de `MontosCajero` para una categoría (ej. `SELECT * FROM dbo.tbl_CoVenAppINDO_MontosCajero`).
2. Calcular un período que NO tenga datos previos (ej. un mes futuro o de prueba) desde la página Total (o `POST /api/calculo/ejecutar`).
3. Confirmar que apareció una fila nueva en `MontosHistorial` para ese período, con `fecha_snapshot` de ahora.
4. Editar ese monto de Cajero en el ABM (`visor-montos.js` → pestaña Cajeros) a un valor distinto.
5. Recalcular el MISMO período de nuevo.
6. Confirmar que el resultado de Cajeros sigue reflejando el valor ANTERIOR a la edición (el que estaba congelado), no el nuevo — comparando el monto en `GET /api/calculo/cajeros?periodo=...` antes y después de la edición del ABM.

- [ ] **Step 4: Actualizar `RETOMAR.md`**

Agregar una entrada de sesión resumiendo: historización de montos implementada, spec en `docs/superpowers/specs/2026-07-27-historizacion-montos-design.md`, plan en `docs/superpowers/plans/2026-07-27-historizacion-montos.md`, resultado del backfill (cuántos períodos), y el resultado del test manual del Step 3.

- [ ] **Step 5: Commit final**

```bash
git add RETOMAR.md
git commit -m "docs(comisiones-indo): historizacion de montos desplegada y verificada"
```
