import sql from 'mssql';

const cfg = {
  server: '10.0.0.115', user: 'sa', password: 'MicroS123',
  database: 'db_Cegid',
  options: { trustServerCertificate: true, encrypt: false, enableArithAbort: true }
};
const cfgBC = { ...cfg, database: 'BeClever' };

const pool   = await (new sql.ConnectionPool(cfg)).connect();
const poolBC = await (new sql.ConnectionPool(cfgBC)).connect();

const PERIODO = '2026-03';
const [yr, mo] = PERIODO.split('-').map(Number);

// 1. Operadores con escalon_consumo = 0 (únicos por sucursal)
console.log('=== Sucursales con escalon_consumo=0 en resultado guardado ===');
const e0 = await pool.request().input('p', sql.VarChar, PERIODO).query(`
  SELECT DISTINCT sucursal_id, sucursal_nombre, categoria, escalon_consumo, escalon_efectivo, calc_consumo, calc_efectivo, monto_full
  FROM dbo.tbl_CoVenAppINDO_ResultadoOperadores
  WHERE periodo=@p AND (escalon_consumo=0 OR escalon_consumo IS NULL)
  ORDER BY sucursal_id
`);
console.table(e0.recordset);

if (!e0.recordset.length) { console.log('(ninguna)'); process.exit(0); }

// 2. Para cada una, calcular el ratio real
const sucIds = e0.recordset.map(r => r.sucursal_id);

const objR = await pool.request().input('p', sql.VarChar, PERIODO).query(`
  SELECT sucursal_id, primer_escalon
  FROM dbo.tbl_CoVenAppINDO_ObjConsumo
  WHERE periodo=@p AND sucursal_id IN (${sucIds.join(',')})
`);
const objMap = {};
for (const o of objR.recordset) objMap[o.sucursal_id] = o.primer_escalon;

// Ventas desde BeClever
const comercio = await poolBC.request().query('SELECT Cod_Comercio, Descripcion FROM dbo.COMERCIO');
const idByNombre = {};
for (const c of comercio.recordset) idByNombre[c.Descripcion.trim()] = c.Cod_Comercio;

const spV = await poolBC.request()
  .input('Anio', sql.Int, yr).input('Mes', sql.Int, mo)
  .execute('dbo.sp_ReporteVentasCobrosObjetivos');

const ventaMap = {};
for (const r of spV.recordset.filter(r => r.Producto?.trim() === 'CONSUMO')) {
  const id = idByNombre[r.Sucursal?.trim()];
  if (id) ventaMap[id] = r.Ventas;
}

console.log('\n=== Ratios de las sucursales E0 ===');
const T1 = 1.00, T2 = 1.10, T3 = 1.10 * 1.15;
const resultados = sucIds.map(id => {
  const obj    = objMap[id];
  const ventas = ventaMap[id];
  const ratio  = (obj && ventas) ? ventas / obj : null;
  const expected =
    ratio === null     ? 'sin datos' :
    ratio > T3 * 0.96  ? 'E3' :
    ratio > T2 * 0.96  ? 'E2' :
    ratio > T1 * 0.96  ? 'E1' : 'E0';
  return {
    sucursal_id: id,
    obj_primer_escalon: obj ?? '—',
    ventas: ventas ?? '—',
    ratio: ratio ? ratio.toFixed(4) : '—',
    shortfall_pct: ratio ? ((ratio - 1) * 100).toFixed(2) + '%' : '—',
    escalon_esperado: expected,
    escalon_guardado: 0
  };
});
console.table(resultados);

await pool.close();
await poolBC.close();
