import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
import { armarVista, agruparVigencias, vigenciaParaPeriodo, validarVigencia } from '../services/vendedoresView.js';

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

// ── ABM de vigencias de importes ─────────────────────────────────────────────
// Único write del módulo. La semántica es la que ya tiene el SQL: una vigencia
// rige desde su (año, mes) hasta que aparece una posterior. Para cambiar los
// montos se crea una vigencia nueva; los períodos anteriores siguen resolviendo
// la vieja, así que recalcularlos da el mismo resultado que hoy.

const DESCRIPCIONES_SQL = [
  ['PRIMER ESCALON',  'primer'],
  ['SEGUNDO ESCALON', 'segundo'],
  ['TERCER ESCALON',  'tercer'],
];

async function insertarVigencia(tx, anio, mes, body) {
  for (const [descripcion, campo] of DESCRIPCIONES_SQL) {
    await new sql.Request(tx)
      .input('desc',  sql.VarChar(50), descripcion)
      .input('monto', sql.Decimal(18, 2), body[campo])
      .input('mes',   sql.Int, mes)
      .input('anio',  sql.Int, anio)
      .query(`INSERT INTO dbo.tbl_CoVenApp_ImportesEscalonesINDO (Descripcion, FullTime, Mes, Año)
              VALUES (@desc, @monto, @mes, @anio)`);
  }
}

// POST /api/vendedores/importes — nueva vigencia (3 filas, en transacción)
router.post('/importes', async (req, res) => {
  try {
    const pool = await getPool();
    const vigencias = await leerVigencias(pool);
    const v = validarVigencia(req.body, vigencias, 'crear');
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    const anio = Number(req.body.anio), mes = Number(req.body.mes);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await insertarVigencia(tx, anio, mes, req.body);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    console.log(`[vendedores] vigencia creada ${anio}-${mes} por ${req.user?.usuario}`);
    res.status(201).json({ ok: true, vigencia: { anio, mes, primer: req.body.primer, segundo: req.body.segundo, tercer: req.body.tercer } });
  } catch (err) {
    console.error('[vendedores POST /importes]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

// PUT /api/vendedores/importes/:anio/:mes — reemplaza los 3 montos
router.put('/importes/:anio/:mes', async (req, res) => {
  const anio = Number(req.params.anio), mes = Number(req.params.mes);
  try {
    const pool = await getPool();
    const vigencias = await leerVigencias(pool);
    const v = validarVigencia({ ...req.body, anio, mes }, vigencias, 'editar');
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    // Borrar + reinsertar: la tabla no tiene clave por (Descripcion, Mes, Año),
    // así que un UPDATE por descripción podría tocar filas duplicadas de una
    // carga manual vieja. Reinsertar deja la vigencia con exactamente 3 filas.
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input('mes', sql.Int, mes).input('anio', sql.Int, anio)
        .query('DELETE FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO WHERE Mes=@mes AND Año=@anio');
      await insertarVigencia(tx, anio, mes, req.body);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    console.log(`[vendedores] vigencia editada ${anio}-${mes} por ${req.user?.usuario}`);
    res.json({ ok: true, vigencia: { anio, mes, primer: req.body.primer, segundo: req.body.segundo, tercer: req.body.tercer } });
  } catch (err) {
    console.error('[vendedores PUT /importes]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

// DELETE /api/vendedores/importes/:anio/:mes — borra la vigencia completa
router.delete('/importes/:anio/:mes', async (req, res) => {
  const anio = Number(req.params.anio), mes = Number(req.params.mes);
  try {
    const pool = await getPool();
    const vigencias = await leerVigencias(pool);
    const v = validarVigencia({ anio, mes }, vigencias, 'borrar');
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    await pool.request()
      .input('mes', sql.Int, mes).input('anio', sql.Int, anio)
      .query('DELETE FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO WHERE Mes=@mes AND Año=@anio');
    console.log(`[vendedores] vigencia borrada ${anio}-${mes} por ${req.user?.usuario}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[vendedores DELETE /importes]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

export default router;
