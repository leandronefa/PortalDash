import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';

const router = Router();
router.use(authMiddleware);
router.use(attachScope);
router.use(blockWriteIfSupervisor);

// ── Migración: agregar con_efectivo si no existe y poblar desde objetivos ──────
async function ensureConEfectivo(pool) {
  const col = await pool.request().query(`
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tbl_CoVenAppINDO_Sucursales') AND name = 'con_efectivo'
  `);
  if (!col.recordset.length) {
    await pool.request().query(`
      ALTER TABLE dbo.tbl_CoVenAppINDO_Sucursales ADD con_efectivo BIT NOT NULL DEFAULT 0
    `);
    await pool.request().query(`
      UPDATE s SET s.con_efectivo = 1
      FROM dbo.tbl_CoVenAppINDO_Sucursales s
      WHERE EXISTS (
        SELECT 1 FROM dbo.tbl_CoVenAppINDO_ObjEfectivo o
        WHERE o.sucursal_id = s.id AND ISNULL(o.primer_escalon, 0) > 0
      )
    `);
  }
}


// ── GET /api/sucursales?periodo=YYYY-MM[&todas=1] ──────────────────────────────
// Devuelve sucursales con su categoría del período (si se pasa) y con_efectivo.
// Por defecto solo las activas; con todas=1 incluye las inactivas (ABM).
router.get('/', async (req, res) => {
  const { periodo, todas } = req.query;
  try {
    const pool = await getPool();
    await ensureConEfectivo(pool);

    const q = pool.request();
    let rankingJoin = '';
    if (periodo) {
      q.input('periodo', sql.VarChar, periodo);
      rankingJoin = `LEFT JOIN dbo.tbl_CoVenAppINDO_Ranking r ON r.sucursal_id = s.id AND r.periodo = @periodo`;
    }

    const r = await q.query(`
      SELECT s.id, s.nombre, s.supervisor, s.provincia, s.region, s.marca, s.activa,
             s.con_efectivo,
             ${periodo ? 'r.categoria' : 'NULL AS categoria'}
      FROM dbo.tbl_CoVenAppINDO_Sucursales s
      ${rankingJoin}
      WHERE s.id < 300 ${todas === '1' ? '' : 'AND s.activa = 1'}
      ORDER BY s.id
    `);
    res.json(filtrarPorSucursal(r.recordset, req.sucursalesPermitidas, 'id'));
  } catch (err) {
    console.error('[SUC GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/sucursales/:id/activa — habilitar/deshabilitar sucursal ─────────
router.patch('/:id/activa', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { activa } = req.body;
  if (typeof activa !== 'boolean' && activa !== 0 && activa !== 1)
    return res.status(400).json({ error: 'activa debe ser true/false' });

  try {
    const pool = await getPool();
    await pool.request()
      .input('id',     sql.Int, id)
      .input('activa', sql.Bit, activa ? 1 : 0)
      .query(`UPDATE dbo.tbl_CoVenAppINDO_Sucursales SET activa=@activa WHERE id=@id`);
    res.json({ ok: true, id, activa: !!activa });
  } catch (err) {
    console.error('[SUC PATCH activa]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/sucursales/:id/efectivo — toggle con_efectivo ──────────────────
router.patch('/:id/efectivo', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { con_efectivo } = req.body;
  if (typeof con_efectivo !== 'boolean' && con_efectivo !== 0 && con_efectivo !== 1)
    return res.status(400).json({ error: 'con_efectivo debe ser true/false' });

  try {
    const pool = await getPool();
    await ensureConEfectivo(pool);
    await pool.request()
      .input('id',           sql.Int, id)
      .input('con_efectivo', sql.Bit, con_efectivo ? 1 : 0)
      .query(`UPDATE dbo.tbl_CoVenAppINDO_Sucursales SET con_efectivo=@con_efectivo WHERE id=@id`);
    res.json({ ok: true, id, con_efectivo: !!con_efectivo });
  } catch (err) {
    console.error('[SUC PATCH]', err);
    res.status(500).json({ error: err.message });
  }
});


export default router;
