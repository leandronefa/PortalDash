require('dotenv').config();
const sql = require('mssql');
const cfg = {
  server: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASS, database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(cfg).then(pool => pool.request().query(
  `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_TYPE='BASE TABLE'
     AND (TABLE_NAME LIKE '%trans%' OR TABLE_NAME LIKE '%dis_%'
          OR TABLE_NAME LIKE '%ingres%' OR TABLE_NAME LIKE '%movim%')
   ORDER BY TABLE_NAME`
)).then(r => {
  console.log('Tablas encontradas:');
  r.recordset.forEach(x => console.log(' -', x.TABLE_NAME));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
