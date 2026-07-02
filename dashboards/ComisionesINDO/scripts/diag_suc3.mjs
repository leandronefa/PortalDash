import sql from 'mssql';

const cfg = {
  server: '10.0.0.115', user: 'sa', password: 'MicroS123',
  database: 'db_Cegid',
  options: { trustServerCertificate: true, encrypt: false, enableArithAbort: true }
};
const cfgBC = { ...cfg, database: 'BeClever' };

const pool   = await sql.connect(cfg);
const poolBC = await (new sql.ConnectionPool(cfgBC)).connect();

const PERIODO = '2026-03';
const SUC_ID  = 3;
const [yr, mo] = PERIODO.split('-').map(Number);

// 1. ObjConsumo suc 3
console.log('=== ObjConsumo suc 3 ===');
const obj = await pool.request()
  .input('p', sql.VarChar, PERIODO).input('s', sql.Int, SUC_ID)
  .query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@p AND sucursal_id=@s');
console.table(obj.recordset);

// 2. ObjEfectivo suc 3
console.log('=== ObjEfectivo suc 3 ===');
const objef = await pool.request()
  .input('p', sql.VarChar, PERIODO).input('s', sql.Int, SUC_ID)
  .query('SELECT * FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@p AND sucursal_id=@s');
console.table(objef.recordset);

// 3. Datos consumo/efectivo desde BeClever SP
console.log('=== sp_ReporteVentasCobrosObjetivos suc 3 ===');
const spV = await poolBC.request()
  .input('Anio', sql.Int, yr).input('Mes', sql.Int, mo)
  .execute('dbo.sp_ReporteVentasCobrosObjetivos');
const comercio = await poolBC.request().query('SELECT Cod_Comercio, Descripcion FROM dbo.COMERCIO');
const idByNombre = {};
for (const c of comercio.recordset) idByNombre[c.Descripcion.trim()] = c.Cod_Comercio;
const rows3 = spV.recordset.filter(r => idByNombre[r.Sucursal?.trim()] === SUC_ID);
console.table(rows3.map(r => ({
  Producto: r.Producto?.trim(),
  Sucursal: r.Sucursal?.trim(),
  Ventas: r.Ventas,
  CredProm: r.CredProm,
  Operaciones: r.Operaciones,
  'VTA/VTATOT': r['VTA/VTATOT']
})));

// 4. Ranking suc 3 + multiplicador de categoría
console.log('=== Ranking suc 3 ===');
const rk = await pool.request()
  .input('p', sql.VarChar, PERIODO).input('s', sql.Int, SUC_ID)
  .query('SELECT sucursal_id, periodo, categoria FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@p AND sucursal_id=@s');
console.table(rk.recordset);

console.log('=== RankingMultiplicador ===');
const mult = await pool.request()
  .query('SELECT categoria, multiplicador FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador ORDER BY categoria');
console.table(mult.recordset);

// 5. Sucursal 3 — con_efectivo
console.log('=== Sucursal 3 config ===');
const suc = await pool.request().input('s', sql.Int, SUC_ID)
  .query('SELECT id, nombre, con_efectivo FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id=@s');
console.table(suc.recordset);

// 6. Montos OPER_CON_EFECT y OPER_SIN_EFECT (todas las filas)
console.log('=== Montos OPER_CON/SIN_EFECT ===');
const m = await pool.request()
  .query("SELECT seccion, escalon, categoria_suc, participacion, escalon_monto, ticket_promedio, operacion, total FROM dbo.tbl_CoVenAppINDO_Montos WHERE seccion IN ('OPER_CON_EFECT','OPER_SIN_EFECT') ORDER BY seccion, escalon, categoria_suc");
console.table(m.recordset);

// 7. MontosPrestamos tipo='suc'
console.log('=== MontosPrestamos tipo=suc ===');
const p2 = await pool.request()
  .query("SELECT tipo, escalon, categoria_suc, monto FROM dbo.tbl_CoVenAppINDO_MontosPrestamos WHERE tipo='suc' ORDER BY escalon, categoria_suc");
console.table(p2.recordset);

// 8. Calculo manual
console.log('\n=== CALCULO MANUAL suc 3 ===');
const objRow = obj.recordset[0];
const conRow  = rows3.find(r => r.Producto?.trim() === 'CONSUMO');
const efRow   = rows3.find(r => r.Producto?.trim() === 'EFECTIVO');
if (objRow && conRow) {
  const G = (objRow.primer_escalon > 0) ? (conRow.Ventas - objRow.primer_escalon) / objRow.primer_escalon : -1;
  const O = (objRow.credito_promedio > 0) ? ((conRow.CredProm ?? 0) - objRow.credito_promedio) / objRow.credito_promedio : -1;
  const R = (objRow.operaciones > 0) ? ((conRow.Operaciones ?? 0) - objRow.operaciones) / objRow.operaciones : -1;

  // getEscalon
  function getEscalon(ratio) {
    if (ratio >= 1.10 * 1.15) return 3;
    if (ratio >= 1.10)         return 2;
    if (ratio >= 1.00)         return 1;
    return 0;
  }
  const conEscalon = getEscalon(conRow.Ventas / objRow.primer_escalon);
  const objefRow = objef.recordset[0];
  const efEscalon = (objefRow && efRow) ? getEscalon((efRow.Ventas ?? 0) / objefRow.primer_escalon) : 0;

  console.log(`G=${G.toFixed(4)}, O=${O.toFixed(4)}, R=${R.toFixed(4)}`);
  console.log(`ratio_consumo=${(conRow.Ventas/objRow.primer_escalon).toFixed(4)}, escalon_consumo=${conEscalon}`);
  console.log(`escalon_efectivo=${efEscalon}`);
  console.log(`G > -0.04: ${G > -0.04}, O > -0.04: ${O > -0.04}, R > -0.04: ${R > -0.04}`);
}

await pool.close();
await poolBC.close();
