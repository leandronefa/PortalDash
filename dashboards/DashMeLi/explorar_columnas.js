require('dotenv').config();
const sql = require('mssql');
const cfg = {
  server: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASS, database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true }
};
sql.connect(cfg).then(async pool => {
  const cols = await pool.request().query(
    `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_NAME = 'dis_transf_recibidas'
     ORDER BY ORDINAL_POSITION`
  );
  console.log('Columnas de dis_transf_recibidas:');
  cols.recordset.forEach(c => console.log(` - ${c.COLUMN_NAME} (${c.DATA_TYPE}${c.CHARACTER_MAXIMUM_LENGTH ? '('+c.CHARACTER_MAXIMUM_LENGTH+')' : ''})`));

  const sample = await pool.request().query(
    `SELECT TOP 3 * FROM dis_transf_recibidas`
  );
  console.log('\nMuestra (3 filas):');
  sample.recordset.forEach((r, i) => { console.log(`\n[${i+1}]`); Object.entries(r).forEach(([k,v]) => console.log(`  ${k}: ${v}`)); });

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
