import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { getPoolBC } from '../config/dbBeClever.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';

const router = Router();
router.use(authMiddleware);
router.use(attachScope);
router.use(blockWriteIfSupervisor);

// ── Helper: parsear periodo "YYYY-MM" → { year, month } ──────────
function parsePeriodo(periodo) {
  if (!periodo) return null;
  const parts = periodo.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (!year || !month) return null;
  return { year, month };
}

// ── Helper: ids de sucursales deshabilitadas (activa=0) ───────────
async function getInactivasSet() {
  const pool = await getPool();
  const r = await pool.request()
    .query('SELECT id FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE activa = 0');
  return new Set(r.recordset.map(x => x.id));
}

// ── Helper: ejecutar sp_ReporteVentasCobrosObjetivos y devolver
//    filas filtradas por Producto (CONSUMO o EFECTIVO) con sucursal_id
async function getVentasSP(year, month, producto) {
  const bcPool = await getPoolBC();

  // Mapa Cod_Comercio → Descripcion para asignar sucursal_id
  const comercioR = await bcPool.request()
    .query('SELECT Cod_Comercio, Descripcion FROM dbo.COMERCIO WHERE Cod_Comercio < 300');
  const idByNombre = {};
  for (const row of comercioR.recordset) {
    idByNombre[row.Descripcion.trim()] = row.Cod_Comercio;
  }

  const spR = await bcPool.request()
    .input('Anio', sql.Int, year)
    .input('Mes',  sql.Int, month)
    .execute('dbo.sp_ReporteVentasCobrosObjetivos');

  const esConsumo = producto === 'CONSUMO';
  const rows = spR.recordset.filter(r => r.Producto?.trim() === producto);

  return rows.map(r => ({
    sucursal_id:      idByNombre[r.Sucursal?.trim()] ?? null,
    sucursal_nombre:  r.Sucursal,
    ventas:           r.Ventas           ?? 0,
    vta_vta_tot:      r['VTA/VTATOT']    ?? 0,
    vta_diaria:       r.VtaDiaria        ?? 0,
    particip_vta:     (r.ParticipacionVentas ?? 0) / 100,
    credito_promedio: r.CredProm         ?? 0,
    operaciones:      r.Operaciones      ?? 0,
    pers_op:          r.CantPersonas     ?? 0,
    particip_op:      (r.ParticipacionOperaciones ?? 0) / 100,
    cobranzas:        r.Cobrado          ?? 0,
    cob_diaria:       r.CobradoDiario    ?? 0,
    particip_cob:     (r.ParticipacionCobranza ?? 0) / 100,
    cant_cob:         r.CantCobranzas    ?? 0,
    pers_cob:         r.CantPers         ?? 0,
    obj_vtas:         esConsumo
                        ? (r.OBJETIVO_VENTAS     ?? 0)
                        : (r.OBJETIVO_VENTAS_EFE ?? 0),
  }));
}

// ── CONSUMO (origen: BeClever.sp_ReporteVentasCobrosObjetivos) ───
router.get('/consumo', async (req, res) => {
  const pm = parsePeriodo(req.query.periodo);
  if (!pm) return res.status(400).json({ error: 'Parámetro periodo requerido (YYYY-MM)' });
  try {
    const [rows, inactivas] = await Promise.all([
      getVentasSP(pm.year, pm.month, 'CONSUMO'), getInactivasSet(),
    ]);
    res.json(filtrarPorSucursal(rows.filter(r => !inactivas.has(r.sucursal_id)), req.sucursalesPermitidas));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.post('/consumo', async (req, res) => {
  const d = req.body;
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('sucursal_id', sql.Int, d.sucursal_id)
      .input('periodo', sql.VarChar, d.periodo)
      .input('ventas', sql.Decimal(14,2), d.ventas)
      .input('vta_diaria', sql.Decimal(14,2), d.vta_diaria)
      .input('particip_vta', sql.Decimal(8,4), d.particip_vta)
      .input('vta_vta_tot', sql.Decimal(8,4), d.vta_vta_tot)
      .input('credito_promedio', sql.Decimal(12,2), d.credito_promedio)
      .input('operaciones', sql.Int, d.operaciones)
      .input('pers_op', sql.Int, d.pers_op)
      .input('particip_op', sql.Decimal(8,4), d.particip_op)
      .input('cobranzas', sql.Decimal(14,2), d.cobranzas)
      .input('cob_diaria', sql.Decimal(14,2), d.cob_diaria)
      .input('particip_cob', sql.Decimal(8,4), d.particip_cob)
      .input('cant_cob', sql.Int, d.cant_cob)
      .input('pers_cob', sql.Int, d.pers_cob)
      .input('obj_vtas', sql.Decimal(14,2), d.obj_vtas)
      .query(`
        INSERT INTO dbo.tbl_CoVenAppINDO_DatosConsumo
          (sucursal_id,periodo,ventas,vta_diaria,particip_vta,vta_vta_tot,credito_promedio,operaciones,pers_op,particip_op,cobranzas,cob_diaria,particip_cob,cant_cob,pers_cob,obj_vtas)
        VALUES
          (@sucursal_id,@periodo,@ventas,@vta_diaria,@particip_vta,@vta_vta_tot,@credito_promedio,@operaciones,@pers_op,@particip_op,@cobranzas,@cob_diaria,@particip_cob,@cant_cob,@pers_cob,@obj_vtas);
        SELECT SCOPE_IDENTITY() as id;
      `);
    res.json({ id: r.recordset[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.put('/consumo/:id', async (req, res) => {
  const d = req.body;
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('ventas', sql.Decimal(14,2), d.ventas)
      .input('vta_diaria', sql.Decimal(14,2), d.vta_diaria)
      .input('particip_vta', sql.Decimal(8,4), d.particip_vta)
      .input('vta_vta_tot', sql.Decimal(8,4), d.vta_vta_tot)
      .input('credito_promedio', sql.Decimal(12,2), d.credito_promedio)
      .input('operaciones', sql.Int, d.operaciones)
      .input('pers_op', sql.Int, d.pers_op)
      .input('particip_op', sql.Decimal(8,4), d.particip_op)
      .input('cobranzas', sql.Decimal(14,2), d.cobranzas)
      .input('cob_diaria', sql.Decimal(14,2), d.cob_diaria)
      .input('particip_cob', sql.Decimal(8,4), d.particip_cob)
      .input('cant_cob', sql.Int, d.cant_cob)
      .input('pers_cob', sql.Int, d.pers_cob)
      .input('obj_vtas', sql.Decimal(14,2), d.obj_vtas)
      .query(`
        UPDATE dbo.tbl_CoVenAppINDO_DatosConsumo SET
          ventas=@ventas, vta_diaria=@vta_diaria, particip_vta=@particip_vta,
          vta_vta_tot=@vta_vta_tot, credito_promedio=@credito_promedio, operaciones=@operaciones,
          pers_op=@pers_op, particip_op=@particip_op, cobranzas=@cobranzas,
          cob_diaria=@cob_diaria, particip_cob=@particip_cob, cant_cob=@cant_cob,
          pers_cob=@pers_cob, obj_vtas=@obj_vtas
        WHERE id = @id
      `);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.delete('/consumo/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_DatosConsumo WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// ── EFECTIVO (origen: BeClever.sp_ReporteVentasCobrosObjetivos) ──
router.get('/efectivo', async (req, res) => {
  const pm = parsePeriodo(req.query.periodo);
  if (!pm) return res.status(400).json({ error: 'Parámetro periodo requerido (YYYY-MM)' });
  try {
    const [rows, inactivas] = await Promise.all([
      getVentasSP(pm.year, pm.month, 'EFECTIVO'), getInactivasSet(),
    ]);
    res.json(filtrarPorSucursal(rows.filter(r => !inactivas.has(r.sucursal_id)), req.sucursalesPermitidas));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.post('/efectivo', async (req, res) => {
  const d = req.body;
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('sucursal_id', sql.Int, d.sucursal_id)
      .input('periodo', sql.VarChar, d.periodo)
      .input('ventas', sql.Decimal(14,2), d.ventas)
      .input('vta_diaria', sql.Decimal(14,2), d.vta_diaria)
      .input('particip_vta', sql.Decimal(10,6), d.particip_vta)
      .input('vta_vta_tot', sql.Decimal(8,4), d.vta_vta_tot)
      .input('credito_promedio', sql.Decimal(12,2), d.credito_promedio)
      .input('operaciones', sql.Int, d.operaciones)
      .input('pers_op', sql.Int, d.pers_op)
      .input('particip_op', sql.Decimal(10,6), d.particip_op)
      .input('cobranzas', sql.Decimal(14,2), d.cobranzas)
      .input('cob_diaria', sql.Decimal(14,2), d.cob_diaria)
      .input('particip_cob', sql.Decimal(10,6), d.particip_cob)
      .input('cant_cob', sql.Int, d.cant_cob)
      .input('pers_cob', sql.Int, d.pers_cob)
      .input('obj_vtas', sql.Decimal(14,2), d.obj_vtas)
      .query(`
        INSERT INTO dbo.tbl_CoVenAppINDO_DatosEfectivo
          (sucursal_id,periodo,ventas,vta_diaria,particip_vta,vta_vta_tot,credito_promedio,operaciones,pers_op,particip_op,cobranzas,cob_diaria,particip_cob,cant_cob,pers_cob,obj_vtas)
        VALUES
          (@sucursal_id,@periodo,@ventas,@vta_diaria,@particip_vta,@vta_vta_tot,@credito_promedio,@operaciones,@pers_op,@particip_op,@cobranzas,@cob_diaria,@particip_cob,@cant_cob,@pers_cob,@obj_vtas);
        SELECT SCOPE_IDENTITY() as id;
      `);
    res.json({ id: r.recordset[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.put('/efectivo/:id', async (req, res) => {
  const d = req.body;
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('ventas', sql.Decimal(14,2), d.ventas)
      .input('vta_diaria', sql.Decimal(14,2), d.vta_diaria)
      .input('particip_vta', sql.Decimal(10,6), d.particip_vta)
      .input('vta_vta_tot', sql.Decimal(8,4), d.vta_vta_tot)
      .input('credito_promedio', sql.Decimal(12,2), d.credito_promedio)
      .input('operaciones', sql.Int, d.operaciones)
      .input('pers_op', sql.Int, d.pers_op)
      .input('particip_op', sql.Decimal(10,6), d.particip_op)
      .input('cobranzas', sql.Decimal(14,2), d.cobranzas)
      .input('cob_diaria', sql.Decimal(14,2), d.cob_diaria)
      .input('particip_cob', sql.Decimal(10,6), d.particip_cob)
      .input('cant_cob', sql.Int, d.cant_cob)
      .input('pers_cob', sql.Int, d.pers_cob)
      .input('obj_vtas', sql.Decimal(14,2), d.obj_vtas)
      .query(`
        UPDATE dbo.tbl_CoVenAppINDO_DatosEfectivo SET
          ventas=@ventas, vta_diaria=@vta_diaria, particip_vta=@particip_vta,
          vta_vta_tot=@vta_vta_tot, credito_promedio=@credito_promedio, operaciones=@operaciones,
          pers_op=@pers_op, particip_op=@particip_op, cobranzas=@cobranzas,
          cob_diaria=@cob_diaria, particip_cob=@particip_cob, cant_cob=@cant_cob,
          pers_cob=@pers_cob, obj_vtas=@obj_vtas
        WHERE id = @id
      `);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.delete('/efectivo/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_DatosEfectivo WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// ── REPORTE (origen: BeClever.sp_ReporteOriginacionesCreditos) ───
router.get('/reporte', async (req, res) => {
  const pm = parsePeriodo(req.query.periodo);
  if (!pm) return res.status(400).json({ error: 'Parámetro periodo requerido (YYYY-MM)' });
  try {
    const bcPool = await getPoolBC();
    const spR = await bcPool.request()
      .input('Anio', sql.Int, pm.year)
      .input('Mes',  sql.Int, pm.month)
      .execute('dbo.sp_ReporteOriginacionesCreditos');

    const inactivas = await getInactivasSet();
    const rows = spR.recordset.filter(r => !inactivas.has(r.IdSucursalEntidad)).map(r => ({
      id_originacion:     r.IdOriginacion,
      estado:             r.Des,
      usuario_originador: r.IdUsuario,
      fecha_alta:         r.FecAlt,
      producto:           r.ProdDesc,
      importe_capital:    r.ImpFin,
      cantidad_cuotas:    r.CanCuo,
      id_prestamo:        r.Val ? parseInt(r.Val, 10) : null,
      id_sucursal:        r.IdSucursalEntidad,
      sucursal:           r.SucDes,
      id_plan:            r.IdPlan,
    }));

    res.json(filtrarPorSucursal(rows, req.sucursalesPermitidas, 'id_sucursal'));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.post('/reporte', async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const pool = await getPool();
    for (const d of rows) {
      await pool.request()
        .input('periodo', sql.VarChar, d.periodo)
        .input('id_originacion', sql.Int, d.id_originacion)
        .input('estado', sql.VarChar, d.estado)
        .input('usuario_originador', sql.VarChar, d.usuario_originador)
        .input('fecha_alta', sql.DateTime, d.fecha_alta ? new Date(d.fecha_alta) : null)
        .input('producto', sql.VarChar, d.producto)
        .input('importe_capital', sql.Decimal(14,2), d.importe_capital)
        .input('cantidad_cuotas', sql.Int, d.cantidad_cuotas)
        .input('id_prestamo', sql.Int, d.id_prestamo)
        .input('id_sucursal', sql.Int, d.id_sucursal)
        .input('sucursal', sql.VarChar, d.sucursal)
        .input('id_plan', sql.Int, d.id_plan)
        .query(`
          INSERT INTO dbo.tbl_CoVenAppINDO_DatosReporte
            (periodo,id_originacion,estado,usuario_originador,fecha_alta,producto,importe_capital,cantidad_cuotas,id_prestamo,id_sucursal,sucursal,id_plan)
          VALUES
            (@periodo,@id_originacion,@estado,@usuario_originador,@fecha_alta,@producto,@importe_capital,@cantidad_cuotas,@id_prestamo,@id_sucursal,@sucursal,@id_plan)
        `);
    }
    res.json({ ok: true, inserted: rows.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

router.delete('/reporte/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_DatosReporte WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// Borrar todo el reporte de un período
router.delete('/reporte/periodo/:periodo', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input('periodo', sql.VarChar, req.params.periodo)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_DatosReporte WHERE periodo = @periodo');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

export default router;
