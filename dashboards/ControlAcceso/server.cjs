'use strict';

require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const sql     = require('mssql');

// ── Configuración ─────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3012;
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'cambiar-en-el-env';
const TOKEN_HORAS  = parseInt(process.env.TOKEN_HORAS || '12', 10);

const SQL_CONFIG = {
  server:   process.env.SQL_SERVER   || '10.0.0.115',
  database: process.env.SQL_DATABASE || 'db_Cegid',
  user:     process.env.SQL_USER     || 'sa',
  password: process.env.SQL_PASSWORD || '',
  options: {
    encrypt:                false,
    trustServerCertificate: true,
    enableArithAbort:       true,
    connectTimeout:         30000
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

// ── Pool SQL (singleton) ──────────────────────────────────────────────────────
let pool = null;
async function getPool() {
  if (!pool) pool = await sql.connect(SQL_CONFIG);
  return pool;
}

// ── Password hash (scrypt) ────────────────────────────────────────────────────
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(pw, salt, 64);
  const ref  = Buffer.from(hash, 'hex');
  return calc.length === ref.length && crypto.timingSafeEqual(calc, ref);
}

// ── Tokens (payload firmado HMAC) ─────────────────────────────────────────────
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function firmar(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig  = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verificarToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const esperado = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload; // { u, n, r, exp }
  } catch { return null; }
}

// Middleware de autenticación. rol: undefined = cualquiera logueado, 'ADMIN' = solo admin
function auth(rol) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const payload = verificarToken(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!payload) return res.status(401).json({ error: 'Sesión inválida o vencida' });
    if (rol && payload.r !== rol) return res.status(403).json({ error: 'Permisos insuficientes' });
    req.user = payload;
    next();
  };
}

// ── Esquema (idempotente) ─────────────────────────────────────────────────────
const SCHEMA_SQL = `
IF OBJECT_ID('dbo.tbl_CtrlAcceso_Usuarios') IS NULL
CREATE TABLE dbo.tbl_CtrlAcceso_Usuarios (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  Usuario   NVARCHAR(50)  NOT NULL UNIQUE,
  Nombre    NVARCHAR(100) NOT NULL,
  Hash      NVARCHAR(200) NOT NULL,
  Rol       NVARCHAR(10)  NOT NULL CHECK (Rol IN ('PORTERO','ADMIN')),
  Activo    BIT NOT NULL DEFAULT 1,
  CreadoEn  DATETIME NOT NULL DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.tbl_CtrlAcceso_Vehiculos') IS NULL
CREATE TABLE dbo.tbl_CtrlAcceso_Vehiculos (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  Patente     NVARCHAR(15)  NOT NULL UNIQUE,
  Tipo        NVARCHAR(10)  NOT NULL CHECK (Tipo IN ('TRACTOR','SEMI')),
  Descripcion NVARCHAR(100) NULL,
  Activo      BIT NOT NULL DEFAULT 1,
  CreadoEn    DATETIME NOT NULL DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.tbl_CtrlAcceso_Conductores') IS NULL
CREATE TABLE dbo.tbl_CtrlAcceso_Conductores (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  Nombre    NVARCHAR(100) NOT NULL,
  Documento NVARCHAR(20)  NULL,
  Activo    BIT NOT NULL DEFAULT 1,
  CreadoEn  DATETIME NOT NULL DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.tbl_CtrlAcceso_Movimientos') IS NULL
CREATE TABLE dbo.tbl_CtrlAcceso_Movimientos (
  Id             INT IDENTITY(1,1) PRIMARY KEY,
  FechaHora      DATETIME      NOT NULL,
  Tipo           NVARCHAR(10)  NOT NULL CHECK (Tipo IN ('INGRESO','EGRESO')),
  EsPropio       BIT           NOT NULL,
  -- vehículos propios (catálogo)
  IdTractor      INT NULL REFERENCES dbo.tbl_CtrlAcceso_Vehiculos(Id),
  IdSemi         INT NULL REFERENCES dbo.tbl_CtrlAcceso_Vehiculos(Id),
  IdConductor    INT NULL REFERENCES dbo.tbl_CtrlAcceso_Conductores(Id),
  Kilometraje    DECIMAL(12,1) NULL,
  DestinoOrigen  NVARCHAR(200) NULL,
  NroViaje       NVARCHAR(30)  NULL,
  NroRemito      NVARCHAR(30)  NULL,
  -- vehículos no propios (texto libre normalizado)
  Patente        NVARCHAR(15)  NULL,
  TipoVehiculo   NVARCHAR(30)  NULL,
  ConductorNom   NVARCHAR(100) NULL,
  Observaciones  NVARCHAR(500) NULL,
  UsuarioCarga   NVARCHAR(50)  NOT NULL,
  CreadoEn       DATETIME NOT NULL DEFAULT GETDATE(),
  Anulado        BIT NOT NULL DEFAULT 0,
  AnuladoPor     NVARCHAR(50) NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_CtrlAcceso_Mov_Fecha')
CREATE INDEX IX_CtrlAcceso_Mov_Fecha ON dbo.tbl_CtrlAcceso_Movimientos (FechaHora DESC) INCLUDE (Tipo, EsPropio, Anulado);
`;

async function ensureSchema() {
  const p = await getPool();
  await p.request().batch(SCHEMA_SQL);
  // seed: si no hay usuarios, crear admin/admin (cambiar al primer ingreso)
  const r = await p.request().query('SELECT COUNT(*) AS n FROM dbo.tbl_CtrlAcceso_Usuarios');
  if (r.recordset[0].n === 0) {
    await p.request()
      .input('Hash', sql.NVarChar, hashPassword('admin'))
      .query(`INSERT INTO dbo.tbl_CtrlAcceso_Usuarios (Usuario, Nombre, Hash, Rol)
              VALUES ('admin', 'Administrador', @Hash, 'ADMIN')`);
    console.log('[ControlAcceso] Usuario inicial creado: admin / admin  (¡cambiar la contraseña!)');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normPatente(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
const TIPOS_VEHICULO = ['CAMION', 'CAMIONETA', 'AUTO', 'UTILITARIO', 'MOTO', 'OTRO'];

// Último movimiento no anulado de un vehículo propio (por Id de catálogo)
async function ultimoEstadoVehiculo(p, idVehiculo) {
  const r = await p.request()
    .input('Id', sql.Int, idVehiculo)
    .query(`SELECT TOP 1 Tipo, FechaHora, Kilometraje
            FROM dbo.tbl_CtrlAcceso_Movimientos
            WHERE Anulado = 0 AND (IdTractor = @Id OR IdSemi = @Id)
            ORDER BY FechaHora DESC, Id DESC`);
  return r.recordset[0] || null;
}

// Último movimiento no anulado de una patente no propia
async function ultimoEstadoPatente(p, patente) {
  const r = await p.request()
    .input('Pat', sql.NVarChar, patente)
    .query(`SELECT TOP 1 Tipo, FechaHora
            FROM dbo.tbl_CtrlAcceso_Movimientos
            WHERE Anulado = 0 AND EsPropio = 0 AND Patente = @Pat
            ORDER BY FechaHora DESC, Id DESC`);
  return r.recordset[0] || null;
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// POST /api/login
app.post('/api/login', async (req, res) => {
  const usuario  = String(req.body.usuario || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  try {
    const p = await getPool();
    const r = await p.request()
      .input('U', sql.NVarChar, usuario)
      .query('SELECT Id, Usuario, Nombre, Hash, Rol, Activo FROM dbo.tbl_CtrlAcceso_Usuarios WHERE Usuario = @U');
    const u = r.recordset[0];
    if (!u || !u.Activo || !verifyPassword(password, u.Hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const payload = { u: u.Usuario, n: u.Nombre, r: u.Rol, exp: Date.now() + TOKEN_HORAS * 3600 * 1000 };
    res.json({ token: firmar(payload), usuario: u.Usuario, nombre: u.Nombre, rol: u.Rol });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/me — valida el token vigente
app.get('/api/me', auth(), (req, res) => {
  res.json({ usuario: req.user.u, nombre: req.user.n, rol: req.user.r });
});

// PUT /api/mi-password — cambio de contraseña propio
app.put('/api/mi-password', auth(), async (req, res) => {
  const actual = String(req.body.actual || '');
  const nueva  = String(req.body.nueva || '');
  if (nueva.length < 4) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  try {
    const p = await getPool();
    const r = await p.request()
      .input('U', sql.NVarChar, req.user.u)
      .query('SELECT Hash FROM dbo.tbl_CtrlAcceso_Usuarios WHERE Usuario = @U AND Activo = 1');
    if (!r.recordset[0] || !verifyPassword(actual, r.recordset[0].Hash)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }
    await p.request()
      .input('U', sql.NVarChar, req.user.u)
      .input('H', sql.NVarChar, hashPassword(nueva))
      .query('UPDATE dbo.tbl_CtrlAcceso_Usuarios SET Hash = @H WHERE Usuario = @U');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catálogos ─────────────────────────────────────────────────────────────────

// GET /api/vehiculos?tipo=TRACTOR|SEMI&todos=1
app.get('/api/vehiculos', auth(), async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request()
      .input('Tipo',  sql.NVarChar, req.query.tipo || null)
      .input('Todos', sql.Bit, req.query.todos === '1' ? 1 : 0)
      .query(`SELECT Id, Patente, Tipo, Descripcion, Activo
              FROM dbo.tbl_CtrlAcceso_Vehiculos
              WHERE (@Tipo IS NULL OR Tipo = @Tipo) AND (@Todos = 1 OR Activo = 1)
              ORDER BY Tipo, Patente`);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/conductores?todos=1
app.get('/api/conductores', auth(), async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request()
      .input('Todos', sql.Bit, req.query.todos === '1' ? 1 : 0)
      .query(`SELECT Id, Nombre, Documento, Activo
              FROM dbo.tbl_CtrlAcceso_Conductores
              WHERE (@Todos = 1 OR Activo = 1)
              ORDER BY Nombre`);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tipos-vehiculo — opciones para vehículos no propios
app.get('/api/tipos-vehiculo', auth(), (req, res) => res.json(TIPOS_VEHICULO));

// ── Movimientos ───────────────────────────────────────────────────────────────

// POST /api/movimientos — alta con validación de coherencia (forzar:true la saltea)
app.post('/api/movimientos', auth(), async (req, res) => {
  const b = req.body || {};
  const tipo = String(b.tipo || '').toUpperCase();
  const esPropio = !!b.esPropio;
  const forzar = !!b.forzar;
  if (!['INGRESO', 'EGRESO'].includes(tipo)) return res.status(400).json({ error: 'Tipo de movimiento inválido' });
  const fechaHora = b.fechaHora ? new Date(b.fechaHora) : new Date();
  if (isNaN(fechaHora.getTime())) return res.status(400).json({ error: 'Fecha/hora inválida' });

  try {
    const p = await getPool();
    const avisos = [];

    if (esPropio) {
      const idTractor   = b.idTractor ? parseInt(b.idTractor, 10) : null;
      const idSemi      = b.idSemi ? parseInt(b.idSemi, 10) : null;
      const idConductor = b.idConductor ? parseInt(b.idConductor, 10) : null;
      if (!idTractor && !idSemi) return res.status(400).json({ error: 'Seleccioná al menos tractor o semirremolque' });
      if (!idConductor) return res.status(400).json({ error: 'Seleccioná el conductor' });
      const km = (b.kilometraje !== undefined && b.kilometraje !== null && b.kilometraje !== '')
        ? parseFloat(b.kilometraje) : null;
      if (km !== null && (isNaN(km) || km < 0)) return res.status(400).json({ error: 'Kilometraje inválido' });

      // validar catálogo (activos y del tipo correcto)
      for (const [id, tipoV, rotulo] of [[idTractor, 'TRACTOR', 'tractor'], [idSemi, 'SEMI', 'semirremolque']]) {
        if (!id) continue;
        const r = await p.request().input('Id', sql.Int, id)
          .query('SELECT Tipo, Activo FROM dbo.tbl_CtrlAcceso_Vehiculos WHERE Id = @Id');
        const v = r.recordset[0];
        if (!v || !v.Activo || v.Tipo !== tipoV) return res.status(400).json({ error: `El ${rotulo} seleccionado no es válido` });
      }
      const rc = await p.request().input('Id', sql.Int, idConductor)
        .query('SELECT Activo FROM dbo.tbl_CtrlAcceso_Conductores WHERE Id = @Id');
      if (!rc.recordset[0] || !rc.recordset[0].Activo) return res.status(400).json({ error: 'El conductor seleccionado no es válido' });

      // coherencia: no repetir el mismo tipo de movimiento consecutivo
      for (const [id, rotulo] of [[idTractor, 'tractor'], [idSemi, 'semirremolque']]) {
        if (!id) continue;
        const ult = await ultimoEstadoVehiculo(p, id);
        if (ult && ult.Tipo === tipo) {
          avisos.push(`El ${rotulo} ya registra un ${tipo} como último movimiento (${new Date(ult.FechaHora).toLocaleString('es-AR')}). ¿Está ${tipo === 'INGRESO' ? 'dentro' : 'fuera'} dos veces?`);
        }
        if (rotulo === 'tractor' && km !== null && ult && ult.Kilometraje !== null && km < ult.Kilometraje) {
          avisos.push(`El kilometraje (${km}) es menor al último registrado (${ult.Kilometraje}).`);
        }
      }
      if (avisos.length && !forzar) return res.status(409).json({ avisos });

      await p.request()
        .input('FechaHora',     sql.DateTime,  fechaHora)
        .input('Tipo',          sql.NVarChar,  tipo)
        .input('IdTractor',     sql.Int,       idTractor)
        .input('IdSemi',        sql.Int,       idSemi)
        .input('IdConductor',   sql.Int,       idConductor)
        .input('Kilometraje',   sql.Decimal(12, 1), km)
        .input('DestinoOrigen', sql.NVarChar,  (b.destinoOrigen || '').trim() || null)
        .input('NroViaje',      sql.NVarChar,  (b.nroViaje || '').trim() || null)
        .input('NroRemito',     sql.NVarChar,  (b.nroRemito || '').trim() || null)
        .input('Observaciones', sql.NVarChar,  (b.observaciones || '').trim() || null)
        .input('Usuario',       sql.NVarChar,  req.user.u)
        .query(`INSERT INTO dbo.tbl_CtrlAcceso_Movimientos
                (FechaHora, Tipo, EsPropio, IdTractor, IdSemi, IdConductor, Kilometraje, DestinoOrigen, NroViaje, NroRemito, Observaciones, UsuarioCarga)
                VALUES (@FechaHora, @Tipo, 1, @IdTractor, @IdSemi, @IdConductor, @Kilometraje, @DestinoOrigen, @NroViaje, @NroRemito, @Observaciones, @Usuario)`);
    } else {
      const patente = normPatente(b.patente);
      if (patente.length < 5) return res.status(400).json({ error: 'Patente inválida (mínimo 5 caracteres alfanuméricos)' });
      const tipoVehiculo = String(b.tipoVehiculo || '').toUpperCase();
      if (!TIPOS_VEHICULO.includes(tipoVehiculo)) return res.status(400).json({ error: 'Elegí el tipo de vehículo' });

      const ult = await ultimoEstadoPatente(p, patente);
      if (ult && ult.Tipo === tipo) {
        avisos.push(`La patente ${patente} ya registra un ${tipo} como último movimiento (${new Date(ult.FechaHora).toLocaleString('es-AR')}).`);
      }
      if (avisos.length && !forzar) return res.status(409).json({ avisos });

      await p.request()
        .input('FechaHora',     sql.DateTime, fechaHora)
        .input('Tipo',          sql.NVarChar, tipo)
        .input('Patente',       sql.NVarChar, patente)
        .input('TipoVehiculo',  sql.NVarChar, tipoVehiculo)
        .input('ConductorNom',  sql.NVarChar, (b.conductorNombre || '').trim() || null)
        .input('Observaciones', sql.NVarChar, (b.observaciones || '').trim() || null)
        .input('Usuario',       sql.NVarChar, req.user.u)
        .query(`INSERT INTO dbo.tbl_CtrlAcceso_Movimientos
                (FechaHora, Tipo, EsPropio, Patente, TipoVehiculo, ConductorNom, Observaciones, UsuarioCarga)
                VALUES (@FechaHora, @Tipo, 0, @Patente, @TipoVehiculo, @ConductorNom, @Observaciones, @Usuario)`);
    }
    res.json({ ok: true, avisos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/movimientos?desde&hasta&tipo&propio&buscar&limite
app.get('/api/movimientos', auth(), async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request()
      .input('Desde',  sql.DateTime, req.query.desde ? new Date(req.query.desde) : null)
      .input('Hasta',  sql.DateTime, req.query.hasta ? new Date(req.query.hasta + 'T23:59:59') : null)
      .input('Tipo',   sql.NVarChar, req.query.tipo || null)
      .input('Propio', sql.Bit,      req.query.propio === '' || req.query.propio === undefined ? null : (req.query.propio === '1' ? 1 : 0))
      .input('Buscar', sql.NVarChar, req.query.buscar ? `%${normPatente(req.query.buscar)}%` : null)
      .input('Limite', sql.Int,      Math.min(parseInt(req.query.limite) || 500, 2000))
      .query(`SELECT TOP (@Limite)
                m.Id, m.FechaHora, m.Tipo, m.EsPropio,
                vt.Patente AS PatTractor, vs.Patente AS PatSemi,
                c.Nombre AS Conductor,
                m.Kilometraje, m.DestinoOrigen, m.NroViaje, m.NroRemito,
                m.Patente, m.TipoVehiculo, m.ConductorNom,
                m.Observaciones, m.UsuarioCarga, m.Anulado, m.AnuladoPor
              FROM dbo.tbl_CtrlAcceso_Movimientos m
              LEFT JOIN dbo.tbl_CtrlAcceso_Vehiculos vt   ON vt.Id = m.IdTractor
              LEFT JOIN dbo.tbl_CtrlAcceso_Vehiculos vs   ON vs.Id = m.IdSemi
              LEFT JOIN dbo.tbl_CtrlAcceso_Conductores c  ON c.Id  = m.IdConductor
              WHERE (@Desde  IS NULL OR m.FechaHora >= @Desde)
                AND (@Hasta  IS NULL OR m.FechaHora <= @Hasta)
                AND (@Tipo   IS NULL OR m.Tipo = @Tipo)
                AND (@Propio IS NULL OR m.EsPropio = @Propio)
                AND (@Buscar IS NULL OR vt.Patente LIKE @Buscar OR vs.Patente LIKE @Buscar OR m.Patente LIKE @Buscar)
              ORDER BY m.FechaHora DESC, m.Id DESC`);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/movimientos/:id — anular (solo admin; no borra, marca Anulado)
app.delete('/api/movimientos/:id', auth('ADMIN'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const p = await getPool();
    const r = await p.request()
      .input('Id', sql.Int, id)
      .input('U',  sql.NVarChar, req.user.u)
      .query(`UPDATE dbo.tbl_CtrlAcceso_Movimientos SET Anulado = 1, AnuladoPor = @U
              WHERE Id = @Id AND Anulado = 0;
              SELECT @@ROWCOUNT AS n`);
    if (!r.recordset[0].n) return res.status(404).json({ error: 'Movimiento no encontrado o ya anulado' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Estado dentro/fuera ───────────────────────────────────────────────────────

// GET /api/estado — propios (por catálogo) + no propios dentro (por patente)
app.get('/api/estado', auth(), async (req, res) => {
  try {
    const p = await getPool();
    const propios = await p.request().query(`
      WITH mov AS (
        SELECT v.Id, m.Tipo AS UltimoMov, m.FechaHora, m.Kilometraje,
               COALESCE(c.Nombre, m.ConductorNom) AS Conductor, m.DestinoOrigen,
               ROW_NUMBER() OVER (PARTITION BY v.Id ORDER BY m.FechaHora DESC, m.Id DESC) AS rn
        FROM dbo.tbl_CtrlAcceso_Vehiculos v
        JOIN dbo.tbl_CtrlAcceso_Movimientos m ON m.Anulado = 0 AND (m.IdTractor = v.Id OR m.IdSemi = v.Id)
        LEFT JOIN dbo.tbl_CtrlAcceso_Conductores c ON c.Id = m.IdConductor
      )
      SELECT v.Id, v.Patente, v.Tipo, v.Descripcion,
             mov.UltimoMov, mov.FechaHora, mov.Kilometraje, mov.Conductor, mov.DestinoOrigen
      FROM dbo.tbl_CtrlAcceso_Vehiculos v
      LEFT JOIN mov ON mov.Id = v.Id AND mov.rn = 1
      WHERE v.Activo = 1
      ORDER BY v.Tipo, v.Patente`);

    const noPropios = await p.request().query(`
      WITH mov AS (
        SELECT m.Patente, m.Tipo, m.FechaHora, m.TipoVehiculo, m.ConductorNom, m.Observaciones,
               ROW_NUMBER() OVER (PARTITION BY m.Patente ORDER BY m.FechaHora DESC, m.Id DESC) AS rn
        FROM dbo.tbl_CtrlAcceso_Movimientos m
        WHERE m.Anulado = 0 AND m.EsPropio = 0
      )
      SELECT Patente, FechaHora, TipoVehiculo, ConductorNom, Observaciones
      FROM mov WHERE rn = 1 AND Tipo = 'INGRESO'
      ORDER BY FechaHora`);

    res.json({ propios: propios.recordset, noPropiosDentro: noPropios.recordset });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── KPIs (solo admin) ─────────────────────────────────────────────────────────

// GET /api/kpis?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  (default: últimos 30 días)
app.get('/api/kpis', auth('ADMIN'), async (req, res) => {
  try {
    const p = await getPool();
    const hasta = req.query.hasta ? new Date(req.query.hasta + 'T23:59:59') : new Date();
    const desde = req.query.desde ? new Date(req.query.desde) : new Date(hasta.getTime() - 30 * 86400000);

    const rango = () => p.request()
      .input('Desde', sql.DateTime, desde)
      .input('Hasta', sql.DateTime, hasta);

    // tarjetas: estado actual + actividad de hoy
    const resumen = await p.request().query(`
      WITH ult AS (
        SELECT v.Id, v.Tipo, m.Tipo AS UltimoMov,
               ROW_NUMBER() OVER (PARTITION BY v.Id ORDER BY m.FechaHora DESC, m.Id DESC) AS rn
        FROM dbo.tbl_CtrlAcceso_Vehiculos v
        JOIN dbo.tbl_CtrlAcceso_Movimientos m ON m.Anulado = 0 AND (m.IdTractor = v.Id OR m.IdSemi = v.Id)
        WHERE v.Activo = 1
      ),
      np AS (
        SELECT Patente, Tipo, ROW_NUMBER() OVER (PARTITION BY Patente ORDER BY FechaHora DESC, Id DESC) AS rn
        FROM dbo.tbl_CtrlAcceso_Movimientos WHERE Anulado = 0 AND EsPropio = 0
      )
      SELECT
        (SELECT COUNT(*) FROM ult WHERE rn=1 AND Tipo='TRACTOR' AND UltimoMov='INGRESO') AS TractoresDentro,
        (SELECT COUNT(*) FROM ult WHERE rn=1 AND Tipo='TRACTOR' AND UltimoMov='EGRESO')  AS TractoresFuera,
        (SELECT COUNT(*) FROM ult WHERE rn=1 AND Tipo='SEMI'    AND UltimoMov='INGRESO') AS SemisDentro,
        (SELECT COUNT(*) FROM ult WHERE rn=1 AND Tipo='SEMI'    AND UltimoMov='EGRESO')  AS SemisFuera,
        (SELECT COUNT(*) FROM np WHERE rn=1 AND Tipo='INGRESO') AS NoPropiosDentro,
        (SELECT COUNT(*) FROM dbo.tbl_CtrlAcceso_Movimientos WHERE Anulado=0 AND FechaHora >= CAST(GETDATE() AS DATE)) AS MovHoy,
        (SELECT COUNT(*) FROM dbo.tbl_CtrlAcceso_Movimientos WHERE Anulado=0 AND Tipo='INGRESO' AND FechaHora >= CAST(GETDATE() AS DATE)) AS IngresosHoy,
        (SELECT COUNT(*) FROM dbo.tbl_CtrlAcceso_Movimientos WHERE Anulado=0 AND Tipo='EGRESO'  AND FechaHora >= CAST(GETDATE() AS DATE)) AS EgresosHoy`);

    // serie diaria ingresos/egresos
    const porDia = await rango().query(`
      SELECT CAST(FechaHora AS DATE) AS Dia,
             SUM(CASE WHEN Tipo='INGRESO' THEN 1 ELSE 0 END) AS Ingresos,
             SUM(CASE WHEN Tipo='EGRESO'  THEN 1 ELSE 0 END) AS Egresos
      FROM dbo.tbl_CtrlAcceso_Movimientos
      WHERE Anulado = 0 AND FechaHora BETWEEN @Desde AND @Hasta
      GROUP BY CAST(FechaHora AS DATE)
      ORDER BY Dia`);

    // top conductores por cantidad de movimientos
    const topConductores = await rango().query(`
      SELECT TOP 10 c.Nombre, COUNT(*) AS Movimientos
      FROM dbo.tbl_CtrlAcceso_Movimientos m
      JOIN dbo.tbl_CtrlAcceso_Conductores c ON c.Id = m.IdConductor
      WHERE m.Anulado = 0 AND m.FechaHora BETWEEN @Desde AND @Hasta
      GROUP BY c.Nombre ORDER BY COUNT(*) DESC`);

    // permanencia de no propios: pares INGRESO→EGRESO cerrados en el rango
    // (sin LEAD: el SQL Server destino no lo soporta)
    const permanencia = await rango().query(`
      SELECT AVG(CAST(DATEDIFF(MINUTE, i.FechaHora, e.FechaHora) AS FLOAT)) AS PromMinutos,
             COUNT(*) AS Visitas
      FROM dbo.tbl_CtrlAcceso_Movimientos i
      CROSS APPLY (
        SELECT TOP 1 x.FechaHora, x.Tipo
        FROM dbo.tbl_CtrlAcceso_Movimientos x
        WHERE x.Anulado = 0 AND x.EsPropio = 0 AND x.Patente = i.Patente
          AND (x.FechaHora > i.FechaHora OR (x.FechaHora = i.FechaHora AND x.Id > i.Id))
        ORDER BY x.FechaHora, x.Id
      ) e
      WHERE i.Anulado = 0 AND i.EsPropio = 0 AND i.Tipo = 'INGRESO'
        AND e.Tipo = 'EGRESO' AND i.FechaHora BETWEEN @Desde AND @Hasta`);

    // actividad de tractores: km recorridos en el rango (máx - mín kilometraje registrado)
    const kmTractores = await rango().query(`
      SELECT TOP 10 v.Patente,
             MAX(m.Kilometraje) - MIN(m.Kilometraje) AS KmRecorridos,
             COUNT(*) AS Movimientos
      FROM dbo.tbl_CtrlAcceso_Movimientos m
      JOIN dbo.tbl_CtrlAcceso_Vehiculos v ON v.Id = m.IdTractor
      WHERE m.Anulado = 0 AND m.Kilometraje IS NOT NULL AND m.FechaHora BETWEEN @Desde AND @Hasta
      GROUP BY v.Patente
      HAVING COUNT(*) > 1
      ORDER BY MAX(m.Kilometraje) - MIN(m.Kilometraje) DESC`);

    res.json({
      resumen: resumen.recordset[0],
      porDia: porDia.recordset,
      topConductores: topConductores.recordset,
      permanenciaNoPropios: permanencia.recordset[0],
      kmTractores: kmTractores.recordset,
      rango: { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10) }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ABM (solo admin) ──────────────────────────────────────────────────────────

// Vehículos
app.post('/api/vehiculos', auth('ADMIN'), async (req, res) => {
  const patente = normPatente(req.body.patente);
  const tipo = String(req.body.tipo || '').toUpperCase();
  if (patente.length < 5) return res.status(400).json({ error: 'Patente inválida' });
  if (!['TRACTOR', 'SEMI'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  try {
    const p = await getPool();
    await p.request()
      .input('P', sql.NVarChar, patente)
      .input('T', sql.NVarChar, tipo)
      .input('D', sql.NVarChar, (req.body.descripcion || '').trim() || null)
      .query('INSERT INTO dbo.tbl_CtrlAcceso_Vehiculos (Patente, Tipo, Descripcion) VALUES (@P, @T, @D)');
    res.json({ ok: true });
  } catch (err) {
    if (err.number === 2627) return res.status(400).json({ error: `La patente ${patente} ya existe` });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/vehiculos/:id', auth('ADMIN'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  try {
    const p = await getPool();
    await p.request()
      .input('Id', sql.Int, id)
      .input('D',  sql.NVarChar, (req.body.descripcion || '').trim() || null)
      .input('A',  sql.Bit, req.body.activo === false ? 0 : 1)
      .query('UPDATE dbo.tbl_CtrlAcceso_Vehiculos SET Descripcion = @D, Activo = @A WHERE Id = @Id');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Conductores
app.post('/api/conductores', auth('ADMIN'), async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  if (nombre.length < 3) return res.status(400).json({ error: 'Nombre inválido' });
  try {
    const p = await getPool();
    await p.request()
      .input('N', sql.NVarChar, nombre)
      .input('D', sql.NVarChar, (req.body.documento || '').trim() || null)
      .query('INSERT INTO dbo.tbl_CtrlAcceso_Conductores (Nombre, Documento) VALUES (@N, @D)');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/conductores/:id', auth('ADMIN'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const nombre = String(req.body.nombre || '').trim();
  if (nombre.length < 3) return res.status(400).json({ error: 'Nombre inválido' });
  try {
    const p = await getPool();
    await p.request()
      .input('Id', sql.Int, id)
      .input('N',  sql.NVarChar, nombre)
      .input('D',  sql.NVarChar, (req.body.documento || '').trim() || null)
      .input('A',  sql.Bit, req.body.activo === false ? 0 : 1)
      .query('UPDATE dbo.tbl_CtrlAcceso_Conductores SET Nombre = @N, Documento = @D, Activo = @A WHERE Id = @Id');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Usuarios
app.get('/api/usuarios', auth('ADMIN'), async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request()
      .query('SELECT Id, Usuario, Nombre, Rol, Activo, CreadoEn FROM dbo.tbl_CtrlAcceso_Usuarios ORDER BY Usuario');
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/usuarios', auth('ADMIN'), async (req, res) => {
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  const nombre  = String(req.body.nombre || '').trim();
  const rol     = String(req.body.rol || '').toUpperCase();
  const pw      = String(req.body.password || '');
  if (!/^[a-z0-9._-]{3,50}$/.test(usuario)) return res.status(400).json({ error: 'Usuario inválido (3-50, minúsculas/números/._-)' });
  if (nombre.length < 3) return res.status(400).json({ error: 'Nombre inválido' });
  if (!['PORTERO', 'ADMIN'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (pw.length < 4) return res.status(400).json({ error: 'Contraseña de al menos 4 caracteres' });
  try {
    const p = await getPool();
    await p.request()
      .input('U', sql.NVarChar, usuario)
      .input('N', sql.NVarChar, nombre)
      .input('H', sql.NVarChar, hashPassword(pw))
      .input('R', sql.NVarChar, rol)
      .query('INSERT INTO dbo.tbl_CtrlAcceso_Usuarios (Usuario, Nombre, Hash, Rol) VALUES (@U, @N, @H, @R)');
    res.json({ ok: true });
  } catch (err) {
    if (err.number === 2627) return res.status(400).json({ error: `El usuario ${usuario} ya existe` });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/usuarios/:id', auth('ADMIN'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  const nombre = String(req.body.nombre || '').trim();
  const rol    = String(req.body.rol || '').toUpperCase();
  if (nombre.length < 3) return res.status(400).json({ error: 'Nombre inválido' });
  if (!['PORTERO', 'ADMIN'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  try {
    const p = await getPool();
    // evitar dejar el sistema sin admins activos
    if (rol !== 'ADMIN' || req.body.activo === false) {
      const r = await p.request().input('Id', sql.Int, id)
        .query(`SELECT COUNT(*) AS n FROM dbo.tbl_CtrlAcceso_Usuarios WHERE Rol='ADMIN' AND Activo=1 AND Id <> @Id`);
      if (r.recordset[0].n === 0) return res.status(400).json({ error: 'No podés desactivar o degradar al único administrador activo' });
    }
    const reqSql = p.request()
      .input('Id', sql.Int, id)
      .input('N',  sql.NVarChar, nombre)
      .input('R',  sql.NVarChar, rol)
      .input('A',  sql.Bit, req.body.activo === false ? 0 : 1);
    let extra = '';
    if (req.body.password) {
      if (String(req.body.password).length < 4) return res.status(400).json({ error: 'Contraseña de al menos 4 caracteres' });
      reqSql.input('H', sql.NVarChar, hashPassword(String(req.body.password)));
      extra = ', Hash = @H';
    }
    await reqSql.query(`UPDATE dbo.tbl_CtrlAcceso_Usuarios SET Nombre = @N, Rol = @R, Activo = @A${extra} WHERE Id = @Id`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ── Inicio ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await ensureSchema();
    console.log(`[ControlAcceso] Conectado a ${SQL_CONFIG.server}/${SQL_CONFIG.database} (esquema OK)`);
  } catch (err) {
    console.error('[ControlAcceso] ERROR SQL:', err.message);
    process.exit(1);
  }

  // Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`[ControlAcceso] Dashboard en http://${HOST}:${PORT}`);
  });
}

start();
