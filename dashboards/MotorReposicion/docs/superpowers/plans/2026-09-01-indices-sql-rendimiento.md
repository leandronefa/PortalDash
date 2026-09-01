# Índices SQL para acelerar consultas de fecha en QUERY_QUIEBRE_DETALLE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un cambio de fecha a un rango NUEVO (cache-miss real en `cacheQuiebre`) corra más rápido, agregando índices cubrientes en `Vta_detalle` y `dis_transf_emitidas` — las dos tablas de millones de filas que `QUERY_QUIEBRE_DETALLE` sigue consultando en vivo, filtradas por fecha, en cada request.

**Architecture:** Dos índices no-clusterizados nuevos (aditivos, no se toca ningún índice existente), definidos en un archivo `.sql` versionado (mismo patrón que `sql/MotorReposicion_sp_PreCalcularStockSemanal.sql`), desplegados con un script Node siguiendo el mismo patrón que `scripts/precalc/desplegar_sp.js`. Se mide el tiempo real de `/api/tablero/quiebre` para combinaciones de fecha NUEVAS (forzando cache-miss) antes y después, contra la base real.

**Tech Stack:** SQL Server 2008 R2 (`db_Cegid` en `10.0.0.115`), Node.js + `mssql` para desplegar/medir (mismas dependencias ya instaladas).

**Spec:** `docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md` (sección 3)

## Global Constraints

- **Esta es la parte de mayor riesgo de los 3 planes de rendimiento**: toca tablas de producción de millones de filas (`Vta_detalle`: 8.743.786 filas; `dis_transf_emitidas`: 2.863.800 filas, conteo real verificado el 2026-09-01). NO ejecutar Task 3 (creación real de los índices) sin que Claudia confirme la ventana de mantenimiento explícitamente — los demás tasks (confirmar edición, backup, medición baseline) son de solo lectura y se pueden correr en cualquier momento.
- No hay test runner en este proyecto — verificación con scripts Node ad-hoc contra la base real (mismo patrón que `scripts/precalc/*.js` existentes) y medición de tiempos reales, no razonamiento teórico (regla ya establecida del proyecto).
- Los índices son ADITIVOS: no se borra ni modifica ningún índice existente, no se cambia ninguna consulta (`QUERY_QUIEBRE_DETALLE` sigue siendo texto idéntico) — el optimizador de SQL Server decide solo si usa el índice nuevo.
- Backup de la definición de índices ANTES de tocar nada (regla ya establecida del proyecto para cambios de esquema), guardado en `backups/<fecha>-indices-rendimiento-fechas/`.

---

### Task 1: Confirmar edición de SQL Server + medir baseline (solo lectura, se puede correr en cualquier momento)

**Files:**
- Create: `scripts/precalc/medir_tiempos_quiebre.js`

**Interfaces:**
- Produces: `scripts/precalc/_resultados_medicion_indices.json` (array de mediciones, con campo `etiqueta: "antes"|"despues"`) — consumido por Task 4 para la comparación final.

- [ ] **Step 1: Confirmar edición de SQL Server**

Crear un script chico descartable y correrlo una vez:

```bash
node -e "
require('dotenv').config();
const sql = require('mssql');
const dbConfig = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER, database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true } };
sql.connect(dbConfig).then(async (pool) => {
  const r = await pool.request().query(\"SELECT SERVERPROPERTY('Edition') AS Edicion, SERVERPROPERTY('ProductVersion') AS Version\");
  console.log(r.recordset[0]);
  await pool.close();
}).catch(e => { console.error(e); process.exit(1); });
"
```

Anotar el resultado (Edición y Versión) — determina si `CREATE INDEX ... WITH (ONLINE=ON)` está disponible en Task 3 (solo Enterprise/Developer lo soportan en SQL Server 2008 R2).

- [ ] **Step 2: Escribir el script de medición**

Crear `scripts/precalc/medir_tiempos_quiebre.js`:

```js
// scripts/precalc/medir_tiempos_quiebre.js
// Uso: node scripts/precalc/medir_tiempos_quiebre.js antes|despues
// Mide el tiempo real de /api/tablero/quiebre (servidor local, puerto 3050) para 3 combinaciones
// de fecha que NO son el combo default (para forzar cache-miss real en cacheQuiebre y medir el
// camino completo contra SQL Server, no una respuesta ya cacheada). Requiere el servidor corriendo
// (`npm start`).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTO = process.env.PORT || 3050;
const ARCHIVO_RESULTADOS = path.join(__dirname, '_resultados_medicion_indices.json');

// 3 combinaciones reales distintas, elegidas para no pisar el combo default (ultimos 90/365 dias) --
// asi cada corrida es garantizado un cache-miss real, no una que ya quedo tibia de una corrida previa.
const COMBOS = [
  { desde: '2025-11-01', hasta: '2026-01-31', ucDesde: '2025-01-01', ucHasta: '2025-12-31' },
  { desde: '2025-06-01', hasta: '2025-08-31', ucDesde: '2024-06-01', ucHasta: '2025-05-31' },
  { desde: '2026-02-01', hasta: '2026-04-30', ucDesde: '2025-04-01', ucHasta: '2026-03-31' },
];

function pedir(params) {
  const qs = new URLSearchParams({ ...params, riesgoDias: '3' }).toString();
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    http.get(`http://127.0.0.1:${PUERTO}/api/tablero/quiebre?${qs}`, (res) => {
      res.on('data', () => {}); // descartamos el body, solo nos importa el tiempo total
      res.on('end', () => resolve({ ms: Date.now() - inicio, status: res.statusCode }));
    }).on('error', reject);
  });
}

async function main() {
  const etiqueta = process.argv[2];
  if (etiqueta !== 'antes' && etiqueta !== 'despues') {
    throw new Error('Uso: node scripts/precalc/medir_tiempos_quiebre.js antes|despues');
  }
  const resultados = [];
  for (const combo of COMBOS) {
    const r = await pedir(combo);
    console.log(`${JSON.stringify(combo)} -> ${r.ms}ms (status ${r.status})`);
    resultados.push({ etiqueta, combo, ms: r.ms, timestamp: new Date().toISOString() });
  }
  const previos = fs.existsSync(ARCHIVO_RESULTADOS) ? JSON.parse(fs.readFileSync(ARCHIVO_RESULTADOS, 'utf8')) : [];
  fs.writeFileSync(ARCHIVO_RESULTADOS, JSON.stringify([...previos, ...resultados], null, 2));
  console.log(`Guardado en ${ARCHIVO_RESULTADOS}`);
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Correr la medición baseline**

Con el servidor local corriendo contra la base real:

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
node scripts/precalc/medir_tiempos_quiebre.js antes
```

Expected: 3 líneas con tiempos en ms (probablemente varios segundos cada una, al ser cache-miss real). Confirmar que `scripts/precalc/_resultados_medicion_indices.json` tiene 3 entradas con `"etiqueta": "antes"`.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add scripts/precalc/medir_tiempos_quiebre.js scripts/precalc/_resultados_medicion_indices.json
git commit -m "chore(motor-reposicion): script de medicion de tiempos + baseline antes de indices nuevos"
```

---

### Task 2: Backup de índices actuales + archivo SQL versionado de los índices nuevos

**Files:**
- Create: `backups/2026-09-01-indices-rendimiento-fechas/indices_antes.txt`
- Create: `sql/2026-09-01_indices_rendimiento_fechas.sql`

**Interfaces:**
- Produces: el archivo `.sql` con las 2 sentencias `CREATE INDEX`, consumido por Task 3 (desplegar).

- [ ] **Step 1: Backup de la definición de índices actuales**

```bash
node -e "
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const dbConfig = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER, database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true } };
sql.connect(dbConfig).then(async (pool) => {
  let out = '';
  for (const t of ['Vta_detalle', 'dis_transf_emitidas']) {
    const r = await pool.request().query(\`
      SELECT i.name, i.type_desc,
             STUFF((SELECT ', ' + c.name FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=0 ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '') AS columnas,
             STUFF((SELECT ', ' + c.name FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=1 ORDER BY c.name FOR XML PATH('')), 1, 2, '') AS incluidas
      FROM sys.indexes i WHERE i.object_id=OBJECT_ID('${t}') AND i.type>0 ORDER BY i.index_id
    \`);
    out += '=== ' + t + ' ===\n' + JSON.stringify(r.recordset, null, 2) + '\n\n';
  }
  fs.writeFileSync('backups/2026-09-01-indices-rendimiento-fechas/indices_antes.txt', out);
  console.log('Backup guardado.');
  await pool.close();
}).catch(e => { console.error(e); process.exit(1); });
"
```

(Crear la carpeta `backups/2026-09-01-indices-rendimiento-fechas/` antes si no existe.)

- [ ] **Step 2: Escribir el archivo SQL versionado**

Crear `sql/2026-09-01_indices_rendimiento_fechas.sql`:

```sql
-- Indices no-clusterizados cubrientes para acelerar QUERY_QUIEBRE_DETALLE (server.js) cuando se
-- pide un rango de fechas NUEVO (cache-miss en cacheQuiebre). Aditivos: no se toca ningun indice
-- existente. Ver docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md, seccion 3, para
-- el analisis completo (conteo de filas real, indices existentes, por que estas columnas puntuales).
--
-- IF NOT EXISTS: seguro de correr mas de una vez sin error si ya se aplico antes.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VtaDetalle_Fecha_Cubriente' AND object_id = OBJECT_ID('Vta_detalle'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_VtaDetalle_Fecha_Cubriente
    ON Vta_detalle (FECHA)
    INCLUDE (ESTAB, ARTCEGID, COLOR, TALLE, CANTIDAD, NUMERO, CODBARRA_prin);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisTransfEmitidas_Fecha_Cubriente' AND object_id = OBJECT_ID('dis_transf_emitidas'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_DisTransfEmitidas_Fecha_Cubriente
    ON dis_transf_emitidas (fecha)
    INCLUDE (destino, arprove, color, talle, cantpend);
END
```

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add backups/2026-09-01-indices-rendimiento-fechas/indices_antes.txt sql/2026-09-01_indices_rendimiento_fechas.sql
git commit -m "chore(motor-reposicion): backup de indices actuales + script versionado de indices nuevos (sin aplicar todavia)"
```

---

### Task 3: Desplegar los índices — REQUIERE CONFIRMACIÓN EXPLÍCITA DE CLAUDIA ANTES DE CORRER

**⚠️ No ejecutar este task sin que Claudia confirme la ventana de mantenimiento.** Crear un índice en una tabla de millones de filas puede bloquear lecturas/escrituras sobre esa tabla mientras corre (en SQL Server Standard, sin `ONLINE=ON` — ver resultado de Task 1). Coordinar con horario de bajo uso (de noche, después del precálculo de las 06:30).

**Files:**
- Create: `scripts/precalc/desplegar_indices_rendimiento.js`

**Interfaces:**
- Consumes: `sql/2026-09-01_indices_rendimiento_fechas.sql` (Task 2).

- [ ] **Step 1: Escribir el script de despliegue**

Crear `scripts/precalc/desplegar_indices_rendimiento.js`:

```js
// scripts/precalc/desplegar_indices_rendimiento.js
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 30 * 60 * 1000, // 30 minutos -- crear indice en tablas de millones de filas puede tardar
};

async function main() {
  const rutaSql = path.join(__dirname, '..', '..', 'sql', '2026-09-01_indices_rendimiento_fechas.sql');
  const texto = fs.readFileSync(rutaSql, 'utf8');

  const pool = await sql.connect(dbConfig);
  const inicio = Date.now();
  await pool.request().query(texto);
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`Indices creados (o ya existian) en ${segundos} segundos.`);

  const verificar = await pool.request().query(`
    SELECT name, object_id FROM sys.indexes
    WHERE name IN ('IX_VtaDetalle_Fecha_Cubriente', 'IX_DisTransfEmitidas_Fecha_Cubriente')
  `);
  console.log('Indices confirmados en sys.indexes:', verificar.recordset);
  if (verificar.recordset.length !== 2) {
    console.error('ERROR: se esperaban 2 indices, se encontraron', verificar.recordset.length);
    await pool.close();
    process.exit(1);
  }
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Ejecutar en la ventana de mantenimiento acordada**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
node scripts/precalc/desplegar_indices_rendimiento.js
```

Expected: "Indices creados (o ya existian) en N segundos." + confirmación de 2 filas en `sys.indexes`.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add scripts/precalc/desplegar_indices_rendimiento.js
git commit -m "chore(motor-reposicion): script de despliegue de indices de rendimiento (aplicado en produccion)"
```

---

### Task 4: Medir "después", comparar contra baseline, documentar en CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (agregar una entrada corta, mismo estilo que las existentes con fecha)

- [ ] **Step 1: Correr la medición "después"**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
node scripts/precalc/medir_tiempos_quiebre.js despues
```

(Nota: los 3 combos de `medir_tiempos_quiebre.js` ya fueron pedidos en el Task 1 con etiqueta "antes" — eso los dejó cacheados en `cacheQuiebre`, así que una segunda corrida ahora daría cache-HIT, no una medición real del efecto del índice. Antes de correr este step, reiniciar el servidor Node — `cacheQuiebre` es un `Map` en memoria, se vacía solo al reiniciar el proceso — para forzar cache-miss real de nuevo con los índices ya puestos.)

- [ ] **Step 2: Comparar resultados**

```bash
node -e "
const r = require('./scripts/precalc/_resultados_medicion_indices.json');
const antes = r.filter(x => x.etiqueta === 'antes');
const despues = r.filter(x => x.etiqueta === 'despues');
antes.forEach((a, i) => {
  const d = despues[i];
  console.log(JSON.stringify(a.combo), '-', a.ms, 'ms ->', d ? d.ms + 'ms' : '(falta)', d ? \`(\${Math.round((1 - d.ms/a.ms)*100)}% mas rapido)\` : '');
});
"
```

- [ ] **Step 3: Documentar en CLAUDE.md**

Agregar una entrada en `CLAUDE.md`, siguiendo el estilo de las secciones existentes con fecha (ej. junto a la sección de índices/rendimiento si existe, o como nueva entrada al final antes de "Reglas de trabajo"):

```markdown
## Índices de rendimiento en Vta_detalle / dis_transf_emitidas (2026-09-01)

Se agregaron 2 índices no-clusterizados cubrientes (`sql/2026-09-01_indices_rendimiento_fechas.sql`)
para acelerar `QUERY_QUIEBRE_DETALLE` ante un cambio de fecha nuevo (cache-miss en `cacheQuiebre`):
`IX_VtaDetalle_Fecha_Cubriente` (FECHA, con ESTAB/ARTCEGID/COLOR/TALLE/CANTIDAD/NUMERO/CODBARRA_prin
incluidas) e `IX_DisTransfEmitidas_Fecha_Cubriente` (fecha, con destino/arprove/color/talle/cantpend
incluidas). Medido antes/después con `scripts/precalc/medir_tiempos_quiebre.js` contra 3
combinaciones de fecha reales: [completar con los números reales de la comparación del Step 2 antes
de dar esta tarea por cerrada].
```

(El corchete de "completar con los números reales" se reemplaza con los valores concretos obtenidos en el Step 2 — no se deja como placeholder en el commit final.)

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add CLAUDE.md scripts/precalc/_resultados_medicion_indices.json
git commit -m "docs(motor-reposicion): documentar resultado real de los indices de rendimiento de fechas"
```

---

## Self-Review (completado durante la escritura de este plan)

- **Cobertura del spec:** Sección 3 del spec ("Índices nuevos en SQL Server") — los 5 puntos de la lista de "antes de aplicar en producción" del spec están cubiertos: edición de SQL Server (Task 1), backup (Task 2), ventana de mantenimiento (Task 3, con advertencia explícita), medir antes/después (Tasks 1 y 4). El punto 5 del spec ("si la creación tarda demasiado, considerar ONLINE=ON o coordinar aparte") queda como decisión a tomar en el momento de Task 3 según lo que confirme Task 1, no se puede resolver de antemano sin saber la edición real.
- **Placeholders:** el único texto entre corchetes ("completar con los números reales...") es intencional — es una instrucción explícita de reemplazo antes de cerrar la tarea, no un placeholder dejado sin resolver; el Step aclara que no se commitea así.
- **Consistencia de nombres:** `IX_VtaDetalle_Fecha_Cubriente`/`IX_DisTransfEmitidas_Fecha_Cubriente` son los mismos en el archivo `.sql` (Task 2), el script de despliegue (Task 3) y la verificación (Task 3, `sys.indexes`).
