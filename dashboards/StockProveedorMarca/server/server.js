require('dotenv').config();
const path = require('path');
const express = require('express');
const sql = require('mssql');
const { DIMENSIONES, CAMPOS_FILTRO, matrizFiltrada } = require('./consultas');

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

function empresaKeyDesde(empresa) {
  return empresa && empresa !== 'TODAS' ? String(empresa).toUpperCase() : null;
}

/* ── Dimensiones: combinaciones DISTINCT de proveedor/marca/sección/género/
   familia/línea (sin fecha ni números) — el front arma con esto las listas de
   filtro relacionales enteramente en el cliente. Cachea por empresa con TTL
   largo: son ~6.200 filas fijas mientras no se cargue una foto nueva. ────── */
const cacheDimensiones = new Map();

async function cargarDimensiones(empresaKey) {
  const p = await getPool();
  const req = p.request();
  if (empresaKey) req.input('empresa', sql.VarChar(50), EMPRESAS[empresaKey]);
  const r = await req.query(DIMENSIONES(!!empresaKey));
  return r.recordset;
}

async function obtenerDimensionesCacheadas(empresaKey) {
  const clave = empresaKey || 'TODAS';
  const cacheado = cacheDimensiones.get(clave);
  if (cacheado && Date.now() - cacheado.ts < TTL_CACHE_MS) return cacheado.data;
  const combos = await cargarDimensiones(empresaKey);
  const data = { combos, recarga: new Date().toISOString() };
  cacheDimensiones.set(clave, { data, ts: Date.now() });
  return data;
}

/* ── Matriz agregada por fecha, filtrada server-side por lo que el usuario
   tenga tildado — el cruce completo de las 6 dimensiones es demasiado grande
   para mandarlo entero al cliente (~139.000 combinaciones), así que cada
   cambio de filtro dispara un pedido nuevo. Cachea por (empresa + filtros)
   exactos: son fotos de fin de mes ya cerradas, no cambian una vez tomadas. */
function normalizarFiltros(body) {
  const limpiar = (arr) => (Array.isArray(arr) ? [...new Set(arr.map(String))].sort() : []);
  const out = {};
  for (const campo of CAMPOS_FILTRO) out[campo.key] = limpiar(body[campo.key]);
  return out;
}

function claveCache(empresaKey, filtros) {
  return JSON.stringify([empresaKey || 'TODAS', ...CAMPOS_FILTRO.map((c) => filtros[c.key])]);
}

const cacheMatriz = new Map();

async function cargarMatrizFiltrada(filtros, empresaKey) {
  const p = await getPool();
  const { sql: sqlTexto, binds } = matrizFiltrada(filtros, !!empresaKey);
  const req = p.request();
  if (empresaKey) req.input('empresa', sql.VarChar(50), EMPRESAS[empresaKey]);
  for (const b of binds) req.input(b.name, sql.VarChar(300), b.value);
  const r = await req.query(sqlTexto);
  return r.recordset.map((row) => {
    const f = row.fecha;
    return {
      fecha: f.toISOString().slice(0, 10),
      anio: f.getUTCFullYear(),
      mes: f.getUTCMonth() + 1,
      stock: row.stock || 0,
      stockPesos: row.stockPesos || 0
    };
  });
}

async function obtenerMatrizCacheada(filtros, empresaKey) {
  const clave = claveCache(empresaKey, filtros);
  const cacheado = cacheMatriz.get(clave);
  if (cacheado && Date.now() - cacheado.ts < TTL_CACHE_MS) return cacheado.data;
  const filas = await cargarMatrizFiltrada(filtros, empresaKey);
  const data = { filas, recarga: new Date().toISOString() };
  cacheMatriz.set(clave, { data, ts: Date.now() });
  return data;
}

const app = express();
app.use(express.json());

app.get('/api/salud', async (_req, res) => {
  try {
    await getPool();
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.get('/api/dimensiones', async (req, res) => {
  const empresaKey = empresaKeyDesde(req.query.empresa);
  if (empresaKey && !EMPRESAS[empresaKey]) {
    return res.status(400).json({ error: `empresa desconocida: ${req.query.empresa}` });
  }
  try {
    res.json(await obtenerDimensionesCacheadas(empresaKey));
  } catch (e) {
    log('error', `dimensiones: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/matriz', async (req, res) => {
  const empresa = req.body && req.body.empresa;
  const empresaKey = empresaKeyDesde(empresa);
  if (empresaKey && !EMPRESAS[empresaKey]) {
    return res.status(400).json({ error: `empresa desconocida: ${empresa}` });
  }
  try {
    const filtros = normalizarFiltros(req.body || {});
    res.json(await obtenerMatrizCacheada(filtros, empresaKey));
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
