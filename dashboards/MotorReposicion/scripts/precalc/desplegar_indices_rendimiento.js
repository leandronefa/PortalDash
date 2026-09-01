// scripts/precalc/desplegar_indices_rendimiento.js
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 30 * 60 * 1000, // 30 minutos -- crear indice en tablas de millones de filas puede tardar
};

async function main() {
  const rutaSql = path.join(__dirname, '..', '..', 'sql', '2026-09-01_indices_rendimiento_fechas.sql');
  const texto = fs.readFileSync(rutaSql, 'utf8');

  const pool = await sql.connect(dbConfig);
  const inicio = Date.now();
  await pool.request().query(texto);
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`Indices creados (o ya existian) en ${segundos} segundos.`);

  const verificar = await pool.request().query(`
    SELECT name, object_id FROM sys.indexes
    WHERE name IN ('IX_VtaDetalle_Fecha_Cubriente', 'IX_DisTransfEmitidas_Fecha_Cubriente')
  `);
  console.log('Indices confirmados en sys.indexes:', verificar.recordset);
  if (verificar.recordset.length !== 2) {
    console.error('ERROR: se esperaban 2 indices, se encontraron', verificar.recordset.length);
    await pool.close();
    process.exit(1);
  }
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
