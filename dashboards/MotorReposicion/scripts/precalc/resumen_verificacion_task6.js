// scripts/precalc/resumen_verificacion_task6.js
// Resumen consolidado de la verificacion de Task 6: junta los resultados de
// verificar_impacto.js (DB) y verificar_indicador_api.js (API real) en un
// solo reporte ANTES vs DESPUES, contra los numeros de referencia del problema
// original documentado en el plan.
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

const ANTES = {
  totalFilasStockSemanal: 8001970,
  filasEnCero: 0,
  filasConQuiebreContribucion: 6981,
  articulosQuiebreConDias: 228,
  articulosQuiebreTotal: 56135,
};

async function main() {
  const pool = await sql.connect(dbConfig);

  const r1 = await pool.request().query(`
    SELECT COUNT(*) AS Total, SUM(CASE WHEN StockSemana=0 THEN 1 ELSE 0 END) AS FilasEnCero
    FROM dbo.MotorReposicion_StockSemanal
  `);
  const r2 = await pool.request().query(`
    SELECT COUNT(*) AS FilasConQuiebreContribucion
    FROM dbo.MotorReposicion_DiasConStockPorSemana
    WHERE DiasQuiebreContribucion > 0
  `);
  await pool.close();

  let apiLine = 'API no disponible';
  try {
    const res = await fetch('http://localhost:3050/api/tablero/quiebre');
    if (res.ok) {
      const d = await res.json();
      const cols = d.detalleColumnas;
      const idx = k => cols.indexOf(k);
      const rows = d.detalle.filter(r => r[idx('estado')] === 'QUIEBRE');
      const conDias = rows.filter(r => (r[idx('diasQuiebrePeriodo')] || 0) > 0);
      const pctAntes = (ANTES.articulosQuiebreConDias / ANTES.articulosQuiebreTotal * 100).toFixed(1);
      const pctDespues = (conDias.length / rows.length * 100).toFixed(1);
      apiLine =
        `  Articulos QUIEBRE con dias>0/total  ANTES: ${ANTES.articulosQuiebreConDias}/${ANTES.articulosQuiebreTotal} (${pctAntes}%)\n` +
        `                                     DESPUES: ${conDias.length}/${rows.length} (${pctDespues}%)`;
    }
  } catch (e) {
    apiLine = 'API no disponible: ' + e.message;
  }

  console.log('=== Resumen de verificacion Task 6 ===');
  console.log('1) MotorReposicion_StockSemanal (filas con StockSemana=0):');
  console.log(`  ANTES:   Total=${ANTES.totalFilasStockSemanal.toLocaleString('es-AR')}  FilasEnCero=${ANTES.filasEnCero.toLocaleString('es-AR')}`);
  console.log(`  DESPUES: Total=${r1.recordset[0].Total.toLocaleString('es-AR')}  FilasEnCero=${r1.recordset[0].FilasEnCero.toLocaleString('es-AR')}`);
  console.log('2) MotorReposicion_DiasConStockPorSemana (filas con DiasQuiebreContribucion>0):');
  console.log(`  ANTES:   ${ANTES.filasConQuiebreContribucion.toLocaleString('es-AR')}`);
  console.log(`  DESPUES: ${r2.recordset[0].FilasConQuiebreContribucion.toLocaleString('es-AR')}`);
  console.log('3) Indicador principal via API (/api/tablero/quiebre), % de articulos QUIEBRE con diasQuiebrePeriodo>0:');
  console.log(apiLine);
}
main().catch(e => { console.error(e); process.exit(1); });
