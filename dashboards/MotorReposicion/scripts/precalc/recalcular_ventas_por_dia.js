// scripts/precalc/recalcular_ventas_por_dia.js
// Uso: node scripts/precalc/recalcular_ventas_por_dia.js 2025-01-01 2025-01-31
// Recalcula MotorReposicion_VentasPorDia para un rango de fechas puntual -- para correr a mano si
// alguien avisa de una correccion a una venta de mas de 3 meses de antiguedad (el recalculo
// semanal automatico de la Etapa 8 solo cubre los ultimos 3 meses).
require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 10 * 60 * 1000,
};
async function main() {
  const [,, desdeArg, hastaArg] = process.argv;
  if (!desdeArg || !hastaArg) throw new Error('Uso: node recalcular_ventas_por_dia.js YYYY-MM-DD YYYY-MM-DD');
  const pool = await sql.connect(dbConfig);
  const req = pool.request();
  req.input('desde', sql.Date, new Date(desdeArg));
  req.input('hasta', sql.Date, new Date(hastaArg));
  await req.query(`
    IF OBJECT_ID('tempdb..#VentasDia') IS NOT NULL DROP TABLE #VentasDia;
    IF OBJECT_ID('tempdb..#PromoDia') IS NOT NULL DROP TABLE #PromoDia;

    SELECT vd.FECHA, vd.ESTAB AS Sucursal, ISNULL(vd.ARTCEGID,'') AS CodArticulo, ISNULL(vd.COLOR,'') AS COLOR, ISNULL(vd.TALLE,'') AS TALLE,
           SUM(CASE WHEN ISNUMERIC(vd.CANTIDAD)=1 THEN CAST(vd.CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS CantidadVendida
    INTO #VentasDia
    FROM Vta_detalle vd
    WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @desde AND vd.FECHA <= @hasta
    GROUP BY vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,'');

    SELECT vd.FECHA, vd.ESTAB AS Sucursal, ISNULL(vd.ARTCEGID,'') AS CodArticulo, ISNULL(vd.COLOR,'') AS COLOR, ISNULL(vd.TALLE,'') AS TALLE,
           COUNT(*) AS CantidadVentasPromo, MAX(c.NOMBRE_COND) AS NombrePromoDia, MAX(c.DESCUENTO) AS DescuentoPromoDia
    INTO #PromoDia
    FROM Vta_detalle vd
    INNER JOIN CGD_CONDCOM_VTA_DET c
      ON c.ESTAB = vd.ESTAB AND c.NUMERO = vd.NUMERO AND c.FECHA = vd.FECHA AND c.CODBARRA_prin = vd.CODBARRA_prin
      AND c.PVP_REBAJADO < c.PRECIOLLENO AND c.NOMBRE_COND NOT LIKE '%MES DE TU CUMPLEA%'
    WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @desde AND vd.FECHA <= @hasta
    GROUP BY vd.FECHA, vd.ESTAB, ISNULL(vd.ARTCEGID,''), ISNULL(vd.COLOR,''), ISNULL(vd.TALLE,'');

    DELETE FROM dbo.MotorReposicion_VentasPorDia WHERE Fecha >= @desde AND Fecha <= @hasta;
    INSERT INTO dbo.MotorReposicion_VentasPorDia (Fecha, Sucursal, CodArticulo, COLOR, TALLE, CantidadVendida, CantidadVentasPromo, NombrePromoDia, DescuentoPromoDia)
    SELECT v.FECHA, v.Sucursal, v.CodArticulo, v.COLOR, v.TALLE,
           v.CantidadVendida, ISNULL(p.CantidadVentasPromo, 0), p.NombrePromoDia, p.DescuentoPromoDia
    FROM #VentasDia v
    LEFT JOIN #PromoDia p ON p.FECHA=v.FECHA AND p.Sucursal=v.Sucursal AND p.CodArticulo=v.CodArticulo AND p.COLOR=v.COLOR AND p.TALLE=v.TALLE;

    DROP TABLE #VentasDia;
    DROP TABLE #PromoDia;
  `);
  console.log(`Recalculado ${desdeArg} a ${hastaArg}.`);
  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
