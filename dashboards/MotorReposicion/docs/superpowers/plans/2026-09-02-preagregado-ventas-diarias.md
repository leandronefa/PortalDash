# Pre-agregar ventas/tránsito por día — Implementation Plan

> **For agentic workers:** Este plan se ejecuta EN SESIÓN, no con subagentes (necesita una conexión viva a la base real que los subagentes de este proyecto no tienen — ver el plan de índices SQL del 2026-09-01 para el precedente). Usar superpowers:executing-plans o ejecutar task por task directamente. Steps con checkbox (`- [ ]`) para trackear progreso.

**Goal:** Que cambiar el "Período de ventas" a una fecha no precalentada corra en el orden de 1-3s (hoy: 25-48s), sin cambiar ningún número que el tablero muestra.

**Architecture:** 2 tablas nuevas (`MotorReposicion_VentasPorDia`, `MotorReposicion_TransitoHoy`) pobladas por una Etapa 8 nueva en el SP de precálculo nocturno existente; `QUERY_QUIEBRE_DETALLE` en `server.js` pasa a sumarlas/leerlas en vez de escanear `Vta_detalle`/`dis_transf_emitidas` en vivo por rango de fechas.

**Tech Stack:** SQL Server 2008 R2 (`db_Cegid`, Enterprise Edition), Node.js + `mssql` (ya en uso).

**Spec:** `docs/superpowers/specs/2026-09-02-preagregado-ventas-diarias-design.md`

## Global Constraints

- No hay test runner en este proyecto — verificación con scripts Node ad-hoc contra la base real, comparando resultado ANTES/DESPUÉS del cambio (deben coincidir EXACTO, no aproximado).
- Retención de `VentasPorDia` = la MISMA variable `@fechaDesde` (18 meses) que ya declara el SP al principio — no una constante nueva separada.
- Recálculo semanal de seguridad: domingos, últimos 3 meses.
- No se toca el frontend (`tablero_motor_quiebre.html`), ni la firma/comportamiento externo de `obtenerDataPesadaQuiebre`/`precalentarComboDefaultSiHaceFalta` (ver `server.js`, agregados el 2026-09-01 — no romperlos).
- No se toca `QUERY_ARTICULO_COMPLETO` ni `QUERY_COMPRAS_VENTAS_POR_MES`.
- Tipos de columna: `VARCHAR(20)` (Sucursal), `VARCHAR(50)` (CodArticulo/COLOR), `VARCHAR(20)` (TALLE), `DECIMAL(18,4)` (cantidades), `VARCHAR(100)` (NombrePromoDia), `FLOAT` (DescuentoPromoDia) — confirmados vía `INFORMATION_SCHEMA.COLUMNS` contra tablas reales existentes, no adivinados.
- **Cualquier `CREATE TABLE`/`ALTER PROCEDURE`/backfill contra la base real requiere confirmación explícita de Claudia antes de ejecutarse** — no correr esos pasos sin preguntar primero, mismo criterio que el plan de índices del 2026-09-01.
- Backup (`OBJECT_DEFINITION`) del SP actual antes de tocarlo, guardado en `backups/<fecha>-preagregado-ventas-por-dia/`.

---

### Task 1: Escribir el SQL de las 2 tablas nuevas (sin ejecutar)

**Files:**
- Create: `sql/2026-09-02_tablas_ventas_por_dia.sql`

- [ ] **Step 1: Escribir el archivo**

```sql
-- Tablas nuevas para pre-agregar ventas/promocion/transito por dia y acelerar cambios de fecha en
-- el tablero. Ver docs/superpowers/specs/2026-09-02-preagregado-ventas-diarias-design.md para el
-- analisis completo. Aditivas -- no se toca ninguna tabla existente.

IF OBJECT_ID('dbo.MotorReposicion_VentasPorDia') IS NULL
BEGIN
  CREATE TABLE dbo.MotorReposicion_VentasPorDia (
    Fecha                DATE          NOT NULL,
    Sucursal             VARCHAR(20)   NOT NULL,
    CodArticulo          VARCHAR(50)   NOT NULL,
    COLOR                VARCHAR(50)   NOT NULL,
    TALLE                VARCHAR(20)   NOT NULL,
    CantidadVendida      DECIMAL(18,4) NOT NULL,
    CantidadVentasPromo  INT           NOT NULL,
    NombrePromoDia       VARCHAR(100)  NULL,
    DescuentoPromoDia    FLOAT         NULL,
    CONSTRAINT PK_MotorReposicion_VentasPorDia PRIMARY KEY CLUSTERED (Fecha, Sucursal, CodArticulo, COLOR, TALLE)
  );
END

IF OBJECT_ID('dbo.MotorReposicion_TransitoHoy') IS NULL
BEGIN
  CREATE TABLE dbo.MotorReposicion_TransitoHoy (
    Sucursal          VARCHAR(20)   NOT NULL,
    CodArticulo       VARCHAR(50)   NOT NULL,
    COLOR             VARCHAR(50)   NOT NULL,
    TALLE             VARCHAR(20)   NOT NULL,
    TransitoPendiente DECIMAL(18,4) NOT NULL,
    CONSTRAINT PK_MotorReposicion_TransitoHoy PRIMARY KEY CLUSTERED (Sucursal, CodArticulo, COLOR, TALLE)
  );
END
```

- [ ] **Step 2: Commit (sin ejecutar todavía)**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add sql/2026-09-02_tablas_ventas_por_dia.sql
git commit -m "chore(motor-reposicion): SQL de tablas nuevas para pre-agregado de ventas por dia (sin ejecutar todavia)"
```

---

### Task 2: Crear las 2 tablas en la base real — REQUIERE CONFIRMACIÓN EXPLÍCITA

**⚠️ Preguntar a Claudia antes de correr este paso.**

**Files:**
- Create: `scripts/precalc/_tmp_crear_tablas_ventas_por_dia.js` (descartable, borrar después de Step 2)

- [ ] **Step 1: Confirmar con Claudia, luego ejecutar el SQL del Task 1**

```js
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};
async function main() {
  const pool = await sql.connect(dbConfig);
  const texto = fs.readFileSync('sql/2026-09-02_tablas_ventas_por_dia.sql', 'utf8');
  await pool.request().query(texto);
  const r = await pool.request().query(`
    SELECT name FROM sys.tables WHERE name IN ('MotorReposicion_VentasPorDia','MotorReposicion_TransitoHoy')
  `);
  console.log('Tablas confirmadas:', r.recordset);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run: `node scripts/precalc/_tmp_crear_tablas_ventas_por_dia.js`
Expected: 2 filas en el resultado (ambas tablas existen).

- [ ] **Step 2: Borrar el script descartable, no commitear nada más en este task**

```bash
rm scripts/precalc/_tmp_crear_tablas_ventas_por_dia.js
```

---

### Task 3: Backfill inicial de `TransitoHoy` (snapshot, rápido)

**Files:**
- Create: `scripts/precalc/backfill_transito_hoy.js`

**Interfaces:**
- Consumes: lógica idéntica a `#TransitoRango` actual en `server.js` (mismo join con `Sucursales`, mismo filtro `cantpend > 0`, misma vigencia de 30 días vía `TRANSITO_VIGENCIA_DIAS`).

- [ ] **Step 1: Escribir y correr el backfill**

```js
// scripts/precalc/backfill_transito_hoy.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 5 * 60 * 1000,
};
async function main() {
  const pool = await sql.connect(dbConfig);
  const inicio = Date.now();
  await pool.request().query(`
    TRUNCATE TABLE dbo.MotorReposicion_TransitoHoy;
    INSERT INTO dbo.MotorReposicion_TransitoHoy (Sucursal, CodArticulo, COLOR, TALLE, TransitoPendiente)
    SELECT te.destino, ISNULL(te.arprove,''), ISNULL(te.color,''), ISNULL(te.talle,''), SUM(te.cantpend)
    FROM dis_transf_emitidas te
    INNER JOIN Sucursales s ON s.Sucursal = te.destino AND (s.viewSuc='S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
    WHERE te.fecha >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE)) AND te.cantpend > 0
    GROUP BY te.destino, ISNULL(te.arprove,''), ISNULL(te.color,''), ISNULL(te.talle,'');
  `);
  console.log('TransitoHoy poblada en', Date.now() - inicio, 'ms');
  const r = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.MotorReposicion_TransitoHoy');
  console.log('Filas:', r.recordset[0].n);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run: `node scripts/precalc/backfill_transito_hoy.js`

- [ ] **Step 2: Verificar contra el cálculo en vivo actual**

Comparar `SUM(TransitoPendiente)` total de la tabla nueva contra correr la consulta original de `#TransitoRango` en vivo (mismo filtro) — deben coincidir exacto. Script chico ad-hoc, no hace falta guardarlo.

- [ ] **Step 3: Commit**

```bash
git add scripts/precalc/backfill_transito_hoy.js
git commit -m "feat(motor-reposicion): script de backfill/refresco de MotorReposicion_TransitoHoy"
```

---

### Task 4: Backfill inicial de `VentasPorDia` (18 meses, una sola vez) — REQUIERE CONFIRMACIÓN EXPLÍCITA

**⚠️ Preguntar a Claudia antes de correr contra producción — puede tardar, medir antes de asumir que es rápido.**

**Files:**
- Create: `scripts/precalc/backfill_ventas_por_dia.js`

- [ ] **Step 1: Escribir el script, corriendo el backfill en tandas MENSUALES (no los 18 meses de una)**

```js
// scripts/precalc/backfill_ventas_por_dia.js
// Uso: node scripts/precalc/backfill_ventas_por_dia.js
// Puebla MotorReposicion_VentasPorDia para los ultimos 18 meses, un mes a la vez (evita una
// transaccion gigante sobre 8.7M filas de Vta_detalle de una sola vez).
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 10 * 60 * 1000,
};

async function poblarMes(pool, desde, hasta) {
  const inicio = Date.now();
  const req = pool.request();
  req.input('desde', sql.Date, desde);
  req.input('hasta', sql.Date, hasta);
  await req.query(`
    DELETE FROM dbo.MotorReposicion_VentasPorDia WHERE Fecha >= @desde AND Fecha <= @hasta;
    INSERT INTO dbo.MotorReposicion_VentasPorDia (Fecha, Sucursal, CodArticulo, COLOR, TALLE, CantidadVendida, CantidadVentasPromo, NombrePromoDia, DescuentoPromoDia)
    SELECT vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,''),
           SUM(CASE WHEN ISNUMERIC(vd.CANTIDAD)=1 THEN CAST(vd.CANTIDAD AS DECIMAL(18,4)) ELSE 0 END),
           SUM(CASE WHEN c.NUMERO IS NOT NULL THEN 1 ELSE 0 END),
           MAX(c.NOMBRE_COND),
           MAX(c.DESCUENTO)
    FROM Vta_detalle vd
    LEFT JOIN CGD_CONDCOM_VTA_DET c
      ON c.ESTAB = vd.ESTAB AND c.NUMERO = vd.NUMERO AND c.FECHA = vd.FECHA AND c.CODBARRA_prin = vd.CODBARRA_prin
      AND c.PVP_REBAJADO < c.PRECIOLLENO AND c.NOMBRE_COND NOT LIKE '%MES DE TU CUMPLEA%'
    WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @desde AND vd.FECHA <= @hasta
    GROUP BY vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,'');
  `);
  console.log(`  ${desde.toISOString().slice(0,10)} a ${hasta.toISOString().slice(0,10)}: ${Date.now()-inicio}ms`);
}

async function main() {
  const pool = await sql.connect(dbConfig);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let cursor = new Date(hoy); cursor.setMonth(cursor.getMonth() - 18);
  while (cursor < hoy) {
    const finMes = new Date(cursor); finMes.setMonth(finMes.getMonth() + 1); finMes.setDate(finMes.getDate() - 1);
    const finReal = finMes > hoy ? hoy : finMes;
    await poblarMes(pool, new Date(cursor), finReal);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const r = await pool.request().query('SELECT COUNT(*) AS n, MIN(Fecha) AS desde, MAX(Fecha) AS hasta FROM dbo.MotorReposicion_VentasPorDia');
  console.log('Total filas:', r.recordset[0]);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

**IMPORTANTE:** el `LEFT JOIN` (no `INNER JOIN`) contra `CGD_CONDCOM_VTA_DET` es intencional y DISTINTO de la consulta original de `#PromoRango` (que usa `INNER JOIN`, porque esa consulta SOLO le interesan las filas con promo). Acá necesitamos UNA fila por día×combo que cubra TANTO ventas con promo como sin — por eso `LEFT JOIN` + `SUM(CASE WHEN c.NUMERO IS NOT NULL THEN 1 ELSE 0 END)` en vez de `COUNT(*)` sobre un INNER JOIN. Verificar en el Task 5 que esto da el mismo resultado que el camino viejo al sumarlo por rango.

- [ ] **Step 2: Confirmar con Claudia, después correr**

Run: `node scripts/precalc/backfill_ventas_por_dia.js`
Expected: 18 líneas de progreso (una por mes) + el conteo total final. Anotar cuánto tardó el total.

- [ ] **Step 3: Commit**

```bash
git add scripts/precalc/backfill_ventas_por_dia.js
git commit -m "feat(motor-reposicion): script de backfill inicial de MotorReposicion_VentasPorDia (18 meses)"
```

---

### Task 5: Verificar que las tablas nuevas dan el mismo resultado que el cálculo en vivo

**Files:**
- Create: `scripts/precalc/_tmp_verificar_ventas_por_dia.js` (descartable)

- [ ] **Step 1: Comparar, para 3 combinaciones de fechas reales, el resultado agregado de la tabla nueva contra la consulta en vivo actual**

```js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 5 * 60 * 1000,
};
const COMBOS = [
  ['2025-11-01','2026-01-31'], ['2025-06-01','2025-08-31'], ['2026-02-01','2026-04-30'],
];
async function main() {
  const pool = await sql.connect(dbConfig);
  for (const [desde, hasta] of COMBOS) {
    const viejo = await pool.request()
      .input('desde', sql.Date, new Date(desde)).input('hasta', sql.Date, new Date(hasta))
      .query(`
        SELECT COUNT(*) AS combos, SUM(v) AS totalVentas, SUM(p) AS totalPromo FROM (
          SELECT ESTAB, ARTCEGID, COLOR, TALLE,
                 SUM(CASE WHEN ISNUMERIC(CANTIDAD)=1 THEN CAST(CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS v,
                 (SELECT COUNT(*) FROM Vta_detalle vd2 INNER JOIN CGD_CONDCOM_VTA_DET c ON c.ESTAB=vd2.ESTAB AND c.NUMERO=vd2.NUMERO AND c.FECHA=vd2.FECHA AND c.CODBARRA_prin=vd2.CODBARRA_prin AND c.PVP_REBAJADO<c.PRECIOLLENO AND c.NOMBRE_COND NOT LIKE '%MES DE TU CUMPLEA%' WHERE vd2.ESTAB=vd.ESTAB AND vd2.ARTCEGID=vd.ARTCEGID AND vd2.COLOR=vd.COLOR AND vd2.TALLE=vd.TALLE AND vd2.FECHA>=@desde AND vd2.FECHA<=@hasta) AS p
          FROM Vta_detalle vd WHERE ESTAB IS NOT NULL AND FECHA>=@desde AND FECHA<=@hasta
          GROUP BY ESTAB, ARTCEGID, COLOR, TALLE
        ) t
      `);
    const nuevo = await pool.request()
      .input('desde', sql.Date, new Date(desde)).input('hasta', sql.Date, new Date(hasta))
      .query(`
        SELECT COUNT(*) AS combos, SUM(CantidadVendida) AS totalVentas, SUM(CantidadVentasPromo) AS totalPromo
        FROM dbo.MotorReposicion_VentasPorDia WHERE Fecha>=@desde AND Fecha<=@hasta
        GROUP BY Sucursal, CodArticulo, COLOR, TALLE
      `);
    console.log(desde, '-', hasta);
    console.log('  viejo (en vivo):', viejo.recordset[0]);
    console.log('  nuevo (VentasPorDia), combos distintos:', nuevo.recordset.length);
  }
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

**Nota:** la consulta "viejo" de arriba es deliberadamente lenta (subquery correlacionada) porque es solo de verificación, no para producción — no optimizarla. Si `combos`/`totalVentas`/`totalPromo` no coinciden entre viejo y nuevo, DETENER el plan acá y investigar antes de seguir — no avanzar al Task 6 con datos que no verifican.

- [ ] **Step 2: Borrar el script descartable si todo coincidió**

```bash
rm scripts/precalc/_tmp_verificar_ventas_por_dia.js
```

---

### Task 6: Agregar la Etapa 8 al SP de precálculo nocturno — REQUIERE CONFIRMACIÓN EXPLÍCITA

**⚠️ Preguntar a Claudia antes de desplegar (`ALTER PROCEDURE` en producción).**

**Files:**
- Modify: `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql`

**Interfaces:**
- Consumes: `@fechaDesde` y `@ahora`, ya declarados al principio del SP existente.

- [ ] **Step 1: Backup de la definición actual del SP**

```bash
node -e "
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const dbConfig = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER, database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true } };
sql.connect(dbConfig).then(async (pool) => {
  const r = await pool.request().query(\"SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.MotorReposicion_sp_PreCalcularStockSemanal')) AS def\");
  fs.mkdirSync('backups/2026-09-02-preagregado-ventas-por-dia', {recursive:true});
  fs.writeFileSync('backups/2026-09-02-preagregado-ventas-por-dia/sp_antes.sql', r.recordset[0].def);
  console.log('Backup guardado.');
  await pool.close();
}).catch(e => { console.error(e); process.exit(1); });
"
```

- [ ] **Step 2: Agregar la Etapa 8 al final del cuerpo del SP** (antes del `END` que cierra el procedimiento — leer el archivo completo primero para ubicar el punto exacto, no asumir la línea)

```sql
  -- Etapa 8 (NUEVA, 2026-09-02, ver spec docs/superpowers/specs/2026-09-02-preagregado-ventas-diarias-design.md):
  -- pre-agregar ventas/promocion por dia (MotorReposicion_VentasPorDia) y transito de hoy
  -- (MotorReposicion_TransitoHoy), para que server.js deje de escanear Vta_detalle/
  -- dis_transf_emitidas en vivo por cada cambio de fecha en el tablero.

  -- 8a: incremental -- solo "ayer" (rapido, corre todas las noches)
  DECLARE @ayer DATE = DATEADD(DAY, -1, CAST(@ahora AS DATE));
  DELETE FROM dbo.MotorReposicion_VentasPorDia WHERE Fecha = @ayer;
  INSERT INTO dbo.MotorReposicion_VentasPorDia (Fecha, Sucursal, CodArticulo, COLOR, TALLE, CantidadVendida, CantidadVentasPromo, NombrePromoDia, DescuentoPromoDia)
  SELECT vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,''),
         SUM(CASE WHEN ISNUMERIC(vd.CANTIDAD)=1 THEN CAST(vd.CANTIDAD AS DECIMAL(18,4)) ELSE 0 END),
         SUM(CASE WHEN c.NUMERO IS NOT NULL THEN 1 ELSE 0 END),
         MAX(c.NOMBRE_COND),
         MAX(c.DESCUENTO)
  FROM Vta_detalle vd
  LEFT JOIN CGD_CONDCOM_VTA_DET c
    ON c.ESTAB = vd.ESTAB AND c.NUMERO = vd.NUMERO AND c.FECHA = vd.FECHA AND c.CODBARRA_prin = vd.CODBARRA_prin
    AND c.PVP_REBAJADO < c.PRECIOLLENO AND c.NOMBRE_COND NOT LIKE '%MES DE TU CUMPLEA%'
  WHERE vd.ESTAB IS NOT NULL AND vd.FECHA = @ayer
  GROUP BY vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,'');

  -- 8b: recalculo semanal de seguridad -- domingos, ultimos 3 meses (correcciones retroactivas)
  IF DATEPART(WEEKDAY, @ahora) = 1
  BEGIN
    DECLARE @desde3Meses DATE = DATEADD(MONTH, -3, CAST(@ahora AS DATE));
    DELETE FROM dbo.MotorReposicion_VentasPorDia WHERE Fecha >= @desde3Meses AND Fecha <= @ayer;
    INSERT INTO dbo.MotorReposicion_VentasPorDia (Fecha, Sucursal, CodArticulo, COLOR, TALLE, CantidadVendida, CantidadVentasPromo, NombrePromoDia, DescuentoPromoDia)
    SELECT vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,''),
           SUM(CASE WHEN ISNUMERIC(vd.CANTIDAD)=1 THEN CAST(vd.CANTIDAD AS DECIMAL(18,4)) ELSE 0 END),
           SUM(CASE WHEN c.NUMERO IS NOT NULL THEN 1 ELSE 0 END),
           MAX(c.NOMBRE_COND),
           MAX(c.DESCUENTO)
    FROM Vta_detalle vd
    LEFT JOIN CGD_CONDCOM_VTA_DET c
      ON c.ESTAB = vd.ESTAB AND c.NUMERO = vd.NUMERO AND c.FECHA = vd.FECHA AND c.CODBARRA_prin = vd.CODBARRA_prin
      AND c.PVP_REBAJADO < c.PRECIOLLENO AND c.NOMBRE_COND NOT LIKE '%MES DE TU CUMPLEA%'
    WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @desde3Meses AND vd.FECHA <= @ayer
    GROUP BY vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,'');
  END

  -- 8c: retencion -- misma @fechaDesde (18 meses) que ya usa Etapa 1
  DELETE FROM dbo.MotorReposicion_VentasPorDia WHERE Fecha < @fechaDesde;

  -- 8d: TransitoHoy -- snapshot completo, siempre (tabla chica, no hace falta incremental)
  TRUNCATE TABLE dbo.MotorReposicion_TransitoHoy;
  INSERT INTO dbo.MotorReposicion_TransitoHoy (Sucursal, CodArticulo, COLOR, TALLE, TransitoPendiente)
  SELECT te.destino, ISNULL(te.arprove,''), ISNULL(te.color,''), ISNULL(te.talle,''), SUM(te.cantpend)
  FROM dis_transf_emitidas te
  INNER JOIN Sucursales s ON s.Sucursal = te.destino AND (s.viewSuc='S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
  WHERE te.fecha >= DATEADD(DAY, -30, CAST(@ahora AS DATE)) AND te.cantpend > 0
  GROUP BY te.destino, ISNULL(te.arprove,''), ISNULL(te.color,''), ISNULL(te.talle,'');
```

- [ ] **Step 3: Confirmar con Claudia, luego desplegar con el script existente**

Run: `node scripts/precalc/desplegar_sp.js`
(Ya sigue el patrón CREATE→ALTER + verificación de `OBJECT_DEFINITION` — no reescribir esa lógica.)

- [ ] **Step 4: NO correr el SP completo manualmente todavía** (correrlo entero recalcula las otras 7 etapas también, ~6-7 minutos) — dejar que la corrida nocturna normal (SQL Agent Job, 06:30) lo recoja solo. Avisar a Claudia que la Etapa 8 va a aparecer recién en la corrida de esta noche (o la próxima).

- [ ] **Step 5: Commit**

```bash
git add sql/MotorReposicion_sp_PreCalcularStockSemanal.sql backups/2026-09-02-preagregado-ventas-por-dia/sp_antes.sql
git commit -m "feat(motor-reposicion): agregar Etapa 8 (VentasPorDia/TransitoHoy) al SP de precalculo nocturno"
```

---

### Task 7: Modificar `QUERY_QUIEBRE_DETALLE` en `server.js`

**Files:**
- Modify: `server.js` (las 3 sub-consultas `#VentasRango`, `#PromoRango`, `#TransitoRango` dentro de `QUERY_QUIEBRE_DETALLE`)

- [ ] **Step 1: Reemplazar las 3 sub-consultas**

Ubicar (buscar por el texto, no por número de línea — puede haber cambiado) el bloque que va desde `SELECT te.destino AS Sucursal...INTO #TransitoRango...` hasta el `GROUP BY vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE;` que cierra `#PromoRango`, y reemplazarlo por:

```sql
SELECT Sucursal, CodArticulo, COLOR, TALLE, TransitoPendiente
INTO #TransitoRango
FROM dbo.MotorReposicion_TransitoHoy;

SELECT Sucursal, CodArticulo, COLOR, TALLE,
       SUM(CantidadVendida) AS VentasRango,
       COUNT(*) AS DiasConVenta,
       MAX(Fecha) AS UltimaVenta
INTO #VentasRango
FROM dbo.MotorReposicion_VentasPorDia
WHERE Fecha >= @fechaDesde AND Fecha <= @fechaHasta
GROUP BY Sucursal, CodArticulo, COLOR, TALLE;

SELECT Sucursal, CodArticulo, COLOR, TALLE,
       SUM(CantidadVentasPromo) AS CantidadVentasPromo,
       MAX(NombrePromoDia) AS NombrePromo,
       MAX(DescuentoPromoDia) AS DescuentoPromo
INTO #PromoRango
FROM dbo.MotorReposicion_VentasPorDia
WHERE Fecha >= @fechaDesde AND Fecha <= @fechaHasta AND CantidadVentasPromo > 0
GROUP BY Sucursal, CodArticulo, COLOR, TALLE;
```

Mantener el `DROP TABLE #TransitoRango`/`#VentasRango`/`#PromoRango IF EXISTS` del principio de la consulta sin cambios (siguen haciendo falta).

- [ ] **Step 2: Sacar el parámetro `fechaDesdeTransito` que ya no se usa**

En `obtenerDataPesadaQuiebre` (`server.js`), buscar el `.input('fechaDesdeTransito', sql.Date, fechaDesdeTransito)` y la línea que calcula `fechaDesdeTransito` (`const fechaDesdeTransito = new Date(); fechaDesdeTransito.setDate(...)`) — sacar ambas si ya no las usa ningún otro lado de la función (confirmar con grep antes de borrar: `grep -n fechaDesdeTransito server.js`).

- [ ] **Step 3: Verificación — respuesta idéntica antes/después, para las mismas 3 combinaciones del Task 5**

```bash
curl -s "http://127.0.0.1:3050/api/tablero/quiebre?desde=2025-11-01&hasta=2026-01-31&riesgoDias=15&ucDesde=2025-01-01&ucHasta=2025-12-31" -o /tmp/despues_combo1.json
```

Reiniciar el servidor primero (vacía `cacheQuiebre` en memoria, fuerza recalculo real) y comparar contra una respuesta ANTES de este cambio para la MISMA combinación (si no se guardó una de referencia, correr esto ANTES de aplicar el Step 1 de este task, y de nuevo DESPUÉS, y diffear).

- [ ] **Step 4: Medir el tiempo — debería bajar de ~25-48s a pocos segundos**

```bash
node scripts/precalc/medir_tiempos_quiebre.js despues
```

(Reusa el script ya existente del 2026-09-01 — reiniciar el servidor antes para forzar cache-miss real.)

- [ ] **Step 5: Confirmar que lo de hoy (2026-09-01) sigue funcionando**

1. Abrir el tablero, confirmar que "Ver en detalle" sigue virtualizando bien (scroll, cambio de orden) — no debería haberse tocado nada de eso, pero confirmar igual.
2. Confirmar en los logs del servidor que sigue apareciendo `Precalentado combo default de /api/tablero/quiebre OK` cada 5 minutos.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(motor-reposicion): usar MotorReposicion_VentasPorDia/_TransitoHoy en vez de escanear Vta_detalle/dis_transf_emitidas en vivo"
```

---

### Task 8: Script manual de recálculo puntual

**Files:**
- Create: `scripts/precalc/recalcular_ventas_por_dia.js`

- [ ] **Step 1: Escribir el script**

```js
// scripts/precalc/recalcular_ventas_por_dia.js
// Uso: node scripts/precalc/recalcular_ventas_por_dia.js 2025-01-01 2025-01-31
// Recalcula MotorReposicion_VentasPorDia para un rango de fechas puntual -- para correr a mano si
// alguien avisa de una correccion a una venta de mas de 3 meses de antiguedad (el recalculo
// semanal automatico de la Etapa 8 solo cubre los ultimos 3 meses).
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 10 * 60 * 1000,
};
async function main() {
  const [,, desdeArg, hastaArg] = process.argv;
  if (!desdeArg || !hastaArg) throw new Error('Uso: node recalcular_ventas_por_dia.js YYYY-MM-DD YYYY-MM-DD');
  const pool = await sql.connect(dbConfig);
  const req = pool.request();
  req.input('desde', sql.Date, new Date(desdeArg));
  req.input('hasta', sql.Date, new Date(hastaArg));
  await req.query(`
    DELETE FROM dbo.MotorReposicion_VentasPorDia WHERE Fecha >= @desde AND Fecha <= @hasta;
    INSERT INTO dbo.MotorReposicion_VentasPorDia (Fecha, Sucursal, CodArticulo, COLOR, TALLE, CantidadVendida, CantidadVentasPromo, NombrePromoDia, DescuentoPromoDia)
    SELECT vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,''),
           SUM(CASE WHEN ISNUMERIC(vd.CANTIDAD)=1 THEN CAST(vd.CANTIDAD AS DECIMAL(18,4)) ELSE 0 END),
           SUM(CASE WHEN c.NUMERO IS NOT NULL THEN 1 ELSE 0 END),
           MAX(c.NOMBRE_COND),
           MAX(c.DESCUENTO)
    FROM Vta_detalle vd
    LEFT JOIN CGD_CONDCOM_VTA_DET c
      ON c.ESTAB = vd.ESTAB AND c.NUMERO = vd.NUMERO AND c.FECHA = vd.FECHA AND c.CODBARRA_prin = vd.CODBARRA_prin
      AND c.PVP_REBAJADO < c.PRECIOLLENO AND c.NOMBRE_COND NOT LIKE '%MES DE TU CUMPLEA%'
    WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @desde AND vd.FECHA <= @hasta
    GROUP BY vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,'');
  `);
  console.log(`Recalculado ${desdeArg} a ${hastaArg}.`);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add scripts/precalc/recalcular_ventas_por_dia.js
git commit -m "feat(motor-reposicion): script manual de recalculo puntual de VentasPorDia"
```

---

### Task 9: Documentar en CLAUDE.md

- [ ] **Step 1: Actualizar la sección "Rendimiento del tablero" con el resultado real** (tiempos antes/después medidos en el Task 7, y mencionar las 2 tablas nuevas + la Etapa 8 + el script manual)
- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(motor-reposicion): documentar resultado del pre-agregado de ventas por dia"
```

---

## Self-Review (completado durante la escritura de este plan)

- **Cobertura del spec:** los 5 componentes del diseño (tabla VentasPorDia, tabla TransitoHoy, Etapa 8, cambio en QUERY_QUIEBRE_DETALLE, script manual) están cubiertos en Tasks 1-2 / 3-4 / 6 / 7 / 8 respectivamente. La verificación de igualdad exacta (punto central del spec) tiene su propio Task (5) antes de tocar el SP o server.js.
- **Placeholders:** ninguno — todo el SQL/JS está completo, no hay "TODO" ni lógica descrita sin código.
- **Consistencia:** la lógica de agregación (`LEFT JOIN` + `SUM(CASE WHEN c.NUMERO IS NOT NULL...)`) es IDÉNTICA en el backfill (Task 4), la Etapa 8 (Task 6) y el script manual (Task 8) — mismo patrón copiado a propósito en los 3 lugares, documentado como intencional.
- **Gates de confirmación:** Tasks 2, 4 y 6 (los que tocan la base real con cambios de esquema/datos) están marcados explícitamente para pedir confirmación antes de ejecutar, igual que el plan de índices del 2026-09-01.
