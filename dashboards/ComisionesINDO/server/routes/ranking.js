import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { getPoolBC } from '../config/dbBeClever.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ── Migración: agrega columnas si no existen ──────────────────────────────────
async function ensureColumns(pool) {
  const cols = [
    { name: 'posicion',       def: 'INT NULL' },
    { name: 'grupo',          def: "VARCHAR(10) NULL" },
    { name: 'venta_consumo',  def: 'DECIMAL(14,2) NULL' },
    { name: 'venta_efectivo', def: 'DECIMAL(14,2) NULL' },
    { name: 'venta_total',    def: 'DECIMAL(14,2) NULL' },
    { name: 'particip_pct',   def: 'DECIMAL(8,4) NULL' },
    { name: 'particip_acum',  def: 'DECIMAL(8,4) NULL' },
  ];
  for (const c of cols) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.tbl_CoVenAppINDO_Ranking') AND name = '${c.name}'
      )
      ALTER TABLE dbo.tbl_CoVenAppINDO_Ranking ADD ${c.name} ${c.def}
    `);
  }
}

// ── GET /api/ranking?periodo= ─────────────────────────────────────────────────
// Devuelve las filas ordenadas por posición (igual que al momento del cálculo).
router.get('/', async (req, res) => {
  const { periodo } = req.query;
  try {
    const pool = await getPool();
    await ensureColumns(pool);
    const q = pool.request();
    let where = 'WHERE r.sucursal_id < 300';
    if (periodo) {
      q.input('periodo', sql.VarChar, periodo);
      where += ' AND r.periodo = @periodo';
    }
    const r = await q.query(`
      SELECT r.sucursal_id, r.categoria, r.override_manual, r.periodo,
             r.posicion, r.grupo,
             r.venta_consumo, r.venta_efectivo, r.venta_total,
             r.particip_pct, r.particip_acum,
             s.nombre
      FROM dbo.tbl_CoVenAppINDO_Ranking r
      LEFT JOIN dbo.tbl_CoVenAppINDO_Sucursales s ON s.id = r.sucursal_id
      ${where} AND ISNULL(s.activa, 1) = 1
      ORDER BY r.grupo, r.posicion, r.sucursal_id
    `);
    res.json(r.recordset);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── POST /api/ranking — override manual de categoría ─────────────────────────
router.post('/', async (req, res) => {
  const { sucursal_id, categoria, periodo } = req.body;
  try {
    const pool = await getPool();
    await ensureColumns(pool);
    await pool.request()
      .input('sucursal_id', sql.Int,    sucursal_id)
      .input('categoria',   sql.Char(1), categoria)
      .input('periodo',     sql.VarChar, periodo)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_Ranking
                   WHERE sucursal_id=@sucursal_id AND periodo=@periodo)
          UPDATE dbo.tbl_CoVenAppINDO_Ranking
          SET categoria=@categoria, override_manual=1
          WHERE sucursal_id=@sucursal_id AND periodo=@periodo
        ELSE
          INSERT INTO dbo.tbl_CoVenAppINDO_Ranking (sucursal_id,categoria,periodo,override_manual)
          VALUES (@sucursal_id,@categoria,@periodo,1)
      `);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── POST /api/ranking/calcular ────────────────────────────────────────────────
router.post('/calcular', async (req, res) => {
  const { periodo } = req.body;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });

  try {
    const pool = await getPool();
    const resultado = await calcularYGuardarRanking(pool, periodo);
    res.json(resultado);
  } catch (err) {
    console.error('[RANKING CALC]', err);
    res.status(500).json({ error: err.message });
  }
});

// Recalcula el ranking (categoría A/B/C por sucursal) desde ventas de BeClever
// y lo persiste en tbl_CoVenAppINDO_Ranking, preservando overrides manuales.
// Se usa desde la ruta /calcular y desde POST /api/calculo/ejecutar (Dashboard).
export async function calcularYGuardarRanking(pool, periodo) {
    const bcPool = await getPoolBC();
    const [yr, mo] = periodo.split('-').map(Number);
    await ensureColumns(pool);

    // Sucursales maestro
    const sucR = await pool.request()
      .query('SELECT id, nombre FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id');

    // Ventas desde BeClever
    const [comercioR, ventasR] = await Promise.all([
      bcPool.request().query('SELECT Cod_Comercio, RTRIM(Descripcion) AS nombre FROM dbo.COMERCIO'),
      bcPool.request()
        .input('Anio', sql.Int, yr)
        .input('Mes',  sql.Int, mo)
        .execute('dbo.sp_ReporteVentasCobrosObjetivos'),
    ]);

    const idByNombre = {};
    for (const c of comercioR.recordset) idByNombre[c.nombre.trim()] = c.Cod_Comercio;

    const ventaMap = {};
    for (const r of ventasR.recordset) {
      const sucId = idByNombre[r.Sucursal?.trim()];
      if (!sucId) continue;
      if (!ventaMap[sucId]) ventaMap[sucId] = { consumo: 0, efectivo: 0 };
      const v = Math.abs(r.Ventas || 0);
      if (r.Producto?.trim() === 'CONSUMO')  ventaMap[sucId].consumo  += v;
      if (r.Producto?.trim() === 'EFECTIVO') ventaMap[sucId].efectivo += v;
    }

    const filas = sucR.recordset.map(s => ({
      sucursal_id:    s.id,
      nombre:         s.nombre,
      venta_consumo:  ventaMap[s.id]?.consumo  || 0,
      venta_efectivo: ventaMap[s.id]?.efectivo || 0,
      venta_total:    (ventaMap[s.id]?.consumo || 0) + (ventaMap[s.id]?.efectivo || 0),
    }));

    const retail = calcularGrupo(filas.filter(f => f.sucursal_id < 100),       'retail');
    const millon = calcularGrupo(filas.filter(f => f.sucursal_id >= 100 && f.sucursal_id < 200), 'millon');

    // Preservar overrides manuales antes de borrar
    const overridesR = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`SELECT sucursal_id, categoria FROM dbo.tbl_CoVenAppINDO_Ranking
              WHERE periodo=@periodo AND override_manual=1`);
    const overrides = {};
    for (const o of overridesR.recordset) overrides[o.sucursal_id] = o.categoria;

    // Borrar todas las filas del período (evita duplicados en recálculos)
    await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`DELETE FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo`);

    // Insertar resultado fresco, aplicando overrides donde corresponda
    for (const r of [...retail, ...millon]) {
      const categoriaFinal  = overrides[r.sucursal_id] ?? r.categoria;
      const esOverride      = overrides[r.sucursal_id] != null ? 1 : 0;
      await pool.request()
        .input('sucursal_id',    sql.Int,          r.sucursal_id)
        .input('categoria',      sql.Char(1),       categoriaFinal)
        .input('override_manual',sql.Bit,           esOverride)
        .input('periodo',        sql.VarChar,       periodo)
        .input('posicion',       sql.Int,           r.posicion)
        .input('grupo',          sql.VarChar(10),   r.grupo)
        .input('venta_consumo',  sql.Decimal(14,2), r.venta_consumo)
        .input('venta_efectivo', sql.Decimal(14,2), r.venta_efectivo)
        .input('venta_total',    sql.Decimal(14,2), r.venta_total)
        .input('particip_pct',   sql.Decimal(8,4),  r.particip_pct)
        .input('particip_acum',  sql.Decimal(8,4),  r.particip_acum)
        .query(`
          INSERT INTO dbo.tbl_CoVenAppINDO_Ranking
            (sucursal_id,categoria,periodo,override_manual,
             posicion,grupo,venta_consumo,venta_efectivo,venta_total,particip_pct,particip_acum)
          VALUES
            (@sucursal_id,@categoria,@periodo,@override_manual,
             @posicion,@grupo,@venta_consumo,@venta_efectivo,@venta_total,@particip_pct,@particip_acum)
        `);
    }

    return { periodo, retail, millon };
}

function calcularGrupo(filas, grupo) {
  const sorted     = [...filas].sort((a, b) => b.venta_total - a.venta_total);
  const totalGrupo = sorted.reduce((s, f) => s + f.venta_total, 0);
  let cumSum = 0;
  return sorted.map((f, idx) => {
    const particip = totalGrupo > 0 ? (f.venta_total / totalGrupo) * 100 : 0;
    cumSum += particip;
    const categoria = cumSum <= 60 ? 'A' : cumSum <= 90 ? 'B' : 'C';
    return {
      ...f,
      grupo,
      posicion:      idx + 1,
      particip_pct:  +particip.toFixed(2),
      particip_acum: +cumSum.toFixed(2),
      categoria,
    };
  });
}

// ── GET /api/ranking/multiplicadores ─────────────────────────────────────────
router.get('/multiplicadores', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador ORDER BY categoria');
    res.json(r.recordset);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// PUT /api/ranking/multiplicadores/:categoria
router.put('/multiplicadores/:categoria', async (req, res) => {
  const { multiplicador } = req.body;
  try {
    const pool = await getPool();
    await pool.request()
      .input('categoria',    sql.Char,       req.params.categoria)
      .input('multiplicador',sql.Decimal(4,2), multiplicador)
      .query('UPDATE dbo.tbl_CoVenAppINDO_RankingMultiplicador SET multiplicador=@multiplicador WHERE categoria=@categoria');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

export default router;
