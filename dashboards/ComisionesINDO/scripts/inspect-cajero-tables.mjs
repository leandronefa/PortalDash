import { getPool } from '../server/config/db.js';
import dotenv from 'dotenv'; dotenv.config();

const pool = await getPool();

// Columnas de tbl_CoVenApp_Vendedores
const cols1 = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE 
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME='tbl_CoVenApp_Vendedores' 
  ORDER BY ORDINAL_POSITION
`);
console.log('\n=== tbl_CoVenApp_Vendedores ===');
cols1.recordset.forEach(c => console.log(c.COLUMN_NAME, '-', c.DATA_TYPE));

// Columnas de tbl_CoVenApp_VendedoresDetalleDiaria
const cols2 = await pool.request().query(`
  SELECT COLUMN_NAME, DATA_TYPE 
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_NAME='tbl_CoVenApp_VendedoresDetalleDiaria' 
  ORDER BY ORDINAL_POSITION
`);
console.log('\n=== tbl_CoVenApp_VendedoresDetalleDiaria ===');
cols2.recordset.forEach(c => console.log(c.COLUMN_NAME, '-', c.DATA_TYPE));

// Muestra de datos de VendedoresDetalleDiaria (cajero)
const sample = await pool.request().query(`
  SELECT TOP 3 dd.* 
  FROM dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
  INNER JOIN dbo.tbl_CoVenApp_Vendedores v ON dd.VEND = v.NRO_VENDEDOR
  WHERE v.TIPO = 'cajero'
`);
console.log('\n=== Muestra VendedoresDetalleDiaria (cajero) ===');
console.log(JSON.stringify(sample.recordset, null, 2));

// Muestra cajero con fecha ingreso
const cajSample = await pool.request().query(`
  SELECT TOP 5 NRO_VENDEDOR, APELLIDO, NOMBRE, TIPO, COMISIONA, GCL_TEMPSPARTIEL
  FROM dbo.tbl_CoVenApp_Vendedores WHERE TIPO = 'cajero'
`);
console.log('\n=== Muestra cajeros ===');
console.log(JSON.stringify(cajSample.recordset, null, 2));

process.exit(0);
