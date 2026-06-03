const sql = require('mssql');
const fs = require('fs');
const config = { server: '10.0.0.115', user: 'sa', password: 'MicroS123', database: 'db_Cegid', options: { encrypt: false, trustServerCertificate: true } };
(async () => {
  const pool = await sql.connect(config);
  
  // Deploy SP
  const script = fs.readFileSync('../SP_CalcularComisiones_v5.sql', 'utf8');
  const parts = script.split(/\nGO\b/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) await pool.request().batch(trimmed);
  }
  console.log('SP v5 deployed with padrinos + reemplazos');
  
  // Test execution
  const r = await pool.request()
    .input('FechaEjecucion', sql.Date, '2026-03-26')
    .input('Empresa', sql.VarChar, 'Tesi')
    .input('MostrarDetalle', sql.Bit, 0)
    .execute('dbo.SP_CalcularComisionesVendedores');
  
  const res = r.recordset;
  console.log('\nTotal vendedores:', res.length);
  
  const conAhijados = res.filter(r => r.VentaAhijados > 0);
  console.log('\nPadrinos con VentaAhijados:');
  conAhijados.forEach(r => {
    console.log(`  ${r.NroVendedor} ${r.NombreVendedor} - VtaAhijados: $${Number(r.VentaAhijados).toLocaleString('es-AR')} | ComAhijados: $${Number(r.ComisionAhijados).toLocaleString('es-AR')}`);
  });
  
  const conReemplazos = res.filter(r => r.MontoReemplazos > 0);
  console.log('\nVendedores con MontoReemplazos:');
  conReemplazos.forEach(r => {
    console.log(`  ${r.NroVendedor} ${r.NombreVendedor} - Reemplazos: $${Number(r.MontoReemplazos).toLocaleString('es-AR')} (${r.CantReemplazos} dias)`);
  });
  
  if (conAhijados.length === 0) console.log('  (ninguno en este periodo)');
  if (conReemplazos.length === 0) console.log('  (ninguno en este periodo)');
  
  // Verify new columns exist
  const cols = Object.keys(res[0] || {});
  console.log('\nColumnas resumen:', cols.join(', '));
  
  await pool.close();
})().catch(e => { console.error(e.message); process.exit(1); });
