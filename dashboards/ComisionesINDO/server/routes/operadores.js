import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { getPoolBC } from '../config/dbBeClever.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
import { calcularTotal, calcularOperadores } from '../services/calcEngine.js';
import { cargarMontosDelPeriodo } from '../services/montosHistorial.js';

const router = Router();
router.use(authMiddleware);
router.use(attachScope);
router.use(blockWriteIfSupervisor);

// ── Asegurar que existen las tablas necesarias ────────────────────────────────
async function ensureTables(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE type='U' AND name='tbl_CoVenAppINDO_OperadoresJornada')
    CREATE TABLE dbo.tbl_CoVenAppINDO_OperadoresJornada (
      id                    INT IDENTITY PRIMARY KEY,
      usuario               VARCHAR(50)  NOT NULL,
      jornada               VARCHAR(10)  NOT NULL DEFAULT 'full',
      fecha_modificacion    DATETIME     NOT NULL DEFAULT GETDATE(),
      usuario_modificacion  VARCHAR(50)  NULL,
      CONSTRAINT UQ_OperadoresJornada_usuario UNIQUE (usuario)
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE type='U' AND name='tbl_CoVenAppINDO_ResultadoOperadores')
    CREATE TABLE dbo.tbl_CoVenAppINDO_ResultadoOperadores (
      id               INT IDENTITY PRIMARY KEY,
      periodo          VARCHAR(7)    NOT NULL,
      usuario          VARCHAR(50)   NOT NULL,
      nombre           VARCHAR(100)  NULL,
      sucursal_id      INT           NULL,
      sucursal_nombre  VARCHAR(100)  NULL,
      categoria        CHAR(1)       NULL,
      tiene_efectivo   BIT           NULL,
      tipo_operador    VARCHAR(20)   NULL,
      escalon          INT           NULL,
      escalon_consumo  INT           NULL,
      escalon_efectivo INT           NULL,
      indicador_g      DECIMAL(8,4)  NULL,
      indicador_o      DECIMAL(8,4)  NULL,
      indicador_r      DECIMAL(8,4)  NULL,
      calc_consumo     DECIMAL(14,2) NULL,
      calc_efectivo    DECIMAL(14,2) NULL,
      sin_operador     BIT           NOT NULL DEFAULT 0,
      jornada          VARCHAR(10)   NULL,
      monto_full       DECIMAL(14,2) NULL,
      monto_part       DECIMAL(14,2) NULL,
      monto            DECIMAL(14,2) NULL,
      fecha_calculo    DATETIME      NOT NULL DEFAULT GETDATE()
    )
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_ResultadoOp_periodo' AND object_id=OBJECT_ID('dbo.tbl_CoVenAppINDO_ResultadoOperadores'))
    CREATE INDEX IX_ResultadoOp_periodo ON dbo.tbl_CoVenAppINDO_ResultadoOperadores(periodo)
  `);
  // Agregar columnas nuevas si la tabla ya existía sin ellas
  for (const [col, def] of [
    ['escalon_consumo',  'INT NULL'],
    ['escalon_efectivo', 'INT NULL'],
    ['indicador_g',      'DECIMAL(8,4) NULL'],
    ['indicador_o',      'DECIMAL(8,4) NULL'],
    ['indicador_r',      'DECIMAL(8,4) NULL'],
    ['calc_consumo',     'DECIMAL(14,2) NULL'],
    ['calc_efectivo',    'DECIMAL(14,2) NULL'],
    ['sin_operador',     'BIT NOT NULL DEFAULT 0'],
    ['ratio_consumo',    'DECIMAL(8,4) NULL'],
    ['ratio_efectivo',   'DECIMAL(8,4) NULL'],
    ['marcador',         'VARCHAR(10) NULL'],
    ['comp_escalon',     'DECIMAL(14,2) NULL'],
    ['comp_particip',    'DECIMAL(14,2) NULL'],
    ['comp_ticket',      'DECIMAL(14,2) NULL'],
    ['comp_operacion',   'DECIMAL(14,2) NULL'],
  ]) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.tbl_CoVenAppINDO_ResultadoOperadores')
          AND name = '${col}'
      )
      ALTER TABLE dbo.tbl_CoVenAppINDO_ResultadoOperadores ADD ${col} ${def}
    `);
  }
}

// ── GET /api/operadores?periodo= — resultado guardado ─────────────────────────
router.get('/', async (req, res) => {
  const { periodo } = req.query;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const r = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`
        SELECT * FROM dbo.tbl_CoVenAppINDO_ResultadoOperadores
        WHERE periodo = @periodo
        ORDER BY sucursal_id, nombre
      `);
    if (!r.recordset.length)
      return res.status(404).json({ error: 'Sin cálculo guardado para este período' });

    const rows = filtrarPorSucursal(r.recordset, req.sucursalesPermitidas);
    res.json({
      periodo,
      fecha_calculo: r.recordset[0].fecha_calculo,
      total:         rows.length,
      total_monto:   rows.reduce((s, c) => s + (+c.monto || 0), 0),
      resultado:     rows
    });
  } catch (err) { console.error('[OP GET]', err); res.status(500).json({ error: err.message }); }
});

// ── GET /api/operadores/jornadas?periodo= — todas las jornadas persistentes ──
// Sin periodo (o perfil sin restricción): devuelve todas. Con perfil supervisor,
// requiere periodo para poder resolver a qué sucursal pertenece cada operador
// (jornada no tiene sucursal propia) y filtrar por sus sucursales asignadas.
router.get('/jornadas', async (req, res) => {
  try {
    const pool = await getPool();
    await ensureTables(pool);
    const r = await pool.request()
      .query('SELECT usuario, jornada, fecha_modificacion, usuario_modificacion FROM dbo.tbl_CoVenAppINDO_OperadoresJornada ORDER BY usuario');

    if (req.sucursalesPermitidas === null) return res.json(r.recordset);

    const { periodo } = req.query;
    if (!periodo) return res.json([]);

    const sucPorUsuario = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query(`SELECT usuario, sucursal_id FROM dbo.tbl_CoVenAppINDO_ResultadoOperadores WHERE periodo = @periodo`);
    const permitidos = new Set(
      sucPorUsuario.recordset
        .filter(x => req.sucursalesPermitidas.includes(x.sucursal_id))
        .map(x => x.usuario.toUpperCase())
    );
    res.json(r.recordset.filter(j => permitidos.has(j.usuario.toUpperCase())));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/operadores/:usuario/jornada — guardar jornada persistente ──────
router.patch('/:usuario/jornada', async (req, res) => {
  const usuario = req.params.usuario.toUpperCase().trim();
  const { jornada } = req.body;
  if (!['full', 'part'].includes(jornada))
    return res.status(400).json({ error: 'jornada debe ser "full" o "part"' });

  try {
    const pool = await getPool();
    await ensureTables(pool);
    await pool.request()
      .input('usuario',     sql.VarChar(50), usuario)
      .input('jornada',     sql.VarChar(10), jornada)
      .input('usuarioMod',  sql.VarChar(50), req.user.usuario)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_OperadoresJornada WHERE usuario = @usuario)
          UPDATE dbo.tbl_CoVenAppINDO_OperadoresJornada
          SET jornada=@jornada, fecha_modificacion=GETDATE(), usuario_modificacion=@usuarioMod
          WHERE usuario=@usuario
        ELSE
          INSERT INTO dbo.tbl_CoVenAppINDO_OperadoresJornada (usuario, jornada, usuario_modificacion)
          VALUES (@usuario, @jornada, @usuarioMod)
      `);
    res.json({ ok: true, usuario, jornada });
  } catch (err) { console.error('[OP JORNADA]', err); res.status(500).json({ error: err.message }); }
});

// ── POST /api/operadores/calcular — calcular y guardar para el período ─────────
router.post('/calcular', async (req, res) => {
  const { periodo } = req.body;
  if (!periodo) return res.status(400).json({ error: 'Período requerido' });

  try {
    const pool = await getPool();
    const resultado = await calcularYGuardarOperadores(pool, periodo);
    res.json(resultado);
  } catch (err) { console.error('[OP CALC]', err); res.status(500).json({ error: err.message }); }
});

// Recalcula Operadores Retail (indicadores G/O/R por operador) y persiste en
// tbl_CoVenAppINDO_ResultadoOperadores. Se usa desde /calcular y desde
// POST /api/calculo/ejecutar (Dashboard) — cálculo puro, sin overrides de usuario.
export async function calcularYGuardarOperadores(pool, periodo) {
    await ensureTables(pool);
    const [yr, mo] = periodo.split('-').map(Number);

    // Cargar datos necesarios en paralelo
    const [
      sucursalesR, rankingR,
      objConsumoR, objEfectivoR,
      montosDelPeriodo,
      jornadasR, qlikUsuariosR
    ] = await Promise.all([
      pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 AND activa=1 ORDER BY id'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@periodo'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@periodo'),
      pool.request().input('periodo', sql.VarChar, periodo)
           .query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@periodo'),
      cargarMontosDelPeriodo(pool, periodo),
      pool.request().query('SELECT usuario, jornada FROM dbo.tbl_CoVenAppINDO_OperadoresJornada'),
      pool.request().query("SELECT UPPER(LTRIM(RTRIM(Usuario))) AS id_usuario, LTRIM(RTRIM(Nombre)) AS nombre FROM dbo.tbl_QlikData_Usuarios"),
    ]);

    // Cargar reporte desde BeClever
    const bcPool = await getPoolBC();
    const reporteR = await bcPool.request()
      .input('Anio', sql.Int, yr)
      .input('Mes',  sql.Int, mo)
      .execute('dbo.sp_ReporteOriginacionesCreditos');

    const datosReporte = reporteR.recordset.map(r => ({
      usuario_originador: r.IdUsuario,
      id_sucursal:        r.IdSucursalEntidad,
    }));

    // Cargar ventas BC para calcularTotal (necesita consumo y efectivo)
    const spVentas = await bcPool.request()
      .input('Anio', sql.Int, yr)
      .input('Mes',  sql.Int, mo)
      .execute('dbo.sp_ReporteVentasCobrosObjetivos');

    const comercioR = await bcPool.request()
      .query('SELECT Cod_Comercio, Descripcion FROM dbo.COMERCIO');
    const idByNombre = {};
    for (const c of comercioR.recordset) idByNombre[c.Descripcion.trim()] = c.Cod_Comercio;

    const mapVenta = (r) => {
      const sucId = idByNombre[r.Sucursal?.trim()] ?? null;
      return {
        sucursal_id:      sucId,
        ventas:           r.Ventas           ?? 0,
        vta_vta_tot:      r['VTA/VTATOT']    ?? 0,
        credito_promedio: r.CredProm         ?? 0,
        operaciones:      r.Operaciones      ?? 0,
      };
    };
    const datosConsumo  = spVentas.recordset.filter(r => r.Producto?.trim() === 'CONSUMO').map(r => mapVenta(r));
    const datosEfectivo = spVentas.recordset.filter(r => r.Producto?.trim() === 'EFECTIVO').map(r => mapVenta(r));

    // Construir maps
    const rankingMap = {};
    for (const r of rankingR.recordset) rankingMap[r.sucursal_id] = r;

    const jornadasMap = {};
    for (const j of jornadasR.recordset) jornadasMap[j.usuario.toUpperCase()] = j.jornada;

    const operadorMap = {};
    for (const u of qlikUsuariosR.recordset) operadorMap[u.id_usuario] = u.nombre;

    // Contexto para calcularTotal + calcularOperadores
    const ctx = {
      sucursales:       sucursalesR.recordset,
      rankingMap,
      multiplicadores:  montosDelPeriodo.multiplicadores,
      datosConsumo,
      datosEfectivo,
      datosReporte,
      objConsumo:       objConsumoR.recordset,
      objEfectivo:      objEfectivoR.recordset,
      montos:           montosDelPeriodo.montos,
      montosVendedor:   [],
      montosSupervisor: [],
      montosPrestamaos: montosDelPeriodo.montosPrestamaos,
      montosCajero:     [],
      jornadasMap,
      operadorMap,
    };

    const sucResultados = calcularTotal(ctx);
    const operadores    = calcularOperadores(ctx, sucResultados);

    // Guardar: borrar período y reinsertar
    await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query('DELETE FROM dbo.tbl_CoVenAppINDO_ResultadoOperadores WHERE periodo=@periodo');

    for (const op of operadores) {
      await pool.request()
        .input('periodo',          sql.VarChar(7),    periodo)
        .input('usuario',          sql.VarChar(50),   op.usuario)
        .input('nombre',           sql.NVarChar(100), op.nombre)
        .input('sucursal_id',      sql.Int,            op.sucursal_id)
        .input('sucursal_nombre',  sql.NVarChar(100), op.sucursal_nombre)
        .input('categoria',        sql.Char(1),        op.categoria)
        .input('tiene_efectivo',   sql.Bit,            op.tiene_efectivo ? 1 : 0)
        .input('tipo_operador',    sql.VarChar(20),   op.tipo_operador)
        .input('escalon',          sql.Int,            op.escalon_consumo)
        .input('escalon_consumo',  sql.Int,            op.escalon_consumo)
        .input('escalon_efectivo', sql.Int,            op.escalon_efectivo)
        .input('indicador_g',      sql.Decimal(8,4),  op.indicador_g)
        .input('indicador_o',      sql.Decimal(8,4),  op.indicador_o)
        .input('indicador_r',      sql.Decimal(8,4),  op.indicador_r)
        .input('calc_consumo',     sql.Decimal(14,2), op.calc_consumo)
        .input('calc_efectivo',    sql.Decimal(14,2), op.calc_efectivo)
        .input('sin_operador',     sql.Bit,            op.sin_operador ? 1 : 0)
        .input('jornada',          sql.VarChar(10),   op.jornada)
        .input('monto_full',       sql.Decimal(14,2), op.monto_full)
        .input('monto_part',       sql.Decimal(14,2), op.monto_part)
        .input('monto',            sql.Decimal(14,2), op.monto)
        .input('ratio_consumo',    sql.Decimal(8,4),  op.ratio_consumo ?? 0)
        .input('ratio_efectivo',   sql.Decimal(8,4),  op.ratio_efectivo ?? 0)
        .input('marcador',         sql.VarChar(10),   op.marcador ?? null)
        .input('comp_escalon',     sql.Decimal(14,2), op.comp_escalon ?? 0)
        .input('comp_particip',    sql.Decimal(14,2), op.comp_particip ?? 0)
        .input('comp_ticket',      sql.Decimal(14,2), op.comp_ticket ?? 0)
        .input('comp_operacion',   sql.Decimal(14,2), op.comp_operacion ?? 0)
        .query(`
          INSERT INTO dbo.tbl_CoVenAppINDO_ResultadoOperadores
            (periodo,usuario,nombre,sucursal_id,sucursal_nombre,categoria,
             tiene_efectivo,tipo_operador,escalon,escalon_consumo,escalon_efectivo,
             indicador_g,indicador_o,indicador_r,calc_consumo,calc_efectivo,
             sin_operador,jornada,monto_full,monto_part,monto,
             ratio_consumo,ratio_efectivo,marcador,
             comp_escalon,comp_particip,comp_ticket,comp_operacion,fecha_calculo)
          VALUES
            (@periodo,@usuario,@nombre,@sucursal_id,@sucursal_nombre,@categoria,
             @tiene_efectivo,@tipo_operador,@escalon,@escalon_consumo,@escalon_efectivo,
             @indicador_g,@indicador_o,@indicador_r,@calc_consumo,@calc_efectivo,
             @sin_operador,@jornada,@monto_full,@monto_part,@monto,
             @ratio_consumo,@ratio_efectivo,@marcador,
             @comp_escalon,@comp_particip,@comp_ticket,@comp_operacion,GETDATE())
        `);
    }

    return {
      periodo,
      total:       operadores.length,
      total_monto: operadores.reduce((s, o) => s + o.monto, 0),
      resultado:   operadores
    };
}

export default router;
