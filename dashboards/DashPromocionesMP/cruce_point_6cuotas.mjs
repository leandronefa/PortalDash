/**
 * Cruce único: Promo "CON LA COMPRA MIN 200.000, DESCUENTO DE 20.000"
 * filtrado por POINT + 6 cuotas → enriquecido con VENDEDOR de Vta_detalle
 *
 * Uso: node cruce_point_6cuotas.mjs
 * Genera: cruce_point_6cuotas_resultado.csv
 */

import sql from 'mssql';
import fs from 'fs';
import 'dotenv/config';

const cfg = {
  user: process.env.SQL_USER,
  password: process.env.SQL_PASS,
  server: process.env.SQL_HOST,
  database: process.env.SQL_DB,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 60000,
};

const PROMO = 'CON LA COMPRA MIN 200.000, DESCUENTO DE 20.000';

async function main() {
  console.log('Conectando a SQL Server...');
  const pool = await new sql.ConnectionPool({ ...cfg, pool: { max: 1, min: 1 } }).connect();

  // 1. Cargar resultados del SP en tabla temporal
  // Con pool max:1 todos los requests usan la misma conexión física → #ventas persiste
  console.log('Ejecutando sp_GrillaPromosMP...');
  await pool.request().query(`
    IF OBJECT_ID('tempdb..##ventas_cruce') IS NOT NULL DROP TABLE ##ventas_cruce;
    CREATE TABLE ##ventas_cruce (
      FECHA       DATETIME2,
      suc         VARCHAR(20),
      NUMERO      VARCHAR(50),
      COD_COND    VARCHAR(20),
      NOMBRE_COND VARCHAR(500),
      fecha_ini   DATE,
      fecha_fin   DATE,
      DESCUENTO   DECIMAL(18,2),
      PRECIOLLENO DECIMAL(18,2),
      TotalTk     DECIMAL(18,2),
      IMPORTE     DECIMAL(18,2),
      cod_MP      VARCHAR(20),
      nom_MP      VARCHAR(100),
      CUOTA       INT
    );
  `);
  await pool.request().query(`INSERT INTO ##ventas_cruce EXEC sp_GrillaPromosMP;`);
  console.log('SP cargado en ##ventas_cruce.');

  // 2. Cruce: ventas (promo+MP) × mp_transacciones (POINT+6c) × Vta_detalle (vendedor)
  const query = `
    SELECT
      v.FECHA                                  AS Fecha_Venta,
      v.suc                                    AS Sucursal,
      v.NUMERO                                 AS Nro_Ticket,
      vd.VEND                                  AS Vendedor,
      v.NOMBRE_COND                            AS Promocion,
      v.cod_MP                                 AS Medio_Pago,
      v.IMPORTE                                AS Importe_Venta,
      v.DESCUENTO                              AS Descuento,
      t.cuotas                                 AS Cuotas,
      t.sub_unit                               AS Canal,
      t.transaction_amount                     AS Importe_MP,
      t.net_received_amount                    AS Neto_MP,
      t.mercadopago_fee                        AS Costo_MP,
      t.financing_fee                          AS Desc_Financiacion,
      t.issuer_name                            AS Emisor,
      t.payment_type                           AS Tipo_Pago,
      t.date_created                           AS Fecha_MP,
      t.franchise                              AS Franquicia,
      vd.VEND                                  AS Cod_Vendedor,
      LTRIM(RTRIM(ISNULL(cv.nombre,'') + ' ' + ISNULL(cv.apellido,''))) AS Nombre_Vendedor
    FROM ##ventas_cruce v
    -- Join con mp_transacciones: misma sucursal + importe ±1 + mismo día
    JOIN dbo.mp_transacciones t
      ON CAST(v.suc AS INT) = CAST(REPLACE(t.description, 'Suc.', '') AS INT)
      AND ABS(v.IMPORTE - t.transaction_amount) <= 1
      AND CAST(v.FECHA AS DATE) = CAST(t.date_created AS DATE)
    -- Join con Vta_detalle para obtener vendedor (un solo valor por ticket)
    OUTER APPLY (
      SELECT TOP 1 vd.VEND
      FROM dbo.Vta_detalle vd
      WHERE CAST(vd.FECHA AS DATE) = CAST(v.FECHA AS DATE)
        AND vd.NUMERO = v.NUMERO
        AND CAST(vd.ESTAB AS INT) = CAST(v.suc AS INT)
    ) vd
    LEFT JOIN dbo.cgd_vendedores cv ON cv.codigo = vd.VEND
    WHERE
      v.NOMBRE_COND = @promo
      AND v.cod_MP IN ('555', 'M', 'ME')
      AND t.cuotas  = 6
      AND t.sub_unit LIKE '%POINT%'
    ORDER BY v.FECHA, v.suc, v.NUMERO;
  `;

  console.log('Ejecutando cruce...');
  const result = await pool.request()
    .input('promo', sql.VarChar(500), PROMO)
    .query(query);

  // Limpiar tabla global
  await pool.request().query(`IF OBJECT_ID('tempdb..##ventas_cruce') IS NOT NULL DROP TABLE ##ventas_cruce;`);
  await pool.close();

  const rows = result.recordset;
  console.log(`Resultados: ${rows.length} filas`);

  if (!rows.length) {
    console.log('Sin resultados. Verificá los filtros.');
    return;
  }

  // 3. Exportar a CSV
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(';'),
    ...rows.map(r =>
      headers.map(h => {
        const v = r[h];
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
        return String(v).replace(/;/g, ',');
      }).join(';')
    ),
  ];

  const outFile = 'cruce_point_6cuotas_resultado.csv';
  fs.writeFileSync(outFile, '\uFEFF' + csvLines.join('\r\n'), 'utf8');
  console.log(`✓ Exportado a ${outFile}`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
