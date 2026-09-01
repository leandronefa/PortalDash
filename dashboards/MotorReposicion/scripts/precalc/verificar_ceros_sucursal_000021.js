// scripts/precalc/verificar_ceros_sucursal_000021.js
//
// Hallazgo de revision sobre task-7-report.md: para el combo 1023016-23007 / NEGRO / U, la
// sucursal 000021 ("Calzados 21") tiene ventasVd=49 (venta real) pero diasStockVd=84, no 91,
// porque tiene 3 semanas reales con StockSemana=0 en MotorReposicion_StockSemanal. El reporte
// generalizo la conclusion de "sin huecos" (verificada solo para 000002) a "todas las
// sucursales", lo cual es una afirmacion falsa.
//
// Esta es una distincion IMPORTANTE que el fix de Task 3 puede confundir si no se verifica con
// cuidado, porque las filas rellenadas por el fix tambien quedan con StockSemana=0 -- no hay
// ninguna columna que marque "esta fila fue insertada por el relleno de huecos" vs. "esta fila
// siempre existio y su foto real daba stock 0". La UNICA forma de distinguirlas es volver a la
// tabla cruda FotoStock: una fila insertada por el relleno (Task 3) corresponde a una semana
// donde FotoStock NO TIENE NINGUNA fila para este combo/sucursal (por eso no habia dato real que
// agrupar); una fila que YA EXISTIA antes del fix (aunque su MAX(stock) diera 0) corresponde a
// una semana donde FotoStock SI tiene al menos una fila para este combo/sucursal.
//
// Este script hace, todo de solo lectura:
//   1) Confirma si sucursal 000021 tiene 0 huecos de calendario en su propio rango (Primera a
//      Ultima semana real) -- dato interesante pero, como se explica abajo, NO es suficiente por
//      si solo para distinguir relleno de quiebre real (ver nota).
//   2) Identifica las semanas con StockSemana<=0 para esta sucursal/combo.
//   3) Para cada una de esas semanas, busca en FotoStock (tabla cruda, nunca tocada por el SP)
//      si existe alguna fila cuya fecha cae en esa misma semana de muestreo (misma formula de
//      FechaSemana que usa la Etapa 1 del SP). Si existe: la semana ya era una fila real antes
//      del fix (relleno no tuvo nada que ver). Si no existe ninguna: fue insertada por el relleno.
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

const SUCURSAL = '000021';
const COD_ARTICULO = '1023016-23007';
const COLOR = 'NEGRO';
const TALLE = 'U';

async function main() {
  const pool = await sql.connect(dbConfig);

  // --- 1) Huecos de calendario propios de esta sucursal (Primera a Ultima semana real) ---
  const req1 = pool.request();
  req1.input('suc', sql.VarChar(20), SUCURSAL);
  req1.input('art', sql.VarChar(50), COD_ARTICULO);
  req1.input('color', sql.VarChar(100), COLOR);
  req1.input('talle', sql.VarChar(20), TALLE);
  const rBase = await req1.query(`
    ;WITH Numerado AS (
      SELECT FechaSemana, StockSemana,
             ROW_NUMBER() OVER (ORDER BY FechaSemana) AS rn
      FROM dbo.MotorReposicion_StockSemanal
      WHERE Sucursal=@suc AND CodArticulo=@art AND COLOR=@color AND TALLE=@talle
    ),
    ConAnterior AS (
      SELECT n.FechaSemana, n.StockSemana, ant.FechaSemana AS FechaAnterior,
             DATEDIFF(DAY, ant.FechaSemana, n.FechaSemana) AS DiasDesdeAnterior
      FROM Numerado n
      LEFT JOIN Numerado ant ON ant.rn = n.rn - 1
    )
    SELECT
      COUNT(*) AS TotalSemanas,
      MIN(StockSemana) AS StockMinimo,
      SUM(CASE WHEN StockSemana <= 0 THEN 1 ELSE 0 END) AS SemanasEnCeroOMenos,
      SUM(CASE WHEN FechaAnterior IS NOT NULL AND DiasDesdeAnterior <> 7 THEN 1 ELSE 0 END) AS SaltosDistintosDe7Dias,
      MIN(FechaSemana) AS PrimeraSemana,
      MAX(FechaSemana) AS UltimaSemana
    FROM ConAnterior
  `);
  const base = rBase.recordset[0];
  console.log('--- 1) Huecos de calendario propios de sucursal', SUCURSAL, '(Primera a Ultima semana real) ---');
  console.log('Total de semanas reales (post-fix, incluye posibles rellenos):', base.TotalSemanas);
  console.log('Stock minimo:', base.StockMinimo);
  console.log('Semanas con StockSemana <= 0:', base.SemanasEnCeroOMenos);
  console.log('Saltos de calendario distintos de 7 dias (post-fix):', base.SaltosDistintosDe7Dias,
    '(nota: post-fix este numero es SIEMPRE 0 para CUALQUIER combo -- el relleno de Task 3 garantiza');
  console.log('cobertura semanal completa entre Primera y Ultima. Por eso este numero NO alcanza para distinguir');
  console.log('"nunca tuvo huecos" de "tenia huecos y el fix los rellenizo" -- hay que mirar FotoStock crudo.)');
  console.log('Rango:', base.PrimeraSemana.toISOString().slice(0, 10), 'a', base.UltimaSemana.toISOString().slice(0, 10));

  // --- 2) Semanas con StockSemana<=0 para este combo/sucursal ---
  const req2 = pool.request();
  req2.input('suc', sql.VarChar(20), SUCURSAL);
  req2.input('art', sql.VarChar(50), COD_ARTICULO);
  req2.input('color', sql.VarChar(100), COLOR);
  req2.input('talle', sql.VarChar(20), TALLE);
  const rCeros = await req2.query(`
    SELECT FechaSemana, StockSemana
    FROM dbo.MotorReposicion_StockSemanal
    WHERE Sucursal=@suc AND CodArticulo=@art AND COLOR=@color AND TALLE=@talle AND StockSemana <= 0
    ORDER BY FechaSemana
  `);
  console.log('\n--- 2) Semanas con StockSemana <= 0 ---');
  rCeros.recordset.forEach(r => console.log(' ', r.FechaSemana.toISOString().slice(0, 10), 'StockSemana=', r.StockSemana));

  // --- 3) Para cada semana en cero, buscar en FotoStock (tabla cruda) si existe alguna fila ---
  //        cuya fecha cae en esa misma semana de muestreo (misma formula que la Etapa 1 del SP:
  //        FechaSemana = viernes de la semana que contiene fs.fecha).
  console.log('\n--- 3) Existencia de filas crudas en FotoStock para cada semana en cero ---');
  for (const row of rCeros.recordset) {
    const req3 = pool.request();
    req3.input('suc', sql.VarChar(20), SUCURSAL);
    req3.input('art', sql.VarChar(50), COD_ARTICULO);
    req3.input('color', sql.VarChar(100), COLOR);
    req3.input('talle', sql.VarChar(20), TALLE);
    req3.input('fechaSemana', sql.Date, row.FechaSemana);
    const rFoto = await req3.query(`
      SELECT COUNT(*) AS FilasFotoStock, MAX(fs.stock) AS StockMaximoEnFotos, MIN(fs.stock) AS StockMinimoEnFotos,
             MIN(fs.fecha) AS PrimeraFotoEnSemana, MAX(fs.fecha) AS UltimaFotoEnSemana
      FROM FotoStock fs
      WHERE fs.Sucursal=@suc AND fs.artprove=@art AND fs.color=@color AND fs.talle=@talle
        AND DATEADD(DAY, (5 - DATEDIFF(DAY,0,fs.fecha)%7 + 7)%7, CAST(fs.fecha AS DATE)) = @fechaSemana
    `);
    const f = rFoto.recordset[0];
    const esRelleno = f.FilasFotoStock === 0;
    console.log(` Semana ${row.FechaSemana.toISOString().slice(0, 10)}:`,
      'filas crudas en FotoStock=', f.FilasFotoStock,
      f.FilasFotoStock > 0 ? `(stock foto min=${f.StockMinimoEnFotos} max=${f.StockMaximoEnFotos}, fechas ${f.PrimeraFotoEnSemana.toISOString().slice(0,10)}..${f.UltimaFotoEnSemana.toISOString().slice(0,10)})` : '',
      '=>', esRelleno ? 'RELLENO (insertada por Task 3, sin dato crudo)' : 'PREEXISTENTE (ya habia fila(s) real(es) en FotoStock antes del fix)');
  }

  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
