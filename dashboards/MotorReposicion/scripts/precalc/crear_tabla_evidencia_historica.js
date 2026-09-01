// scripts/precalc/crear_tabla_evidencia_historica.js
// Crea dbo.MotorReposicion_EvidenciaHistorica (una sola vez) -- tabla nueva que el SP de
// precalculo va a poblar (Etapa 6) para soportar el ajuste "evidencia historica" de la necesidad
// de compra sin recalcular Vta_detalle/DiasConStockPorSemana en vivo en cada request.
require('dotenv').config();
const sql = require('mssql');

const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const pool = await sql.connect(dbConfig);

  const yaExiste = await pool.request().query(`SELECT OBJECT_ID('dbo.MotorReposicion_EvidenciaHistorica') AS id`);
  if (yaExiste.recordset[0].id) {
    console.log('La tabla ya existe, no se hace nada.');
    await pool.close();
    return;
  }

  await pool.request().query(`
    CREATE TABLE dbo.MotorReposicion_EvidenciaHistorica (
      Sucursal VARCHAR(20) NOT NULL,
      CodArticulo VARCHAR(50) NOT NULL,
      COLOR VARCHAR(50) NOT NULL,
      TALLE VARCHAR(20) NOT NULL,
      VentasHistoricoTotal DECIMAL(18,4) NOT NULL,
      DiasConStockHistorico INT NOT NULL,
      PrimeraStockSemana DATE NULL,
      PrimeraAceptacionDeposito DATE NULL,
      FechaCalculo DATETIME NOT NULL,
      CONSTRAINT PK_MotorReposicion_EvidenciaHistorica PRIMARY KEY CLUSTERED (Sucursal, CodArticulo, COLOR, TALLE)
    );
  `);
  console.log('Tabla dbo.MotorReposicion_EvidenciaHistorica creada.');

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
