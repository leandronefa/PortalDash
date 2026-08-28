require('dotenv').config();
const path = require('path');
const express = require('express');
const sql = require('mssql');
const { matriz } = require('./consultas');

const PORT = Number(process.env.PORT || 3017);
const HOST = process.env.HOST || '127.0.0.1';
const TTL_CACHE_MS = Number(process.env.TTL_CACHE_MIN || 1440) * 60 * 1000;

// Valor real guardado en nomfilial (con espacio final tal cual viene de origen).
const EMPRESAS = { TESI: 'Tesi ', PUEBLO: 'Pueblo ' };

function log(nivel, msg) {
  console.log(`${new Date().toISOString()} [${nivel}] ${msg}`);
}

const cfg = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: process.env.DB_ENCRYPT === '1',
    trustServerCertificate: process.env.DB_TRUST_CERT !== '0'
  },
  pool: { max: Number(process.env.DB_POOL_MAX || 6) },
  connectionTimeout: Number(process.env.DB_TIMEOUT_MS || 60000),
  requestTimeout: Number(process.env.DB_TIMEOUT_MS || 60000)
};

let pool = null;
async function getPool() {
  if (!pool) pool = await new sql.ConnectionPool(cfg).connect();
  return pool;
}

/* ── Matriz completa (fecha, proveedor, marca, stock, stockPesos) — cachea por
   empresa: son fotos de fin de mes ya cerradas, no cambian una vez tomadas.
   La consulta agregada sobre el histórico completo tarda unos segundos, por
   eso el TTL es largo (default 24h) en vez de recalcular en cada request. ── */
const cacheMatriz = new Map();

async function cargarMatriz(empresaKey) {
  const p = await getPool();
  const req = p.request();
  if (empresaKey) req.input('empresa', sql.VarChar(50), EMPRESAS[empresaKey]);
  const r = await req.query(matriz(!!empresaKey));
  return r.recordset.map((row) => {
    const f = row.fecha;
    return {
      fecha: f.toISOString().slice(0, 10),
      anio: f.getUTCFullYear(),
      mes: f.getUTCMonth() + 1,
      proveedor: row.proveedor,
      marca: row.marca,
      stock: row.stock || 0,
      stockPesos: row.stockPesos || 0
    };
  });
}

async function obtenerMatrizCacheada(empresaKey) {
  const clave = empresaKey || 'TODAS';
  const cacheado = cacheMatriz.get(clave);
  if (cacheado && Date.now() - cacheado.ts < TTL_CACHE_MS) return cacheado.data;

  const filas = await cargarMatriz(empresaKey);
  const proveedores = [...new Set(filas.map((f) => f.proveedor))].sort();
  const marcas = [...new Set(filas.map((f) => f.marca || '(sin marca)'))].sort();
  const data = { empresa: clave, filas, proveedores, marcas, recarga: new Date().toISOString() };
  cacheMatriz.set(clave, { data, ts: Date.now() });
  return data;
}

const app = express();

app.get('/api/salud', async (_req, res) => {
  try {
    await getPool();
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.get('/api/matriz', async (req, res) => {
  const empresa = req.query.empresa;
  const empresaKey = empresa && empresa !== 'TODAS' ? String(empresa).toUpperCase() : null;
  if (empresaKey && !EMPRESAS[empresaKey]) {
    return res.status(400).json({ error: `empresa desconocida: ${empresa}` });
  }
  try {
    res.json(await obtenerMatrizCacheada(empresaKey));
  } catch (e) {
    log('error', `matriz: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, HOST, () => {
  log('info', `http: escuchando en http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
