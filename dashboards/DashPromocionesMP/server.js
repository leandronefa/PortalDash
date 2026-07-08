import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Writable } from 'stream';
import { readFileSync, readdirSync, mkdirSync, renameSync, existsSync } from 'fs';
import * as ftp from 'basic-ftp';
import sql from 'mssql';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3005;
const CACHE_TTL = parseInt(process.env.CACHE_TTL_MS || '300000', 10);

// ── Simple in-memory cache ────────────────────────────────────────────────────
const cache = {};
function getCached(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}
function setCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// ── SQL Server config ─────────────────────────────────────────────────────────
const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASS,
  server: process.env.SQL_HOST,
  database: process.env.SQL_DB,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

// ── FTP helper ────────────────────────────────────────────────────────────────
// Returns CSV string or null if no matching file found.
// Descarga TODOS los archivos que coincidan con namePattern y los devuelve como array de CSVs.
// Si moveToOld=true, mueve cada archivo a OLD/ después de descargarlo.
async function fetchAllFromFTP(namePattern, moveToOld = false) {
  const client = new ftp.Client(30000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: true,
      secureOptions: { rejectUnauthorized: false },
    });
    const remotePath = process.env.FTP_PATH || '/MercadoPago';
    await client.cd(remotePath);
    const list = await client.list();
    const matches = list
      .filter(f => namePattern.test(f.name) && /\.csv$/i.test(f.name))
      .sort((a, b) => {
        const ta = a.modifiedAt ? a.modifiedAt.getTime() : 0;
        const tb = b.modifiedAt ? b.modifiedAt.getTime() : 0;
        return ta - tb; // más antiguo primero para procesar en orden cronológico
      });
    if (!matches.length) {
      console.log(`[FTP] Sin archivos para ${namePattern}`);
      return [];
    }
    console.log(`[FTP] ${matches.length} archivo(s) encontrado(s) para ${namePattern}: ${matches.map(f => f.name).join(', ')}`);

    if (moveToOld) {
      try { await client.send('MKD OLD'); } catch (_) { /* ya existe */ }
    }

    const results = [];
    for (const file of matches) {
      console.log(`[FTP] Descargando: ${file.name}`);
      const chunks = [];
      const writable = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
      });
      await client.downloadTo(writable, file.name);
      const csv = Buffer.concat(chunks).toString('utf8');
      results.push({ name: file.name, csv });

      if (moveToOld) {
        try {
          await client.rename(file.name, `OLD/${file.name}`);
          console.log(`[FTP] Movido a OLD/${file.name}`);
        } catch (moveErr) {
          console.warn(`[FTP] No se pudo mover ${file.name} a OLD/:`, moveErr.message);
        }
      }
    }
    return results;
  } finally {
    client.close();
  }
}

// Compatibilidad: devuelve solo el CSV del primer archivo (uso legado)
async function fetchFromFTP(namePattern, moveToOld = false) {
  const all = await fetchAllFromFTP(namePattern, moveToOld);
  return all.length ? all[0].csv : null;
}

// ── API: Ventas (SQL Server → CSV) ───────────────────────────────────────────
app.get('/api/ventas', async (_req, res) => {
  try {
    const cached = getCached('ventas');
    if (cached) return res.type('text/plain').send(cached);

    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().execute('sp_GrillaPromosMP');
    await pool.close();

    const rows = result.recordset;
    if (!rows.length) return res.type('text/plain').send('');

    const headers = Object.keys(rows[0]).join(';');
    const lines = rows.map(r =>
      Object.values(r).map(v => {
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        return String(v);
      }).join(';')
    );
    const csv = [headers, ...lines].join('\r\n');

    setCache('ventas', csv);
    res.type('text/plain').send(csv);
  } catch (err) {
    console.error('[/api/ventas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── API: Tesi (SQL Server) ───────────────────────────────────────────────────
app.get('/api/tesi', async (_req, res) => {
  try {
    const cached = getCached('tesi');
    if (cached) return res.type('text/plain').send(cached);
    const csv = await queryTesiFromSQL('Tesi');
    if (csv) setCache('tesi', csv);
    res.type('text/plain').send(csv || '');
  } catch (err) {
    console.error('[/api/tesi]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── API: Pueblo (SQL Server) ──────────────────────────────────────────────────
app.get('/api/pueblo', async (_req, res) => {
  try {
    const cached = getCached('pueblo');
    if (cached) return res.type('text/plain').send(cached);
    const csv = await queryTesiFromSQL('Pueblo');
    if (csv) setCache('pueblo', csv);
    res.type('text/plain').send(csv || '');
  } catch (err) {
    console.error('[/api/pueblo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── API: cache invalidation ───────────────────────────────────────────────────
app.post('/api/cache/clear', (_req, res) => {
  Object.keys(cache).forEach(k => delete cache[k]);
  res.json({ ok: true });
});

// ── API: debug — muestra primeras filas de cada cache + estado ────────────────
app.get('/api/debug', (_req, res) => {
  const sample = (key) => {
    const data = getCached(key);
    if (!data) return { cached: false };
    const lines = data.split(/\r?\n/).filter(Boolean);
    return {
      cached: true,
      rows: lines.length - 1,
      header: lines[0],
      sample: lines.slice(1, 6),
    };
  };
  res.json({ ventas: sample('ventas'), tesi: sample('tesi'), pueblo: sample('pueblo') });
});

// ── Last-updated timestamps ──────────────────────────────────────────────────
const lastUpdated = { ventas: null, tesi: null, pueblo: null };
let isRefreshing = false;

// ── Leer Tesi/Pueblo desde SQL Server ────────────────────────────────────────
// Devuelve CSV con headers compatibles con parseTesi() del frontend.
async function queryTesiFromSQL(fuente) {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request()
    .input('fuente', sql.VarChar(10), fuente)
    .execute('sp_GrillaPromosMPTesi');
  await pool.close();
  const rows = r.recordset;
  if (!rows.length) return '';
  const headers = 'TRANSACTION_DATE;TRANSACTION_AMOUNT;FEE_AMOUNT;REAL_AMOUNT;INSTALLMENTS;PAYMENT_METHOD_TYPE;STORE_NAME;FINANCING_FEE_AMOUNT;SUB_UNIT;FRANCHISE;ISSUER_NAME';
  const lines = rows.map(row => [
    row.date_created instanceof Date ? row.date_created.toISOString() : (row.date_created ?? ''),
    row.transaction_amount ?? '',
    row.mercadopago_fee ?? '',
    row.net_received_amount ?? '',
    row.cuotas ?? '',
    row.payment_type ?? '',
    row.description ?? '',
    row.financing_fee ?? '',
    row.sub_unit ?? '',
    row.franchise ?? '',
    row.issuer_name ?? '',
  ].join(';'));
  return [headers, ...lines].join('\r\n');
}

// ── Guardar CSV del FTP en SQL Server ────────────────────────────────────────
// Elimina los registros del mismo dia+fuente antes de insertar (idempotente).
async function saveFTPDataToSQL(csvString, fuente, fechaDescarga = null) {
  const lines = csvString.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) { console.log(`[SQL] ${fuente}: CSV vacío, nada que guardar`); return 0; }

  const rawHeaders = lines[0].split(';').map(h => h.trim());
  const dataRows = lines.slice(1);
  if (!fechaDescarga) fechaDescarga = new Date().toISOString().slice(0, 10);

  const get = (obj, ...keys) => { for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k]; return ''; };

  const pool = await sql.connect(sqlConfig);

  // Eliminar batch del mismo día para poder reinsertar sin duplicados
  await pool.request()
    .input('fuente', sql.VarChar(10), fuente)
    .input('fecha', sql.Date, fechaDescarga)
    .query('DELETE FROM mp_transacciones WHERE fuente = @fuente AND fecha_descarga = @fecha');

  // Bulk insert
  const table = new sql.Table('mp_transacciones');
  table.create = false;
  table.columns.add('fuente',              sql.VarChar(10),    { nullable: false });
  table.columns.add('fecha_descarga',      sql.Date,           { nullable: false });
  table.columns.add('date_created',        sql.DateTime2(0),   { nullable: true });
  table.columns.add('transaction_amount',  sql.Decimal(18, 2), { nullable: true });
  table.columns.add('mercadopago_fee',     sql.Decimal(18, 2), { nullable: true });
  table.columns.add('net_received_amount', sql.Decimal(18, 2), { nullable: true });
  table.columns.add('cuotas',             sql.Int,            { nullable: true });
  table.columns.add('payment_type',        sql.VarChar(50),    { nullable: true });
  table.columns.add('description',         sql.VarChar(200),   { nullable: true });
  table.columns.add('financing_fee',       sql.Decimal(18, 2), { nullable: true });
  table.columns.add('sub_unit',            sql.VarChar(50),    { nullable: true });
  table.columns.add('franchise',           sql.VarChar(100),   { nullable: true });
  table.columns.add('issuer_name',         sql.VarChar(100),   { nullable: true });

  for (const line of dataRows) {
    const vals = line.split(';');
    const row = {};
    rawHeaders.forEach((h, i) => { row[h] = vals[i]?.trim() ?? ''; });
    const rawDate = get(row, 'TRANSACTION_DATE', 'date_created');
    const dateVal = rawDate ? new Date(rawDate) : null;
    table.rows.add(
      fuente,
      fechaDescarga,
      dateVal && !isNaN(dateVal.getTime()) ? dateVal : null,
      parseFloat(get(row, 'TRANSACTION_AMOUNT', 'transaction_amount')) || null,
      parseFloat(get(row, 'FEE_AMOUNT', 'mercadopago_fee')) || null,
      parseFloat(get(row, 'REAL_AMOUNT', 'net_received_amount')) || null,
      parseInt(get(row, 'INSTALLMENTS', 'installments', 'cuotas'), 10) || 1,
      get(row, 'PAYMENT_METHOD_TYPE', 'payment_type') || null,
      get(row, 'STORE_NAME', 'description') || null,
      parseFloat(get(row, 'FINANCING_FEE_AMOUNT', 'financing_fee')) || null,
      get(row, 'SUB_UNIT', 'sub_unit') || null,
      get(row, 'FRANCHISE', 'franchise') || null,
      get(row, 'ISSUER_NAME', 'issuer_name') || null,
    );
  }

  await pool.request().bulk(table);
  await pool.close();
  console.log(`[SQL] ${fuente}: ${dataRows.length} filas guardadas para ${fechaDescarga}`);
  return dataRows.length;
}

// ── Cruce Ventas × MercadoPago → SQL ─────────────────────────────────────────
// Replica la lógica de crossData() del frontend pero server-side.
// Guarda resultados en mp_transaccionesCEGID (borra el día actual antes).
async function performAndSaveCruce() {
  console.log('[cruce] Iniciando cruce Vtas × MP...');
  const pool = await sql.connect(sqlConfig);
  try {
    // 1. Ventas desde SP
    const vtaResult = await pool.request().execute('sp_GrillaPromosMP');
    const ventasRows = vtaResult.recordset;
    if (!ventasRows.length) { console.log('[cruce] Sin ventas, abortando.'); return 0; }

    // 2. Tesi + Pueblo desde mp_transacciones (últimos 60 días)
    const tesiResult = await pool.request().query(`
      SELECT fuente, date_created, transaction_amount, mercadopago_fee,
             net_received_amount, cuotas, payment_type, description,
             financing_fee, sub_unit, franchise, issuer_name
      FROM mp_transacciones
      WHERE date_created >= DATEADD(day, -60, GETDATE())
      ORDER BY date_created
    `);
    const tesiRows = tesiResult.recordset;

    // 3. Cross-matching (mismo algoritmo que crossData en el frontend)
    const TARGET_MP = ['555', 'M', 'ME'];
    const tesiPool = tesiRows.map(t => ({ ...t, _used: false }));

    const crossResults = ventasRows.map(v => {
      const base = { ...v, mp_matched: false, mp_row: null };
      if (!TARGET_MP.includes(v.cod_MP)) return base;

      const vSuc = parseInt(v.suc, 10);
      const vImporte = parseFloat(v.IMPORTE) || 0;
      const vDate = v.FECHA instanceof Date ? v.FECHA : (v.FECHA ? new Date(v.FECHA) : null);

      const idx = tesiPool.findIndex(t => {
        if (t._used) return false;
        // Match sucursal (descripción "Suc.X")
        let tSuc = -1;
        if (t.description && t.description.startsWith('Suc.')) {
          tSuc = parseInt(t.description.replace('Suc.', ''), 10);
        }
        if (vSuc !== tSuc) return false;
        // Match importe ±1 peso
        if (Math.abs(vImporte - (parseFloat(t.transaction_amount) || 0)) > 1) return false;
        // Match mismo día calendario
        if (vDate && t.date_created) {
          const vDay = vDate.toISOString().slice(0, 10);
          const tD = t.date_created instanceof Date ? t.date_created : new Date(t.date_created);
          if (vDay !== tD.toISOString().slice(0, 10)) return false;
        }
        return true;
      });

      if (idx !== -1) {
        tesiPool[idx]._used = true;
        base.mp_matched = true;
        base.mp_row = tesiPool[idx];
      }
      return base;
    });

    // 4. Guardar en mp_transaccionesCEGID (borrar el día actual primero)
    const fechaProceso = new Date();
    const today = fechaProceso.toISOString().slice(0, 10);
    await pool.request()
      .input('hoy', sql.Date, today)
      .query('DELETE FROM mp_transaccionesCEGID WHERE CAST(fecha_proceso AS DATE) = @hoy');

    const table = new sql.Table('mp_transaccionesCEGID');
    table.create = false;
    table.columns.add('fecha_proceso',          sql.DateTime2(0),   { nullable: false });
    table.columns.add('vta_fecha',              sql.DateTime2(0),   { nullable: true  });
    table.columns.add('vta_suc',                sql.VarChar(10),    { nullable: true  });
    table.columns.add('vta_numero',             sql.VarChar(20),    { nullable: true  });
    table.columns.add('vta_cod_cond',           sql.VarChar(50),    { nullable: true  });
    table.columns.add('vta_nombre_cond',        sql.VarChar(200),   { nullable: true  });
    table.columns.add('vta_descuento',          sql.Decimal(18, 2), { nullable: true  });
    table.columns.add('vta_preciolleno',        sql.Decimal(18, 2), { nullable: true  });
    table.columns.add('vta_importe',            sql.Decimal(18, 2), { nullable: true  });
    table.columns.add('vta_cod_mp',             sql.VarChar(10),    { nullable: true  });
    table.columns.add('vta_nom_mp',             sql.VarChar(100),   { nullable: true  });
    table.columns.add('vta_cuota',              sql.Int,            { nullable: true  });
    table.columns.add('mp_matched',             sql.Bit,            { nullable: false });
    table.columns.add('mp_fuente',              sql.VarChar(10),    { nullable: true  });
    table.columns.add('mp_date_created',        sql.DateTime2(0),   { nullable: true  });
    table.columns.add('mp_transaction_amount',  sql.Decimal(18, 2), { nullable: true  });
    table.columns.add('mp_mercadopago_fee',     sql.Decimal(18, 2), { nullable: true  });
    table.columns.add('mp_net_received_amount', sql.Decimal(18, 2), { nullable: true  });
    table.columns.add('mp_cuotas',              sql.Int,            { nullable: true  });
    table.columns.add('mp_payment_type',        sql.VarChar(50),    { nullable: true  });
    table.columns.add('mp_description',         sql.VarChar(200),   { nullable: true  });
    table.columns.add('mp_financing_fee',       sql.Decimal(18, 2), { nullable: true  });
    table.columns.add('mp_sub_unit',            sql.VarChar(50),    { nullable: true  });
    table.columns.add('mp_franchise',           sql.VarChar(100),   { nullable: true  });
    table.columns.add('mp_issuer_name',         sql.VarChar(100),   { nullable: true  });

    for (const r of crossResults) {
      const vtaF = r.FECHA instanceof Date ? r.FECHA : (r.FECHA ? new Date(r.FECHA) : null);
      const mp   = r.mp_row;
      const mpD  = mp?.date_created instanceof Date ? mp.date_created : (mp?.date_created ? new Date(mp.date_created) : null);
      table.rows.add(
        fechaProceso,
        vtaF && !isNaN(vtaF.getTime()) ? vtaF : null,
        r.suc     || null,
        r.NUMERO  || null,
        r.COD_COND    || r.cod_cond    || null,
        r.NOMBRE_COND || r.nombre_cond || null,
        parseFloat(r.DESCUENTO    ?? r.descuento)    || null,
        parseFloat(r.PRECIOLLENO  ?? r.preciolleno)  || null,
        parseFloat(r.IMPORTE      ?? r.importe)      || null,
        r.cod_MP  || null,
        r.nom_MP  || null,
        parseInt(r.CUOTA ?? r.cuota, 10) || null,
        r.mp_matched ? 1 : 0,
        mp?.fuente || null,
        mpD && !isNaN(mpD.getTime()) ? mpD : null,
        mp ? (parseFloat(mp.transaction_amount)  || null) : null,
        mp ? (parseFloat(mp.mercadopago_fee)     || null) : null,
        mp ? (parseFloat(mp.net_received_amount) || null) : null,
        mp ? (parseInt(mp.cuotas, 10)            || null) : null,
        mp?.payment_type  || null,
        mp?.description   || null,
        mp ? (parseFloat(mp.financing_fee) || null) : null,
        mp?.sub_unit      || null,
        mp?.franchise     || null,
        mp?.issuer_name   || null,
      );
    }

    await pool.request().bulk(table);
    const matched = crossResults.filter(r => r.mp_matched).length;
    console.log(`[cruce] ${crossResults.length} filas guardadas (${matched} con match, ${crossResults.length - matched} sin match)`);
    return crossResults.length;
  } finally {
    await pool.close();
  }
}

// ── Daily data refresh ────────────────────────────────────────────────────────
async function refreshAllData(isScheduled = false) {
  if (isRefreshing) {
    console.log('[refresh] Ya hay una recarga en curso, se omite.');
    return { skipped: true };
  }
  isRefreshing = true;
  const result = { ventas: false, tesi: false, pueblo: false };
  console.log(`[refresh] Iniciando recarga${isScheduled ? ' (programada)' : ''} ${new Date().toISOString()}`);
  try {
    // 1. VENTAS (SP SQL Server) — siempre
    try {
      const pool = await sql.connect(sqlConfig);
      const r = await pool.request().execute('sp_GrillaPromosMP');
      await pool.close();
      const rows = r.recordset;
      if (rows.length) {
        const headers = Object.keys(rows[0]).join(';');
        const lines = rows.map(row => Object.values(row).map(v => {
          if (v == null) return '';
          if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
          return String(v);
        }).join(';'));
        setCache('ventas', [headers, ...lines].join('\r\n'));
        lastUpdated.ventas = new Date().toISOString();
        result.ventas = true;
        console.log(`[refresh] Ventas OK (${rows.length} filas)`);
      }
    } catch (err) { console.error('[refresh] Ventas ERROR:', err.message); }

    if (isScheduled) {
      // 2+3. FTP → SQL → bust cache (solo en refresh programado diario)
      for (const { pattern, fuente, key } of [
        { pattern: /tesi/i,   fuente: 'Tesi',   key: 'tesi'   },
        { pattern: /pueblo/i, fuente: 'Pueblo', key: 'pueblo' },
      ]) {
        try {
          const files = await fetchAllFromFTP(pattern, true);
          if (!files.length) {
            console.log(`[refresh] ${fuente}: sin archivos nuevos en FTP`);
          } else {
            for (const { name, csv } of files) {
              try {
                await saveFTPDataToSQL(csv, fuente);
                console.log(`[refresh] ${fuente}: procesado ${name}`);
              } catch (saveErr) {
                console.error(`[refresh] ${fuente} ERROR guardando ${name}:`, saveErr.message);
              }
            }
            lastUpdated[key] = new Date().toISOString();
            result[key] = true;
          }
        } catch (err) { console.error(`[refresh] ${fuente} ERROR:`, err.message); }
      }
    }

    // Bust cache de tesi/pueblo para que el siguiente request lea de SQL
    delete cache['tesi'];
    delete cache['pueblo'];

    // Cruce Ventas × MP → guardar en mp_transaccionesCEGID
    try {
      await performAndSaveCruce();
    } catch (err) { console.error('[refresh] cruce ERROR:', err.message); }

    console.log(`[refresh] Completado ${new Date().toISOString()}`);
  } finally {
    isRefreshing = false;
  }
  return result;
}

// ── API: status / timestamps ──────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  const next = new Date();
  next.setHours(REFRESH_HOUR, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  res.json({
    lastUpdated,
    nextRefresh: next.toISOString(),
    refreshHour: REFRESH_HOUR,
    isRefreshing,
  });
});

// ── API: manual refresh ───────────────────────────────────────────────────────
app.post('/api/refresh', async (_req, res) => {
  if (isRefreshing) {
    return res.status(409).json({ ok: false, message: 'Recarga en curso, intentá en unos segundos.' });
  }
  // fire and forget — client polls /api/status
  refreshAllData().catch(err => console.error('[manual refresh]', err.message));
  res.json({ ok: true, message: 'Recarga iniciada.' });
});

// ── API: Reporte Ventas Histórico (streaming CSV) ────────────────────────────
app.get('/api/reporte-ventas-historico', async (req, res) => {
  const { desde, hasta } = req.query;
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Se requieren los parámetros "desde" y "hasta" (YYYY-MM-DD).' });
  }
  // Validar formato de fecha para evitar SQL injection
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
  }

  const filename = `ventas_historico_${desde}_${hasta}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM para Excel (como bytes, no como string)
  res.write(Buffer.from([0xEF, 0xBB, 0xBF]));

  let pool;
  let headerWritten = false;
  let rowCount = 0;

  try {
    pool = await sql.connect(sqlConfig);
    const request = pool.request();
    request.input('FechaDesde', sql.Date, desde);
    request.input('FechaHasta', sql.Date, hasta);
    request.stream = true;

    request.on('recordset', (columns) => {
      const headers = Object.keys(columns).join(';');
      res.write(headers + '\r\n');
      headerWritten = true;
    });

    request.on('row', (row) => {
      const line = Object.values(row).map(v => {
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
        const s = String(v);
        // Escapar campos que contengan punto y coma o saltos de línea
        if (s.includes(';') || s.includes('\n') || s.includes('"')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(';');
      res.write(line + '\r\n');
      rowCount++;
    });

    request.on('error', (err) => {
      console.error('[/api/reporte-ventas-historico] row error:', err.message);
      if (!headerWritten) {
        res.status(500).end();
      } else {
        res.end();
      }
    });

    request.on('done', () => {
      console.log(`[reporte-historico] Completado: ${rowCount} filas (${desde} → ${hasta})`);
      res.end();
    });

    request.execute('sp_ReporteVentasHistorico');
  } catch (err) {
    console.error('[/api/reporte-ventas-historico]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
    if (pool) pool.close().catch(() => {});
  }
});

// ── API: forzar descarga FTP pendiente (todos los archivos) ──────────────────
app.post('/api/ftp/import', async (_req, res) => {
  const summary = {};
  for (const { pattern, fuente, key } of [
    { pattern: /tesi/i,   fuente: 'Tesi',   key: 'tesi'   },
    { pattern: /pueblo/i, fuente: 'Pueblo', key: 'pueblo' },
  ]) {
    summary[fuente] = { files: 0, rows: 0, errors: [] };
    try {
      const files = await fetchAllFromFTP(pattern, true);
      summary[fuente].files = files.length;
      for (const { name, csv } of files) {
        try {
          const n = await saveFTPDataToSQL(csv, fuente);
          summary[fuente].rows += n;
          console.log(`[ftp/import] ${fuente}: ${name} → ${n} filas`);
        } catch (saveErr) {
          console.error(`[ftp/import] ${fuente} ERROR en ${name}:`, saveErr.message);
          summary[fuente].errors.push(`${name}: ${saveErr.message}`);
        }
      }
      if (files.length) lastUpdated[key] = new Date().toISOString();
      delete cache[key];
    } catch (err) {
      console.error(`[ftp/import] ${fuente} ERROR:`, err.message);
      summary[fuente].errors.push(err.message);
    }
  }
  res.json({ ok: true, summary });
});

// ── API: forzar cruce y guardar en SQL ───────────────────────────────────────
app.post('/api/save-cruce', async (_req, res) => {
  try {
    const n = await performAndSaveCruce();
    res.json({ ok: true, rows: n });
  } catch (err) {
    console.error('[/api/save-cruce]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Calcular ms hasta la próxima hora de refresh (default 7:00 AM)
const REFRESH_HOUR = parseInt(process.env.REFRESH_HOUR || '7', 10);
function msUntilNextRefresh() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(REFRESH_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// ── Helper: parsear fuente+fecha del nombre de archivo local ─────────────────
function parseFuenteFecha(filename) {
  const base = filename.replace(/\.csv$/i, '');
  const isTesi   = /^tesi/i.test(base);
  const isPueblo = /^pueblo/i.test(base);
  if (!isTesi && !isPueblo) return null;
  const fuente = isTesi ? 'Tesi' : 'Pueblo';
  let m = base.match(/_(\d{4})(\d{2})(\d{2})_/);
  if (m) return { fuente, fecha: `${m[1]}-${m[2]}-${m[3]}` };
  m = base.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { fuente, fecha: `${m[1]}-${m[2]}-${m[3]}` };
  return null;
}

// ── API: importar CSVs locales del directorio raíz → Procesados/ ─────────────
app.post('/api/local/import', async (_req, res) => {
  const procesadosDir = path.join(__dirname, 'Procesados');
  if (!existsSync(procesadosDir)) mkdirSync(procesadosDir);

  const csvFiles = readdirSync(__dirname)
    .filter(f => /\.csv$/i.test(f) && !/^cruce_/i.test(f))
    .sort();

  const summary = { total: csvFiles.length, inserted: 0, skipped: 0, moved: [], errors: [] };

  for (const filename of csvFiles) {
    const meta = parseFuenteFecha(filename);
    if (!meta) {
      summary.skipped++;
      summary.errors.push(`${filename}: nombre no reconocido (esperado tesi-*.csv / pueblo-*.csv)`);
      continue;
    }
    try {
      const csvText = readFileSync(path.join(__dirname, filename), 'utf8');
      const n = await saveFTPDataToSQL(csvText, meta.fuente, meta.fecha);
      summary.inserted += n;
      renameSync(path.join(__dirname, filename), path.join(procesadosDir, filename));
      summary.moved.push(filename);
      const key = meta.fuente === 'Tesi' ? 'tesi' : 'pueblo';
      delete cache[key];
      lastUpdated[key] = new Date().toISOString();
      console.log(`[local/import] ${filename} → ${meta.fuente} ${meta.fecha} → ${n} filas → Procesados/`);
    } catch (err) {
      console.error(`[local/import] ERROR en ${filename}:`, err.message);
      summary.errors.push(`${filename}: ${err.message}`);
    }
  }

  // Relanzar cruce si se insertó algo
  if (summary.inserted > 0) {
    try {
      const cruceRows = await performAndSaveCruce();
      summary.cruce = { ok: true, rows: cruceRows };
      console.log(`[local/import] Cruce actualizado: ${cruceRows} filas`);
    } catch (err) {
      console.error('[local/import] cruce ERROR:', err.message);
      summary.cruce = { ok: false, error: err.message };
    }
  }

  res.json({ ok: true, summary });
});

// ── Static files (production build) — debe ir después de todas las rutas API ──
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en http://${HOST}:${PORT}`);
  // Carga inicial al arrancar
  refreshAllData();
  // Refresh diario a las REFRESH_HOUR (default 6:00 AM)
  setTimeout(function schedule() {
    refreshAllData(true);  // isScheduled=true → FTP + guarda en SQL + mueve a OLD
    setTimeout(schedule, 24 * 60 * 60 * 1000);
  }, msUntilNextRefresh());
  console.log(`[refresh] Próxima recarga programada a las ${REFRESH_HOUR}:00 hs`);
});
