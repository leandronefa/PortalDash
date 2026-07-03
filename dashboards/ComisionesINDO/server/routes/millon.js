import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { getPoolBC } from '../config/dbBeClever.js';
import { authMiddleware } from '../middleware/auth.js';
import { calcularOperadoresMillon } from '../services/calcEngine.js';

const router = Router();
router.use(authMiddleware);

// ── Setup de tablas ────────────────────────────────────────────────────────────

async function ensureResultTable(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tbl_CoVenAppINDO_ResultadoOpMillon')
    CREATE TABLE dbo.tbl_CoVenAppINDO_ResultadoOpMillon (
      id              INT IDENTITY PRIMARY KEY,
      periodo         VARCHAR(7)    NOT NULL,
      usuario         VARCHAR(50)   NOT NULL,
      nombre          VARCHAR(100)  NULL,
      sucursal_id     INT           NOT NULL,
      sucursal_nombre VARCHAR(100)  NULL,
      categoria       CHAR(1)       NULL,
      vta_efectivo    DECIMAL(14,2) NOT NULL DEFAULT 0,
      obj_sucursal    DECIMAL(14,2) NOT NULL DEFAULT 0,
      n_operadores    INT           NOT NULL DEFAULT 1,
      obj_individual  DECIMAL(14,2) NOT NULL DEFAULT 0,
      ratio           DECIMAL(8,4)  NOT NULL DEFAULT 0,
      escalon         INT           NOT NULL DEFAULT 0,
      comisiona       BIT           NOT NULL DEFAULT 0,
      jornada         VARCHAR(10)   NULL,
      monto_full      DECIMAL(14,2) NOT NULL DEFAULT 0,
      monto_part      DECIMAL(14,2) NOT NULL DEFAULT 0,
      monto           DECIMAL(14,2) NOT NULL DEFAULT 0,
      fecha_calculo   DATETIME      NOT NULL DEFAULT GETDATE()
    )
  `);
}

async function ensureTables(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tbl_CoVenAppINDO_MillonCache')
    CREATE TABLE dbo.tbl_CoVenAppINDO_MillonCache (
      id                INT IDENTITY PRIMARY KEY,
      periodo           VARCHAR(7)    NOT NULL,
      sucursal_id       INT           NOT NULL,
      sucursal          VARCHAR(200)  NOT NULL,
      operador          VARCHAR(100)  NOT NULL,
      total_operaciones INT           NOT NULL DEFAULT 0,
      total_importe     DECIMAL(14,2) NOT NULL DEFAULT 0,
      fecha_carga       DATETIME      NOT NULL DEFAULT GETDATE()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tbl_CoVenAppINDO_MillonOperadores')
    CREATE TABLE dbo.tbl_CoVenAppINDO_MillonOperadores (
      id          INT IDENTITY PRIMARY KEY,
      periodo     VARCHAR(7)   NOT NULL DEFAULT '',
      sucursal_id INT          NOT NULL,
      operador    VARCHAR(100) NOT NULL,
      es_operador BIT          NOT NULL DEFAULT 1,
      CONSTRAINT UQ_MillonOp UNIQUE (periodo, sucursal_id, operador)
    )
  `);
  // Migración: agregar columna periodo si la tabla ya existía sin ella
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.tbl_CoVenAppINDO_MillonOperadores') AND name = 'periodo'
    )
    BEGIN
      ALTER TABLE dbo.tbl_CoVenAppINDO_MillonOperadores ADD periodo VARCHAR(7) NOT NULL DEFAULT ''
      IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_MillonOp')
        ALTER TABLE dbo.tbl_CoVenAppINDO_MillonOperadores DROP CONSTRAINT UQ_MillonOp
      ALTER TABLE dbo.tbl_CoVenAppINDO_MillonOperadores
        ADD CONSTRAINT UQ_MillonOp UNIQUE (periodo, sucursal_id, operador)
    END
  `);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getMillonSucursalIds(bcPool) {
  const r = await bcPool.request().query(
    "SELECT Cod_Comercio FROM dbo.COMERCIO WHERE RTRIM(Descripcion) LIKE 'MILLON%'"
  );
  return new Set(r.recordset.map(x => x.Cod_Comercio));
}

// Llama BeClever y devuelve filas agrupadas por sucursal+operador
async function fetchResumenFromBC(periodo) {
  const [yr, mo] = periodo.split('-').map(Number);
  const bcPool   = await getPoolBC();
  const milonIds = await getMillonSucursalIds(bcPool);
  const spR = await bcPool.request()
    .input('Anio', sql.Int, yr)
    .input('Mes',  sql.Int, mo)
    .execute('dbo.sp_ReporteOriginacionesCreditos');

  // Planes excluidos del cómputo de venta efectivo Millón
  const PLANES_EXCLUIDOS = new Set([24, 29, 41, 44, 45, 46]);

  const map = {};
  for (const r of spR.recordset) {
    if (!milonIds.has(r.IdSucursalEntidad)) continue;
    if (PLANES_EXCLUIDOS.has(r.IdPlan)) continue;
    const key = `${r.IdSucursalEntidad}|${(r.IdUsuario || '').toUpperCase().trim()}`;
    if (!map[key]) map[key] = {
      sucursal_id:       r.IdSucursalEntidad,
      sucursal:          r.SucDes,
      operador:          (r.IdUsuario || '').toUpperCase().trim(),
      total_operaciones: 0,
      total_importe:     0,
    };
    map[key].total_operaciones++;
    map[key].total_importe += r.ImpFin || 0;
  }
  return Object.values(map).map(r => ({ ...r, total_importe: +r.total_importe.toFixed(2) }));
}

// Persiste en cache (reemplaza el período completo)
async function saveCache(pool, periodo, rows) {
  await pool.request()
    .input('periodo', sql.VarChar(7), periodo)
    .query(`DELETE FROM dbo.tbl_CoVenAppINDO_MillonCache WHERE periodo = @periodo`);

  for (const r of rows) {
    await pool.request()
      .input('periodo', sql.VarChar(7),    periodo)
      .input('suc_id',  sql.Int,           r.sucursal_id)
      .input('sucursal',sql.VarChar(200),  r.sucursal)
      .input('operador',sql.VarChar(100),  r.operador)
      .input('ops',     sql.Int,           r.total_operaciones)
      .input('importe', sql.Decimal(14,2), r.total_importe)
      .query(`
        INSERT INTO dbo.tbl_CoVenAppINDO_MillonCache
          (periodo, sucursal_id, sucursal, operador, total_operaciones, total_importe)
        VALUES (@periodo, @suc_id, @sucursal, @operador, @ops, @importe)
      `);
  }
}

// Lee desde cache + flags y devuelve la respuesta combinada
async function buildResponse(pool, periodo) {
  const [cacheR, flagsR] = await Promise.all([
    pool.request()
      .input('periodo', sql.VarChar(7), periodo)
      .query(`SELECT * FROM dbo.tbl_CoVenAppINDO_MillonCache
              WHERE periodo = @periodo
              ORDER BY sucursal_id, operador`),
    pool.request()
      .input('periodo', sql.VarChar(7), periodo)
      .query(`SELECT sucursal_id, operador, es_operador
              FROM dbo.tbl_CoVenAppINDO_MillonOperadores
              WHERE periodo = @periodo`),
  ]);

  const flags = {};
  for (const f of flagsR.recordset)
    flags[`${f.sucursal_id}|${f.operador}`] = !!f.es_operador;

  const fecha_carga = cacheR.recordset[0]?.fecha_carga ?? null;

  const bySuc = {};
  for (const r of cacheR.recordset) {
    if (!bySuc[r.sucursal_id])
      bySuc[r.sucursal_id] = { sucursal_id: r.sucursal_id, sucursal: r.sucursal, operadores: [] };
    bySuc[r.sucursal_id].operadores.push({
      operador:          r.operador,
      total_operaciones: r.total_operaciones,
      total_importe:     +r.total_importe,
      es_operador:       flags[`${r.sucursal_id}|${r.operador}`] ?? true,
    });
  }

  return {
    fecha_carga,
    desde_cache: true,
    sucursales: Object.values(bySuc).sort((a, b) => a.sucursal_id - b.sucursal_id),
  };
}

// ── Endpoints ──────────────────────────────────────────────────────────────────

// GET /api/millon/sucursales?periodo=YYYY-MM
// Sirve desde cache local; si no hay cache para el período, carga desde BeClever.
router.get('/sucursales', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    await ensureTables(pool);

    // ¿Hay cache para este período?
    const check = await pool.request()
      .input('periodo', sql.VarChar(7), periodo)
      .query(`SELECT TOP 1 1 FROM dbo.tbl_CoVenAppINDO_MillonCache WHERE periodo = @periodo`);

    if (!check.recordset.length) {
      // Primera carga: llamar BeClever y guardar
      const rows = await fetchResumenFromBC(periodo);
      await saveCache(pool, periodo, rows);
    }

    res.json(await buildResponse(pool, periodo));
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// POST /api/millon/cache/refresh?periodo=YYYY-MM
// Fuerza re-fetch desde BeClever y actualiza el cache.
router.post('/cache/refresh', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const rows = await fetchResumenFromBC(periodo);
    await saveCache(pool, periodo, rows);
    res.json(await buildResponse(pool, periodo));
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// PATCH /api/millon/operadores — upsert es_operador (por período)
router.patch('/operadores', async (req, res) => {
  const { sucursal_id, operador, es_operador, periodo } = req.body;
  if (!sucursal_id || !operador || typeof es_operador !== 'boolean' || !periodo)
    return res.status(400).json({ error: 'sucursal_id, operador, es_operador y periodo requeridos' });
  try {
    const pool = await getPool();
    await ensureTables(pool);
    await pool.request()
      .input('periodo',     sql.VarChar(7),   periodo)
      .input('suc_id',      sql.Int,          sucursal_id)
      .input('operador',    sql.VarChar(100),  operador.toUpperCase().trim())
      .input('es_operador', sql.Bit,           es_operador ? 1 : 0)
      .query(`
        MERGE dbo.tbl_CoVenAppINDO_MillonOperadores AS t
        USING (SELECT @periodo AS periodo, @suc_id AS sucursal_id, @operador AS operador) AS s
          ON t.periodo = s.periodo AND t.sucursal_id = s.sucursal_id AND t.operador = s.operador
        WHEN MATCHED    THEN UPDATE SET es_operador = @es_operador
        WHEN NOT MATCHED THEN INSERT (periodo, sucursal_id, operador, es_operador)
                              VALUES (@periodo, @suc_id, @operador, @es_operador);
      `);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── Endpoints Operadores Millón ────────────────────────────────────────────────

// GET /api/millon/operadores/resultado?periodo=YYYY-MM
router.get('/operadores/resultado', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    await ensureResultTable(pool);
    const r = await pool.request()
      .input('periodo', sql.VarChar(7), periodo)
      .query(`
        SELECT * FROM dbo.tbl_CoVenAppINDO_ResultadoOpMillon
        WHERE periodo = @periodo
        ORDER BY sucursal_id, nombre
      `);
    if (!r.recordset.length)
      return res.status(404).json({ error: 'Sin cálculo guardado para este período' });
    const rows = r.recordset;
    res.json({
      periodo,
      fecha_calculo: rows[0].fecha_calculo,
      total:         rows.length,
      comisionan:    rows.filter(r => r.comisiona).length,
      total_monto:   rows.reduce((s, r) => s + (+r.monto || 0), 0),
      resultado:     rows,
    });
  } catch (err) { console.error('[OP_MILLON GET]', err); res.status(500).json({ error: err.message }); }
});

// POST /api/millon/operadores/calcular
router.post('/operadores/calcular', async (req, res) => {
  const { periodo } = req.body;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    const resultado = await calcularYGuardarOperadoresMillon(pool, periodo);
    res.json(resultado);
  } catch (err) { console.error('[OP_MILLON CALC]', err); res.status(500).json({ error: err.message }); }
});

// Recalcula Operadores Millón (venta efectivo vs objetivo individual) y persiste
// en tbl_CoVenAppINDO_ResultadoOpMillon. Se usa desde /operadores/calcular y desde
// POST /api/calculo/ejecutar (Dashboard) — cálculo puro, sin overrides de usuario.
export async function calcularYGuardarOperadoresMillon(pool, periodo) {
    await ensureTables(pool);
    await ensureResultTable(pool);

    // 1) Asegurar cache para el período
    const check = await pool.request()
      .input('periodo', sql.VarChar(7), periodo)
      .query(`SELECT TOP 1 1 FROM dbo.tbl_CoVenAppINDO_MillonCache WHERE periodo = @periodo`);
    if (!check.recordset.length) {
      const rows = await fetchResumenFromBC(periodo);
      await saveCache(pool, periodo, rows);
    }

    // 2) Leer datos en paralelo
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

    const rankingMap = {};
    for (const r of rankingR.recordset) rankingMap[r.sucursal_id] = r;
    const operadorMap = {};
    for (const u of qlikR.recordset) operadorMap[u.id_usuario] = u.nombre;
    const jornadasMap = {};
    for (const j of jornadaR.recordset) jornadasMap[j.usuario.toUpperCase()] = j.jornada;

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

    const operadores = calcularOperadoresMillon(ctx);

    // 3) Guardar resultado (borrar período y reinsertar)
    await pool.request()
      .input('periodo', sql.VarChar(7), periodo)
      .query(`DELETE FROM dbo.tbl_CoVenAppINDO_ResultadoOpMillon WHERE periodo = @periodo`);

    for (const op of operadores) {
      await pool.request()
        .input('periodo',         sql.VarChar(7),    periodo)
        .input('usuario',         sql.VarChar(50),   op.usuario)
        .input('nombre',          sql.NVarChar(100), op.nombre)
        .input('sucursal_id',     sql.Int,           op.sucursal_id)
        .input('sucursal_nombre', sql.NVarChar(100), op.sucursal_nombre)
        .input('categoria',       sql.Char(1),       op.categoria)
        .input('vta_efectivo',    sql.Decimal(14,2), op.vta_efectivo)
        .input('obj_sucursal',    sql.Decimal(14,2), op.obj_sucursal)
        .input('n_operadores',    sql.Int,           op.n_operadores)
        .input('obj_individual',  sql.Decimal(14,2), op.obj_individual)
        .input('ratio',           sql.Decimal(8,4),  op.ratio)
        .input('escalon',         sql.Int,           op.escalon)
        .input('comisiona',       sql.Bit,           op.comisiona ? 1 : 0)
        .input('jornada',         sql.VarChar(10),   op.jornada)
        .input('monto_full',      sql.Decimal(14,2), op.monto_full)
        .input('monto_part',      sql.Decimal(14,2), op.monto_part)
        .input('monto',           sql.Decimal(14,2), op.monto)
        .query(`
          INSERT INTO dbo.tbl_CoVenAppINDO_ResultadoOpMillon
            (periodo,usuario,nombre,sucursal_id,sucursal_nombre,categoria,
             vta_efectivo,obj_sucursal,n_operadores,obj_individual,ratio,escalon,
             comisiona,jornada,monto_full,monto_part,monto,fecha_calculo)
          VALUES
            (@periodo,@usuario,@nombre,@sucursal_id,@sucursal_nombre,@categoria,
             @vta_efectivo,@obj_sucursal,@n_operadores,@obj_individual,@ratio,@escalon,
             @comisiona,@jornada,@monto_full,@monto_part,@monto,GETDATE())
        `);
    }

    return {
      periodo,
      total:       operadores.length,
      comisionan:  operadores.filter(o => o.comisiona).length,
      total_monto: operadores.reduce((s, o) => s + o.monto, 0),
      resultado:   operadores,
    };
}

// GET /api/millon?periodo=  y  GET /api/millon/resumen?periodo=
// Mantenidos por compatibilidad — sirven desde cache si existe, sino BeClever.
router.get('/', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const [yr, mo] = periodo.split('-').map(Number);
    const bcPool = await getPoolBC();
    const milonIds = await getMillonSucursalIds(bcPool);
    const spR = await bcPool.request()
      .input('Anio', sql.Int, yr)
      .input('Mes',  sql.Int, mo)
      .execute('dbo.sp_ReporteOriginacionesCreditos');
    const rows = spR.recordset
      .filter(r => milonIds.has(r.IdSucursalEntidad))
      .map(r => ({
        id_originacion: r.IdOriginacion,
        estado:  r.Des,        operador:    r.IdUsuario,
        fecha:   r.FecAlt,     producto:    r.ProdDesc,
        importe: r.ImpFin,     cuotas:      r.CanCuo,
        id_prestamo: r.Val ? parseInt(r.Val, 10) : null,
        sucursal_id: r.IdSucursalEntidad,
        sucursal:    r.SucDes, id_plan:     r.IdPlan,
      }));
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.get('/resumen', async (req, res) => {
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

    const r = await pool.request()
      .input('periodo', sql.VarChar(7), periodo)
      .query(`SELECT sucursal_id, sucursal, operador, total_operaciones, total_importe
              FROM dbo.tbl_CoVenAppINDO_MillonCache
              WHERE periodo = @periodo
              ORDER BY sucursal_id, operador`);
    res.json(r.recordset);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

export default router;
