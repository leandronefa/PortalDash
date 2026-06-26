'use strict';

require('dotenv').config();
const express = require('express');
const path    = require('path');
const sql     = require('mssql');

// ── Configuración ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3009;

const SQL_CONFIG = {
  server:   process.env.SQL_SERVER   || '10.0.0.115',
  database: process.env.SQL_DATABASE || 'db_Cegid',
  user:     process.env.SQL_USER     || 'sa',
  password: process.env.SQL_PASSWORD || 'MicroS123',
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

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// GET /api/servidores — lista de servidores registrados (para el filtro)
app.get('/api/servidores', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().execute('sp_PassReset_GetServidores');
    res.json(r.recordset.map(row => row.Servidor));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/resumen?servidor=X — métricas para las tarjetas
app.get('/api/resumen', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request()
      .input('Servidor', sql.NVarChar, req.query.servidor || null)
      .execute('sp_PassReset_GetResumen');
    res.json(r.recordset[0] || { Total: 0, Vencidas: 0, Proximas: 0, Ok: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/usuarios?servidor=X&todos=1 — lista con estado calculado
app.get('/api/usuarios', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request()
      .input('SoloActivos', sql.Bit,      req.query.todos === '1' ? 0 : 1)
      .input('Servidor',    sql.NVarChar, req.query.servidor || null)
      .execute('sp_PassReset_GetUsuarios');
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/log?servidor=X&idUsuario=N&limite=200 — historial de operaciones
app.get('/api/log', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request()
      .input('Limite',    sql.Int,      parseInt(req.query.limite)    || 200)
      .input('Servidor',  sql.NVarChar, req.query.servidor            || null)
      .input('IdUsuario', sql.Int,      req.query.idUsuario ? parseInt(req.query.idUsuario) : null)
      .execute('sp_PassReset_GetLog');
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/usuarios/:id/correo — asignar/actualizar correo de un usuario
app.put('/api/usuarios/:id/correo', async (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const correo = (req.body.correo || '').trim();
  if (!id || isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const p = await getPool();
    const r = await p.request()
      .input('Id',            sql.Int,      id)
      .input('CorreoDestino', sql.NVarChar, correo)
      .execute('sp_PassReset_SetCorreo');
    const updated = r.recordset[0]?.Updated ?? 0;
    if (!updated) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ── Inicio ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await getPool();
    console.log(`[PassReset] Conectado a ${SQL_CONFIG.server}/${SQL_CONFIG.database}`);
  } catch (err) {
    console.error('[PassReset] ERROR SQL:', err.message);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[PassReset] Dashboard en http://0.0.0.0:${PORT}`);
  });
}

start();
