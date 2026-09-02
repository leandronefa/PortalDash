// scripts/precalc/backfill_ventas_por_dia.js
// Uso: node scripts/precalc/backfill_ventas_por_dia.js
// Puebla MotorReposicion_VentasPorDia para los ultimos 18 meses, un mes a la vez (evita una
// transaccion gigante sobre 8.7M filas de Vta_detalle de una sola vez).
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 10 * 60 * 1000,
};

async function poblarMes(pool, desde, hasta) {
  const inicio = Date.now();
  const req = pool.request();
  req.input('desde', sql.Date, desde);
  req.input('hasta', sql.Date, hasta);
  await req.query(`
    IF OBJECT_ID('tempdb..#VentasDia') IS NOT NULL DROP TABLE #VentasDia;
    IF OBJECT_ID('tempdb..#PromoDia') IS NOT NULL DROP TABLE #PromoDia;

    -- Paso 1: cantidad vendida, SIN ningun join a promocion -- igual que #VentasRango original,
    -- que nunca toca CGD_CONDCOM_VTA_DET. Evita el fan-out del intento anterior (ver commit): si
    -- combinabamos esto con el join de promocion en una sola pasada, una linea de venta que
    -- matcheaba mas de una condicion comercial duplicaba su CANTIDAD en el SUM.
    SELECT vd.FECHA, vd.ESTAB AS Sucursal, ISNULL(vd.ARTCEGID,'') AS CodArticulo, ISNULL(vd.COLOR,'') AS COLOR, ISNULL(vd.TALLE,'') AS TALLE,
           SUM(CASE WHEN ISNUMERIC(vd.CANTIDAD)=1 THEN CAST(vd.CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS CantidadVendida
    INTO #VentasDia
    FROM Vta_detalle vd
    WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @desde AND vd.FECHA <= @hasta
    GROUP BY vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,'');

    -- Paso 2: promocion, JOIN separado -- misma estructura que #PromoRango original (INNER JOIN
    -- propio, sin mezclarse con el calculo de cantidad).
    SELECT vd.FECHA, vd.ESTAB AS Sucursal, ISNULL(vd.ARTCEGID,'') AS CodArticulo, ISNULL(vd.COLOR,'') AS COLOR, ISNULL(vd.TALLE,'') AS TALLE,
           COUNT(*) AS CantidadVentasPromo, MAX(c.NOMBRE_COND) AS NombrePromoDia, MAX(c.DESCUENTO) AS DescuentoPromoDia
    INTO #PromoDia
    FROM Vta_detalle vd
    INNER JOIN CGD_CONDCOM_VTA_DET c
      ON c.ESTAB = vd.ESTAB AND c.NUMERO = vd.NUMERO AND c.FECHA = vd.FECHA AND c.CODBARRA_prin = vd.CODBARRA_prin
      AND c.PVP_REBAJADO < c.PRECIOLLENO AND c.NOMBRE_COND NOT LIKE '%MES DE TU CUMPLEA%'
    WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @desde AND vd.FECHA <= @hasta
    GROUP BY vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,'');

    -- Paso 3: combinar (LEFT JOIN aca es seguro -- ambos lados ya vienen agregados/deduplicados
    -- por clave, un solo match posible por fila).
    DELETE FROM dbo.MotorReposicion_VentasPorDia WHERE Fecha >= @desde AND Fecha <= @hasta;
    INSERT INTO dbo.MotorReposicion_VentasPorDia (Fecha, Sucursal, CodArticulo, COLOR, TALLE, CantidadVendida, CantidadVentasPromo, NombrePromoDia, DescuentoPromoDia)
    SELECT v.FECHA, v.Sucursal, v.CodArticulo, v.COLOR, v.TALLE,
           v.CantidadVendida, ISNULL(p.CantidadVentasPromo, 0), p.NombrePromoDia, p.DescuentoPromoDia
    FROM #VentasDia v
    LEFT JOIN #PromoDia p ON p.FECHA=v.FECHA AND p.Sucursal=v.Sucursal AND p.CodArticulo=v.CodArticulo AND p.COLOR=v.COLOR AND p.TALLE=v.TALLE;

    DROP TABLE #VentasDia;
    DROP TABLE #PromoDia;
  `);
  console.log(`  ${desde.toISOString().slice(0,10)} a ${hasta.toISOString().slice(0,10)}: ${Date.now()-inicio}ms`);
}

async function main() {
  const pool = await sql.connect(dbConfig);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let cursor = new Date(hoy); cursor.setMonth(cursor.getMonth() - 18);
  while (cursor < hoy) {
    const finMes = new Date(cursor); finMes.setMonth(finMes.getMonth() + 1); finMes.setDate(finMes.getDate() - 1);
    const finReal = finMes > hoy ? hoy : finMes;
    await poblarMes(pool, new Date(cursor), finReal);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const r = await pool.request().query('SELECT COUNT(*) AS n, MIN(Fecha) AS desde, MAX(Fecha) AS hasta FROM dbo.MotorReposicion_VentasPorDia');
  console.log('Total filas:', r.recordset[0]);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
