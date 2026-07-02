import { getPool } from '../server/config/db.js';
import dotenv from 'dotenv'; dotenv.config();
const pool = await getPool();

// Cajeros asignados a suc 2 en DetalleDiaria
const r = await pool.request().query(`
  SELECT dd.VEND, dd.Sucursal, v.APELLIDO, v.NOMBRE, v.TIPO, v.FECHAING, v.COMISIONA
  FROM dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
  LEFT JOIN dbo.tbl_CoVenApp_Vendedores v ON v.NRO_VENDEDOR = dd.VEND
  WHERE dd.Sucursal IN ('000002','2','02','2')
`);
console.log('DetalleDiaria suc 02:', JSON.stringify(r.recordset, null, 2));

// Todos los valores distintos de sucursal con CAJERO
const r2 = await pool.request().query(`
  SELECT DISTINCT dd.Sucursal
  FROM dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
  INNER JOIN dbo.tbl_CoVenApp_Vendedores v ON v.NRO_VENDEDOR = dd.VEND
  WHERE v.TIPO = 'CAJERO'
  ORDER BY dd.Sucursal
`);
console.log('Todas las sucursales con cajeros:', JSON.stringify(r2.recordset));

process.exit(0);
