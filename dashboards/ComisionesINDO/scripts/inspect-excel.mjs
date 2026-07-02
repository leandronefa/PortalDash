// inspect-excel.mjs — muestra hojas y primeras filas de cada Excel
import ExcelJS from 'exceljs';
import path from 'path';

const files = [
  'comisiones 03-2026.xlsx',
  'Objetivos MARZO 2026 - BI.xlsx'
];

for (const file of files) {
  console.log('\n' + '='.repeat(70));
  console.log('ARCHIVO:', file);
  console.log('='.repeat(70));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(file));

  for (const ws of wb.worksheets) {
    console.log(`\n  ── Hoja: "${ws.name}" (${ws.rowCount} filas, ${ws.columnCount} cols)`);
    // Primeras 4 filas
    let count = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (count >= 4) return;
      const vals = row.values.slice(1).map(v =>
        v == null ? '' :
        typeof v === 'object' && v.text ? v.text :
        typeof v === 'object' && v.result != null ? v.result :
        String(v).substring(0, 25)
      );
      console.log(`    Fila ${rowNum}:`, vals.join(' | '));
      count++;
    });
  }
}
