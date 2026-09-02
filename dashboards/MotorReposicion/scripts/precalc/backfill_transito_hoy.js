// scripts/precalc/backfill_transito_hoy.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 5 * 60 * 1000,
};
async function main() {
  const pool = await sql.connect(dbConfig);
  const inicio = Date.now();
  await pool.request().query(`
    TRUNCATE TABLE dbo.MotorReposicion_TransitoHoy;
    INSERT INTO dbo.MotorReposicion_TransitoHoy (Sucursal, CodArticulo, COLOR, TALLE, TransitoPendiente)
    SELECT te.destino, ISNULL(te.arprove,''), ISNULL(te.color,''), ISNULL(te.talle,''), SUM(te.cantpend)
    FROM dis_transf_emitidas te
    INNER JOIN Sucursales s ON s.Sucursal = te.destino AND (s.viewSuc='S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
    WHERE te.fecha >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE)) AND te.cantpend > 0
    GROUP BY te.destino, ISNULL(te.arprove,''), ISNULL(te.color,''), ISNULL(te.talle,'');
  `);
  console.log('TransitoHoy poblada en', Date.now() - inicio, 'ms');
  const r = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.MotorReposicion_TransitoHoy');
  console.log('Filas:', r.recordset[0].n);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
