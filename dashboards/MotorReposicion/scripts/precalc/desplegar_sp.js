// scripts/precalc/desplegar_sp.js
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
  const rutaSql = path.join(__dirname, '..', '..', 'sql', 'MotorReposicion_sp_PreCalcularStockSemanal.sql');
  let texto = fs.readFileSync(rutaSql, 'utf8');
  if (!texto.trim().toUpperCase().startsWith('CREATE PROCEDURE')) {
    throw new Error('El archivo no empieza con CREATE PROCEDURE -- no se despliega, revisar a mano.');
  }
  // Anclado al principio del archivo (ignorando espacios/saltos de linea iniciales) -- sin el
  // ancla (`/CREATE PROCEDURE/i` suelto), el replace pegaria contra CUALQUIER aparicion del texto
  // "CREATE PROCEDURE" en el archivo (ej. dentro de un comentario que lo mencione), no solo el
  // encabezado real. Hallazgo 4b de la revision final (2026-08-18).
  texto = texto.replace(/^\s*CREATE PROCEDURE/i, (m) => m.replace(/CREATE/i, 'ALTER'));

  const pool = await sql.connect(dbConfig);
  await pool.request().query(texto);
  console.log('SP actualizado correctamente.');

  // Verificación post-despliegue: comparar longitud del texto enviado vs OBJECT_DEFINITION de la base
  const verifyQuery = `SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.MotorReposicion_sp_PreCalcularStockSemanal')) AS SpBody`;
  const result = await pool.request().query(verifyQuery);

  if (!result.recordset || result.recordset.length === 0) {
    throw new Error('Verificación fallida: No se pudo recuperar OBJECT_DEFINITION del SP.');
  }

  const spBodyFromDb = result.recordset[0].SpBody;
  // Normalizamos: eliminar espacios en blanco al inicio/final y normalizar saltos de línea
  const textoNorm = texto.trim().replace(/\r\n/g, '\n');
  const spBodyNorm = (spBodyFromDb ? spBodyFromDb.trim() : '').replace(/\r\n/g, '\n');

  // Normalizamos el texto enviado: revertimos ALTER PROCEDURE a CREATE PROCEDURE
  // (para que coincida exactamente con lo que devuelve OBJECT_DEFINITION)
  // ya que SQL Server siempre devuelve CREATE, sin importar si se creó con ALTER
  const textoNormalized = textoNorm.replace(/^ALTER PROCEDURE/i, 'CREATE PROCEDURE');

  const textoLength = texto.length;
  const dbLength = spBodyFromDb ? spBodyFromDb.length : 0;
  const textoLengthNorm = textoNorm.length;
  const dbLengthNorm = spBodyNorm.length;
  const textoLengthNormalized = textoNormalized.length;

  console.log(`\n--- Verificación post-despliegue ---`);
  console.log(`Longitud enviada: ${textoLength} caracteres`);
  console.log(`Longitud en OBJECT_DEFINITION: ${dbLength} caracteres`);
  console.log(`Longitud enviada (normalizado): ${textoLengthNorm} caracteres`);
  console.log(`Longitud en OBJECT_DEFINITION (normalizado): ${dbLengthNorm} caracteres`);
  console.log(`Longitud enviada (normalizado + ALTER→CREATE revertido): ${textoLengthNormalized} caracteres`);
  console.log(`Diferencia después de normalizar ALTER→CREATE: ${Math.abs(textoLengthNormalized - dbLengthNorm)} caracteres`);

  if (textoNormalized === spBodyNorm) {
    console.log('✓ Los contenidos coinciden EXACTAMENTE después de normalizar. SP desplegado correctamente.');
  } else {
    console.log(`✗ Los contenidos NO coinciden después de normalizar. Verificación fallida.`);
    console.log(`Esperado: ${spBodyNorm.substring(0, 100)}...`);
    console.log(`Enviado (normalizado): ${textoNormalized.substring(0, 100)}...`);
    await pool.close();
    process.exit(1);
  }

  await pool.close();
}
main().catch(e => { console.error(e); process.exit(1); });
