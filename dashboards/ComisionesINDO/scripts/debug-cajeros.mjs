import { getPool, sql } from '../server/config/db.js';
import dotenv from 'dotenv'; dotenv.config();

const pool = await getPool();

// Test join cajeros + detalle diaria para 2026-05
const r = await pool.request()
  .input('yr', sql.Int, 2026)
  .input('mo', sql.Int, 5)
  .query(`
    SELECT TOP 5 v.NRO_VENDEDOR, v.APELLIDO, v.NOMBRE, v.TIPO, v.FECHAING,
           dd.VEND, dd.Sucursal, dd.año, dd.mes
    FROM dbo.tbl_CoVenApp_Vendedores v
    INNER JOIN dbo.tbl_CoVenApp_VendedoresDetalleDiaria dd
      ON dd.VEND = v.NRO_VENDEDOR AND dd.año = @yr AND dd.mes = @mo
    WHERE v.TIPO = 'CAJERO'
  `);
console.log('JOIN result:', JSON.stringify(r.recordset, null, 2));

// Tipos disponibles
const r2 = await pool.request().query(`SELECT TIPO, COUNT(*) as cnt FROM dbo.tbl_CoVenApp_Vendedores GROUP BY TIPO`);
console.log('TIPOS en Vendedores:', JSON.stringify(r2.recordset));

// Valores de TIPO para cajeros específicamente
const r3 = await pool.request().query(`SELECT TOP 3 NRO_VENDEDOR, TIPO FROM dbo.tbl_CoVenApp_Vendedores WHERE UPPER(TIPO) = 'CAJERO'`);
console.log('Cajeros (UPPER):', JSON.stringify(r3.recordset));

// Qué VEND hay en DetalleDiaria para 2026-05
const r4 = await pool.request()
  .input('yr', sql.Int, 2026).input('mo', sql.Int, 5)
  .query(`SELECT TOP 5 VEND, Sucursal FROM dbo.tbl_CoVenApp_VendedoresDetalleDiaria WHERE año=@yr AND mes=@mo`);
console.log('DetalleDiaria 2026-05:', JSON.stringify(r4.recordset));

process.exit(0);
