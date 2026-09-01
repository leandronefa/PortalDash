// scripts/precalc/spotcheck_combos_con_quiebre.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};
async function main() {
  const pool = await sql.connect(dbConfig);
  const combos = await pool.request().query(`
    SELECT TOP 3 Sucursal, CodArticulo, COLOR, TALLE, SUM(DiasQuiebreContribucion) AS DiasQuiebreTotal
    FROM dbo.MotorReposicion_DiasConStockPorSemana
    WHERE DiasQuiebreContribucion > 0
    GROUP BY Sucursal, CodArticulo, COLOR, TALLE
    ORDER BY SUM(DiasQuiebreContribucion) DESC
  `);
  for (const c of combos.recordset) {
    console.log('---', c.CodArticulo, c.COLOR, c.TALLE, c.Sucursal, '| DiasQuiebreTotal calculado:', c.DiasQuiebreTotal);
    const fotos = await pool.request()
      .input('suc', sql.VarChar(20), c.Sucursal).input('art', sql.VarChar(50), c.CodArticulo)
      .input('color', sql.VarChar(100), c.COLOR).input('talle', sql.VarChar(20), c.TALLE)
      .query(`SELECT TOP 10 fecha, stock FROM FotoStock WHERE Sucursal=@suc AND artprove=@art AND color=@color AND talle=@talle ORDER BY fecha DESC`);
    console.log('  Ultimas fotos reales (FotoStock):', fotos.recordset.map(f => f.fecha.toISOString().slice(0,10) + ':' + f.stock));
    const ventas = await pool.request()
      .input('suc', sql.VarChar(20), c.Sucursal).input('art', sql.VarChar(50), c.CodArticulo)
      .input('color', sql.VarChar(100), c.COLOR).input('talle', sql.VarChar(20), c.TALLE)
      .query(`SELECT TOP 10 FECHA, CANTIDAD FROM Vta_detalle WHERE ESTAB=@suc AND ARTCEGID=@art AND COLOR=@color AND TALLE=@talle ORDER BY FECHA DESC`);
    console.log('  Ultimas ventas reales (Vta_detalle):', ventas.recordset.map(v => v.FECHA.toISOString().slice(0,10) + ':' + v.CANTIDAD));
  }
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
