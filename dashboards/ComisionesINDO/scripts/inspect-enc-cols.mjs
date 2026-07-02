import { getPool } from '../server/config/db.js';
const pool = await getPool();

// Columnas de tbl_CoVenAppINDO_Montos
const cols = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE 
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME = 'tbl_CoVenAppINDO_Montos'
  ORDER BY ORDINAL_POSITION
`);
console.log('Columnas:', cols.recordset);

// Filas ENCARGADO C
const rows = await pool.request().query(`
  SELECT * FROM dbo.tbl_CoVenAppINDO_Montos WHERE seccion='ENCARGADO' AND categoria_suc='C'
`);
console.log('ENCARGADO C:', JSON.stringify(rows.recordset, null, 2));

process.exit(0);
