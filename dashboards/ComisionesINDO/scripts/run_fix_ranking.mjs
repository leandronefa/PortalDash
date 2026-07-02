import sql from 'mssql';

const cfg = {
  server: '10.0.0.115',
  user: 'sa',
  password: 'MicroS123',
  database: 'db_Cegid',
  options: { trustServerCertificate: true, encrypt: false, enableArithAbort: true },
};

const pool = await sql.connect(cfg);

// Paso 1: verificar duplicados
console.log('=== Duplicados existentes ===');
const dups = await pool.request().query(`
  SELECT sucursal_id, periodo, COUNT(*) AS cant
  FROM dbo.tbl_CoVenAppINDO_Ranking
  GROUP BY sucursal_id, periodo
  HAVING COUNT(*) > 1
  ORDER BY periodo, sucursal_id
`);
if (dups.recordset.length === 0) {
  console.log('(ninguno)');
} else {
  console.table(dups.recordset);
}

// Paso 2: eliminar duplicados (conserva el de id más alto)
const del = await pool.request().query(`
  WITH cte AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY sucursal_id, periodo ORDER BY id DESC) AS rn
    FROM dbo.tbl_CoVenAppINDO_Ranking
  )
  DELETE FROM cte WHERE rn > 1
`);
console.log(`\nFilas eliminadas: ${del.rowsAffected[0]}`);

// Paso 3: agregar UNIQUE constraint si no existe
const exists = await pool.request().query(`
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.tbl_CoVenAppINDO_Ranking')
    AND name = 'UQ_Ranking_SucursalPeriodo'
`);
if (exists.recordset.length === 0) {
  await pool.request().query(`
    ALTER TABLE dbo.tbl_CoVenAppINDO_Ranking
    ADD CONSTRAINT UQ_Ranking_SucursalPeriodo UNIQUE (sucursal_id, periodo)
  `);
  console.log('UNIQUE constraint agregado.');
} else {
  console.log('UNIQUE constraint ya existía, sin cambios.');
}

// Verificación final
const check = await pool.request().query(`
  SELECT sucursal_id, periodo, COUNT(*) AS cant
  FROM dbo.tbl_CoVenAppINDO_Ranking
  GROUP BY sucursal_id, periodo
  HAVING COUNT(*) > 1
`);
console.log(`\nVerificación final — duplicados restantes: ${check.recordset.length}`);

await pool.close();
