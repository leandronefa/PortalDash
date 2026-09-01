// scripts/precalc/correr_sp_y_medir.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 30 * 60 * 1000, // 30 minutos, por si tarda mas de lo esperado
};

async function main() {
  const pool = await sql.connect(dbConfig);
  const inicio = Date.now();
  await pool.request().query(`EXEC dbo.MotorReposicion_sp_PreCalcularStockSemanal`);
  const segundos = Math.round((Date.now() - inicio) / 1000);
  console.log(`El SP corrio OK en ${segundos} segundos (antes rondaba los 6-7 minutos = 360-420 segundos).`);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
