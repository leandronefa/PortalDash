// Test del PUT de montos
import { getPool, sql } from '../server/config/db.js';

const pool = await getPool();

// Simular el body que envía el frontend al guardar fila C, escalón 1, OPER_CON_EFECT
const d = {
  id: 1,
  seccion: 'OPER_CON_EFECT',
  escalon: 1,
  participacion: 10000,
  escalon_monto: 7000,
  subtotal: 17000,
  ticket_promedio: 1000,
  operacion: 2000,
  total: 20000,
  categoria_suc: 'C'
};

const tipo  = 'base';
const tabla = 'dbo.tbl_CoVenAppINDO_Montos';
const NUMERIC_FIELDS = { base: ['participacion','escalon_monto','subtotal','ticket_promedio','operacion','total'] };
const KEY_FIELDS     = { base: ['seccion','escalon'] };
const numFields = NUMERIC_FIELDS[tipo];
const keyFields = KEY_FIELDS[tipo];

function roundTo1000(v) { return Math.round(v / 1000) * 1000; }

try {
  // 1. Actualizar C
  const qUpd = pool.request().input('id', sql.Int, d.id);
  const sets = [];
  for (const f of numFields) {
    if (f in d) {
      qUpd.input(f, sql.Decimal(18, 4), parseFloat(d[f]) || 0);
      sets.push(`${f} = @${f}`);
    }
  }
  console.log('SET clause:', sets.join(', '));
  await qUpd.query(`UPDATE ${tabla} SET ${sets.join(', ')} WHERE id = @id`);
  console.log('✅ UPDATE C ok');

  // 2. Cascade
  const multR = await pool.request()
    .query(`SELECT categoria, multiplicador FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador WHERE categoria IN ('A','B')`);
  const mults = {};
  multR.recordset.forEach(m => { mults[m.categoria] = parseFloat(m.multiplicador); });
  console.log('Multiplicadores:', mults);

  for (const cat of ['B', 'A']) {
    const factor = mults[cat] ?? 1;
    const qCat = pool.request().input('cat', sql.Char(1), cat);

    const whereKey = keyFields.map((kf, i) => {
      qCat.input(`kf${i}`, d[kf]);
      return `${kf} = @kf${i}`;
    }).join(' AND ');

    const catSets = [];
    for (const f of numFields) {
      if (f in d) {
        const val = roundTo1000((parseFloat(d[f]) || 0) * factor);
        qCat.input(`cf_${f}`, sql.Decimal(18, 4), val);
        catSets.push(`${f} = @cf_${f}`);
      }
    }

    console.log(`Cat ${cat} — WHERE: ${whereKey} — SET: ${catSets.join(', ')}`);
    await qCat.query(`UPDATE ${tabla} SET ${catSets.join(', ')} WHERE categoria_suc = @cat AND ${whereKey}`);
    console.log(`✅ UPDATE ${cat} ok`);
  }
} catch (err) {
  console.error('❌ Error:', err.message);
  console.error(err);
}

process.exit(0);
