import xlsx from 'xlsx';
import path from 'path';

const wb = xlsx.readFile(path.resolve('comisiones 03-2026 REFINADA.xlsx'), { cellFormula: true, cellNF: true });
const ws = wb.Sheets['TOTAL'];
const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Fila 2 (índice 1) es la cabecera real
const headers = data[1];
console.log('=== Headers fila 2 ===');
headers.forEach((h, i) => { if (h) console.log(`  col ${i} (${xlsx.utils.encode_col(i)}): "${h}"`); });

// Columnas clave por nombre
const colIdx = {};
headers.forEach((h, i) => { colIdx[String(h).trim()] = i; });

const claves = ['CALCULO EFECTIVO', 'CALCULO CONSUMO', 'OPERADOR -ranking', 'RANKING', 'esc', 'op'];
console.log('\n=== Índices columnas clave ===');
for (const k of claves) console.log(`  "${k}" → col ${colIdx[k]} (${xlsx.utils.encode_col(colIdx[k])})`);

// Mostrar formulas y valores filas 3..10
const addr = (col, row) => xlsx.utils.encode_cell({ r: row - 1, c: col });
for (const k of ['CALCULO EFECTIVO', 'CALCULO CONSUMO', 'OPERADOR -ranking']) {
  const ci = colIdx[k];
  if (ci === undefined) { console.log(`\n"${k}" no encontrado`); continue; }
  console.log(`\n--- "${k}" (col ${ci} = ${xlsx.utils.encode_col(ci)}) ---`);
  for (let row = 3; row <= 12; row++) {
    const cell = ws[addr(ci, row)];
    if (cell) console.log(`  fila ${row}: valor=${cell.v}  |  formula: ${cell.f ?? '—'}`);
    else console.log(`  fila ${row}: (vacía)`);
  }
}

// También mostrar las columnas de escalon consumo/efectivo para entender el calculo
// Buscar columnas 'esc' (hay dos: una para consumo y otra para efectivo)
const escCols = headers.map((h, i) => ({ i, h })).filter(x => String(x.h).trim() === 'esc');
const opCols  = headers.map((h, i) => ({ i, h })).filter(x => String(x.h).trim() === 'op');
console.log('\n=== Columnas "esc" ===', escCols);
console.log('=== Columnas "op" ===', opCols);

for (const { i, h } of [...escCols, ...opCols]) {
  console.log(`\n--- col ${i} (${xlsx.utils.encode_col(i)}) = "${h}" ---`);
  for (let row = 3; row <= 8; row++) {
    const cell = ws[addr(i, row)];
    if (cell) console.log(`  fila ${row}: valor=${cell.v}  |  formula: ${cell.f ?? '—'}`);
  }
}

// Hoja Montos: ver estructura
const wsM = wb.Sheets['Montos'];
const montos = xlsx.utils.sheet_to_json(wsM, { header: 1, defval: '' });
console.log('\n=== Hoja Montos — primeras 30 filas ===');
montos.slice(0, 30).forEach((r, i) => { if (r.some(c => c !== '')) console.log(`fila ${i+1}:`, r); });
