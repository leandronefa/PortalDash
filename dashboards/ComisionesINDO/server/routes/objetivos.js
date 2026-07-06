import { Router } from 'express';
import { getPoolBC, sql } from '../config/dbBeClever.js';
import { getPool } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

function parsePeriodo(p) {
  if (!p) return null;
  const [y, m] = p.split('-').map(Number);
  if (!y || !m) return null;
  return { year: y, month: m };
}

// Ids de sucursales deshabilitadas (activa=0) — se ocultan en los GET del visor
async function getInactivasSet() {
  const pool = await getPool();
  const r = await pool.request()
    .query('SELECT id FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE activa = 0');
  return new Set(r.recordset.map(x => x.id));
}

// Cache automático en db_Cegid al consultar objetivos
async function cacheConsumo(periodo, rows) {
  const pool = await getPool();
  await pool.request().input('p', sql.VarChar, periodo)
    .query('DELETE FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@p');
  for (const row of rows) {
    await pool.request()
      .input('suc',  sql.Int,     row.sucursal_id)
      .input('per',  sql.VarChar, periodo)
      .input('pe',   sql.Float,   row.OBJETIVO_VENTAS      || 0)
      .input('part', sql.Float,   (row.OBJETIVO_PARTICIPA   || 0) / 100)
      .input('cp',   sql.Float,   row.OBJETIVO_CREDPRO     || 0)
      .input('op',   sql.Float,   row.OBJETIVO_OPERACIONES || 0)
      .input('cob',  sql.Float,   row.OBJETIVO_COBRANZAS   || 0)
      .query(`INSERT INTO dbo.tbl_CoVenAppINDO_ObjConsumo
                (sucursal_id,periodo,primer_escalon,participacion,credito_promedio,operaciones,cobranza,dias)
              VALUES (@suc,@per,@pe,@part,@cp,@op,@cob,0)`);
  }
}

async function cacheEfectivo(periodo, rows) {
  const pool = await getPool();
  await pool.request().input('p', sql.VarChar, periodo)
    .query('DELETE FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@p');
  for (const row of rows) {
    await pool.request()
      .input('suc',  sql.Int,     row.sucursal_id)
      .input('per',  sql.VarChar, periodo)
      .input('pe',   sql.Float,   row.OBJETIVO_VENTAS_EFE      || 0)
      .input('cp',   sql.Float,   row.OBJETIVO_CREDPRO_EFE     || 0)
      .input('op',   sql.Float,   row.OBJETIVO_OPERACIONES_EFE || 0)
      .query(`INSERT INTO dbo.tbl_CoVenAppINDO_ObjEfectivo
                (sucursal_id,periodo,primer_escalon,credito_promedio,operaciones,dias)
              VALUES (@suc,@per,@pe,@cp,@op,0)`);
  }
}

async function fetchConsumoBC(pm) {
  const pool = await getPoolBC();
  const r = await pool.request()
    .input('anio', sql.Int, pm.year)
    .input('mes',  sql.Int, pm.month)
    .query(`
      SELECT o.SUCURSAL           as sucursal_id,
             RTRIM(c.Descripcion) as sucursal_nombre,
             o.OBJETIVO_VENTAS, o.OBJETIVO_COBRANZAS,
             o.OBJETIVO_OPERACIONES, o.OBJETIVO_PARTICIPA, o.OBJETIVO_CREDPRO
      FROM METRIX.dbo.OBJETIVOS_MILLON o
      LEFT JOIN dbo.COMERCIO c ON c.Cod_Comercio = o.SUCURSAL
      WHERE o.ANIO = @anio AND o.MES = @mes
      ORDER BY o.SUCURSAL
    `);
  return r.recordset;
}

async function fetchEfectivoBC(pm) {
  const pool = await getPoolBC();
  const r = await pool.request()
    .input('anio', sql.Int, pm.year)
    .input('mes',  sql.Int, pm.month)
    .query(`
      SELECT o.SUCURSAL               as sucursal_id,
             RTRIM(c.Descripcion)     as sucursal_nombre,
             o.OBJETIVO_VENTAS_EFE, o.OBJETIVO_COBRANZAS_EFE,
             o.OBJETIVO_OPERACIONES_EFE, o.OBJETIVO_PARTICIPA_EFE, o.OBJETIVO_CREDPRO_EFE
      FROM METRIX.dbo.OBJETIVOS_MILLON o
      LEFT JOIN dbo.COMERCIO c ON c.Cod_Comercio = o.SUCURSAL
      WHERE o.ANIO = @anio AND o.MES = @mes AND o.SUCURSAL < 300
      ORDER BY o.SUCURSAL
    `);
  return r.recordset;
}

// Descarga los objetivos (consumo + efectivo) desde BeClever y los persiste
// en ObjConsumo/ObjEfectivo. Antes esto solo pasaba al entrar a cada solapa
// de la página Objetivos — se usa también desde POST /api/calculo/ejecutar
// para que el cálculo nunca corra con objetivos viejos o vacíos.
export async function sincronizarObjetivos(periodo) {
  const pm = parsePeriodo(periodo);
  if (!pm) throw new Error(`Período inválido: ${periodo}`);
  // Secuencial: el pool de BeClever no tolera queries en paralelo (ECONNCLOSED)
  const consumo  = await fetchConsumoBC(pm);
  const efectivo = await fetchEfectivoBC(pm);
  await cacheConsumo(periodo, consumo);
  await cacheEfectivo(periodo, efectivo);
  return { consumo: consumo.length, efectivo: efectivo.length };
}

// CONSUMO
router.get('/consumo', async (req, res) => {
  const pm = parsePeriodo(req.query.periodo);
  if (!pm) return res.status(400).json({ error: 'Parámetro periodo requerido (YYYY-MM)' });
  try {
    const rows = await fetchConsumoBC(pm);
    const inactivas = await getInactivasSet();
    res.json(rows.filter(r => !inactivas.has(r.sucursal_id)));
    cacheConsumo(req.query.periodo, rows)
      .catch(e => console.error('[OBJ cache consumo]', e.message));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// EFECTIVO
router.get('/efectivo', async (req, res) => {
  const pm = parsePeriodo(req.query.periodo);
  if (!pm) return res.status(400).json({ error: 'Parámetro periodo requerido (YYYY-MM)' });
  try {
    const rows = await fetchEfectivoBC(pm);
    const inactivas = await getInactivasSet();
    res.json(rows.filter(r => !inactivas.has(r.sucursal_id)));
    cacheEfectivo(req.query.periodo, rows)
      .catch(e => console.error('[OBJ cache efectivo]', e.message));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

export default router;
