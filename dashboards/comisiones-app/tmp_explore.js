const sql = require('mssql');
const config = { server: '10.0.0.115', user: 'sa', password: 'MicroS123', database: 'db_Cegid', options: { encrypt: false, trustServerCertificate: true } };
(async () => {
  const pool = await sql.connect(config);

  // 1. Ver SP sp_CoVenApp_CargaVentasPadrinos
  console.log('=== SP sp_CoVenApp_CargaVentasPadrinos ===');
  const sp = await pool.request().query(`
    SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_CoVenApp_CargaVentasPadrinos')) AS def
  `);
  console.log(sp.recordset[0].def);

  // 2. Ver estructura tbl_CoVenApp_reemplazos
  console.log('\n=== tbl_CoVenApp_reemplazos COLUMNS ===');
  const r1 = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tbl_CoVenApp_reemplazos' ORDER BY ORDINAL_POSITION
  `);
  r1.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE}${c.CHARACTER_MAXIMUM_LENGTH ? '('+c.CHARACTER_MAXIMUM_LENGTH+')' : ''})`));

  // 3. Ver datos reemplazos
  console.log('\n=== tbl_CoVenApp_reemplazos SAMPLE ===');
  const r2 = await pool.request().query(`SELECT TOP 10 * FROM dbo.tbl_CoVenApp_reemplazos`);
  console.log(JSON.stringify(r2.recordset, null, 2));

  // 4. Ver estructura tbl_CoVenApp_ReemplazosSucursales
  console.log('\n=== tbl_CoVenApp_ReemplazosSucursales COLUMNS ===');
  const r3 = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'tbl_CoVenApp_ReemplazosSucursales' ORDER BY ORDINAL_POSITION
  `);
  r3.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE}${c.CHARACTER_MAXIMUM_LENGTH ? '('+c.CHARACTER_MAXIMUM_LENGTH+')' : ''})`));

  // 5. Ver datos ReemplazosSucursales
  console.log('\n=== tbl_CoVenApp_ReemplazosSucursales SAMPLE ===');
  const r4 = await pool.request().query(`SELECT TOP 10 * FROM dbo.tbl_CoVenApp_ReemplazosSucursales`);
  console.log(JSON.stringify(r4.recordset, null, 2));

  // 6. Ver IDPADRINO en vendedores
  console.log('\n=== Vendedores con IDPADRINO ===');
  const r5 = await pool.request().query(`
    SELECT NRO_VENDEDOR, NOMBRE, APELLIDO, TIPO, IDPADRINO
    FROM dbo.tbl_CoVenApp_Vendedores
    WHERE IDPADRINO IS NOT NULL AND IDPADRINO <> ''
    ORDER BY IDPADRINO
  `);
  console.log('Total ahijados:', r5.recordset.length);
  r5.recordset.forEach(v => console.log(`  ${v.NRO_VENDEDOR} (${v.TIPO||'?'}) -> Padrino: ${v.IDPADRINO}  [${v.APELLIDO}, ${v.NOMBRE}]`));

  await pool.close();
})().catch(e => { console.error(e.message); process.exit(1); });
