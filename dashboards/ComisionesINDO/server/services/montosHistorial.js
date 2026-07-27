import { sql } from '../config/db.js';

// Migración self-healing (mismo patrón que ranking.js/sucursales.js): crea la
// tabla de fotos de montos por período si no existe.
export async function ensureMontosHistorialTable(pool) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.objects
      WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_MontosHistorial') AND type = 'U'
    )
    CREATE TABLE dbo.tbl_CoVenAppINDO_MontosHistorial (
      periodo         VARCHAR(7) PRIMARY KEY,
      montos_json     NVARCHAR(MAX),
      fecha_snapshot  DATETIME DEFAULT GETDATE()
    )
  `);
}

// Lee las 6 fuentes de montos "vivas" (valor actual del ABM) tal cual las
// carga hoy calculo.js::cargarContexto — sin filtro de período, son tablas
// de configuración global por categoría/escalón.
async function leerMontosVivos(pool) {
  const [montosR, montosVendR, montoSupR, montosPresR, montosCajR, multR] = await Promise.all([
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Montos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosVendedor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosSupervisor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosPrestamos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosCajero'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
  ]);
  return {
    montos:            montosR.recordset,
    montosVendedor:    montosVendR.recordset,
    montosSupervisor:  montoSupR.recordset,
    montosPrestamaos:  montosPresR.recordset,
    montosCajero:      montosCajR.recordset,
    multiplicadores:   multR.recordset,
  };
}

// Devuelve la foto congelada de montos de un período: si ya existe, la lee
// y la devuelve tal cual (sin importar qué se haya editado después en el
// ABM); si es la primera vez que se calcula ese período, la crea a partir
// de los valores vivos actuales y la persiste.
export async function cargarMontosDelPeriodo(pool, periodo) {
  await ensureMontosHistorialTable(pool);

  const existente = await pool.request()
    .input('periodo', sql.VarChar, periodo)
    .query('SELECT montos_json FROM dbo.tbl_CoVenAppINDO_MontosHistorial WHERE periodo = @periodo');

  if (existente.recordset.length) {
    return JSON.parse(existente.recordset[0].montos_json);
  }

  const snapshot = await leerMontosVivos(pool);
  await pool.request()
    .input('periodo', sql.VarChar, periodo)
    .input('json', sql.NVarChar(sql.MAX), JSON.stringify(snapshot))
    .query(`
      INSERT INTO dbo.tbl_CoVenAppINDO_MontosHistorial (periodo, montos_json)
      VALUES (@periodo, @json)
    `);
  return snapshot;
}
