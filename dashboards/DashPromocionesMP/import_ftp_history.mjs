/**
 * Importación histórica desde FTP → SQL Server
 * Baja TODOS los archivos Tesi*.csv y Pueblo*.csv del FTP
 * (carpeta raíz y subcarpeta OLD/) e inserta en mp_transacciones.
 *
 * Uso: node import_ftp_history.mjs
 */

import { Writable } from 'stream';
import * as ftp from 'basic-ftp';
import sql from 'mssql';
import 'dotenv/config';

const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASS,
  server: process.env.SQL_HOST,
  database: process.env.SQL_DB,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

// Detecta fuente y fecha a partir del nombre del archivo.
// Ejemplos:
//   Tesi_20260509_1000.csv         → { fuente: 'Tesi',   fecha: '2026-05-09' }
//   Pueblo_20260510_0830.csv       → { fuente: 'Pueblo', fecha: '2026-05-10' }
//   tesi-manual-2026-05-11-161834.csv   → { fuente: 'Tesi',   fecha: '2026-05-11' }
//   pueblo-manual-2026-05-11-161939.csv → { fuente: 'Pueblo', fecha: '2026-05-11' }
function parseFuenteFecha(filename) {
  const base = filename.replace(/\.csv$/i, '');
  const isTesi   = /^tesi/i.test(base);
  const isPueblo = /^pueblo/i.test(base);
  if (!isTesi && !isPueblo) return null;
  const fuente = isTesi ? 'Tesi' : 'Pueblo';

  // Formato 1: Tesi_YYYYMMDD_HHMM
  let m = base.match(/_(\d{4})(\d{2})(\d{2})_/);
  if (m) return { fuente, fecha: `${m[1]}-${m[2]}-${m[3]}` };

  // Formato 2: xxx-YYYY-MM-DD-HHMMSS o xxx-YYYY-MM-DD
  m = base.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { fuente, fecha: `${m[1]}-${m[2]}-${m[3]}` };

  return null;
}

async function downloadFile(client, remotePath) {
  const chunks = [];
  const writable = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  await client.downloadTo(writable, remotePath);
  return Buffer.concat(chunks).toString('utf8');
}

async function saveToDB(csvString, fuente, fechaDescarga) {
  const lines = csvString.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) { console.log(`  → vacío, omitido`); return 0; }

  const rawHeaders = lines[0].split(';').map(h => h.trim());
  const dataRows = lines.slice(1);

  const get = (obj, ...keys) => {
    for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
    return '';
  };

  const pool = await sql.connect(sqlConfig);

  // Verificar si ya existen datos para esta fuente+fecha (evitar duplicados)
  const exists = await pool.request()
    .input('fuente', sql.VarChar(10), fuente)
    .input('fecha', sql.Date, fechaDescarga)
    .query('SELECT COUNT(*) AS cnt FROM mp_transacciones WHERE fuente = @fuente AND fecha_descarga = @fecha');
  const cnt = exists.recordset[0].cnt;
  if (cnt > 0) {
    console.log(`  → ${fuente} ${fechaDescarga}: ya tiene ${cnt} filas en SQL, omitido (usar --force para sobreescribir)`);
    await pool.close();
    return 0;
  }

  const table = new sql.Table('mp_transacciones');
  table.create = false;
  table.columns.add('fuente',              sql.VarChar(10),    { nullable: false });
  table.columns.add('fecha_descarga',      sql.Date,           { nullable: false });
  table.columns.add('date_created',        sql.DateTime2(0),   { nullable: true });
  table.columns.add('transaction_amount',  sql.Decimal(18, 2), { nullable: true });
  table.columns.add('mercadopago_fee',     sql.Decimal(18, 2), { nullable: true });
  table.columns.add('net_received_amount', sql.Decimal(18, 2), { nullable: true });
  table.columns.add('cuotas',              sql.Int,            { nullable: true });
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
  return dataRows.length;
}

async function listAllCSVFiles(client, remotePath) {
  const results = [];

  await client.cd(remotePath);
  const list = await client.list();

  for (const f of list) {
    if (/\.csv$/i.test(f.name)) {
      results.push({ path: f.name, name: f.name });
    }
    // También entrar en OLD/
    if (f.isDirectory && f.name.toUpperCase() === 'OLD') {
      try {
        await client.cd('OLD');
        const oldList = await client.list();
        for (const of2 of oldList) {
          if (/\.csv$/i.test(of2.name)) {
            results.push({ path: `OLD/${of2.name}`, name: of2.name });
          }
        }
        await client.cd('..');
      } catch (_) {}
    }
  }

  return results;
}

async function main() {
  const force = process.argv.includes('--force');
  if (force) console.log('Modo --force: sobreescribirá filas existentes');

  const client = new ftp.Client(30000);
  client.ftp.verbose = false;

  try {
    console.log('Conectando al FTP...');
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: false,
    });

    const remotePath = process.env.FTP_PATH || '/MercadoPago';
    console.log(`Listando archivos en ${remotePath} y ${remotePath}/OLD ...`);
    const files = await listAllCSVFiles(client, remotePath);
    console.log(`Encontrados ${files.length} archivos CSV\n`);

    let totalInserted = 0;
    let skipped = 0;

    for (const file of files) {
      const meta = parseFuenteFecha(file.name);
      if (!meta) {
        console.log(`SKIP (nombre no reconocido): ${file.path}`);
        skipped++;
        continue;
      }

      console.log(`Procesando: ${file.path}  →  ${meta.fuente} ${meta.fecha}`);

      // Si --force, eliminar primero
      if (force) {
        const pool = await sql.connect(sqlConfig);
        await pool.request()
          .input('fuente', sql.VarChar(10), meta.fuente)
          .input('fecha', sql.Date, meta.fecha)
          .query('DELETE FROM mp_transacciones WHERE fuente = @fuente AND fecha_descarga = @fecha');
        await pool.close();
      }

      try {
        // Volver al directorio base antes de cada descarga
        await client.cd(remotePath);
        const csv = await downloadFile(client, file.path);
        const n = await saveToDB(csv, meta.fuente, meta.fecha);
        if (n > 0) {
          console.log(`  → ${n} filas insertadas`);
          totalInserted += n;
        }
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
      }
    }

    console.log(`\n✓ Importación completada: ${totalInserted} filas insertadas, ${skipped} archivos omitidos`);
  } finally {
    client.close();
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
