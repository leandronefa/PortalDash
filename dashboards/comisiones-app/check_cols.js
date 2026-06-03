const sql = require('mssql');
const cfg = {server:'10.0.0.115',database:'db_Cegid',user:'sa',password:'MicroS123',options:{encrypt:false,trustServerCertificate:true}};

async function main() {
    const pool = await sql.connect(cfg);

    // Vta_detalle columns
    const r1 = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Vta_detalle' ORDER BY ORDINAL_POSITION");
    console.log('Vta_detalle columns:', r1.recordset.map(x => x.COLUMN_NAME));

    // Sample Vta_detalle with CANTIDAD, PRECIO, DESCUENTO2
    const r2 = await pool.request().query("SELECT TOP 2 CANTIDAD, PRECIO, DESCUENTO, DESCUENTO2, ARTCEGID, VEND FROM dbo.Vta_detalle WHERE CANTIDAD <> 0");
    console.log('\nSample Vta_detalle:', JSON.stringify(r2.recordset, null, 2));

    // Check if TCVAGVD is same as Vta_detalle or a different table
    const r3 = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%TCVAGVD%' OR TABLE_NAME LIKE '%tcvagvd%'");
    console.log('\nTCVAGVD table exists?', r3.recordset);

    // How many part-time vs full-time vendors that COMISIONA=1
    const r4 = await pool.request().query("SELECT GCL_TEMPSPARTIEL, COUNT(*) as cnt FROM dbo.tbl_CoVenApp_Vendedores WHERE COMISIONA=1 GROUP BY GCL_TEMPSPARTIEL");
    console.log('\nPart-time distribution (COMISIONA=1):', r4.recordset);

    // Sample comision especial to verify formula
    const r5 = await pool.request().query("SELECT TOP 3 idComision, seccion, marca, porcentaje, Nivel FROM dbo.tbl_CoVenApp_ComisionesEspeciales WHERE porcentaje > 0 ORDER BY Nivel DESC");
    console.log('\nSample ComisionesEspeciales with porcentaje > 0:', JSON.stringify(r5.recordset, null, 2));

    await sql.close();
}
main().catch(e => { console.error(e.message); sql.close(); });
