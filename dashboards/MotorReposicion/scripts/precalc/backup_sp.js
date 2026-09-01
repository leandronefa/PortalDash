require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const pool = await sql.connect(dbConfig);
  const r = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.MotorReposicion_sp_PreCalcularStockSemanal')) AS Def
  `);
  const def = r.recordset[0].Def;
  if (!def || def.length < 100) {
    throw new Error('La definicion vino vacia o sospechosamente corta -- no se escribe el backup.');
  }
  const destino = path.join(__dirname, '..', '..', 'backups', '2026-08-18-dias-con-stock-huecos', 'MotorReposicion_sp_PreCalcularStockSemanal_ANTES.sql');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, def, 'utf8');
  console.log('Backup escrito en', destino, '(', def.length, 'caracteres)');
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
