import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/supervisores  — lista todos con sus sucursales asignadas
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const sups = await pool.request().query(
      'SELECT id, nombre, activo FROM dbo.tbl_CoVenAppINDO_Supervisores ORDER BY nombre'
    );
    const asigs = await pool.request().query(
      'SELECT supervisor_id, sucursal_id FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales'
    );
    const asigMap = {};
    for (const a of asigs.recordset) {
      if (!asigMap[a.supervisor_id]) asigMap[a.supervisor_id] = [];
      asigMap[a.supervisor_id].push(a.sucursal_id);
    }
    res.json(sups.recordset.map(s => ({ ...s, sucursales: asigMap[s.id] || [] })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// POST /api/supervisores  — crear supervisor
router.post('/', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('nombre', sql.VarChar, nombre.trim())
      .query('INSERT INTO dbo.tbl_CoVenAppINDO_Supervisores (nombre, activo) OUTPUT INSERTED.id VALUES (@nombre, 1)');
    res.json({ id: r.recordset[0].id, nombre: nombre.trim(), activo: true, sucursales: [] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// PUT /api/supervisores/:id  — editar nombre o activo
router.put('/:id', async (req, res) => {
  const { nombre, activo } = req.body;
  const id = parseInt(req.params.id);
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .input('nombre', sql.VarChar, nombre.trim())
      .input('activo', sql.Bit, activo ?? 1)
      .query('UPDATE dbo.tbl_CoVenAppINDO_Supervisores SET nombre=@nombre, activo=@activo WHERE id=@id');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// DELETE /api/supervisores/:id  — eliminar supervisor y sus asignaciones
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales WHERE supervisor_id=@id');
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_Supervisores WHERE id=@id');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// PUT /api/supervisores/:id/sucursales  — reemplazar todas las sucursales asignadas
router.put('/:id/sucursales', async (req, res) => {
  const id = parseInt(req.params.id);
  const { sucursales } = req.body; // array of sucursal_id numbers
  if (!Array.isArray(sucursales)) return res.status(400).json({ error: 'sucursales debe ser array' });
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales WHERE supervisor_id=@id');
    for (const sId of sucursales) {
      await pool.request()
        .input('sup_id', sql.Int, id)
        .input('suc_id', sql.Int, sId)
        .query('INSERT INTO dbo.tbl_CoVenAppINDO_SupervisorSucursales (supervisor_id, sucursal_id) VALUES (@sup_id, @suc_id)');
    }
    res.json({ ok: true, sucursales });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

export default router;
