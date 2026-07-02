import sql from 'mssql';
const cfg = { server:'10.0.0.115', user:'sa', password:'MicroS123', database:'db_Cegid', options:{trustServerCertificate:true,encrypt:false,enableArithAbort:true} };
const pool = await sql.connect(cfg);

console.log('=== tbl_CoVenAppINDO_Montos ===');
const m = await pool.request().query(`SELECT seccion, escalon, categoria_suc, participacion, escalon_monto, subtotal, ticket_promedio, operacion, total FROM dbo.tbl_CoVenAppINDO_Montos ORDER BY seccion, escalon, categoria_suc`);
console.table(m.recordset);

console.log('\n=== tbl_CoVenAppINDO_MontosPrestamos ===');
const p = await pool.request().query(`SELECT tipo, escalon, categoria_suc, monto FROM dbo.tbl_CoVenAppINDO_MontosPrestamos ORDER BY tipo, escalon, categoria_suc`);
console.table(p.recordset);

console.log('\n=== ObjConsumo campos disponibles (1 fila de muestra) ===');
const o = await pool.request().query(`SELECT TOP 3 * FROM dbo.tbl_CoVenAppINDO_ObjConsumo`);
console.table(o.recordset);

console.log('\n=== DatosConsumo para periodo 2026-03 (3 filas) ===');
const d = await pool.request().input('p', sql.VarChar, '2026-03').query(`SELECT TOP 3 sucursal_id, ventas, credito_promedio, operaciones FROM dbo.tbl_CoVenAppINDO_DatosConsumo WHERE periodo=@p`);
console.table(d.recordset);

await pool.close();
