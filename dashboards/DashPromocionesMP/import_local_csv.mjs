/**
 * Importa archivos CSV locales (Tesi/Pueblo) a SQL Server → mp_transacciones.
 * Lee todos los *.csv de la carpeta actual (excepto cruce_*).
 *
 * Uso: node import_local_csv.mjs [--force]
 *   --force  elimina y reimporta aunque ya existan datos para esa fecha
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sqlConfig = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASS,
  server: process.env.SQL_HOST,
  database: process.env.SQL_DB,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

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

async function saveToDB(csvString, fuente, fechaDescarga, force) {
  const lines = csvString.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) { console.log('  → vacío, omitido'); return 0; }

  const rawHeaders = lines[0].split(';').map(h => h.trim());
  const dataRows   = lines.slice(1);

  const get = (obj, ...keys) => {
    for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
    return '';
  };

  const pool = await sql.connect(sqlConfig);

  if (force) {
    await pool.request()
      .input('fuente', sql.VarChar(10), fuente)
      .input('fecha',  sql.Date,        fechaDescarga)
      .query('DELETE FROM mp_transacciones WHERE fuente = @fuente AND fecha_descarga = @fecha');
  } else {
    const exists = await pool.request()
      .input('fuente', sql.VarChar(10), fuente)
      .input('fecha',  sql.Date,        fechaDescarga)
      .query('SELECT COUNT(*) AS cnt FROM mp_transacciones WHERE fuente = @fuente AND fecha_descarga = @fecha');
    const cnt = exists.recordset[0].cnt;
    if (cnt > 0) {
      console.log(`  → ya tiene ${cnt} filas en SQL, omitido (usá --force para reimportar)`);
      await pool.close();
      return -1;
    }
  }

  const table = new sql.Table('mp_transacciones');
  table.create = false;
  table.columns.add('fuente',              sql.VarChar(10),    { nullable: false });
  table.columns.add('fecha_descarga',      sql.Date,           { nullable: false });
  table.columns.add('date_created',        sql.DateTime2(0),   { nullable: true  });
  table.columns.add('transaction_amount',  sql.Decimal(18, 2), { nullable: true  });
  table.columns.add('mercadopago_fee',     sql.Decimal(18, 2), { nullable: true  });
  table.columns.add('net_received_amount', sql.Decimal(18, 2), { nullable: true  });
  table.columns.add('cuotas',              sql.Int,            { nullable: true  });
  table.columns.add('payment_type',        sql.VarChar(50),    { nullable: true  });
  table.columns.add('description',         sql.VarChar(200),   { nullable: true  });
  table.columns.add('financing_fee',       sql.Decimal(18, 2), { nullable: true  });
  table.columns.add('sub_unit',            sql.VarChar(50),    { nullable: true  });
  table.columns.add('franchise',           sql.VarChar(100),   { nullable: true  });
  table.columns.add('issuer_name',         sql.VarChar(100),   { nullable: true  });

  for (const line of dataRows) {
    const vals = line.split(';');
    const row  = {};
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

async function main() {
  const force = process.argv.includes('--force');
  if (force) console.log('Modo --force: reimportará aunque ya existan datos\n');

  const csvFiles = readdirSync(__dirname)
    .filter(f => /\.csv$/i.test(f) && !/^cruce_/i.test(f))
    .sort();

  console.log(`Archivos CSV encontrados: ${csvFiles.length}\n`);

  let totalInserted = 0;
  let skipped = 0;
  let errors   = 0;

  for (const filename of csvFiles) {
    const meta = parseFuenteFecha(filename);
    if (!meta) {
      console.log(`SKIP (nombre no reconocido): ${filename}`);
      skipped++;
      continue;
    }

    console.log(`Procesando: ${filename}  →  ${meta.fuente} ${meta.fecha}`);
    try {
      const csvText = readFileSync(join(__dirname, filename), 'utf8');
      const n = await saveToDB(csvText, meta.fuente, meta.fecha, force);
      if (n > 0) {
        console.log(`  → ${n} filas insertadas`);
        totalInserted += n;
      } else if (n === -1) {
        skipped++;
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nImportación completada:`);
  console.log(`  Filas insertadas : ${totalInserted}`);
  console.log(`  Omitidos         : ${skipped}`);
  console.log(`  Errores          : ${errors}`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
