import sql from 'mssql';

const cfgBC = {
  server: '10.0.0.115', user: 'sa', password: 'MicroS123',
  database: 'BeClever',
  options: { trustServerCertificate: true, encrypt: false, enableArithAbort: true }
};
const cfg = { ...cfgBC, database: 'db_Cegid' };

const PERIODO = '2026-03';
const [yr, mo] = PERIODO.split('-').map(Number);

const poolBC = await (new sql.ConnectionPool(cfgBC)).connect();
const pool   = await (new sql.ConnectionPool(cfg)).connect();

// 1. Cuántos operadores devuelve el SP de originaciones
console.log('=== sp_ReporteOriginacionesCreditos (primeras 10 filas) ===');
const rep = await poolBC.request()
  .input('Anio', sql.Int, yr).input('Mes', sql.Int, mo)
  .execute('dbo.sp_ReporteOriginacionesCreditos');
console.log(`Total filas: ${rep.recordset.length}`);
if (rep.recordset.length > 0) {
  const sample = rep.recordset.slice(0, 5);
  console.table(sample.map(r => ({
    IdUsuario: r.IdUsuario,
    IdSucursalEntidad: r.IdSucursalEntidad,
    SucDes: r.SucDes
  })));
}

// 2. IDs de sucursales en tbl_CoVenAppINDO_Sucursales
console.log('\n=== Sucursales registradas (id < 300) ===');
const sucs = await pool.request()
  .query('SELECT id, nombre FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id < 300 ORDER BY id');
const sucIds = new Set(sucs.recordset.map(s => s.id));
console.log(`Total: ${sucs.recordset.length}, IDs: ${[...sucIds].join(', ')}`);

// 3. ¿Los IdSucursalEntidad del SP coinciden con los IDs de la tabla?
if (rep.recordset.length > 0) {
  const idsSP = [...new Set(rep.recordset.map(r => r.IdSucursalEntidad))];
  console.log('\n=== IdSucursalEntidad únicos del SP ===');
  console.log(idsSP.join(', '));
  const sinMatch = idsSP.filter(id => !sucIds.has(id));
  const conMatch = idsSP.filter(id => sucIds.has(id));
  console.log(`Con match: ${conMatch.length} IDs → ${conMatch.join(', ')}`);
  console.log(`Sin match: ${sinMatch.length} IDs → ${sinMatch.join(', ')}`);
}

// 4. Ranking para el período (¿hay filas?)
console.log('\n=== Ranking 2026-03 ===');
const rk = await pool.request()
  .input('p', sql.VarChar, PERIODO)
  .query('SELECT COUNT(*) AS cnt FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@p');
console.log(`Filas: ${rk.recordset[0].cnt}`);

await pool.close();
await poolBC.close();
