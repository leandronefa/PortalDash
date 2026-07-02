require('dotenv').config();
const sql = require('mssql');
const cfg = {
  server: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASS, database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(cfg).then(async pool => {
  const count = await pool.request().query(`
    SELECT destino, COUNT(*) AS registros, MIN(fecha) AS primera, MAX(fecha) AS ultima
    FROM dis_transf_recibidas
    WHERE destino IN ('000198', '000199')
    GROUP BY destino
  `);
  console.log('Registros por depósito:');
  count.recordset.forEach(r => console.log(` Dep ${r.destino}: ${r.registros} registros | desde ${r.primera?.toISOString().slice(0,10)} hasta ${r.ultima?.toISOString().slice(0,10)}`));

  const sample = await pool.request().query(`
    SELECT TOP 5 destino, fecha, arprove, detalle, color, talle, cantidad, costouni
    FROM dis_transf_recibidas
    WHERE destino IN ('000198', '000199')
    ORDER BY fecha DESC
  `);
  console.log('\nÚltimos 5 registros:');
  sample.recordset.forEach(r => console.log(` [${r.destino}] ${r.fecha?.toISOString().slice(0,10)} | ${r.arprove} | ${r.detalle} | ${r.color} talle ${r.talle} | cant ${r.cantidad}`));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
