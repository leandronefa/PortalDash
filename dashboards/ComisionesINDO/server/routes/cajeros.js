import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';

const router = Router();
router.use(authMiddleware);
router.use(attachScope);
router.use(blockWriteIfSupervisor);

// GET /api/cajeros  — cajeros con sucursal asignada (desde VendedoresDetalleDiaria, estado actual)
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

// PUT /api/cajeros/:nroVendedor/sucursal  — asignar o actualizar sucursal de un cajero
router.put('/:nroVendedor/sucursal', async (req, res) => {
  const nro = req.params.nroVendedor;
  const { sucursal_id } = req.body;
  try {
    const pool = await getPool();
    if (!sucursal_id) {
      // Quitar asignación
      await pool.request().input('nro', sql.VarChar, nro)
        .query('DELETE FROM dbo.tbl_CoVenAppINDO_CajeroSucursal WHERE nro_vendedor=@nro');
    } else {
      const exists = await pool.request().input('nro', sql.VarChar, nro)
        .query('SELECT 1 as c FROM dbo.tbl_CoVenAppINDO_CajeroSucursal WHERE nro_vendedor=@nro');
      if (exists.recordset.length > 0) {
        await pool.request()
          .input('nro', sql.VarChar, nro)
          .input('suc', sql.Int, sucursal_id)
          .query('UPDATE dbo.tbl_CoVenAppINDO_CajeroSucursal SET sucursal_id=@suc WHERE nro_vendedor=@nro');
      } else {
        await pool.request()
          .input('nro', sql.VarChar, nro)
          .input('suc', sql.Int, sucursal_id)
          .query('INSERT INTO dbo.tbl_CoVenAppINDO_CajeroSucursal (nro_vendedor, sucursal_id) VALUES (@nro, @suc)');
      }
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

export default router;
