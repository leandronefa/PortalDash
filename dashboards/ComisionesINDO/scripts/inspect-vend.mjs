// inspect-vend.mjs
import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('comisiones 03-2026.xlsx');

function cv(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'object' && v.result != null) return v.result;
  if (v instanceof Date) return v.toISOString().substring(0,10);
  return v;
}

const ws = wb.getWorksheet('Montos');

// Rows 23-28 (Vendedores cat C) and 67-72 (cat B) and 109-115 (cat A)
const ranges = [[23,28],[67,75],[109,118],[40,45],[82,87],[124,130]];
for (const [s, e] of ranges) {
  console.log(`\n--- Filas ${s}-${e} ---`);
  for (let rn = s; rn <= e; rn++) {
    const row = ws.getRow(rn);
    const vals = [];
    row.eachCell({ includeEmpty: false }, (c, col) => {
      if (col <= 15) vals.push(`[${col}]${String(cv(c)).substring(0,20)}`);
    });
    if (vals.length) console.log(`Fila ${rn}:`, vals.join(' | '));
  }
}
