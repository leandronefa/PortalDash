// scripts/precalc/verificar_dias_stock_manual.js
//
// Verificacion INDEPENDIENTE (de solo lectura, sin pasar por la API/cache) de que el combo de
// referencia 1023016-23007 / NEGRO / U / sucursal 000002 realmente no tiene ningun hueco dentro
// del periodo por defecto de la API (ultimos 90 dias) -- confirmando por otro camino lo que ya
// muestra verificar_sin_regresion.js.
//
// Hace dos cosas, ambas leyendo directo de la base real:
//   1) Confirma en dbo.MotorReposicion_StockSemanal que las semanas de este combo son
//      consecutivas (7 dias exactos entre cada una) y con StockSemana >= 1 siempre -- es decir,
//      que la tabla base NO tiene ninguna fila de hueco (StockSemana=0) para este combo. Esto es
//      la prueba directa de que la Task 3 (relleno de huecos) no tuvo nada que rellenar aca.
//   2) Recalcula A MANO (replicando la formula de la Etapa 3 del SP -- ver sql/
//      MotorReposicion_sp_PreCalcularStockSemanal.sql lineas ~179-221 -- pero como un SELECT
//      independiente, no leyendo la tabla ya precalculada) cuanto DiasConStockContribucion y
//      DiasQuiebreContribucion le tocarian a este combo en el periodo [fechaDesde,fechaHasta] que
//      usa por defecto GET /api/tablero/articulo (ultimos 90 dias: hoy-89 a hoy). Si el combo no
//      tiene huecos, la formula da 7 dias por semana para cada semana real que cae en el periodo,
//      0 de quiebre, sumando ~90 (cobertura completa).
//   3) Como chequeo cruzado, lee tambien la tabla YA precalculada
//      dbo.MotorReposicion_DiasConStockPorSemana para el mismo combo/periodo y confirma que
//      coincide con el calculo manual -- si coincidieran pero el manual estuviera mal, seria una
//      coincidencia; que ambos caminos (formula recalculada a mano vs. tabla ya guardada) den el
//      mismo numero, y que ese numero sea ~90 sin quiebre, es la prueba independiente pedida.
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

const SUCURSAL = '000002';
const COD_ARTICULO = '1023016-23007';
const COLOR = 'NEGRO';
const TALLE = 'U';

async function main() {
  const pool = await sql.connect(dbConfig);

  // Mismo default que server.js (GET /api/tablero/articulo): hoy y hoy-89 (calendario, sin hora).
  const rPeriodo = await pool.request().query(`
    SELECT CAST(GETDATE() AS DATE) AS FechaHasta, DATEADD(DAY, -89, CAST(GETDATE() AS DATE)) AS FechaDesde
  `);
  const { FechaHasta, FechaDesde } = rPeriodo.recordset[0];
  console.log('Periodo por defecto de la API (ultimos 90 dias):', FechaDesde.toISOString().slice(0, 10), 'a', FechaHasta.toISOString().slice(0, 10));

  // --- 1) Confirmar que la tabla BASE (StockSemanal) no tiene ningun hueco para este combo ---
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
  console.log('\n--- 1) dbo.MotorReposicion_StockSemanal (tabla base, no tocada por el join de la API) ---');
  console.log('Total de semanas reales:', base.TotalSemanas);
  console.log('Stock minimo de todas las semanas:', base.StockMinimo);
  console.log('Semanas con StockSemana <= 0 (huecos rellenados):', base.SemanasEnCeroOMenos, '(esperado: 0)');
  console.log('Semanas cuyo salto desde la anterior NO es de 7 dias exactos:', base.SaltosDistintosDe7Dias, '(esperado: 0 -- cero huecos de calendario)');
  console.log('Rango real:', base.PrimeraSemana.toISOString().slice(0, 10), 'a', base.UltimaSemana.toISOString().slice(0, 10));

  // --- 2) Recalculo A MANO de DiasConStockContribucion/DiasQuiebreContribucion (formula de la ---
  // --- Etapa 3 del SP), como SELECT independiente contra StockSemanal, restringido al periodo ---
  const req2 = pool.request();
  req2.input('suc', sql.VarChar(20), SUCURSAL);
  req2.input('art', sql.VarChar(50), COD_ARTICULO);
  req2.input('color', sql.VarChar(100), COLOR);
  req2.input('talle', sql.VarChar(20), TALLE);
  req2.input('fechaDesde', sql.Date, FechaDesde);
  req2.input('fechaHasta', sql.Date, FechaHasta);
  const rManual = await req2.query(`
    ;WITH PrimeraAceptacionH AS (
      SELECT destino AS Sucursal, arprove AS CodArticulo, color AS COLOR, talle AS TALLE, MIN(fecha) AS PrimeraAceptacion
      FROM dis_transf_recibidas
      WHERE destino=@suc AND arprove=@art AND color=@color AND talle=@talle
      GROUP BY destino, arprove, color, talle
    ),
    NumeradoH AS (
      SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana,
             ROW_NUMBER() OVER (ORDER BY FechaSemana) AS rn
      FROM dbo.MotorReposicion_StockSemanal
      WHERE Sucursal=@suc AND CodArticulo=@art AND COLOR=@color AND TALLE=@talle
    ),
    ConAnteriorH AS (
      SELECT n.Sucursal, n.CodArticulo, n.COLOR, n.TALLE, n.FechaSemana, n.StockSemana,
             ant.FechaSemana AS FechaAnterior, ant.StockSemana AS StockAnterior
      FROM NumeradoH n
      LEFT JOIN NumeradoH ant ON ant.rn = n.rn - 1
    ),
    CorreccionH AS (
      SELECT vd.ESTAB AS Sucursal, vd.ARTCEGID AS CodArticulo, vd.COLOR, vd.TALLE, ss.FechaSemana,
             COUNT(DISTINCT vd.FECHA) AS DiasVentaEnSemanaSinStock
      FROM Vta_detalle vd
      INNER JOIN dbo.MotorReposicion_StockSemanal ss
          ON ss.Sucursal=vd.ESTAB AND ss.CodArticulo=vd.ARTCEGID AND ss.COLOR=vd.COLOR AND ss.TALLE=vd.TALLE
         AND vd.FECHA <= ss.FechaSemana AND vd.FECHA > DATEADD(DAY,-7,ss.FechaSemana) AND ss.StockSemana <= 0
      WHERE vd.ESTAB=@suc AND vd.ARTCEGID=@art AND vd.COLOR=@color AND vd.TALLE=@talle
      GROUP BY vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE, ss.FechaSemana
    ),
    ContribucionManual AS (
      SELECT ca.FechaSemana,
             (CASE
                WHEN ca.FechaAnterior IS NOT NULL AND ca.StockAnterior > 0 AND ca.StockSemana > 0
                     AND (pa.PrimeraAceptacion IS NULL OR ca.FechaAnterior >= pa.PrimeraAceptacion)
                  THEN DATEDIFF(DAY, ca.FechaAnterior, ca.FechaSemana)
                WHEN ca.StockSemana > 0 AND (pa.PrimeraAceptacion IS NULL OR ca.FechaSemana >= pa.PrimeraAceptacion)
                  THEN 7
                ELSE 0
              END) + ISNULL(c.DiasVentaEnSemanaSinStock,0) AS DiasConStockContribucionManual,
             CASE
               WHEN ca.StockSemana <= 0 AND (pa.PrimeraAceptacion IS NULL OR ca.FechaSemana >= pa.PrimeraAceptacion)
                 THEN CASE WHEN 7 - ISNULL(c.DiasVentaEnSemanaSinStock,0) < 0 THEN 0 ELSE 7 - ISNULL(c.DiasVentaEnSemanaSinStock,0) END
               ELSE 0
             END AS DiasQuiebreContribucionManual
      FROM ConAnteriorH ca
      LEFT JOIN PrimeraAceptacionH pa ON pa.Sucursal=ca.Sucursal AND pa.CodArticulo=ca.CodArticulo AND pa.COLOR=ca.COLOR AND pa.TALLE=ca.TALLE
      LEFT JOIN CorreccionH c ON c.Sucursal=ca.Sucursal AND c.CodArticulo=ca.CodArticulo AND c.COLOR=ca.COLOR AND c.TALLE=ca.TALLE AND c.FechaSemana=ca.FechaSemana
    )
    SELECT
      COUNT(*) AS SemanasEnPeriodo,
      SUM(DiasConStockContribucionManual) AS DiasConStockEstimadoManual,
      SUM(DiasQuiebreContribucionManual) AS DiasQuiebreEstimadoManual
    FROM ContribucionManual
    WHERE FechaSemana >= @fechaDesde AND FechaSemana <= @fechaHasta
  `);
  const manual = rManual.recordset[0];
  console.log('\n--- 2) Recalculo manual de la formula de Etapa 3, aplicado solo a este combo ---');
  console.log('(SELECT independiente contra StockSemanal -- NO lee la tabla ya precalculada)');
  console.log('Semanas reales dentro del periodo de 90 dias:', manual.SemanasEnPeriodo);
  console.log('DiasConStockEstimado (calculado a mano):', manual.DiasConStockEstimadoManual);
  console.log('DiasQuiebreEstimado (calculado a mano):', manual.DiasQuiebreEstimadoManual, '(esperado: 0)');

  // --- 3) Chequeo cruzado contra la tabla YA precalculada por el SP (Etapa 3/4) ---
  const req3 = pool.request();
  req3.input('suc', sql.VarChar(20), SUCURSAL);
  req3.input('art', sql.VarChar(50), COD_ARTICULO);
  req3.input('color', sql.VarChar(100), COLOR);
  req3.input('talle', sql.VarChar(20), TALLE);
  req3.input('fechaDesde', sql.Date, FechaDesde);
  req3.input('fechaHasta', sql.Date, FechaHasta);
  const rTabla = await req3.query(`
    SELECT
      SUM(DiasConStockContribucion) AS DiasConStockEstimadoTabla,
      SUM(DiasQuiebreContribucion) AS DiasQuiebreEstimadoTabla
    FROM dbo.MotorReposicion_DiasConStockPorSemana
    WHERE Sucursal=@suc AND CodArticulo=@art AND COLOR=@color AND TALLE=@talle
      AND FechaSemana >= @fechaDesde AND FechaSemana <= @fechaHasta
  `);
  const tabla = rTabla.recordset[0];
  console.log('\n--- 3) Chequeo cruzado contra dbo.MotorReposicion_DiasConStockPorSemana (ya precalculada) ---');
  console.log('DiasConStockEstimado (tabla precalculada):', tabla.DiasConStockEstimadoTabla);
  console.log('DiasQuiebreEstimado (tabla precalculada):', tabla.DiasQuiebreEstimadoTabla);

  const coincide = Number(manual.DiasConStockEstimadoManual) === Number(tabla.DiasConStockEstimadoTabla)
    && Number(manual.DiasQuiebreEstimadoManual) === Number(tabla.DiasQuiebreEstimadoTabla);
  console.log('\nManual vs. tabla precalculada coinciden exactamente:', coincide);

  const diasPeriodo = Math.round((FechaHasta - FechaDesde) / 86400000) + 1;
  console.log('\nDias totales del periodo [FechaDesde,FechaHasta] (inclusive):', diasPeriodo);
  console.log('DiasConStockEstimado obtenido / dias totales del periodo:', manual.DiasConStockEstimadoManual, '/', diasPeriodo,
    '=', (Number(manual.DiasConStockEstimadoManual) / diasPeriodo * 100).toFixed(1) + '%');
  console.log('(si es 0 huecos, se espera ~100% de cobertura -- cerca de', diasPeriodo, 'dias con stock y 0 de quiebre)');

  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
