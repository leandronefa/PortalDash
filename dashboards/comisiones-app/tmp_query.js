const sql = require('mssql');
const config = { server: '10.0.0.115', user: 'sa', password: 'MicroS123', database: 'db_Cegid', options: { encrypt: false, trustServerCertificate: true } };
(async () => {
  const pool = await sql.connect(config);
  const r = await pool.request().query(`
    DECLARE @FD DATE = '2026-02-26', @FH DATE = '2026-03-25';
    SELECT 
        vd.VEND,
        RTRIM(ISNULL(v.APELLIDO,'')) + ', ' + RTRIM(ISNULL(v.NOMBRE,'')) AS Nombre,
        ISNULL(v.TIPO, 'VENDEDOR') AS Tipo,
        SUM(CASE WHEN suc.empresa = 'Tesi' THEN (vd.CANTIDAD * ABS(vd.PRECIO)) - ABS(ISNULL(vd.DESCUENTO2,0)) ELSE 0 END) AS VentaTesi,
        SUM(CASE WHEN suc.empresa <> 'Tesi' THEN (vd.CANTIDAD * ABS(vd.PRECIO)) - ABS(ISNULL(vd.DESCUENTO2,0)) ELSE 0 END) AS VentaOtras,
        SUM((vd.CANTIDAD * ABS(vd.PRECIO)) - ABS(ISNULL(vd.DESCUENTO2,0))) AS VentaTotal,
        COUNT(DISTINCT suc.empresa) AS CantEmpresas
    FROM dbo.Vta_detalle vd
    INNER JOIN dbo.cgd_ARTICULOS art
        ON vd.ARTCEGID = art.GA_CODEARTICLE AND vd.COLOR = art.COLOR AND vd.TALLE = art.TALLE
    INNER JOIN dbo.cgd_sucursales suc ON vd.ESTAB = suc.sucursal
    LEFT JOIN dbo.tbl_CoVenApp_Vendedores v ON vd.VEND = v.NRO_VENDEDOR
    WHERE vd.FECHA >= @FD AND vd.FECHA <= @FH
      AND ISNULL(vd.CANTIDAD, 0) <> 0
      AND ISNUMERIC(vd.VEND) = 1
    GROUP BY vd.VEND, v.APELLIDO, v.NOMBRE, v.TIPO
    HAVING COUNT(DISTINCT suc.empresa) > 1
    ORDER BY VentaTotal DESC
  `);
  const rows = r.recordset;
  console.log('Vendedores con ventas en AMBAS empresas:', rows.length);
  console.log('');
  const fmt = n => '$' + Number(n).toLocaleString('es-AR', {minimumFractionDigits:0, maximumFractionDigits:0});
  console.log(
    'VEND'.padEnd(8) + 'Nombre'.padEnd(32) + 'Tipo'.padEnd(12) +
    'Vta Tesi'.padStart(18) + 'Vta Otras'.padStart(18) + 'Vta Total'.padStart(18)
  );
  console.log('-'.repeat(130));
  rows.forEach(row => {
    console.log(
      String(row.VEND).padEnd(8) +
      (row.Nombre || '').substring(0, 30).padEnd(32) +
      (row.Tipo || '').padEnd(12) +
      fmt(row.VentaTesi).padStart(18) +
      fmt(row.VentaOtras).padStart(18) +
      fmt(row.VentaTotal).padStart(18)
    );
  });
  await pool.close();
})().catch(e => { console.error(e.message); process.exit(1); });
