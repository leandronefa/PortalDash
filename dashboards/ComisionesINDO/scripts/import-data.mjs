// import-data.mjs — Importación completa desde los Excel
// Ejecutar: node scripts/import-data.mjs

import ExcelJS from 'exceljs';
import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: +process.env.DB_PORT || 1433,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true }
};

const PERIODO = '2026-03';

function cv(cell) {
  if (!cell || cell.value == null) return null;
  const v = cell.value;
  if (typeof v === 'object' && v.result != null) return v.result;
  if (typeof v === 'object' && v.text) return v.text;
  if (v instanceof Date) return v;
  return v;
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function int(v) { const n = parseInt(v); return isNaN(n) ? 0 : n; }
function str(v) { return v == null ? '' : String(v).trim(); }

function parseFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  // Format: dd/MM/yyyy HH:mm:ss
  const s = String(v);
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
  return null;
}

console.log('Conectando a SQL Server…');
const pool = await sql.connect(dbConfig);
console.log('Conectado.\n');

// ══════════════════════════════════════════════════════════════════
// EXCEL 1: comisiones 03-2026.xlsx
// ══════════════════════════════════════════════════════════════════
const wb1 = new ExcelJS.Workbook();
await wb1.xlsx.readFile('comisiones 03-2026.xlsx');

// ─────────────────────────────────────────────────────────────────
// 1. SUCURSALES (desde TOTAL + DATO CONSUMO)
// ─────────────────────────────────────────────────────────────────
console.log('Importando SUCURSALES…');

const wsConsumoForNames = wb1.getWorksheet('DATO CONSUMO');
const nombrePorId = {};
wsConsumoForNames.eachRow((row, rn) => {
  if (rn < 2) return;
  const id = int(cv(row.getCell(1)));
  if (!id) return;
  const nombre = str(cv(row.getCell(2))).replace(/^\d+-/, '').trim();
  if (nombre) nombrePorId[id] = nombre;
});

const wsTotal = wb1.getWorksheet('TOTAL');
let sucCount = 0;
const totalRows = [];
wsTotal.eachRow((row, rn) => {
  if (rn < 3) return;
  const id = int(cv(row.getCell(1)));
  if (!id) return;
  totalRows.push({ rn, id, row });
});

for (const { id, row } of totalRows) {
  const nombre        = nombrePorId[id] || `Sucursal ${id}`;
  const supervisor    = str(cv(row.getCell(43)));
  const provincia_code = str(cv(row.getCell(48)));
  const provincia     = str(cv(row.getCell(49)));
  const marca         = str(cv(row.getCell(50)));
  const region        = str(cv(row.getCell(51)));

  await pool.request()
    .input('id',             sql.Int,      id)
    .input('nombre',         sql.VarChar,  nombre)
    .input('supervisor',     sql.VarChar,  supervisor || null)
    .input('provincia',      sql.VarChar,  provincia || null)
    .input('provincia_code', sql.VarChar,  provincia_code || null)
    .input('marca',          sql.VarChar,  marca || null)
    .input('region',         sql.VarChar,  region || null)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_Sucursales WHERE id=@id)
        UPDATE dbo.tbl_CoVenAppINDO_Sucursales SET
          nombre=@nombre, supervisor=@supervisor, provincia=@provincia,
          provincia_code=@provincia_code, marca=@marca, region=@region, activa=1
        WHERE id=@id
      ELSE
        INSERT INTO dbo.tbl_CoVenAppINDO_Sucursales
          (id,nombre,supervisor,provincia,provincia_code,marca,region,activa)
        VALUES (@id,@nombre,@supervisor,@provincia,@provincia_code,@marca,@region,1)
    `);
  sucCount++;
}
console.log(`  ✓ ${sucCount} sucursales procesadas`);

// ─────────────────────────────────────────────────────────────────
// 2. DATOS CONSUMO
// ─────────────────────────────────────────────────────────────────
console.log('Importando DATOS CONSUMO…');

const wsDC = wb1.getWorksheet('DATO CONSUMO');
let dcCount = 0;

// Limpiar periodo antes de reimportar
await pool.request().input('p', sql.VarChar, PERIODO)
  .query('DELETE FROM dbo.tbl_CoVenAppINDO_DatosConsumo WHERE periodo=@p');

wsDC.eachRow((row, rn) => {
  if (rn < 2) return;
  const id = int(cv(row.getCell(1)));
  if (!id) return;
  return { id, row, rn };
});

const dcRows = [];
wsDC.eachRow((row, rn) => {
  if (rn < 2) return;
  const id = int(cv(row.getCell(1)));
  if (!id) return;
  dcRows.push({ id, row });
});

for (const { id, row } of dcRows) {
  await pool.request()
    .input('sucursal_id',      sql.Int,           id)
    .input('periodo',          sql.VarChar,       PERIODO)
    .input('ventas',           sql.Decimal(14,2), num(cv(row.getCell(3))))
    .input('vta_diaria',       sql.Decimal(14,2), num(cv(row.getCell(4))))
    .input('particip_vta',     sql.Decimal(8,4),  num(cv(row.getCell(5))))
    .input('vta_vta_tot',      sql.Decimal(8,4),  num(cv(row.getCell(6))))
    .input('credito_promedio', sql.Decimal(12,2), num(cv(row.getCell(7))))
    .input('operaciones',      sql.Int,           int(cv(row.getCell(8))))
    .input('pers_op',          sql.Int,           int(cv(row.getCell(9))))
    .input('particip_op',      sql.Decimal(8,4),  num(cv(row.getCell(10))))
    .input('cobranzas',        sql.Decimal(14,2), num(cv(row.getCell(11))))
    .input('cob_diaria',       sql.Decimal(14,2), num(cv(row.getCell(12))))
    .input('particip_cob',     sql.Decimal(8,4),  num(cv(row.getCell(13))))
    .input('cant_cob',         sql.Int,           int(cv(row.getCell(14))))
    .input('pers_cob',         sql.Int,           int(cv(row.getCell(15))))
    .input('obj_vtas',         sql.Decimal(14,2), num(cv(row.getCell(16))))
    .query(`
      INSERT INTO dbo.tbl_CoVenAppINDO_DatosConsumo
        (sucursal_id,periodo,ventas,vta_diaria,particip_vta,vta_vta_tot,credito_promedio,
         operaciones,pers_op,particip_op,cobranzas,cob_diaria,particip_cob,cant_cob,pers_cob,obj_vtas)
      VALUES
        (@sucursal_id,@periodo,@ventas,@vta_diaria,@particip_vta,@vta_vta_tot,@credito_promedio,
         @operaciones,@pers_op,@particip_op,@cobranzas,@cob_diaria,@particip_cob,@cant_cob,@pers_cob,@obj_vtas)
    `);
  dcCount++;
}
console.log(`  ✓ ${dcCount} filas consumo`);

// ─────────────────────────────────────────────────────────────────
// 3. DATOS EFECTIVO
// ─────────────────────────────────────────────────────────────────
console.log('Importando DATOS EFECTIVO…');

const wsDE = wb1.getWorksheet('DATO EFECTIVO');
let deCount = 0;

await pool.request().input('p', sql.VarChar, PERIODO)
  .query('DELETE FROM dbo.tbl_CoVenAppINDO_DatosEfectivo WHERE periodo=@p');

const deRows = [];
wsDE.eachRow((row, rn) => {
  if (rn < 2) return;
  const id = int(cv(row.getCell(1)));
  if (!id) return;
  deRows.push({ id, row });
});

for (const { id, row } of deRows) {
  await pool.request()
    .input('sucursal_id',      sql.Int,           id)
    .input('periodo',          sql.VarChar,       PERIODO)
    .input('ventas',           sql.Decimal(14,2), num(cv(row.getCell(3))))
    .input('vta_diaria',       sql.Decimal(14,2), num(cv(row.getCell(4))))
    .input('particip_vta',     sql.Decimal(10,6), num(cv(row.getCell(5))))
    .input('vta_vta_tot',      sql.Decimal(8,4),  num(cv(row.getCell(6))))
    .input('credito_promedio', sql.Decimal(12,2), num(cv(row.getCell(7))))
    .input('operaciones',      sql.Int,           int(cv(row.getCell(8))))
    .input('pers_op',          sql.Int,           int(cv(row.getCell(9))))
    .input('particip_op',      sql.Decimal(10,6), num(cv(row.getCell(10))))
    .input('cobranzas',        sql.Decimal(14,2), num(cv(row.getCell(11))))
    .input('cob_diaria',       sql.Decimal(14,2), num(cv(row.getCell(12))))
    .input('particip_cob',     sql.Decimal(10,6), num(cv(row.getCell(13))))
    .input('cant_cob',         sql.Int,           int(cv(row.getCell(14))))
    .input('pers_cob',         sql.Int,           int(cv(row.getCell(15))))
    .input('obj_vtas',         sql.Decimal(14,2), num(cv(row.getCell(16))))
    .query(`
      INSERT INTO dbo.tbl_CoVenAppINDO_DatosEfectivo
        (sucursal_id,periodo,ventas,vta_diaria,particip_vta,vta_vta_tot,credito_promedio,
         operaciones,pers_op,particip_op,cobranzas,cob_diaria,particip_cob,cant_cob,pers_cob,obj_vtas)
      VALUES
        (@sucursal_id,@periodo,@ventas,@vta_diaria,@particip_vta,@vta_vta_tot,@credito_promedio,
         @operaciones,@pers_op,@particip_op,@cobranzas,@cob_diaria,@particip_cob,@cant_cob,@pers_cob,@obj_vtas)
    `);
  deCount++;
}
console.log(`  ✓ ${deCount} filas efectivo`);

// ─────────────────────────────────────────────────────────────────
// 4. DATOS REPORTE (header en fila 13, datos desde fila 14)
// ─────────────────────────────────────────────────────────────────
console.log('Importando DATOS REPORTE…');

const wsRep = wb1.getWorksheet('DATO Reporte');
let repCount = 0;

await pool.request().input('p', sql.VarChar, PERIODO)
  .query('DELETE FROM dbo.tbl_CoVenAppINDO_DatosReporte WHERE periodo=@p');

const repRows = [];
wsRep.eachRow((row, rn) => {
  if (rn < 14) return;
  const idOri = int(cv(row.getCell(1)));
  if (!idOri || idOri < 1) return;
  repRows.push({ idOri, row });
});

for (const { idOri, row } of repRows) {
  const fechaRaw = cv(row.getCell(4));
  const fecha    = parseFecha(fechaRaw);
  await pool.request()
    .input('periodo',            sql.VarChar,   PERIODO)
    .input('id_originacion',     sql.Int,        idOri)
    .input('estado',             sql.VarChar,   str(cv(row.getCell(2))))
    .input('usuario_originador', sql.VarChar,   str(cv(row.getCell(3))))
    .input('fecha_alta',         sql.DateTime,  fecha)
    .input('producto',           sql.VarChar,   str(cv(row.getCell(5))))
    .input('importe_capital',    sql.Decimal(14,2), num(cv(row.getCell(6))))
    .input('cantidad_cuotas',    sql.Int,        int(cv(row.getCell(7))))
    .input('id_prestamo',        sql.Int,        int(cv(row.getCell(8))) || null)
    .input('id_sucursal',        sql.Int,        int(cv(row.getCell(9))))
    .input('sucursal',           sql.VarChar,   str(cv(row.getCell(10))))
    .input('id_plan',            sql.Int,        int(cv(row.getCell(11))) || null)
    .query(`
      INSERT INTO dbo.tbl_CoVenAppINDO_DatosReporte
        (periodo,id_originacion,estado,usuario_originador,fecha_alta,producto,
         importe_capital,cantidad_cuotas,id_prestamo,id_sucursal,sucursal,id_plan)
      VALUES
        (@periodo,@id_originacion,@estado,@usuario_originador,@fecha_alta,@producto,
         @importe_capital,@cantidad_cuotas,@id_prestamo,@id_sucursal,@sucursal,@id_plan)
    `);
  repCount++;
}
console.log(`  ✓ ${repCount} filas reporte`);

// ─────────────────────────────────────────────────────────────────
// 5. RANKING (col 1 = suc_id, col 10 = categoria)
// ─────────────────────────────────────────────────────────────────
console.log('Importando RANKING…');

const wsRnk = wb1.getWorksheet('Ranking');
let rnkCount = 0;

await pool.request().input('p', sql.VarChar, PERIODO)
  .query('DELETE FROM dbo.tbl_CoVenAppINDO_Ranking WHERE periodo=@p');

const rnkRows = [];
wsRnk.eachRow((row, rn) => {
  if (rn < 2) return;
  const id  = int(cv(row.getCell(1)));
  const cat = str(cv(row.getCell(10))).toUpperCase();
  if (!id || !['A','B','C'].includes(cat)) return;
  rnkRows.push({ id, cat });
});

for (const { id, cat } of rnkRows) {
  await pool.request()
    .input('sucursal_id',    sql.Int,     id)
    .input('categoria',      sql.Char,    cat)
    .input('override_manual',sql.Bit,     0)
    .input('periodo',        sql.VarChar, PERIODO)
    .query(`
      INSERT INTO dbo.tbl_CoVenAppINDO_Ranking (sucursal_id,categoria,override_manual,periodo)
      VALUES (@sucursal_id,@categoria,@override_manual,@periodo)
    `);
  rnkCount++;
}
console.log(`  ✓ ${rnkCount} filas ranking`);

// ─────────────────────────────────────────────────────────────────
// 6. MONTOS (actualizar cat C + insertar B y A)
// ─────────────────────────────────────────────────────────────────
console.log('Importando MONTOS…');

const montosData = [
  // cat, seccion, escalon, participacion, escalon_monto, subtotal, ticket_promedio, operacion, total
  ['C', 'OPER_CON_EFECT', 1, 10000, 7000,  17000, 1000, 2000, 20000],
  ['C', 'OPER_CON_EFECT', 2, 10000, 12000, 22000, 1000, 4000, 27000],
  ['C', 'OPER_CON_EFECT', 3, 10000, 18000, 28000, 2000, 5000, 35000],
  ['C', 'OPER_SIN_EFECT', 1, 14000, 9000,  23000, 1000, 3000, 27000],
  ['C', 'OPER_SIN_EFECT', 2, 14000, 14700, 28700, 2000, 5000, 35700],
  ['C', 'OPER_SIN_EFECT', 3, 14000, 20300, 34300, 3000, 6000, 43300],
  ['C', 'ENCARGADO',       1, 14000, 0,     9000,  0,    0,    23000],
  ['C', 'ENCARGADO',       2, 14000, 0,     18000, 0,    0,    32000],
  ['C', 'ENCARGADO',       3, 14000, 0,     27000, 0,    0,    41000],
  ['C', 'ENC_MILLON',      1, 0,     0,     0,     0,    0,    45000],
  ['C', 'ENC_MILLON',      2, 0,     0,     0,     0,    0,    68000],
  ['C', 'ENC_MILLON',      3, 0,     0,     0,     0,    0,    85000],

  ['B', 'OPER_CON_EFECT', 1, 12000, 8000,  20000, 1000, 2000, 23000],
  ['B', 'OPER_CON_EFECT', 2, 12000, 14000, 26000, 1000, 5000, 32000],
  ['B', 'OPER_CON_EFECT', 3, 12000, 21000, 33000, 2000, 6000, 41000],
  ['B', 'OPER_SIN_EFECT', 1, 16000, 10000, 26000, 1000, 3000, 30000],
  ['B', 'OPER_SIN_EFECT', 2, 16000, 17000, 33000, 2000, 6000, 41000],
  ['B', 'OPER_SIN_EFECT', 3, 16000, 23000, 39000, 3000, 7000, 49000],
  ['B', 'ENCARGADO',       1, 16000, 0,     10000, 0,    0,    26000],
  ['B', 'ENCARGADO',       2, 16000, 0,     21000, 0,    0,    37000],
  ['B', 'ENCARGADO',       3, 16000, 0,     31000, 0,    0,    47000],
  ['B', 'ENC_MILLON',      1, 0,     0,     0,     0,    0,    52000],
  ['B', 'ENC_MILLON',      2, 0,     0,     0,     0,    0,    78000],
  ['B', 'ENC_MILLON',      3, 0,     0,     0,     0,    0,    98000],

  ['A', 'OPER_CON_EFECT', 1, 13000, 9000,  22000, 1000, 3000, 26000],
  ['A', 'OPER_CON_EFECT', 2, 13000, 16000, 29000, 1000, 5000, 35000],
  ['A', 'OPER_CON_EFECT', 3, 13000, 23000, 36000, 3000, 7000, 46000],
  ['A', 'OPER_SIN_EFECT', 1, 18000, 12000, 30000, 1000, 4000, 35000],
  ['A', 'OPER_SIN_EFECT', 2, 18000, 19000, 37000, 3000, 7000, 47000],
  ['A', 'OPER_SIN_EFECT', 3, 18000, 26000, 44000, 4000, 8000, 56000],
  ['A', 'ENCARGADO',       1, 18000, 0,     12000, 0,    0,    30000],
  ['A', 'ENCARGADO',       2, 18000, 0,     23000, 0,    0,    41000],
  ['A', 'ENCARGADO',       3, 18000, 0,     35000, 0,    0,    53000],
  ['A', 'ENC_MILLON',      1, 0,     0,     0,     0,    0,    59000],
  ['A', 'ENC_MILLON',      2, 0,     0,     0,     0,    0,    88000],
  ['A', 'ENC_MILLON',      3, 0,     0,     0,     0,    0,   111000],
];

for (const [cat, seccion, escalon, participacion, escalon_monto, subtotal, ticket_promedio, operacion, total] of montosData) {
  await pool.request()
    .input('seccion',         sql.VarChar,   seccion)
    .input('escalon',         sql.Int,        escalon)
    .input('categoria_suc',   sql.Char,       cat)
    .input('participacion',   sql.Decimal(12,2), participacion)
    .input('escalon_monto',   sql.Decimal(12,2), escalon_monto)
    .input('subtotal',        sql.Decimal(12,2), subtotal)
    .input('ticket_promedio', sql.Decimal(12,2), ticket_promedio)
    .input('operacion',       sql.Decimal(12,2), operacion)
    .input('total',           sql.Decimal(12,2), total)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_Montos WHERE seccion=@seccion AND escalon=@escalon AND categoria_suc=@categoria_suc)
        UPDATE dbo.tbl_CoVenAppINDO_Montos SET
          participacion=@participacion, escalon_monto=@escalon_monto, subtotal=@subtotal,
          ticket_promedio=@ticket_promedio, operacion=@operacion, total=@total
        WHERE seccion=@seccion AND escalon=@escalon AND categoria_suc=@categoria_suc
      ELSE
        INSERT INTO dbo.tbl_CoVenAppINDO_Montos
          (seccion,escalon,participacion,escalon_monto,subtotal,ticket_promedio,operacion,total,categoria_suc)
        VALUES (@seccion,@escalon,@participacion,@escalon_monto,@subtotal,@ticket_promedio,@operacion,@total,@categoria_suc)
    `);
}
console.log(`  ✓ ${montosData.length} montos procesados`);

// ─────────────────────────────────────────────────────────────────
// 7. MONTOS VENDEDOR (FULL/PART/CAJERO x 3 escalones x 3 cats)
// ─────────────────────────────────────────────────────────────────
const montosVend = [
  // cat, escalon, tipo_vendedor, monto
  ['C', 1, 'FULL',   11000], ['C', 2, 'FULL',   15000], ['C', 3, 'FULL',   29000],
  ['C', 1, 'PART',    6000], ['C', 2, 'PART',    7000], ['C', 3, 'PART',   15000],
  ['C', 1, 'CAJERO', 15000], ['C', 2, 'CAJERO', 15000], ['C', 3, 'CAJERO', 15000],
  ['B', 1, 'FULL',   11000], ['B', 2, 'FULL',   15000], ['B', 3, 'FULL',   29000],
  ['B', 1, 'PART',    6000], ['B', 2, 'PART',    7000], ['B', 3, 'PART',   15000],
  ['B', 1, 'CAJERO', 15000], ['B', 2, 'CAJERO', 15000], ['B', 3, 'CAJERO', 15000],
  ['A', 1, 'FULL',   11000], ['A', 2, 'FULL',   15000], ['A', 3, 'FULL',   29000],
  ['A', 1, 'PART',    6000], ['A', 2, 'PART',    7000], ['A', 3, 'PART',   15000],
  ['A', 1, 'CAJERO', 15000], ['A', 2, 'CAJERO', 15000], ['A', 3, 'CAJERO', 15000],
];

for (const [cat, escalon, tipo, monto] of montosVend) {
  await pool.request()
    .input('cat',    sql.Char,        cat)
    .input('esc',    sql.Int,          escalon)
    .input('tipo',   sql.VarChar,     tipo)
    .input('monto',  sql.Decimal(12,2), monto)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosVendedor WHERE categoria_suc=@cat AND escalon=@esc AND tipo_vendedor=@tipo)
        UPDATE dbo.tbl_CoVenAppINDO_MontosVendedor SET monto=@monto
        WHERE categoria_suc=@cat AND escalon=@esc AND tipo_vendedor=@tipo
      ELSE
        INSERT INTO dbo.tbl_CoVenAppINDO_MontosVendedor (escalon,tipo_vendedor,monto,categoria_suc)
        VALUES (@esc,@tipo,@monto,@cat)
    `);
}
console.log(`  ✓ ${montosVend.length} montos vendedor procesados`);

// ─────────────────────────────────────────────────────────────────
// 8. MONTOS SUPERVISOR
// ─────────────────────────────────────────────────────────────────
const montosSup = [
  // cat, concepto, tipo, monto, factor_plaza
  ['C', 'consumo',  'por_sucursal',  8000, 0.5],
  ['C', 'efectivo', 'por_sucursal',     0, 0.5],
  ['C', 'consumo',  'por_plaza',        0, 0.5],
  ['C', 'efectivo', 'por_plaza',    23000, 0.5],
  ['B', 'consumo',  'por_sucursal',  9000, 0.5],
  ['B', 'efectivo', 'por_sucursal',     0, 0.5],
  ['B', 'consumo',  'por_plaza',        0, 0.5],
  ['B', 'efectivo', 'por_plaza',    23000, 0.5],
  ['A', 'consumo',  'por_sucursal', 10000, 0.5],
  ['A', 'efectivo', 'por_sucursal',     0, 0.5],
  ['A', 'consumo',  'por_plaza',        0, 0.5],
  ['A', 'efectivo', 'por_plaza',    23000, 0.5],
];

for (const [cat, concepto, tipo, monto, factor] of montosSup) {
  await pool.request()
    .input('cat',     sql.Char,        cat)
    .input('concepto',sql.VarChar,     concepto)
    .input('tipo',    sql.VarChar,     tipo)
    .input('monto',   sql.Decimal(12,2), monto)
    .input('factor',  sql.Decimal(4,2),  factor)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosSupervisor WHERE categoria_suc=@cat AND concepto=@concepto AND tipo=@tipo)
        UPDATE dbo.tbl_CoVenAppINDO_MontosSupervisor SET monto=@monto, factor_plaza=@factor
        WHERE categoria_suc=@cat AND concepto=@concepto AND tipo=@tipo
      ELSE
        INSERT INTO dbo.tbl_CoVenAppINDO_MontosSupervisor (concepto,monto,tipo,factor_plaza,categoria_suc)
        VALUES (@concepto,@monto,@tipo,@factor,@cat)
    `);
}
console.log(`  ✓ ${montosSup.length} montos supervisor procesados`);

// ─────────────────────────────────────────────────────────────────
// 9. MONTOS PRESTAMOS
// ─────────────────────────────────────────────────────────────────
const montosPrests = [
  ['C', 1, 'suc', 28000], ['C', 2, 'suc', 34000], ['C', 3, 'suc', 40000],
  ['C', 1, 'suc13', 0],   ['C', 2, 'suc13', 0],   ['C', 3, 'suc13', 0],
  ['B', 1, 'suc', 32000], ['B', 2, 'suc', 39000], ['B', 3, 'suc', 46000],
  ['B', 1, 'suc13', 0],   ['B', 2, 'suc13', 0],   ['B', 3, 'suc13', 0],
  ['A', 1, 'suc', 36000], ['A', 2, 'suc', 44000], ['A', 3, 'suc', 52000],
  ['A', 1, 'suc13', 0],   ['A', 2, 'suc13', 0],   ['A', 3, 'suc13', 0],
];

for (const [cat, escalon, tipo, monto] of montosPrests) {
  await pool.request()
    .input('cat',    sql.Char,        cat)
    .input('esc',    sql.Int,          escalon)
    .input('tipo',   sql.VarChar,     tipo)
    .input('monto',  sql.Decimal(12,2), monto)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosPrestamos WHERE categoria_suc=@cat AND escalon=@esc AND tipo=@tipo)
        UPDATE dbo.tbl_CoVenAppINDO_MontosPrestamos SET monto=@monto
        WHERE categoria_suc=@cat AND escalon=@esc AND tipo=@tipo
      ELSE
        INSERT INTO dbo.tbl_CoVenAppINDO_MontosPrestamos (escalon,tipo,monto,categoria_suc)
        VALUES (@esc,@tipo,@monto,@cat)
    `);
}
console.log(`  ✓ ${montosPrests.length} montos préstamos procesados`);

// ══════════════════════════════════════════════════════════════════
// EXCEL 2: Objetivos MARZO 2026 - BI.xlsx
// ══════════════════════════════════════════════════════════════════
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.readFile('Objetivos MARZO 2026 - BI.xlsx');

// ─────────────────────────────────────────────────────────────────
// 10. OBJETIVOS CONSUMO (col 1=suc, 2=part%, 3=1er esc, 4=cred, 5=ops, 6=cob, 7=dias)
// ─────────────────────────────────────────────────────────────────
console.log('Importando OBJETIVOS CONSUMO…');

const wsOC = wb2.getWorksheet('BI CONSUMO');
let ocCount = 0;

await pool.request().input('p', sql.VarChar, PERIODO)
  .query('DELETE FROM dbo.tbl_CoVenAppINDO_ObjConsumo WHERE periodo=@p');

const ocRows = [];
wsOC.eachRow((row, rn) => {
  if (rn < 3) return;
  const id = int(cv(row.getCell(1)));
  if (!id) return;
  ocRows.push({ id, row });
});

for (const { id, row } of ocRows) {
  await pool.request()
    .input('suc',   sql.Int,           id)
    .input('p',     sql.VarChar,       PERIODO)
    .input('part',  sql.Decimal(6,4),  num(cv(row.getCell(2))))
    .input('esc',   sql.Decimal(14,2), num(cv(row.getCell(3))))
    .input('cred',  sql.Decimal(12,2), num(cv(row.getCell(4))))
    .input('ops',   sql.Decimal(10,2), num(cv(row.getCell(5))))
    .input('cob',   sql.Decimal(14,2), num(cv(row.getCell(6))))
    .input('dias',  sql.Int,           int(cv(row.getCell(7))))
    .query(`
      INSERT INTO dbo.tbl_CoVenAppINDO_ObjConsumo
        (sucursal_id,periodo,participacion,primer_escalon,credito_promedio,operaciones,cobranza,dias)
      VALUES (@suc,@p,@part,@esc,@cred,@ops,@cob,@dias)
    `);
  ocCount++;
}
console.log(`  ✓ ${ocCount} objetivos consumo`);

// ─────────────────────────────────────────────────────────────────
// 11. OBJETIVOS EFECTIVO (col 2=suc, 3=1er esc, 4=cred, 5=ops, 8=dias)
// ─────────────────────────────────────────────────────────────────
console.log('Importando OBJETIVOS EFECTIVO…');

const wsOE = wb2.getWorksheet('BI EFECTIVO');
let oeCount = 0;

await pool.request().input('p', sql.VarChar, PERIODO)
  .query('DELETE FROM dbo.tbl_CoVenAppINDO_ObjEfectivo WHERE periodo=@p');

const oeRows = [];
wsOE.eachRow((row, rn) => {
  if (rn < 3) return;
  const id = int(cv(row.getCell(2))); // col 2 = sucursal (col 1 = nombre supervisor)
  if (!id) return;
  oeRows.push({ id, row });
});

for (const { id, row } of oeRows) {
  await pool.request()
    .input('suc',  sql.Int,           id)
    .input('p',    sql.VarChar,       PERIODO)
    .input('esc',  sql.Decimal(14,2), num(cv(row.getCell(3))))
    .input('cred', sql.Decimal(12,2), num(cv(row.getCell(4))))
    .input('ops',  sql.Decimal(10,2), num(cv(row.getCell(5))))
    .input('dias', sql.Int,           int(cv(row.getCell(8))))
    .query(`
      INSERT INTO dbo.tbl_CoVenAppINDO_ObjEfectivo
        (sucursal_id,periodo,primer_escalon,credito_promedio,operaciones,dias)
      VALUES (@suc,@p,@esc,@cred,@ops,@dias)
    `);
  oeCount++;
}
console.log(`  ✓ ${oeCount} objetivos efectivo`);

// ══════════════════════════════════════════════════════════════════
await pool.close();
console.log('\n✅ Importación completada.');
