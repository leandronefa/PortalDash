import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
import { armarVista, agruparVigencias, vigenciaParaPeriodo } from '../services/vendedoresView.js';

const router = Router();
router.use(authMiddleware);
router.use(attachScope);
router.use(blockWriteIfSupervisor);

// El cálculo de comisiones de vendedores lo corre un job SQL
// (SP_ComisionesINDO): este router SOLO lee sus resultados. Lo único que
// escribe es la tabla de vigencias de importes (ver más abajo).

function parsePeriodo(periodo) {
  if (!/^\d{4}-\d{2}$/.test(String(periodo || ''))) return null;
  const [anio, mes] = String(periodo).split('-').map(Number);
  if (mes < 1 || mes > 12) return null;
  return { anio, mes };
}

async function leerVigencias(pool) {
  const r = await pool.request().query(`
    SELECT Descripcion, FullTime, Mes, Año
    FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO
  `);
  return agruparVigencias(r.recordset);
}

// GET /api/vendedores?periodo=YYYY-MM — resultado del período por sucursal
router.get('/', async (req, res) => {
  const p = parsePeriodo(req.query.periodo);
  if (!p) return res.status(400).json({ ok: false, error: 'Período inválido (formato YYYY-MM)' });

  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('anio', sql.Int, p.anio)
      .input('mes',  sql.Int, p.mes)
      .query(`
        SELECT CAST(g.idSucursal AS INT)                AS sucursal_id,
               s.nombre                                 AS sucursal_nombre,
               e.CantidadVendedores                     AS cant_vendedores,
               e.PrimerEscalon                          AS primer_escalon,
               e.SegundoEcalon                          AS segundo_escalon,
               e.TercerEscalon                          AS tercer_escalon,
               e.ImportePrimerEscalon                   AS importe_primer,
               e.ImporteSegundoEcalon                   AS importe_segundo,
               e.ImporteTercerEscalon                   AS importe_tercer,
               g.idVendedor                             AS legajo,
               LTRIM(RTRIM(ISNULL(v.APELLIDO,'') + ' ' + ISNULL(v.NOMBRE,''))) AS nombre,
               g.parcial                                AS parcial,
               v.GCL_TEMPSPARTIEL                       AS parcial_actual,
               g.ventareal                              AS venta_real,
               g.DiasVenta                              AS dias_venta,
               g.ventacalculada                         AS venta_calculada,
               g.vtaproporcional                        AS vta_proporcional,
               g.diaslicencia                           AS dias_licencia,
               g.comisiona                              AS comisiona,
               c.comision                               AS comision
        FROM dbo.tbl_CoVenApp_GrillaVendedoresINDO g
        INNER JOIN dbo.tbl_CoVenApp_EscalonesINDO e
          ON e.Sucursal = CAST(g.idSucursal AS INT)
         AND e.mes = g.mes AND e.año = g.año
        LEFT JOIN dbo.tbl_CoVenApp_GrillaComisionesINDO c
          ON c.idVendedor = g.idVendedor AND c.mes = g.mes AND c.año = g.año
        LEFT JOIN dbo.tbl_CoVenApp_Vendedores v
          ON v.NRO_VENDEDOR = g.idVendedor
        LEFT JOIN dbo.tbl_CoVenAppINDO_Sucursales s
          ON s.id = CAST(g.idSucursal AS INT)
        WHERE g.año = @anio AND g.mes = @mes
        ORDER BY CAST(g.idSucursal AS INT), g.idVendedor
      `);

    // Scope de supervisor (perfil 8): se filtra ANTES de agrupar.
    const filas = filtrarPorSucursal(r.recordset, req.sucursalesPermitidas);
    const vista = armarVista(filas);
    const vigencias = await leerVigencias(pool);

    res.json({
      ok: true,
      periodo: req.query.periodo,
      vigencia: vigenciaParaPeriodo(vigencias, req.query.periodo),
      ...vista,
    });
  } catch (err) {
    console.error('[vendedores GET /]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

// GET /api/vendedores/importes?periodo=YYYY-MM — vigencias, marcando la vigente
router.get('/importes', async (req, res) => {
  try {
    const pool = await getPool();
    const vigencias = await leerVigencias(pool);
    const periodo = /^\d{4}-\d{2}$/.test(String(req.query.periodo || '')) ? req.query.periodo : null;
    res.json({
      ok: true,
      vigencias,
      vigente: periodo ? vigenciaParaPeriodo(vigencias, periodo) : null,
    });
  } catch (err) {
    console.error('[vendedores GET /importes]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

export default router;
