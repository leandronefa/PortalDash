// inspect-montos.mjs — inspección completa de la hoja Montos
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('comisiones 03-2026.xlsx');

function cellVal(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'object' && v.result != null) return v.result;
  if (typeof v === 'object' && v.text) return v.text;
  if (v instanceof Date) return v.toISOString().substring(0,10);
  return v;
}

const ws = wb.getWorksheet('Montos');
console.log('=== Montos — todas las filas con datos en cols 1-8 ===');
ws.eachRow({ includeEmpty: false }, (row, rn) => {
  const c1 = String(cellVal(row.getCell(1))).trim();
  const c2 = cellVal(row.getCell(2));
  const c3 = cellVal(row.getCell(3));
  const c4 = cellVal(row.getCell(4));
  const c5 = cellVal(row.getCell(5));
  const c6 = cellVal(row.getCell(6));
  const c7 = cellVal(row.getCell(7));
  if (c1 || c2 || c3) {
    console.log(`Fila ${rn}: [1]"${c1}" [2]${c2} [3]${c3} [4]${c4} [5]${c5} [6]${c6} [7]${c7}`);
  }
});
