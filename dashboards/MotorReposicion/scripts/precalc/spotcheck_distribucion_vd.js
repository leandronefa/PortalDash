// scripts/precalc/spotcheck_distribucion_vd.js
//
// Complemento de scripts/precalc/medir_distribucion_vd_huecos.js (Hallazgo 2 de la revision
// final, 2026-08-18): para los combos con el cambio de Vd mas grande (identificados por ese
// script), muestra las ultimas fotos reales de FotoStock y ventas reales de Vta_detalle -- mismo
// patron que scripts/precalc/spotcheck_combos_con_quiebre.js (Task 6) -- para juzgar a mano si el
// cambio de velocidad tiene sentido de negocio (quiebre real prolongado) o es sospechoso (ej. un
// articulo estacional que "revivio" y el relleno de huecos esta leyendo la temporada baja como un
// quiebre largo, inflando su velocidad de forma desproporcionada).
//
// Solo lectura -- no modifica ninguna tabla.
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

// Combos a inspeccionar -- completar con los resultados de medir_distribucion_vd_huecos.js
// (R3 top por cambio absoluto, R4 top por cambio porcentual). Cada entrada puede incluir una
// etiqueta libre para anotar de donde salio (abs/pct/manual).
const COMBOS = [
  { suc: '000028', art: '1412-1340', color: 'SURTIDO', talle: 'U', etiqueta: 'top #1 cambio ABSOLUTO' },
  { suc: '000010', art: '9110-7174', color: 'NEGRO', talle: 'U', etiqueta: 'top #2 cambio ABSOLUTO' },
  { suc: '000035', art: '60T2-1340', color: 'SURTIDO', talle: '2', etiqueta: 'top #3 cambio ABSOLUTO' },
  { suc: '000009', art: 'JP9771-1074', color: 'CORE BLACK-CLOUD WHITE-OFF WHITE', talle: '5', etiqueta: 'top #1 cambio PORCENTUAL' },
  { suc: '000010', art: 'ID8797-1074', color: 'CLOUD WHITE-CORE BLACK-GREY ONE', talle: '5', etiqueta: 'top #4 cambio PORCENTUAL' },
];

async function main() {
  if (COMBOS.length === 0) {
    console.error('COMBOS esta vacio -- completar con los combos a inspeccionar antes de correr.');
    process.exit(1);
  }
  const pool = await sql.connect(dbConfig);
  for (const c of COMBOS) {
    console.log('\n===', c.etiqueta || '', '|', c.art, c.color, c.talle, c.suc, '===');
    const fotos = await pool.request()
      .input('suc', sql.VarChar(20), c.suc).input('art', sql.VarChar(50), c.art)
      .input('color', sql.VarChar(100), c.color).input('talle', sql.VarChar(20), c.talle)
      .query(`SELECT TOP 15 fecha, stock FROM FotoStock WHERE Sucursal=@suc AND artprove=@art AND color=@color AND talle=@talle ORDER BY fecha DESC`);
    console.log('  Ultimas fotos reales (FotoStock, desc):', fotos.recordset.map(f => f.fecha.toISOString().slice(0,10) + ':' + f.stock));

    // Primera foto real ANTERIOR a la mas reciente, para ver el tamano del hueco previo (si hay)
    const primeraFoto = await pool.request()
      .input('suc', sql.VarChar(20), c.suc).input('art', sql.VarChar(50), c.art)
      .input('color', sql.VarChar(100), c.color).input('talle', sql.VarChar(20), c.talle)
      .query(`SELECT MIN(fecha) AS Primera, MAX(fecha) AS Ultima, COUNT(*) AS TotalFotos FROM FotoStock WHERE Sucursal=@suc AND artprove=@art AND color=@color AND talle=@talle`);
    console.log('  Rango completo de FotoStock para este combo:', primeraFoto.recordset[0]);

    const ventas = await pool.request()
      .input('suc', sql.VarChar(20), c.suc).input('art', sql.VarChar(50), c.art)
      .input('color', sql.VarChar(100), c.color).input('talle', sql.VarChar(20), c.talle)
      .query(`SELECT TOP 15 FECHA, CANTIDAD FROM Vta_detalle WHERE ESTAB=@suc AND ARTCEGID=@art AND COLOR=@color AND TALLE=@talle ORDER BY FECHA DESC`);
    console.log('  Ultimas ventas reales (Vta_detalle, desc):', ventas.recordset.map(v => v.FECHA.toISOString().slice(0,10) + ':' + v.CANTIDAD));

    // Ventas por año calendario (para detectar estacionalidad: si la venta se concentra siempre
    // en el mismo tramo del año en varios años, es una señal de estacionalidad real, no de quiebre)
    const ventasPorMes = await pool.request()
      .input('suc', sql.VarChar(20), c.suc).input('art', sql.VarChar(50), c.art)
      .input('color', sql.VarChar(100), c.color).input('talle', sql.VarChar(20), c.talle)
      .query(`SELECT YEAR(FECHA) AS Anio, MONTH(FECHA) AS Mes, SUM(CASE WHEN ISNUMERIC(CANTIDAD)=1 THEN CAST(CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS Unidades, COUNT(DISTINCT FECHA) AS DiasConVenta
              FROM Vta_detalle WHERE ESTAB=@suc AND ARTCEGID=@art AND COLOR=@color AND TALLE=@talle
              GROUP BY YEAR(FECHA), MONTH(FECHA) ORDER BY Anio, Mes`);
    console.log('  Ventas por mes (todo el historial disponible):');
    ventasPorMes.recordset.forEach(r => console.log(`    ${r.Anio}-${String(r.Mes).padStart(2,'0')}: ${r.Unidades} uds, ${r.DiasConVenta} dias con venta`));
  }
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
