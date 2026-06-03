const { getPool, sql } = require('./config/db');

(async () => {
    const pool = await getPool();

    // 1. Table structure
    const cols = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'tbl_CoVenApp_Comisiones' 
        ORDER BY ORDINAL_POSITION
    `);
    console.log('=== COLUMNS ===');
    cols.recordset.forEach(c => console.log(c.COLUMN_NAME, '-', c.DATA_TYPE));

    // 2. Get MAX año/mes
    const maxYear = await pool.request().query(`
        SELECT MAX(año) as maxAnio FROM dbo.tbl_CoVenApp_Comisiones
    `);
    console.log('\nMax año:', maxYear.recordset[0].maxAnio);

    const maxMonth = await pool.request().query(`
        SELECT MAX(mes) as maxMes FROM dbo.tbl_CoVenApp_Comisiones 
        WHERE año = (SELECT MAX(año) FROM dbo.tbl_CoVenApp_Comisiones)
    `);
    console.log('Max mes:', maxMonth.recordset[0].maxMes);

    // 3. Get data for latest period
    const data = await pool.request().query(`
        SELECT * FROM dbo.tbl_CoVenApp_Comisiones 
        WHERE año = (SELECT MAX(año) FROM dbo.tbl_CoVenApp_Comisiones)
          AND mes = (SELECT MAX(mes) FROM dbo.tbl_CoVenApp_Comisiones 
                     WHERE año = (SELECT MAX(año) FROM dbo.tbl_CoVenApp_Comisiones))
        ORDER BY valorInferior
    `);
    console.log('\n=== LATEST PERIOD DATA ===', data.recordset.length, 'rows');
    data.recordset.forEach(r => console.log(JSON.stringify(r)));

    // 4. Check historical periods
    const periods = await pool.request().query(`
        SELECT año, mes, COUNT(*) as escalones 
        FROM dbo.tbl_CoVenApp_Comisiones 
        GROUP BY año, mes 
        ORDER BY año DESC, mes DESC
    `);
    console.log('\n=== ALL PERIODS ===');
    periods.recordset.forEach(r => console.log(`${r.año}-${String(r.mes).padStart(2,'0')}: ${r.escalones} escalones`));

    // 5. Check the tbl_CoVenApp_Vendedores to understand TIPO values
    const tipos = await pool.request().query(`
        SELECT TIPO, COUNT(*) as cnt FROM dbo.tbl_CoVenApp_Vendedores GROUP BY TIPO
    `);
    console.log('\n=== VENDOR TYPES ===');
    tipos.recordset.forEach(r => console.log(`${r.TIPO}: ${r.cnt}`));

    // 6. Check current SP filter on COMISIONA
    console.log('\nDone.');
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
