import { getPool } from '../server/config/db.js';

const pool = await getPool();

// Montos base
const r1 = await pool.request().query(
  'SELECT seccion, categoria_suc, COUNT(*) as cnt FROM dbo.tbl_CoVenAppINDO_Montos GROUP BY seccion, categoria_suc ORDER BY seccion, categoria_suc'
);
console.log('=== tbl_CoVenAppINDO_Montos ===');
console.log(JSON.stringify(r1.recordset, null, 2));

// Otras tablas
for (const t of ['MontosVendedor','MontosSupervisor','MontosPrestamos','MontosCajero']) {
  const r = await pool.request().query(
    `SELECT categoria_suc, COUNT(*) as cnt FROM dbo.tbl_CoVenAppINDO_${t} GROUP BY categoria_suc`
  );
  console.log(`\n=== ${t} ===`, JSON.stringify(r.recordset));
}

// Multiplicadores
const r2 = await pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador');
console.log('\n=== Multiplicadores ===', JSON.stringify(r2.recordset, null, 2));

process.exit(0);
