// scripts/precalc/medir_distribucion_vd_huecos.js
//
// Hallazgo 2 de la revision final (2026-08-18): el fix de relleno de huecos (Task 3) baja
// DiasConStockEstimado (denominador de Vd) para las ~50.880 combinaciones que tenian huecos
// reales -- eso sube su Vd, que es lo que determina cuanto se sugiere comprar. Se habian
// validado los dos extremos (un combo sin huecos, sin cambio; combos con quiebre real, con
// sentido de negocio) pero nunca la DISTRIBUCION del medio.
//
// Esta consulta de SOLO LECTURA contra la base real (sin ningun INSERT/UPDATE/DELETE/ALTER):
//  1. Reconstruye la Etapa 1 VIEJA (sin relleno de huecos) on-the-fly, exactamente como estaba en
//     backups/2026-08-18-dias-con-stock-huecos/MotorReposicion_sp_PreCalcularStockSemanal_ANTES.sql,
//     leyendo directo de FotoStock (la tabla cruda, nunca tocada por el fix).
//  2. Detecta las combinaciones con al menos un hueco real, con la MISMA logica que
//     scripts/precalc/probar_relleno_huecos.js (rango Primera..Ultima + tabla de numeros +
//     LEFT JOIN), pero aplicada sobre la reconstruccion vieja (no sobre la tabla ya arreglada).
//  3. Para esas combinaciones, corre la logica EXACTA de la Etapa 3 (sin cambios entre el SP
//     viejo y el nuevo) sobre la reconstruccion vieja -> DiasConStockEstimado "ANTES".
//  4. Lee el DiasConStockEstimado "DESPUES" directo de la tabla ya precalculada en produccion
//     (dbo.MotorReposicion_DiasConStockPorSemana, que ya tiene el fix desplegado).
//  5. Calcula VentasRango (igual en ambos escenarios, no depende del fix) y compone
//     Vd = VentasRango / MAX(7, DiasConStockEstimado) -- misma formula que server.js (VdRaw) --
//     para el periodo default de 90 dias que usa el tablero principal (mismo que decide cuanto
//     se sugiere comprar hoy).
//
// Periodo: ultimos 90 dias desde HOY (mismo default que server.js, QUERY_QUIEBRE_DETALLE).
require('dotenv').config();
const sql = require('mssql');

const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 120000, requestTimeout: 1200000, // 20 min -- consulta pesada de investigacion, una sola vez
};

const QUERY = `
SET NOCOUNT ON;
DECLARE @ahora DATETIME = GETDATE();
DECLARE @fechaDesde DATE = DATEADD(MONTH, -12, CAST(@ahora AS DATE));
DECLARE @periodoDesde DATE = DATEADD(DAY, -89, CAST(@ahora AS DATE));
DECLARE @periodoHasta DATE = CAST(@ahora AS DATE);

-- 1) Reconstruccion de la Etapa 1 VIEJA (sin relleno), igual que el backup _ANTES.sql
IF OBJECT_ID('tempdb..#StockOld') IS NOT NULL DROP TABLE #StockOld;
SELECT fs.Sucursal, ISNULL(fs.artprove, '') AS CodArticulo, ISNULL(fs.color, '') AS COLOR, ISNULL(fs.talle, '') AS TALLE,
       DATEADD(DAY, (5 - DATEDIFF(DAY,0,fs.fecha)%7 + 7)%7, CAST(fs.fecha AS DATE)) AS FechaSemana,
       MAX(fs.stock) AS StockSemana
INTO #StockOld
FROM FotoStock fs
INNER JOIN Sucursales s
  ON s.Sucursal = fs.Sucursal
 AND (s.viewSuc = 'S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111'))
 AND s.Sucursal NOT IN ('000226','000235')
LEFT JOIN (
  SELECT GA_CODEARTICLE AS CodArticulo, COLOR, TALLE
  FROM cgd_ARTICULOS
  WHERE GA_CODEARTICLE IS NOT NULL AND UPPER(ISNULL(PERTARIFA, '')) LIKE '%LIQUI%'
) cl ON cl.CodArticulo = fs.artprove AND cl.COLOR = fs.color AND cl.TALLE = fs.talle
WHERE fs.fecha >= @fechaDesde AND cl.CodArticulo IS NULL
GROUP BY fs.Sucursal, ISNULL(fs.artprove,''), ISNULL(fs.color,''), ISNULL(fs.talle,''),
         DATEADD(DAY, (5 - DATEDIFF(DAY,0,fs.fecha)%7 + 7)%7, CAST(fs.fecha AS DATE));

CREATE INDEX ix_stockold ON #StockOld (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana);

-- 2) Deteccion de combos con al menos un hueco real (misma logica que probar_relleno_huecos.js),
--    materializada en #HuecosRaw (una fila por semana faltante) y #CombosConHueco (distinct).
;WITH E1(N) AS (
  SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
  UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
),
Nums(N) AS (
  SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1
  FROM E1 a CROSS JOIN E1 b
),
RangoPorCombo AS (
  SELECT Sucursal, CodArticulo, COLOR, TALLE, MIN(FechaSemana) AS Primera, MAX(FechaSemana) AS Ultima
  FROM #StockOld GROUP BY Sucursal, CodArticulo, COLOR, TALLE
),
SemanasEsperadas AS (
  SELECT r.Sucursal, r.CodArticulo, r.COLOR, r.TALLE, DATEADD(DAY, n.N*7, r.Primera) AS FechaSemana
  FROM RangoPorCombo r CROSS JOIN Nums n
  WHERE DATEADD(DAY, n.N*7, r.Primera) <= r.Ultima
)
SELECT se.Sucursal, se.CodArticulo, se.COLOR, se.TALLE, se.FechaSemana
INTO #HuecosRaw
FROM SemanasEsperadas se
LEFT JOIN #StockOld real2
  ON real2.Sucursal = se.Sucursal AND real2.CodArticulo = se.CodArticulo
 AND real2.COLOR = se.COLOR AND real2.TALLE = se.TALLE AND real2.FechaSemana = se.FechaSemana
WHERE real2.FechaSemana IS NULL;

SELECT DISTINCT Sucursal, CodArticulo, COLOR, TALLE
INTO #CombosConHueco
FROM #HuecosRaw;

CREATE INDEX ix_combos ON #CombosConHueco (Sucursal, CodArticulo, COLOR, TALLE);

-- 3) Etapa 3 VIEJA (logica sin cambios respecto a la nueva), corrida sobre #StockOld pero
--    restringida a las combinaciones con hueco (para acotar el costo -- las que NO tienen hueco
--    no cambiaron de comportamiento, no hace falta recalcularlas).
IF OBJECT_ID('tempdb..#StockOldGap') IS NOT NULL DROP TABLE #StockOldGap;
SELECT so.*
INTO #StockOldGap
FROM #StockOld so
INNER JOIN #CombosConHueco c ON c.Sucursal=so.Sucursal AND c.CodArticulo=so.CodArticulo AND c.COLOR=so.COLOR AND c.TALLE=so.TALLE;

CREATE INDEX ix_stockoldgap ON #StockOldGap (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana);

;WITH PrimeraAceptacionH AS (
    SELECT destino AS Sucursal, arprove AS CodArticulo, color AS COLOR, talle AS TALLE, MIN(fecha) AS PrimeraAceptacion
    FROM dis_transf_recibidas GROUP BY destino, arprove, color, talle
),
NumeradoH AS (
    SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana,
           ROW_NUMBER() OVER (PARTITION BY Sucursal, CodArticulo, COLOR, TALLE ORDER BY FechaSemana) AS rn
    FROM #StockOldGap
),
ConAnteriorH AS (
    SELECT n.Sucursal, n.CodArticulo, n.COLOR, n.TALLE, n.FechaSemana, n.StockSemana,
           ant.FechaSemana AS FechaAnterior, ant.StockSemana AS StockAnterior
    FROM NumeradoH n
    LEFT JOIN NumeradoH ant ON ant.Sucursal=n.Sucursal AND ant.CodArticulo=n.CodArticulo AND ant.COLOR=n.COLOR AND ant.TALLE=n.TALLE AND ant.rn = n.rn - 1
),
CorreccionH AS (
    SELECT vd.ESTAB AS Sucursal, vd.ARTCEGID AS CodArticulo, vd.COLOR, vd.TALLE, ss.FechaSemana,
           COUNT(DISTINCT vd.FECHA) AS DiasVentaEnSemanaSinStock
    FROM Vta_detalle vd
    INNER JOIN #StockOldGap ss
        ON ss.Sucursal=vd.ESTAB AND ss.CodArticulo=vd.ARTCEGID AND ss.COLOR=vd.COLOR AND ss.TALLE=vd.TALLE
       AND vd.FECHA <= ss.FechaSemana AND vd.FECHA > DATEADD(DAY,-7,ss.FechaSemana) AND ss.StockSemana <= 0
    GROUP BY vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE, ss.FechaSemana
)
SELECT ca.Sucursal, ca.CodArticulo, ca.COLOR, ca.TALLE, ca.FechaSemana,
       (CASE
          WHEN ca.FechaAnterior IS NOT NULL AND ca.StockAnterior > 0 AND ca.StockSemana > 0
               AND (pa.PrimeraAceptacion IS NULL OR ca.FechaAnterior >= pa.PrimeraAceptacion)
            THEN DATEDIFF(DAY, ca.FechaAnterior, ca.FechaSemana)
          WHEN ca.StockSemana > 0 AND (pa.PrimeraAceptacion IS NULL OR ca.FechaSemana >= pa.PrimeraAceptacion)
            THEN 7
          ELSE 0
        END) + ISNULL(c.DiasVentaEnSemanaSinStock,0) AS DiasConStockContribucion
INTO #DiasOld
FROM ConAnteriorH ca
LEFT JOIN PrimeraAceptacionH pa ON pa.Sucursal=ca.Sucursal AND pa.CodArticulo=ca.CodArticulo AND pa.COLOR=ca.COLOR AND pa.TALLE=ca.TALLE
LEFT JOIN CorreccionH c ON c.Sucursal=ca.Sucursal AND c.CodArticulo=ca.CodArticulo AND c.COLOR=ca.COLOR AND c.TALLE=ca.TALLE AND c.FechaSemana=ca.FechaSemana;

SELECT Sucursal, CodArticulo, COLOR, TALLE, SUM(DiasConStockContribucion) AS DiasConStockEstimadoOld
INTO #DiasOldAgg
FROM #DiasOld
WHERE FechaSemana >= @periodoDesde AND FechaSemana <= @periodoHasta
GROUP BY Sucursal, CodArticulo, COLOR, TALLE;

-- 4) DESPUES: directo de la tabla ya precalculada en produccion (con el fix desplegado)
SELECT dc.Sucursal, dc.CodArticulo, dc.COLOR, dc.TALLE, SUM(dc.DiasConStockContribucion) AS DiasConStockEstimadoNew
INTO #DiasNewAgg
FROM dbo.MotorReposicion_DiasConStockPorSemana dc
INNER JOIN #CombosConHueco c ON c.Sucursal=dc.Sucursal AND c.CodArticulo=dc.CodArticulo AND c.COLOR=dc.COLOR AND c.TALLE=dc.TALLE
WHERE dc.FechaSemana >= @periodoDesde AND dc.FechaSemana <= @periodoHasta
GROUP BY dc.Sucursal, dc.CodArticulo, dc.COLOR, dc.TALLE;

-- 5) Ventas del periodo (igual en ambos escenarios, no depende del fix)
SELECT vd.ESTAB AS Sucursal, vd.ARTCEGID AS CodArticulo, vd.COLOR, vd.TALLE,
       SUM(CASE WHEN ISNUMERIC(vd.CANTIDAD)=1 THEN CAST(vd.CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS VentasRango
INTO #VentasAgg
FROM Vta_detalle vd
INNER JOIN #CombosConHueco c ON c.Sucursal=vd.ESTAB AND c.CodArticulo=vd.ARTCEGID AND c.COLOR=vd.COLOR AND c.TALLE=vd.TALLE
WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @periodoDesde AND vd.FECHA <= @periodoHasta
GROUP BY vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE;

-- 6) Composicion final: Vd antes/despues, misma formula que server.js (VdRaw)
SELECT c.Sucursal, c.CodArticulo, c.COLOR, c.TALLE,
       ISNULL(v.VentasRango,0) AS VentasRango,
       ISNULL(o.DiasConStockEstimadoOld,0) AS DiasOld,
       ISNULL(n.DiasConStockEstimadoNew,0) AS DiasNew,
       CAST(ISNULL(v.VentasRango,0) AS DECIMAL(18,6)) / CASE WHEN ISNULL(o.DiasConStockEstimadoOld,0) < 7 THEN 7 ELSE o.DiasConStockEstimadoOld END AS VdOld,
       CAST(ISNULL(v.VentasRango,0) AS DECIMAL(18,6)) / CASE WHEN ISNULL(n.DiasConStockEstimadoNew,0) < 7 THEN 7 ELSE n.DiasConStockEstimadoNew END AS VdNew
INTO #Final
FROM #CombosConHueco c
LEFT JOIN #VentasAgg v ON v.Sucursal=c.Sucursal AND v.CodArticulo=c.CodArticulo AND v.COLOR=c.COLOR AND v.TALLE=c.TALLE
LEFT JOIN #DiasOldAgg o ON o.Sucursal=c.Sucursal AND o.CodArticulo=c.CodArticulo AND o.COLOR=c.COLOR AND o.TALLE=c.TALLE
LEFT JOIN #DiasNewAgg n ON n.Sucursal=c.Sucursal AND n.CodArticulo=c.CodArticulo AND n.COLOR=c.COLOR AND n.TALLE=c.TALLE;

-- ===== Recordsets de salida =====

-- R0: sanity check contra los numeros de la spec (~50.880 combos, ~526.541 semanas)
SELECT (SELECT COUNT(*) FROM #CombosConHueco) AS CombosConHueco,
       (SELECT COUNT(*) FROM #HuecosRaw) AS TotalSemanasFaltantes;

-- R1: resumen de la distribucion (solo combos con venta real en el periodo -- sin venta, Vd=0
-- en ambos escenarios y no hay "cambio" que medir)
SELECT
  COUNT(*) AS TotalCombosConHueco,
  SUM(CASE WHEN VentasRango > 0 THEN 1 ELSE 0 END) AS ConVentaEnPeriodo,
  SUM(CASE WHEN VentasRango > 0 AND VdNew >= 2*VdOld THEN 1 ELSE 0 END) AS DuplicaronOMasVd,
  SUM(CASE WHEN VentasRango > 0 AND VdNew >= 3*VdOld THEN 1 ELSE 0 END) AS TriplicaronOMasVd,
  SUM(CASE WHEN VentasRango > 0 AND VdNew > VdOld THEN 1 ELSE 0 END) AS SubieronVd,
  SUM(CASE WHEN VentasRango > 0 AND VdNew < VdOld THEN 1 ELSE 0 END) AS BajaronVd,
  SUM(CASE WHEN VentasRango > 0 AND VdNew = VdOld THEN 1 ELSE 0 END) AS SinCambio,
  MAX(CASE WHEN VentasRango > 0 THEN VdNew - VdOld END) AS CambioAbsolutoMax,
  MAX(CASE WHEN VentasRango > 0 AND VdOld > 0 THEN (VdNew - VdOld) / VdOld END) AS CambioPorcentualMax
FROM #Final;

-- R2: distribucion por bucket de razon VdNew/VdOld (solo con venta real)
SELECT Bucket, COUNT(*) AS Cantidad FROM (
  SELECT CASE
    WHEN VdOld = 0 THEN 'VdOld=0 (N/A, no debería pasar con VentasRango>0)'
    WHEN VdNew <= VdOld THEN '<=1x (sin cambio o baja)'
    WHEN VdNew < 1.5*VdOld THEN '1x-1.5x'
    WHEN VdNew < 2*VdOld THEN '1.5x-2x'
    WHEN VdNew < 3*VdOld THEN '2x-3x'
    WHEN VdNew < 5*VdOld THEN '3x-5x'
    WHEN VdNew < 10*VdOld THEN '5x-10x'
    ELSE '10x+'
  END AS Bucket
  FROM #Final WHERE VentasRango > 0
) t
GROUP BY Bucket;

-- R3: top 15 por cambio ABSOLUTO (VdNew - VdOld)
SELECT TOP 15 Sucursal, CodArticulo, COLOR, TALLE, VentasRango, DiasOld, DiasNew, VdOld, VdNew,
   (VdNew - VdOld) AS CambioAbsoluto,
   CASE WHEN VdOld > 0 THEN (VdNew-VdOld)/VdOld ELSE NULL END AS CambioPorcentual
FROM #Final
WHERE VentasRango > 0
ORDER BY CambioAbsoluto DESC;

-- R4: top 15 por cambio PORCENTUAL ((VdNew-VdOld)/VdOld)
SELECT TOP 15 Sucursal, CodArticulo, COLOR, TALLE, VentasRango, DiasOld, DiasNew, VdOld, VdNew,
   (VdNew - VdOld) AS CambioAbsoluto,
   (VdNew-VdOld)/VdOld AS CambioPorcentual
FROM #Final
WHERE VentasRango > 0 AND VdOld > 0
ORDER BY CambioPorcentual DESC;

DROP TABLE #StockOld;
DROP TABLE #HuecosRaw;
DROP TABLE #CombosConHueco;
DROP TABLE #StockOldGap;
DROP TABLE #DiasOld;
DROP TABLE #DiasOldAgg;
DROP TABLE #DiasNewAgg;
DROP TABLE #VentasAgg;
DROP TABLE #Final;
`;

async function main() {
  const inicio = Date.now();
  const pool = await sql.connect(dbConfig);
  console.log('Conectado. Corriendo consulta de investigacion (puede tardar varios minutos)...');
  const result = await pool.request().query(QUERY);
  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`Consulta terminada en ${seg}s.\n`);

  console.log('=== R0: Sanity check (comparar contra la spec: ~50.880 combos, ~526.541 semanas) ===');
  console.log(result.recordsets[0]);

  console.log('\n=== R1: Resumen de la distribucion ===');
  console.log(result.recordsets[1]);

  console.log('\n=== R2: Distribucion por bucket de razon VdNew/VdOld ===');
  console.table(result.recordsets[2]);

  console.log('\n=== R3: Top 15 por cambio ABSOLUTO de Vd ===');
  console.table(result.recordsets[3]);

  console.log('\n=== R4: Top 15 por cambio PORCENTUAL de Vd ===');
  console.table(result.recordsets[4]);

  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
