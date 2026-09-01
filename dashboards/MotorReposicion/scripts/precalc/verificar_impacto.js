// scripts/precalc/verificar_impacto.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const pool = await sql.connect(dbConfig);

  const r1 = await pool.request().query(`
    SELECT COUNT(*) AS Total, SUM(CASE WHEN StockSemana=0 THEN 1 ELSE 0 END) AS FilasEnCero
    FROM dbo.MotorReposicion_StockSemanal
  `);
  console.log('MotorReposicion_StockSemanal ahora:', r1.recordset[0]);
  console.log('  (antes del cambio: Total=8.001.970, FilasEnCero=0 -- ahora FilasEnCero deberia ser un numero grande, no 0)');

  const r2 = await pool.request().query(`
    SELECT COUNT(*) AS FilasConQuiebreContribucion
    FROM dbo.MotorReposicion_DiasConStockPorSemana
    WHERE DiasQuiebreContribucion > 0
  `);
  console.log('Filas con DiasQuiebreContribucion > 0:', r2.recordset[0], '(antes del cambio: 6.981 de 8.001.970 -- deberia subir bastante)');

  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
