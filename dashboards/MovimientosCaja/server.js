import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3004;
const LIMIT = 10000;

const sqlConfig = {
  server: process.env.DB_SERVER,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'BeClever',
  options: {
    trustServerCertificate: true,
    enableArithAbort: true,
    encrypt: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
    console.log(`[DB] Conectado a ${sqlConfig.server}/${sqlConfig.database}`);
  }
  return pool;
}

// ── GET /api/filtros ──────────────────────────────────────────────────────────
// Devuelve los valores distintos de cada columna para poblar los dropdowns.

app.get('/api/filtros', async (req, res) => {
  try {
    const db = await getPool();

    // Columna real → clave del filtro en la API
    const cols = [
      { real: 'DesProducto',  key: 'tipoproducto' },
      { real: 'DesSuc',       key: 'sucursal'     },
      { real: 'TipoCartera',  key: 'tipocartera'  },
      { real: 'DesMedPag',    key: 'mediopago'    },
      { real: 'EstadoPago',   key: 'estadopago'   },
      { real: 'IdTipEst',     key: 'estado'       },
      { real: 'DesTipMovCaja',key: 'tipomovcaja'  },
    ];

    const queries = cols.map(({ real }) =>
      db.request().query(`
        SELECT DISTINCT ${real} AS valor
        FROM dbo.CajasMovimientosTipoCartera
        WHERE ${real} IS NOT NULL AND LTRIM(RTRIM(CAST(${real} AS NVARCHAR(MAX)))) <> ''
        ORDER BY ${real}
      `)
    );

    const results = await Promise.all(queries);
    const filtros = {};
    cols.forEach(({ key }, i) => {
      filtros[key] = results[i].recordset.map(r => r.valor);
    });

    res.json(filtros);
  } catch (err) {
    console.error('[/api/filtros]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Agrega un filtro IN a la query para múltiples valores seleccionados.
function addInFilter(request, conditions, col, paramBase, rawVal) {
  const values = Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : []);
  if (values.length === 0) return;
  const placeholders = values.map((v, i) => {
    const name = `${paramBase}_${i}`;
    request.input(name, sql.NVarChar(200), v);
    return `@${name}`;
  });
  conditions.push(`${col} IN (${placeholders.join(', ')})`);
}

// ── GET /api/movimientos ──────────────────────────────────────────────────────
// Devuelve registros con filtros aplicados (máximo LIMIT filas).

app.get('/api/movimientos', async (req, res) => {
  const {
    fechaDesde, fechaHasta,
    tipoproducto, sucursal, tipocartera,
    mediopago, estadopago, estado, tipomovcaja,
  } = req.query;

  try {
    const db = await getPool();
    const request = db.request();
    const conditions = [];

    if (fechaDesde) {
      request.input('fechaDesde', sql.Date, fechaDesde);
      conditions.push('CAST(FechaImpacto AS DATE) >= @fechaDesde');
    }
    if (fechaHasta) {
      request.input('fechaHasta', sql.Date, fechaHasta);
      conditions.push('CAST(FechaImpacto AS DATE) <= @fechaHasta');
    }

    addInFilter(request, conditions, 'DesProducto',   'tipoproducto', tipoproducto);
    addInFilter(request, conditions, 'DesSuc',        'sucursal',     sucursal);
    addInFilter(request, conditions, 'TipoCartera',   'tipocartera',  tipocartera);
    addInFilter(request, conditions, 'DesMedPag',     'mediopago',    mediopago);
    addInFilter(request, conditions, 'EstadoPago',    'estadopago',   estadopago);
    addInFilter(request, conditions, 'IdTipEst',      'estado',       estado);
    addInFilter(request, conditions, 'DesTipMovCaja', 'tipomovcaja',  tipomovcaja);

    const where = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const query = `
      SELECT TOP (${LIMIT})
        FechaImpacto  AS fecha,
        DesSuc        AS sucursal,
        DesMedPag     AS mediopago,
        EstadoPago    AS estadopago,
        IdTipEst      AS estado,
        TipoCartera   AS tipocartera,
        DesProducto   AS tipoproducto,
        ImpDeb        AS importedebito,
        ImpCred       AS importecredito
      FROM dbo.CajasMovimientosTipoCartera
      ${where}
      ORDER BY FechaImpacto DESC
    `;

    const result = await request.query(query);

    res.json({
      rows: result.recordset,
      limit: LIMIT,
      truncated: result.recordset.length === LIMIT,
    });
  } catch (err) {
    console.error('[/api/movimientos]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Estáticos + SPA fallback ──────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ── Inicio ────────────────────────────────────────────────────────────────────

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`[MovimientosCaja] Escuchando en http://${HOST}:${PORT}`);
});
