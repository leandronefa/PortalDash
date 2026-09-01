// scripts/precalc/probar_relleno_huecos.js
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 120000, requestTimeout: 120000,
};

async function main() {
  const pool = await sql.connect(dbConfig);
  const r = await pool.request().query(`
    ;WITH E1(N) AS (
      SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
      UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
    ),
    Nums(N) AS (
      SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1
      FROM E1 a CROSS JOIN E1 b   -- 8x8 = 64 numeros: 0..63 (suficiente para 12 meses ~53 semanas)
    ),
    RangoPorCombo AS (
      SELECT Sucursal, CodArticulo, COLOR, TALLE,
             MIN(FechaSemana) AS Primera, MAX(FechaSemana) AS Ultima
      FROM dbo.MotorReposicion_StockSemanal
      GROUP BY Sucursal, CodArticulo, COLOR, TALLE
    ),
    SemanasEsperadas AS (
      SELECT r.Sucursal, r.CodArticulo, r.COLOR, r.TALLE,
             DATEADD(DAY, n.N * 7, r.Primera) AS FechaSemana
      FROM RangoPorCombo r
      CROSS JOIN Nums n
      WHERE DATEADD(DAY, n.N * 7, r.Primera) <= r.Ultima
    ),
    Huecos AS (
      SELECT se.Sucursal, se.CodArticulo, se.COLOR, se.TALLE, se.FechaSemana
      FROM SemanasEsperadas se
      LEFT JOIN dbo.MotorReposicion_StockSemanal real2
        ON real2.Sucursal = se.Sucursal AND real2.CodArticulo = se.CodArticulo
       AND real2.COLOR = se.COLOR AND real2.TALLE = se.TALLE AND real2.FechaSemana = se.FechaSemana
      WHERE real2.FechaSemana IS NULL
    )
    SELECT COUNT(DISTINCT Sucursal+'|'+CodArticulo+'|'+COLOR+'|'+TALLE) AS CombosConHueco,
           COUNT(*) AS TotalSemanasFaltantes
    FROM Huecos
  `);
  console.log('Resultado de la prueba aislada:', r.recordset[0]);
  console.log('Esperado (segun la spec, medido el 2026-08-18): CombosConHueco ~50.880, TotalSemanasFaltantes ~526.541');
  console.log('(pueden no ser EXACTAMENTE iguales -- pasaron dias y la ventana de 12 meses se movio -- pero deben ser del mismo orden de magnitud)');
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
