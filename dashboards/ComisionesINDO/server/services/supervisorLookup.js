import { sql } from '../config/db.js';

// Migración self-healing (mismo patrón que ranking.js/sucursales.js ensureColumns):
// agrega la columna si falta y carga el vínculo conocido de los 2 supervisores existentes.
export async function ensureUsuarioLoginColumn(pool) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.tbl_CoVenAppINDO_Supervisores') AND name = 'usuario_login'
    )
    ALTER TABLE dbo.tbl_CoVenAppINDO_Supervisores ADD usuario_login VARCHAR(50) NULL
  `);
  await pool.request().query(`
    UPDATE dbo.tbl_CoVenAppINDO_Supervisores SET usuario_login = 'EVIDABLE'
    WHERE nombre = 'Eric Vidable' AND usuario_login IS NULL
  `);
  await pool.request().query(`
    UPDATE dbo.tbl_CoVenAppINDO_Supervisores SET usuario_login = 'JROSSINI'
    WHERE nombre = 'Josefina Rossini' AND usuario_login IS NULL
  `);
}

// Resuelve el supervisor_id y sus sucursales asignadas a partir del usuario de login (JWT).
// Devuelve null si el usuario no tiene ningún supervisor vinculado (evita fugas por default-abierto).
export async function resolverSupervisor(pool, usuarioLogin) {
  const supR = await pool.request()
    .input('usuario', sql.VarChar, usuarioLogin)
    .query('SELECT id FROM dbo.tbl_CoVenAppINDO_Supervisores WHERE usuario_login = @usuario');
  if (!supR.recordset.length) return null;

  const supervisorId = supR.recordset[0].id;
  const asigR = await pool.request()
    .input('sup', sql.Int, supervisorId)
    .query('SELECT sucursal_id FROM dbo.tbl_CoVenAppINDO_SupervisorSucursales WHERE supervisor_id = @sup');

  return { supervisorId, sucursales: asigR.recordset.map(r => r.sucursal_id) };
}
