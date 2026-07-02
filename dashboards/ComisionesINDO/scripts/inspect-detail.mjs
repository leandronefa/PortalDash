// inspect-detail.mjs — inspección profunda de hojas clave
import ExcelJS from 'exceljs';

const wb1 = new ExcelJS.Workbook();
await wb1.xlsx.readFile('comisiones 03-2026.xlsx');

function cellVal(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'object' && v.result != null) return v.result;
  if (typeof v === 'object' && v.text) return v.text;
  if (v instanceof Date) return v.toISOString().substring(0,10);
  return v;
}

// ── TOTAL sheet: primeras 5 filas con índices de columna
console.log('\n=== TOTAL — columnas con índice ===');
const wsTotal = wb1.getWorksheet('TOTAL');
[2,3,4,5].forEach(rn => {
  const row = wsTotal.getRow(rn);
  const out = [];
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    out.push(`[${col}]${String(cellVal(cell)).substring(0,20)}`);
  });
  console.log(`Fila ${rn}:`, out.join(' | '));
});

// Total: cuántas filas de datos válidas (col 1 = número)
let totalRows = 0;
wsTotal.eachRow((row, rn) => {
  if (rn < 3) return;
  const v = cellVal(row.getCell(1));
  if (!isNaN(v) && v !== '') totalRows++;
});
console.log('Filas de datos en TOTAL:', totalRows);

// ── DATO REPORTE: encontrar fila de encabezado y estructura
console.log('\n=== DATO Reporte — búsqueda de encabezado ===');
const wsRep = wb1.getWorksheet('DATO Reporte');
for (let rn = 1; rn <= 15; rn++) {
  const row = wsRep.getRow(rn);
  const vals = [];
  row.eachCell({ includeEmpty: true }, (c, col) => {
    if (col <= 15) vals.push(`[${col}]${String(cellVal(c)).substring(0,20)}`);
  });
  console.log(`Fila ${rn}:`, vals.join(' | '));
}

// ── MONTOS: primeras 15 filas con índices
console.log('\n=== Montos — primeras 15 filas ===');
const wsMontos = wb1.getWorksheet('Montos');
for (let rn = 1; rn <= 15; rn++) {
  const row = wsMontos.getRow(rn);
  const vals = [];
  row.eachCell({ includeEmpty: false }, (c, col) => {
    vals.push(`[${col}]${String(cellVal(c)).substring(0,15)}`);
  });
  if (vals.length) console.log(`Fila ${rn}:`, vals.join(' | '));
}

// ── RANKING: primeras 10 filas con índices
console.log('\n=== Ranking — col indices ===');
const wsRnk = wb1.getWorksheet('Ranking');
for (let rn = 1; rn <= 5; rn++) {
  const row = wsRnk.getRow(rn);
  const vals = [];
  row.eachCell({ includeEmpty: false }, (c, col) => {
    vals.push(`[${col}]${String(cellVal(c)).substring(0,20)}`);
  });
  if (vals.length) console.log(`Fila ${rn}:`, vals.join(' | '));
}

// ── Objetivos
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.readFile('Objetivos MARZO 2026 - BI.xlsx');
console.log('\n=== BI CONSUMO ===');
const wsCon = wb2.getWorksheet('BI CONSUMO');
for (let rn = 1; rn <= 6; rn++) {
  const row = wsCon.getRow(rn);
  const vals = [];
  row.eachCell({ includeEmpty: false }, (c, col) => vals.push(`[${col}]${String(cellVal(c)).substring(0,20)}`));
  if (vals.length) console.log(`Fila ${rn}:`, vals.join(' | '));
}
console.log('\n=== BI EFECTIVO ===');
const wsEfe = wb2.getWorksheet('BI EFECTIVO');
for (let rn = 1; rn <= 6; rn++) {
  const row = wsEfe.getRow(rn);
  const vals = [];
  row.eachCell({ includeEmpty: false }, (c, col) => vals.push(`[${col}]${String(cellVal(c)).substring(0,20)}`));
  if (vals.length) console.log(`Fila ${rn}:`, vals.join(' | '));
}
