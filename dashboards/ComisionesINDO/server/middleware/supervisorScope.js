import { getPool } from '../config/db.js';
import { ensureUsuarioLoginColumn, resolverSupervisor } from '../services/supervisorLookup.js';

let usuarioLoginColumnEnsured = false;

export async function attachScope(req, res, next) {
  if (req.user?.perfil !== 8) {
    req.sucursalesPermitidas = null;
    req.supervisorId = null;
    return next();
  }
  try {
    const pool = await getPool();
    if (!usuarioLoginColumnEnsured) {
      await ensureUsuarioLoginColumn(pool);
      usuarioLoginColumnEnsured = true;
    }
    const info = await resolverSupervisor(pool, req.user.usuario);
    if (!info) {
      req.supervisorId = null;
      req.sucursalesPermitidas = [];
      return next();
    }
    req.supervisorId = info.supervisorId;
    req.sucursalesPermitidas = info.sucursales;
    next();
  } catch (err) {
    console.error('[attachScope]', err);
    res.status(500).json({ error: 'Error de servidor' });
  }
}

export function blockWriteIfSupervisor(req, res, next) {
  if (req.user?.perfil === 8 && req.method !== 'GET') {
    return res.status(403).json({ error: 'Usuario de solo lectura' });
  }
  next();
}
