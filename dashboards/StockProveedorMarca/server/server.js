require('dotenv').config();
const path = require('path');
const express = require('express');
const sql = require('mssql');
const { PERIODOS, stockPorProveedorMarca } = require('./consultas');

const PORT = Number(process.env.PORT || 3017);
const HOST = process.env.HOST || '127.0.0.1';
const TTL_CACHE_MS = Number(process.env.TTL_CACHE_MIN || 1440) * 60 * 1000;

const NOMBRES_MES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

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

/* ── Períodos (caché larga: sólo se suma una fila nueva una vez al mes) ──── */
let cachePeriodos = { data: null, ts: 0 };
const TTL_PERIODOS_MS = 60 * 60 * 1000;

async function cargarPeriodos() {
  const p = await getPool();
  const r = await p.request().query(PERIODOS);
  return r.recordset.map((row) => {
    const f = row.fecha;
    const anio = f.getUTCFullYear();
    const mes = f.getUTCMonth() + 1;
    return {
      fecha: f.toISOString().slice(0, 10),
      anio,
      mes,
      etiqueta: `${NOMBRES_MES[mes]} ${anio}`
    };
  });
}

async function obtenerPeriodosCacheados() {
  if (cachePeriodos.data && Date.now() - cachePeriodos.ts < TTL_PERIODOS_MS) return cachePeriodos.data;
  const data = await cargarPeriodos();
  cachePeriodos = { data, ts: Date.now() };
  return data;
}

/* ── Stock por proveedor/marca de un período — cachea por (fecha, empresa):
   son fotos de fin de mes ya cerradas, no cambian una vez tomadas. ────────── */
const cacheStock = new Map();

async function cargarStock(fecha, empresaKey) {
  const p = await getPool();
  const req = p.request();
  req.input('fecha', sql.Date, fecha);
  if (empresaKey) req.input('empresa', sql.VarChar(50), EMPRESAS[empresaKey]);
  const r = await req.query(stockPorProveedorMarca(!!empresaKey));
  return r.recordset;
}

function resumir(filas) {
  const marcas = new Set();
  const proveedores = new Set();
  let stock = 0;
  let stockPesos = 0;
  let articulos = 0;
  for (const f of filas) {
    proveedores.add(f.proveedor);
    marcas.add(f.marca || '(sin marca)');
    stock += f.stock || 0;
    stockPesos += f.stockPesos || 0;
    articulos += f.articulos || 0;
  }
  return { stock, stockPesos, articulos, proveedores: proveedores.size, marcas: marcas.size };
}

async function obtenerStockCacheado(fecha, empresaKey) {
  const clave = `${fecha}|${empresaKey || 'TODAS'}`;
  const cacheado = cacheStock.get(clave);
  if (cacheado && Date.now() - cacheado.ts < TTL_CACHE_MS) return cacheado.data;

  const filas = await cargarStock(fecha, empresaKey);
  const data = { fecha, empresa: empresaKey || 'TODAS', filas, totales: resumir(filas), recarga: new Date().toISOString() };
  cacheStock.set(clave, { data, ts: Date.now() });
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

app.get('/api/periodos', async (_req, res) => {
  try {
    res.json(await obtenerPeriodosCacheados());
  } catch (e) {
    log('error', `periodos: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stock', async (req, res) => {
  const { fecha, empresa } = req.query;
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha requerida en formato YYYY-MM-DD' });
  }
  const empresaKey = empresa && empresa !== 'TODAS' ? String(empresa).toUpperCase() : null;
  if (empresaKey && !EMPRESAS[empresaKey]) {
    return res.status(400).json({ error: `empresa desconocida: ${empresa}` });
  }
  try {
    const periodos = await obtenerPeriodosCacheados();
    if (!periodos.some((p) => p.fecha === fecha)) {
      return res.status(400).json({ error: `no hay foto de stock para ${fecha}` });
    }
    res.json(await obtenerStockCacheado(fecha, empresaKey));
  } catch (e) {
    log('error', `stock: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, HOST, () => {
  log('info', `http: escuchando en http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
