# Relleno de huecos en MotorReposicion_StockSemanal — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las semanas genuinamente sin stock generen su fila real (`StockSemana = 0`) en `dbo.MotorReposicion_StockSemanal`, para que la Etapa 3 del precálculo nocturno (rescate por ventas reales, conteo de días quebrado) funcione como fue diseñada.

**Architecture:** Un bloque nuevo de SQL dentro de la Etapa 1 de `dbo.MotorReposicion_sp_PreCalcularStockSemanal` que, para cada combinación sucursal+artículo+color+talle, genera las semanas esperadas entre su primera y su última aparición real, y rellena con `StockSemana = 0` las que no tengan fila. El resto del SP (Etapas 2, 3, 4) no se modifica.

**Tech Stack:** SQL Server 2008 R2 (T-SQL, sin `CREATE OR ALTER`, sin `CONCAT`, sin generadores de fecha nativos), Node.js + paquete `mssql` para correr y verificar contra la base real (mismo patrón ya usado en toda la sesión). El proyecto no usa git — los "checkpoints" son backups en `backups/<fecha>-<descripcion>/`, no commits.

## Global Constraints

- SQL Server 2008 R2: no usar `CONCAT`, `CREATE OR ALTER`, ni funciones de fecha posteriores a esa versión.
- No modificar la Etapa 3 (`MotorReposicion_DiasConStockPorSemana`), la Etapa 4, ni la fórmula de velocidad en `server.js` — el cambio vive enteramente dentro de la Etapa 1 del SP.
- El relleno de huecos NO debe extenderse más allá de la última semana real vista por cada combinación (no inventar quiebre perpetuo para artículos descontinuados) — ver spec, sección "Aclaraciones de diseño".
- Antes de cualquier `ALTER PROCEDURE`, debe existir un backup de la definición anterior en `backups/2026-08-18-dias-con-stock-huecos/`.
- Todo Node.js de verificación se escribe en `scripts/precalc/` (queda en el proyecto, no es scratch descartable — a diferencia de los diagnósticos ad-hoc de sesiones anteriores) y usa las credenciales de `.env` igual que `server.js`.

---

### Task 1: Backup de la definición actual del SP

**Files:**
- Create: `backups/2026-08-18-dias-con-stock-huecos/MotorReposicion_sp_PreCalcularStockSemanal_ANTES.sql`
- Create: `scripts/precalc/backup_sp.js`

**Interfaces:**
- Produces: el archivo `.sql` con la definición completa y actual del SP, que Task 3 va a editar (como copia de trabajo en `sql/`, no este archivo de backup).

- [ ] **Step 1: Escribir el script de backup**

```javascript
// scripts/precalc/backup_sp.js
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const pool = await sql.connect(dbConfig);
  const r = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.MotorReposicion_sp_PreCalcularStockSemanal')) AS Def
  `);
  const def = r.recordset[0].Def;
  if (!def || def.length < 100) {
    throw new Error('La definicion vino vacia o sospechosamente corta -- no se escribe el backup.');
  }
  const destino = path.join(__dirname, '..', '..', 'backups', '2026-08-18-dias-con-stock-huecos', 'MotorReposicion_sp_PreCalcularStockSemanal_ANTES.sql');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, def, 'utf8');
  console.log('Backup escrito en', destino, '(', def.length, 'caracteres)');
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correrlo**

Run: `node scripts/precalc/backup_sp.js`
Expected: imprime la ruta del archivo y una longitud de varios miles de caracteres (la definición completa del SP tiene ~285 líneas).

- [ ] **Step 3: Confirmar el contenido**

Abrir `backups/2026-08-18-dias-con-stock-huecos/MotorReposicion_sp_PreCalcularStockSemanal_ANTES.sql` y confirmar que empieza con `CREATE PROCEDURE dbo.MotorReposicion_sp_PreCalcularStockSemanal` y termina con un `END` — si no, no seguir a la Task 2 hasta resolverlo.

---

### Task 2: Probar la lógica de relleno de huecos de forma aislada (sin escribir nada)

Antes de tocar el SP real, confirmar que la consulta de relleno de huecos da los mismos números que ya midió el diseño (50.880 combinaciones con huecos, 526.541 semanas faltantes) — corriéndola como un SELECT de solo lectura contra los datos reales de hoy.

**Files:**
- Create: `scripts/precalc/probar_relleno_huecos.js`

**Interfaces:**
- Consumes: nada de tasks anteriores (consulta la base real directamente).
- Produces: confirmación de que la lógica de relleno (Nums + spine + LEFT JOIN) funciona antes de integrarla al SP real.

- [ ] **Step 1: Escribir el script de prueba**

```javascript
// scripts/precalc/probar_relleno_huecos.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const pool = await sql.connect(dbConfig);
  const r = await pool.request().query(`
    ;WITH E1(N) AS (
      SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
      UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
    ),
    Nums(N) AS (
      SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1
      FROM E1 a CROSS JOIN E1 b   -- 8x8 = 64 numeros: 0..63 (suficiente para 12 meses ~53 semanas)
    ),
    RangoPorCombo AS (
      SELECT Sucursal, CodArticulo, COLOR, TALLE,
             MIN(FechaSemana) AS Primera, MAX(FechaSemana) AS Ultima
      FROM dbo.MotorReposicion_StockSemanal
      GROUP BY Sucursal, CodArticulo, COLOR, TALLE
    ),
    SemanasEsperadas AS (
      SELECT r.Sucursal, r.CodArticulo, r.COLOR, r.TALLE,
             DATEADD(DAY, n.N * 7, r.Primera) AS FechaSemana
      FROM RangoPorCombo r
      CROSS JOIN Nums n
      WHERE DATEADD(DAY, n.N * 7, r.Primera) <= r.Ultima
    ),
    Huecos AS (
      SELECT se.Sucursal, se.CodArticulo, se.COLOR, se.TALLE, se.FechaSemana
      FROM SemanasEsperadas se
      LEFT JOIN dbo.MotorReposicion_StockSemanal real2
        ON real2.Sucursal = se.Sucursal AND real2.CodArticulo = se.CodArticulo
       AND real2.COLOR = se.COLOR AND real2.TALLE = se.TALLE AND real2.FechaSemana = se.FechaSemana
      WHERE real2.FechaSemana IS NULL
    )
    SELECT COUNT(DISTINCT Sucursal+'|'+CodArticulo+'|'+COLOR+'|'+TALLE) AS CombosConHueco,
           COUNT(*) AS TotalSemanasFaltantes
    FROM Huecos
  `);
  console.log('Resultado de la prueba aislada:', r.recordset[0]);
  console.log('Esperado (segun la spec, medido el 2026-08-18): CombosConHueco ~50.880, TotalSemanasFaltantes ~526.541');
  console.log('(pueden no ser EXACTAMENTE iguales -- pasaron dias y la ventana de 12 meses se movio -- pero deben ser del mismo orden de magnitud)');
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correrlo**

Run: `node scripts/precalc/probar_relleno_huecos.js`
Expected: `CombosConHueco` y `TotalSemanasFaltantes` del mismo orden de magnitud que lo medido en la spec (decenas de miles de combos, cientos de miles de semanas). Si da 0 en ambos, o un número absurdamente mayor (millones), NO seguir a la Task 3 — revisar la consulta primero.

---

### Task 3: Modificar la Etapa 1 del SP para insertar las filas de hueco

**Files:**
- Create: `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` (copia editable de trabajo, se llena en el Step 1 con el contenido del backup de la Task 1)
- Modify: `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` (el mismo archivo, Step 2)

**Interfaces:**
- Consumes: `backups/2026-08-18-dias-con-stock-huecos/MotorReposicion_sp_PreCalcularStockSemanal_ANTES.sql` (Task 1).
- Produces: `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql`, la definición completa y modificada que la Task 4 va a desplegar con `ALTER PROCEDURE`.

- [ ] **Step 1: Copiar el backup a la carpeta de trabajo `sql/`**

Run (PowerShell): `Copy-Item "backups\2026-08-18-dias-con-stock-huecos\MotorReposicion_sp_PreCalcularStockSemanal_ANTES.sql" "sql\MotorReposicion_sp_PreCalcularStockSemanal.sql"`

Expected: el archivo nuevo existe en `sql/` con el mismo contenido que el backup.

- [ ] **Step 2: Insertar el bloque de relleno de huecos**

Buscar en `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` este texto exacto (el final de la Etapa 1 tal como está hoy):

```sql
  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_StockSemanal;
    INSERT INTO dbo.MotorReposicion_StockSemanal (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo
    FROM #StockSemanalNuevo;
  COMMIT TRANSACTION;

  DROP TABLE #StockSemanalNuevo;
```

Y reemplazarlo por (agrega el relleno de huecos ANTES del `TRUNCATE`+`INSERT`, sin tocar nada de lo que ya existía):

```sql
  -- Relleno de huecos: una semana sin ninguna foto con stock (quiebre real) no genera fila en
  -- #StockSemanalNuevo -- sin esto, no hay diferencia entre "nunca existio aca" y "se quedo sin
  -- stock esta semana". Se generan las semanas esperadas entre la primera y la ultima semana
  -- REAL de cada combinacion (nunca mas alla -- no se inventa quiebre para algo descontinuado)
  -- y se insertan con StockSemana=0 las que falten. Ver docs/superpowers/specs/2026-08-18-dias-con-stock-huecos-design.md.
  ;WITH E1(N) AS (
    SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
    UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
  ),
  Nums(N) AS (
    SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1
    FROM E1 a CROSS JOIN E1 b   -- 8x8 = 64 numeros: 0..63 (suficiente para 12 meses ~53 semanas)
  ),
  RangoPorCombo AS (
    SELECT Sucursal, CodArticulo, COLOR, TALLE,
           MIN(FechaSemana) AS Primera, MAX(FechaSemana) AS Ultima
    FROM #StockSemanalNuevo
    GROUP BY Sucursal, CodArticulo, COLOR, TALLE
  ),
  SemanasEsperadas AS (
    SELECT r.Sucursal, r.CodArticulo, r.COLOR, r.TALLE,
           DATEADD(DAY, n.N * 7, r.Primera) AS FechaSemana
    FROM RangoPorCombo r
    CROSS JOIN Nums n
    WHERE DATEADD(DAY, n.N * 7, r.Primera) <= r.Ultima
  ),
  Huecos AS (
    SELECT se.Sucursal, se.CodArticulo, se.COLOR, se.TALLE, se.FechaSemana,
           0 AS StockSemana, @ahora AS FechaCalculo
    FROM SemanasEsperadas se
    LEFT JOIN #StockSemanalNuevo real2
      ON real2.Sucursal = se.Sucursal AND real2.CodArticulo = se.CodArticulo
     AND real2.COLOR = se.COLOR AND real2.TALLE = se.TALLE AND real2.FechaSemana = se.FechaSemana
    WHERE real2.FechaSemana IS NULL
  )
  INSERT INTO #StockSemanalNuevo (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo)
  SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo
  FROM Huecos;

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_StockSemanal;
    INSERT INTO dbo.MotorReposicion_StockSemanal (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo
    FROM #StockSemanalNuevo;
  COMMIT TRANSACTION;

  DROP TABLE #StockSemanalNuevo;
```

- [ ] **Step 3: Confirmar que el archivo quedó bien armado**

Abrir `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` y confirmar a simple vista: el bloque nuevo aparece UNA sola vez, antes del `BEGIN TRANSACTION` de la Etapa 1, y el resto del archivo (Etapas 2, 3, 4, el `END` final) está intacto y sin duplicar.

---

### Task 4: Desplegar el SP modificado contra la base real

**Files:**
- Create: `scripts/precalc/desplegar_sp.js`

**Interfaces:**
- Consumes: `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` (Task 3).
- Produces: el SP real en la base queda actualizado con la lógica nueva.

- [ ] **Step 1: Escribir el script de despliegue**

SQL Server 2008 R2 no tiene `CREATE OR ALTER` -- hay que convertir el primer `CREATE PROCEDURE` del archivo a `ALTER PROCEDURE` antes de ejecutarlo.

```javascript
// scripts/precalc/desplegar_sp.js
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const rutaSql = path.join(__dirname, '..', '..', 'sql', 'MotorReposicion_sp_PreCalcularStockSemanal.sql');
  let texto = fs.readFileSync(rutaSql, 'utf8');
  if (!texto.trim().toUpperCase().startsWith('CREATE PROCEDURE')) {
    throw new Error('El archivo no empieza con CREATE PROCEDURE -- no se despliega, revisar a mano.');
  }
  texto = texto.replace(/^CREATE PROCEDURE/i, 'ALTER PROCEDURE');

  const pool = await sql.connect(dbConfig);
  await pool.request().query(texto);
  console.log('SP actualizado correctamente.');
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correrlo**

Run: `node scripts/precalc/desplegar_sp.js`
Expected: `SP actualizado correctamente.` sin errores de sintaxis. Si tira un error de SQL, NO seguir -- corregir `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql` y repetir este step (no la Task 3 completa).

---

### Task 5: Correr el SP manualmente una vez y medir el tiempo

No hay que esperar a las 06:30 -- se corre a mano ahora para poder validar el resultado en la misma sesión.

**Files:**
- Create: `scripts/precalc/correr_sp_y_medir.js`

**Interfaces:**
- Consumes: el SP ya desplegado (Task 4).
- Produces: confirmación de que corre sin errores y cuánto tarda (para comparar con los ~7 minutos de antes).

- [ ] **Step 1: Escribir el script**

```javascript
// scripts/precalc/correr_sp_y_medir.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 30 * 60 * 1000, // 30 minutos, por si tarda mas de lo esperado
};

async function main() {
  const pool = await sql.connect(dbConfig);
  const inicio = Date.now();
  await pool.request().query(`EXEC dbo.MotorReposicion_sp_PreCalcularStockSemanal`);
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`El SP corrio OK en ${segundos} segundos (antes rondaba los 6-7 minutos = 360-420 segundos).`);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correrlo**

Run: `node scripts/precalc/correr_sp_y_medir.js`
Expected: termina sin error. Anotar los segundos que tardó -- si es más del doble de lo normal (>~14 minutos), avisar antes de seguir (podría necesitar un índice o ajuste, no bloquea la validación funcional pero sí importa para la corrida nocturna real).

---

### Task 6: Verificar el impacto real (antes vs. después)

**Files:**
- Create: `scripts/precalc/verificar_impacto.js`

**Interfaces:**
- Consumes: los datos ya recalculados por la Task 5.
- Produces: la confirmación numérica de que el problema (0,4% de artículos en quiebre mostrando "días quebrado") mejoró.

- [ ] **Step 1: Escribir el script de verificación**

```javascript
// scripts/precalc/verificar_impacto.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const pool = await sql.connect(dbConfig);

  const r1 = await pool.request().query(`
    SELECT COUNT(*) AS Total, SUM(CASE WHEN StockSemana=0 THEN 1 ELSE 0 END) AS FilasEnCero
    FROM dbo.MotorReposicion_StockSemanal
  `);
  console.log('MotorReposicion_StockSemanal ahora:', r1.recordset[0]);
  console.log('  (antes del cambio: Total=8.001.970, FilasEnCero=0 -- ahora FilasEnCero deberia ser un numero grande, no 0)');

  const r2 = await pool.request().query(`
    SELECT COUNT(*) AS FilasConQuiebreContribucion
    FROM dbo.MotorReposicion_DiasConStockPorSemana
    WHERE DiasQuiebreContribucion > 0
  `);
  console.log('Filas con DiasQuiebreContribucion > 0:', r2.recordset[0], '(antes del cambio: 6.981 de 8.001.970 -- deberia subir bastante)');

  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correrlo**

Run: `node scripts/precalc/verificar_impacto.js`
Expected: `FilasEnCero` ya no es 0 (debería acercarse al orden de las ~526.000 semanas que se esperaba rellenar), y `FilasConQuiebreContribucion` subió sensiblemente por encima de 6.981.

- [ ] **Step 3: Verificar el indicador principal (el 0,4% original) usando la API real de la app**

Requiere que `node server.js` esté corriendo (`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/` debe dar `200`; si no, levantarlo con `Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "." -WindowStyle Hidden`, esperar 2 segundos, y recién ahí seguir).

Run:
```bash
curl -s "http://localhost:3050/api/tablero/quiebre" -o /tmp_quiebre_post_fix.json
node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('/tmp_quiebre_post_fix.json','utf8'));
const cols = d.detalleColumnas; const idx = k=>cols.indexOf(k);
const rows = d.detalle.filter(r=>r[idx('estado')]==='QUIEBRE');
const conDias = rows.filter(r=>(r[idx('diasQuiebrePeriodo')]||0) > 0);
console.log('Filas QUIEBRE:', rows.length, '| con diasQuiebrePeriodo>0:', conDias.length, '| porcentaje:', (conDias.length/rows.length*100).toFixed(1)+'%');
"
rm -f /tmp_quiebre_post_fix.json
```

Expected: el porcentaje sube claramente por encima del 0,4% medido antes del cambio (no se puede predecir el número exacto, pero debe ser una mejora notoria, no marginal).

- [ ] **Step 4: Revisar a mano 2-3 combinaciones reales con quiebre, comparando contra `Vta_detalle`/`FotoStock` directamente**

```javascript
// scripts/precalc/spotcheck_combos_con_quiebre.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};
async function main() {
  const pool = await sql.connect(dbConfig);
  const combos = await pool.request().query(`
    SELECT TOP 3 Sucursal, CodArticulo, COLOR, TALLE, SUM(DiasQuiebreContribucion) AS DiasQuiebreTotal
    FROM dbo.MotorReposicion_DiasConStockPorSemana
    WHERE DiasQuiebreContribucion > 0
    GROUP BY Sucursal, CodArticulo, COLOR, TALLE
    ORDER BY SUM(DiasQuiebreContribucion) DESC
  `);
  for (const c of combos.recordset) {
    console.log('---', c.CodArticulo, c.COLOR, c.TALLE, c.Sucursal, '| DiasQuiebreTotal calculado:', c.DiasQuiebreTotal);
    const fotos = await pool.request()
      .input('suc', sql.VarChar(20), c.Sucursal).input('art', sql.VarChar(50), c.CodArticulo)
      .input('color', sql.VarChar(100), c.COLOR).input('talle', sql.VarChar(20), c.TALLE)
      .query(`SELECT TOP 10 fecha, stock FROM FotoStock WHERE Sucursal=@suc AND artprove=@art AND color=@color AND talle=@talle ORDER BY fecha DESC`);
    console.log('  Ultimas fotos reales (FotoStock):', fotos.recordset.map(f => f.fecha.toISOString().slice(0,10) + ':' + f.stock));
    const ventas = await pool.request()
      .input('suc', sql.VarChar(20), c.Sucursal).input('art', sql.VarChar(50), c.CodArticulo)
      .input('color', sql.VarChar(100), c.COLOR).input('talle', sql.VarChar(20), c.TALLE)
      .query(`SELECT TOP 10 FECHA, CANTIDAD FROM Vta_detalle WHERE ESTAB=@suc AND ARTCEGID=@art AND COLOR=@color AND TALLE=@talle ORDER BY FECHA DESC`);
    console.log('  Ultimas ventas reales (Vta_detalle):', ventas.recordset.map(v => v.FECHA.toISOString().slice(0,10) + ':' + v.CANTIDAD));
  }
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run: `node scripts/precalc/spotcheck_combos_con_quiebre.js`
Expected: para cada combinación, las fotos reales muestran huecos (semanas sin foto porque no había stock) consistentes con el `DiasQuiebreTotal` calculado, y las ventas reales (si las hay) caen dentro de las semanas que la Etapa 3 clasificó como "con stock" gracias al rescate -- no dentro de semanas que quedaron como quiebre puro.

---

### Task 7: Confirmar que la velocidad de artículos SIN huecos no cambió

**Files:**
- Create: `scripts/precalc/verificar_sin_regresion.js`

**Interfaces:**
- Consumes: los datos recalculados (Task 5) y un artículo real de referencia sin huecos conocido de esta misma sesión (KC1575-1074, color OFF WHITE-TEAM POWER RED 2, talle S, TESI SA).

- [ ] **Step 1: Escribir el script**

```javascript
// scripts/precalc/verificar_sin_regresion.js
require('dotenv').config();
const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const d = await get('http://localhost:3050/api/tablero/articulo?modelo=KC1575-1074&riesgoDias=3');
  const cols = d.detalleColumnas; const idx = k => cols.indexOf(k);
  const rows = d.detalle.filter(row => {
    const cat = d.catalogo[row[idx('sku')]];
    return cat && cat.color === 'OFF WHITE-TEAM POWER RED 2' && cat.talle === 'S' && row[idx('empresa')] === 'TESI';
  });
  const sumaVd = rows.reduce((a, r) => a + r[idx('vd')], 0);
  console.log('Suma de velocidad (KC1575-1074 / OFF WHITE-TEAM POWER RED 2 / S / TESI):', sumaVd.toFixed(4));
  console.log('Esperado (medido el 2026-08-18, antes de este cambio): 1.8869 -- debe seguir igual o muy cercano');
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Correrlo** (con `server.js` corriendo, igual que en la Task 6)

Run: `node scripts/precalc/verificar_sin_regresion.js`
Expected: `1.8869` o un número casi idéntico. Si cambió de forma notoria, investigar antes de dar el cambio por terminado -- este combo no debería tener huecos (fue el mismo que confirmamos con `MAX/MIN` positivo en toda la sesión).

---

### Task 8: Reiniciar el servidor y guardar todo en memoria

**Files:**
- Modify: (ninguno de código -- solo el proceso corriendo y la memoria del proyecto)

- [ ] **Step 1: Reiniciar `server.js`** (limpia el cache en memoria, que puede tener datos de antes del cambio)

Run (PowerShell):
```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "C:\Users\ClaudiaM\Motor Reposicion Nuevo" -WindowStyle Hidden
Start-Sleep -Seconds 2
```
Expected: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3050/` da `200`.

- [ ] **Step 2: Abrir la cuadrícula de cobertura de un artículo real conocido en quiebre y confirmar a simple vista que "días quebrado (período)" ya no muestra 0**

Manual, en el navegador: Quiebre → cualquier artículo en QUIEBRE → clic para abrir la cuadrícula de cobertura → mirar la línea "🕘 X episodios · Y días quebrado (período)".

- [ ] **Step 3: Guardar en memoria**

Actualizar `project_motor_reposicion_estado.md` (memoria del proyecto) con: qué se cambió, los números antes/después medidos en la Task 6, y la ubicación del backup y de los scripts nuevos en `scripts/precalc/`.
