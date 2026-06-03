const sql = require('mssql');
const config = { server: '10.0.0.115', user: 'sa', password: 'MicroS123', database: 'db_Cegid', options: { encrypt: false, trustServerCertificate: true } };
(async () => {
  const pool = await sql.connect(config);

  // Reemplazos in current period
  console.log('=== Reemplazos en periodo Feb-Mar 2026 ===');
  const r1 = await pool.request().query(`
    SELECT r.idReemplazos, r.idLicencia, r.NroVendReemplazo, r.fecha_desde, r.fecha_hasta, 
           r.cod_sucursal, rs.tipo AS tipoSucursal, rs.francos, rs.licencias,
           l.estado, l.idPoliticaHumand
    FROM dbo.tbl_CoVenApp_reemplazos r
    LEFT JOIN dbo.tbl_CoVenApp_ReemplazosSucursales rs ON r.cod_sucursal = rs.sucursal
    LEFT JOIN dbo.tbl_CoVenApp_Licencias l ON r.idLicencia = l.idLicencia
    WHERE r.fecha_desde >= '2026-02-26' AND r.fecha_hasta <= '2026-03-25'
    ORDER BY r.NroVendReemplazo, r.fecha_desde
  `);
  console.log('Total reemplazos en periodo:', r1.recordset.length);
  r1.recordset.forEach(r => console.log(JSON.stringify(r)));

  // All ReemplazosSucursales
  console.log('\n=== TODAS las ReemplazosSucursales ===');
  const r2 = await pool.request().query(`SELECT * FROM dbo.tbl_CoVenApp_ReemplazosSucursales ORDER BY sucursal`);
  r2.recordset.forEach(r => console.log(`  ${r.sucursal} tipo=${r.tipo} francos=${r.francos} licencias=${r.licencias}`));

  // Check PADRINO_FECHA_INICIO/FIN columns
  console.log('\n=== Columns PADRINO in tbl_CoVenApp_Vendedores ===');
  const r3 = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME='tbl_CoVenApp_Vendedores' AND COLUMN_NAME LIKE '%PADRINO%'
  `);
  r3.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));

  // Active padrinos in period
  console.log('\n=== Padrinos activos en periodo actual ===');
  const r4 = await pool.request().query(`
    SELECT v.NRO_VENDEDOR AS ahijado, v.APELLIDO + ', ' + v.NOMBRE AS nombreAhijado,
           v.TIPO, v.IDPADRINO, v.PADRINO_FECHA_INICIO, v.PADRINO_FECHA_FIN
    FROM dbo.tbl_CoVenApp_Vendedores v
    WHERE v.IDPADRINO IS NOT NULL AND v.IDPADRINO <> ''
      AND (v.PADRINO_FECHA_INICIO <= '2026-03-25' AND v.PADRINO_FECHA_FIN >= '2026-02-26')
    ORDER BY v.IDPADRINO
  `);
  console.log('Ahijados activos en periodo:', r4.recordset.length);
  r4.recordset.forEach(r => console.log(`  ${r.ahijado} -> Padrino ${r.IDPADRINO}  [${r.nombreAhijado}]  ${r.PADRINO_FECHA_INICIO?.toISOString().slice(0,10)} - ${r.PADRINO_FECHA_FIN?.toISOString().slice(0,10)}`));

  // Check idLicencia in reemplazos - is it from tbl_CoVenApp_Licencias?
  console.log('\n=== Reemplazo idLicencia mapping ===');
  const r5 = await pool.request().query(`
    SELECT TOP 5 r.idReemplazos, r.idLicencia, r.NroVendReemplazo,
           l.idLicencia AS lic_id, l.estado, l.inicioLicencia, l.finLicencia,
           p.descripcion AS tipolicencia
    FROM dbo.tbl_CoVenApp_reemplazos r
    LEFT JOIN dbo.tbl_CoVenApp_Licencias l ON r.idLicencia = l.idLicencia
    LEFT JOIN dbo.tbl_CoVenApp_PoliticasDeLicencias p ON l.idPoliticaHumand = p.idPoliticaHumand
  `);
  r5.recordset.forEach(r => console.log(JSON.stringify(r)));

  // Total reemplazos by month
  console.log('\n=== Reemplazos por mes ===');
  const r6 = await pool.request().query(`
    SELECT YEAR(fecha_desde) as anio, MONTH(fecha_desde) as mes, COUNT(*) as cnt
    FROM dbo.tbl_CoVenApp_reemplazos
    GROUP BY YEAR(fecha_desde), MONTH(fecha_desde)
    ORDER BY anio DESC, mes DESC
  `);
  r6.recordset.forEach(r => console.log(`  ${r.anio}-${String(r.mes).padStart(2,'0')}: ${r.cnt} reemplazos`));

  await pool.close();
})().catch(e => { console.error(e.message); process.exit(1); });
