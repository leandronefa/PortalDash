import { getPoolBC, sql } from '../server/config/dbBeClever.js';
import dotenv from 'dotenv'; dotenv.config();

const pool = await getPoolBC();
const r = await pool.request()
  .input('Anio', sql.Int, 2026)
  .input('Mes', sql.Int, 5)
  .execute('dbo.sp_ReporteVentasCobrosObjetivos');

// Mostrar columnas disponibles
const cols = Object.keys(r.recordset[0] || {});
console.log('Columnas:', cols);

// Muestra 1 fila de CONSUMO
const row = r.recordset.find(r => r.Producto?.trim() === 'CONSUMO');
console.log('Fila CONSUMO:', JSON.stringify(row, null, 2));
process.exit(0);
