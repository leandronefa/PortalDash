import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { getPoolBC } from '../config/dbBeClever.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
import { calcularTotal, calcularCajeros, calcularOperadores, calcularEncargados, calcularEncargadosMillon, calcularSupervisores } from '../services/calcEngine.js';
import { calcularYGuardarRanking } from './ranking.js';
import { sincronizarObjetivos } from './objetivos.js';
import { calcularYGuardarOperadores } from './operadores.js';
import { calcularYGuardarOperadoresMillon } from './millon.js';

const router = Router();
router.use(authMiddleware);
router.use(attachScope);
router.use(blockWriteIfSupervisor);

// Llama a sp_ReporteVentasCobrosObjetivos en BeClever y devuelve
// arrays separados para consumo y efectivo con el formato del motor
async function cargarVentasBC(periodo) {
  const [yr, mo] = periodo.split('-').map(Number);
  const bcPool = await getPoolBC();

  const [comercioR, spR, objMillonR] = await Promise.all([
    bcPool.request().query('SELECT Cod_Comercio, Descripcion FROM dbo.COMERCIO'),
    bcPool.request()
      .input('Anio', sql.Int, yr)
      .input('Mes',  sql.Int, mo)
      .execute('dbo.sp_ReporteVentasCobrosObjetivos'),
    bcPool.request()
      .input('anio', sql.Int, yr)
      .input('mes',  sql.Int, mo)
      .query('SELECT SUCURSAL, OBJETIVO_PARTICIPA FROM METRIX.dbo.OBJETIVOS_MILLON WHERE ANIO=@anio AND MES=@mes'),
  ]);

  const idByNombre = {};
  for (const c of comercioR.recordset) idByNombre[c.Descripcion.trim()] = c.Cod_Comercio;

  // OBJETIVO_PARTICIPA en OBJETIVOS_MILLON ya está en % directo (ej: 42.00)
  const objPartByIdSuc = {};
  for (const o of objMillonR.recordset) objPartByIdSuc[o.SUCURSAL] = o.OBJETIVO_PARTICIPA ?? 0;

  const mapRow = (r, esConsumo) => {
    const sucId = idByNombre[r.Sucursal?.trim()] ?? null;
    return {
      sucursal_id:      sucId,
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
      obj_vtas:         esConsumo ? (r.OBJETIVO_VENTAS ?? 0) : (r.OBJETIVO_VENTAS_EFE ?? 0),
      // Objetivo de participación directo desde OBJETIVOS_MILLON (ya en %, ej: 42.00)
      obj_particip_pct: esConsumo ? (objPartByIdSuc[sucId] ?? 0) : 0,
    };
  };

  const datosConsumo  = spR.recordset.filter(r => r.Producto?.trim() === 'CONSUMO')
                                     .map(r => mapRow(r, true));
  const datosEfectivo = spR.recordset.filter(r => r.Producto?.trim() === 'EFECTIVO')
                                     .map(r => mapRow(r, false));
  return { datosConsumo, datosEfectivo };
}

// Llama a sp_ReporteOriginacionesCreditos en BeClever
async function cargarReporteBC(periodo) {
  const [yr, mo] = periodo.split('-').map(Number);
  const bcPool = await getPoolBC();
  const spR = await bcPool.request()
    .input('Anio', sql.Int, yr)
    .input('Mes',  sql.Int, mo)
    .execute('dbo.sp_ReporteOriginacionesCreditos');

  return spR.recordset.map(r => ({
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
}

async function cargarContexto(pool, periodo) {
  const p = (q) => pool.request().input('periodo', sql.VarChar, periodo).query(q);
  const [yr, mo] = periodo.split('-').map(Number);

  // Queries de db_Cegid (paralelo) y BeClever (secuencial para evitar conflictos de pool)
  const [
    sucursalesR, rankingR, multR,
    objConsumoR, objEfectivoR,
    montosR, montosVendR, montoSupR, montosPresR, montosCajR,
    encargadosR, vendedoresR, cakerosR,
    supervisoresR, supSucursalesR,
    qlikUsuariosR, jornadasR
  ] = await Promise.all([
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
    p('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@periodo'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Montos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosVendedor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosSupervisor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosPrestamos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosCajero'),
    pool.request().query('SELECT idEncargado, apellido_nombre, codSucursal FROM dbo.tbl_CoVenApp_encargados'),
    pool.request().query("SELECT NRO_VENDEDOR, LTRIM(RTRIM(ISNULL(APELLIDO,'')+' '+ISNULL(NOMBRE,''))) as nombre, TIPO, GCL_TEMPSPARTIEL as gclTemps FROM dbo.tbl_CoVenApp_Vendedores WHERE COMISIONA=1"),
    // Cajeros: sucursal actual desde VendedoresDetalleDiaria
    pool.request()
      .query(`
        SELECT v.NRO_VENDEDOR,
               LTRIM(RTRIM(ISNULL(v.APELLIDO,'')+' '+ISNULL(v.NOMBRE,''))) AS nombre,
               v.GCL_TEMPSPARTIEL AS gclTemps,
               CAST(dd.Sucursal AS INT) AS sucursal_id
        FROM dbo.tbl_CoVenApp_Vendedores v
        INNER JOIN dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
          ON dd.VEND = v.NRO_VENDEDOR
        WHERE v.TIPO = 'CAJERO'
          AND ISNULL(dd.Sucursal,'') <> ''
          AND dd.Sucursal <> '0'
          AND ISNUMERIC(dd.Sucursal) = 1
        ORDER BY dd.Sucursal, v.APELLIDO, v.NOMBRE
      `),
    pool.request().query('SELECT id, nombre, activo FROM dbo.tbl_CoVenAppINDO_Supervisores'),
    pool.request().query('SELECT supervisor_id, sucursal_id FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales'),
    pool.request().query("SELECT UPPER(LTRIM(RTRIM(Usuario))) AS id_usuario, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.tbl_QlikData_Usuarios"),
    pool.request().query("SELECT usuario, jornada FROM dbo.tbl_CoVenAppINDO_OperadoresJornada"),
  ]);

  // BeClever SPs secuenciales (pool compartido, evitar conflictos)
  const ventasBC  = await cargarVentasBC(periodo);
  const reporteBC = await cargarReporteBC(periodo);

  // Grilla de vendedores (operadores) del período
  const grillaR = await pool.request()
    .input('yr', sql.Int, yr)
    .input('mo', sql.Int, mo)
    .query(`
      SELECT g.idVendedor, g.idSucursal, g.parcial AS parcial_mes, g.comisiona,
             v.TIPO AS tipo, v.GCL_TEMPSPARTIEL AS gclTemps, v.nombre
      FROM dbo.tbl_CoVenApp_GrillaVendedoresINDO g
      INNER JOIN (
        SELECT NRO_VENDEDOR,
               LTRIM(RTRIM(ISNULL(APELLIDO,'')+' '+ISNULL(NOMBRE,''))) AS nombre,
               TIPO, GCL_TEMPSPARTIEL
        FROM dbo.tbl_CoVenApp_Vendedores WHERE COMISIONA=1
      ) v ON g.idVendedor = v.NRO_VENDEDOR
      WHERE g.año=@yr AND g.mes=@mo AND g.comisiona=1
    `);

  // Cajeros: ya vienen con sucursal_id y filtro de antigüedad desde la query
  const cajerosSucursal = cakerosR.recordset.map(v => ({
    nro_vendedor: v.NRO_VENDEDOR,
    nombre:       v.nombre,
    parcial_tipo: v.gclTemps,
    sucursal_id:  v.sucursal_id
  }));

  const rankingMap = {};
  for (const r of rankingR.recordset) rankingMap[r.sucursal_id] = r;

  // Mapa IdUsuario (uppercase) → nombre completo para operadores
  const operadorMap = {};
  for (const u of qlikUsuariosR.recordset) operadorMap[u.id_usuario] = u.nombre;

  // Mapa de jornadas persistentes: usuario → 'full'|'part'
  const jornadasMap = {};
  for (const j of jornadasR.recordset) jornadasMap[j.usuario.toUpperCase()] = j.jornada;

  return {
    sucursales:           sucursalesR.recordset,
    rankingMap,
    multiplicadores:      multR.recordset,
    datosConsumo:         ventasBC.datosConsumo,
    datosEfectivo:        ventasBC.datosEfectivo,
    datosReporte:         reporteBC,
    objConsumo:           objConsumoR.recordset,
    objEfectivo:          objEfectivoR.recordset,
    montos:               montosR.recordset,
    montosVendedor:       montosVendR.recordset,
    montosSupervisor:     montoSupR.recordset,
    montosPrestamaos:     montosPresR.recordset,
    montosCajero:         montosCajR.recordset,
    encargados:           encargadosR.recordset,
    grilla:               grillaR.recordset,
    operadorMap,
    jornadasMap,
    cajerosSucursal,
    supervisores:         supervisoresR.recordset,
    supervisorSucursales: supSucursalesR.recordset
  };
}

// POST /api/calculo/cajeros  { periodo, overrides: { "NRO_VENDEDOR": "part"|"full" } }
// Cálculo independiente solo de cajeros (carga ligera, sin reporte ni encargados)
router.post('/cajeros', async (req, res) => {
  const { periodo, overrides = {} } = req.body;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });

  try {
    const pool = await getPool();
    const [yr, mo] = periodo.split('-').map(Number);

    const [
      sucursalesR, rankingR, multR,
      objConsumoR, montosCajR, cakerosR
    ] = await Promise.all([
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
      pool.request().input('periodo', sql.VarChar, periodo).query('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
      pool.request().input('periodo', sql.VarChar, periodo).query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosCajero'),
      pool.request()
        .query(`
          SELECT v.NRO_VENDEDOR,
                 LTRIM(RTRIM(ISNULL(v.APELLIDO,'')+' '+ISNULL(v.NOMBRE,''))) AS nombre,
                 v.GCL_TEMPSPARTIEL AS gclTemps,
                 CAST(dd.Sucursal AS INT) AS sucursal_id
          FROM dbo.tbl_CoVenApp_Vendedores v
          INNER JOIN dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
            ON dd.VEND = v.NRO_VENDEDOR
          WHERE v.TIPO = 'CAJERO'
            AND ISNULL(dd.Sucursal,'') <> ''
            AND dd.Sucursal <> '0'
            AND ISNUMERIC(dd.Sucursal) = 1
          ORDER BY dd.Sucursal, v.APELLIDO, v.NOMBRE
        `)
    ]);

    // Solo necesitamos datos de consumo de BeClever (no reporte)
    const ventasBC = await cargarVentasBC(periodo);

    const rankingMap = {};
    for (const r of rankingR.recordset) rankingMap[r.sucursal_id] = r;

    // Aplicar overrides manuales de jornada
    const cajerosSucursal = cakerosR.recordset.map(v => ({
      nro_vendedor:     v.NRO_VENDEDOR,
      nombre:           v.nombre,
      parcial_tipo:     v.gclTemps,
      sucursal_id:      v.sucursal_id,
      parcial_override: overrides[String(v.NRO_VENDEDOR)] ?? null
    }));

    // Contexto mínimo: solo lo que necesita calcularTotal para obtener ratio_consumo
    const ctx = {
      sucursales:       sucursalesR.recordset,
      rankingMap,
      multiplicadores:  multR.recordset,
      datosConsumo:     ventasBC.datosConsumo,
      datosEfectivo:    [],
      datosReporte:     [],
      objConsumo:       objConsumoR.recordset,
      objEfectivo:      [],
      montos:           [],
      montosVendedor:   [],
      montosSupervisor: [],
      montosPrestamaos: [],
      montosCajero:     montosCajR.recordset,
      cajerosSucursal,
    };

    const sucursalResultados = calcularTotal(ctx);
    const cajeros = calcularCajeros(ctx, sucursalResultados);
    const totalMonto = cajeros.filter(c => c.comisiona).reduce((s, c) => s + c.monto, 0);

    // ── Guardar en DB: borrar período y reinsertar ────────────────
    await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_ResultadoCajeros WHERE periodo = @periodo');

    for (const c of cajeros) {
      await pool.request()
        .input('periodo',         sql.VarChar,      periodo)
        .input('nro_vendedor',    sql.Int,           c.nro_vendedor)
        .input('nombre',          sql.NVarChar(100), c.nombre)
        .input('sucursal_id',     sql.Int,           c.sucursal_id)
        .input('sucursal_nombre', sql.NVarChar(100), c.sucursal_nombre)
        .input('categoria',       sql.Char(1),       c.categoria)
        .input('vta_vta_tot',     sql.Decimal(10,4), c.vta_vta_tot)
        .input('obj_particip',    sql.Decimal(10,4), c.obj_particip)
        .input('ratio_particip',  sql.Decimal(10,4), c.ratio_particip)
        .input('comisiona',       sql.Bit,           c.comisiona ? 1 : 0)
        .input('jornada_db',      sql.VarChar(10),   c.jornada_db)
        .input('jornada',         sql.VarChar(10),   c.jornada)
        .input('monto_base',      sql.Decimal(14,2), c.monto_base)
        .input('monto_full',      sql.Decimal(14,2), c.monto_full)
        .input('monto_part',      sql.Decimal(14,2), c.monto_part)
        .input('monto',           sql.Decimal(14,2), c.monto)
        .query(`
          INSERT INTO dbo.tbl_CoVenAppINDO_ResultadoCajeros
            (periodo,nro_vendedor,nombre,sucursal_id,sucursal_nombre,categoria,
             vta_vta_tot,obj_particip,ratio_particip,comisiona,
             jornada_db,jornada,monto_base,monto_full,monto_part,monto,fecha_calculo)
          VALUES
            (@periodo,@nro_vendedor,@nombre,@sucursal_id,@sucursal_nombre,@categoria,
             @vta_vta_tot,@obj_particip,@ratio_particip,@comisiona,
             @jornada_db,@jornada,@monto_base,@monto_full,@monto_part,@monto,GETDATE())
        `);
    }

    res.json({
      periodo,
      total:        cajeros.length,
      comisionan:   cajeros.filter(c => c.comisiona).length,
      no_comisionan:cajeros.filter(c => !c.comisiona).length,
      total_monto:  totalMonto,
      resultado:    cajeros
    });
  } catch (err) { console.error('[CAJ ERROR]', err); res.status(500).json({ error: err.message }); }
});

// GET /api/calculo/cajeros?periodo=YYYY-MM  — leer resultado guardado
router.get('/cajeros', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`
        SELECT *, fecha_calculo
        FROM dbo.tbl_CoVenAppINDO_ResultadoCajeros
        WHERE periodo = @periodo
        ORDER BY sucursal_id, nombre
      `);
    if (!r.recordset.length) return res.status(404).json({ error: 'Sin cálculo guardado para este período' });
    const rows = filtrarPorSucursal(r.recordset, req.sucursalesPermitidas);
    res.json({
      periodo,
      fecha_calculo: r.recordset[0].fecha_calculo,
      total:         rows.length,
      comisionan:    rows.filter(c => c.comisiona).length,
      no_comisionan: rows.filter(c => !c.comisiona).length,
      total_monto:   rows.reduce((s, c) => s + (+c.monto || 0), 0),
      resultado:     rows
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// POST /api/calculo/ejecutar  { periodo: "2026-03" }
router.post('/ejecutar', async (req, res) => {
  const { periodo } = req.body;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    // Los objetivos (consumo + efectivo) deben bajarse de BeClever antes de todo:
    // el cache ObjConsumo/ObjEfectivo solo se llenaba al entrar a la página
    // Objetivos — sin fila en ObjEfectivo el escalón efectivo da 0 para todas
    // las sucursales y la base efectivo de Operadores/Encargados queda en cero.
    await sincronizarObjetivos(periodo);
    // El ranking (categoría A/B/C por sucursal) debe recalcularse siempre antes
    // del cálculo completo — si no, las sucursales sin fila en Ranking caen al
    // fallback 'C' y se pierden las categorías A/B reales del período.
    await calcularYGuardarRanking(pool, periodo);
    const ctx  = await cargarContexto(pool, periodo);
    const sucursalResultados = calcularTotal(ctx);
    const cajeros      = calcularCajeros(ctx, sucursalResultados);
    const operadores   = calcularOperadores(ctx, sucursalResultados);
    const encargados   = calcularEncargados(ctx, sucursalResultados);
    const encargadosMillon = calcularEncargadosMillon(ctx, sucursalResultados);
    const supervisores = calcularSupervisores(ctx, sucursalResultados);

    // Operadores Retail y Millón tienen sus propias tablas de resultado
    // (ResultadoOperadores / ResultadoOpMillon), leídas por sus páginas —
    // se recalculan y persisten acá para que no dependan de que el usuario
    // entre a cada página a apretar su botón propio.
    await calcularYGuardarOperadores(pool, periodo);
    await calcularYGuardarOperadoresMillon(pool, periodo);

    const resultado = { sucursales: sucursalResultados, cajeros, operadores, encargados, encargadosMillon, supervisores };

    // Guardar historial
    await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .input('usuario', sql.VarChar, req.user.usuario)
      .input('resultado_json', sql.NVarChar(sql.MAX), JSON.stringify(resultado))
      .query(`
        INSERT INTO dbo.tbl_CoVenAppINDO_CalculoHistorial (periodo, usuario, resultado_json)
        VALUES (@periodo, @usuario, @resultado_json)
      `);

    res.json({
      periodo,
      total_sucursales:  sucursalResultados.length,
      total_cajeros:     cajeros.length,
      total_operadores:  operadores.length,
      total_encargados:  encargados.length,
      total_encargados_millon: encargadosMillon.length,
      total_supervisores: supervisores.length,
      resultado
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// GET /api/calculo/ultimo?periodo=2026-03
router.get('/ultimo', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`
        SELECT TOP 1 id, periodo, fecha_calculo, usuario, resultado_json
        FROM dbo.tbl_CoVenAppINDO_CalculoHistorial
        WHERE periodo = @periodo
        ORDER BY fecha_calculo DESC
      `);
    if (!r.recordset.length) return res.status(404).json({ error: 'Sin cálculo guardado' });
    const row = r.recordset[0];
    const resultado = JSON.parse(row.resultado_json);
    const filtrado = {
      ...resultado,
      sucursales:      filtrarPorSucursal(resultado.sucursales || [], req.sucursalesPermitidas),
      cajeros:         filtrarPorSucursal(resultado.cajeros || [], req.sucursalesPermitidas),
      operadores:      filtrarPorSucursal(resultado.operadores || [], req.sucursalesPermitidas),
      encargados:      filtrarPorSucursal(resultado.encargados || [], req.sucursalesPermitidas),
      encargadosMillon: filtrarPorSucursal(resultado.encargadosMillon || [], req.sucursalesPermitidas),
      supervisores: req.user.perfil === 8
        ? (resultado.supervisores || []).filter(s => req.supervisorId && s.id === req.supervisorId)
        : (resultado.supervisores || []),
    };
    res.json({
      id:            row.id,
      periodo:       row.periodo,
      fecha_calculo: row.fecha_calculo,
      usuario:       row.usuario,
      resultado:     filtrado
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// GET /api/calculo/encargados?periodo=YYYY-MM  — lee desde el último cálculo guardado
router.get('/encargados', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`
        SELECT TOP 1 resultado_json, fecha_calculo, usuario
        FROM dbo.tbl_CoVenAppINDO_CalculoHistorial
        WHERE periodo = @periodo
        ORDER BY fecha_calculo DESC
      `);
    if (!r.recordset.length) return res.status(404).json({ error: 'Sin cálculo guardado para este período' });
    const row     = r.recordset[0];
    const res_obj = JSON.parse(row.resultado_json);
    const encargados = filtrarPorSucursal(res_obj.encargados || [], req.sucursalesPermitidas);
    res.json({
      periodo,
      fecha_calculo: row.fecha_calculo,
      usuario:       row.usuario,
      total:         encargados.length,
      total_monto:   encargados.reduce((s, e) => s + (e.monto || 0), 0),
      resultado:     encargados,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/calculo/encargados-millon?periodo=YYYY-MM — lee desde el último cálculo guardado
router.get('/encargados-millon', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`
        SELECT TOP 1 resultado_json, fecha_calculo, usuario
        FROM dbo.tbl_CoVenAppINDO_CalculoHistorial
        WHERE periodo = @periodo
        ORDER BY fecha_calculo DESC
      `);
    if (!r.recordset.length) return res.status(404).json({ error: 'Sin cálculo guardado para este período' });
    const row     = r.recordset[0];
    const res_obj = JSON.parse(row.resultado_json);
    const encargadosMillon = filtrarPorSucursal(res_obj.encargadosMillon || [], req.sucursalesPermitidas);
    res.json({
      periodo,
      fecha_calculo: row.fecha_calculo,
      usuario:       row.usuario,
      total:         encargadosMillon.length,
      total_monto:   encargadosMillon.reduce((s, e) => s + (e.monto || 0), 0),
      resultado:     encargadosMillon,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/calculo/supervisores?periodo=YYYY-MM — lee desde el último cálculo guardado
router.get('/supervisores', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`
        SELECT TOP 1 resultado_json, fecha_calculo, usuario
        FROM dbo.tbl_CoVenAppINDO_CalculoHistorial
        WHERE periodo = @periodo
        ORDER BY fecha_calculo DESC
      `);
    if (!r.recordset.length) return res.status(404).json({ error: 'Sin cálculo guardado para este período' });
    const row     = r.recordset[0];
    const res_obj = JSON.parse(row.resultado_json);
    let supervisores = res_obj.supervisores || [];
    if (req.user.perfil === 8) {
      supervisores = req.supervisorId
        ? supervisores.filter(s => s.id === req.supervisorId)
        : [];
    }
    res.json({
      periodo,
      fecha_calculo: row.fecha_calculo,
      usuario:       row.usuario,
      total:         supervisores.length,
      total_monto:   supervisores.reduce((s, e) => s + (e.monto || 0), 0),
      resultado:     supervisores,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// GET /api/calculo/historial?periodo=2026-03
router.get('/historial', async (req, res) => {
  const { periodo } = req.query;
  try {
    const pool = await getPool();
    const q = pool.request();
    let where = '';
    if (periodo) { q.input('periodo', sql.VarChar, periodo); where = 'WHERE periodo = @periodo'; }
    const r = await q.query(`
      SELECT id, periodo, fecha_calculo, usuario
      FROM dbo.tbl_CoVenAppINDO_CalculoHistorial
      ${where}
      ORDER BY fecha_calculo DESC
    `);
    res.json(r.recordset);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

export default router;
