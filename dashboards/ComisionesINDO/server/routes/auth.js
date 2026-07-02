import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getPool, sql } from '../config/db.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { usuario, contrasena } = req.body;
  if (!usuario || !contrasena) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }
  try {
    const pool = await getPool();
    // Credentials validated via parameterized query (no string interpolation)
    const result2 = await pool.request()
      .input('usuario', sql.VarChar, usuario)
      .input('contrasena', sql.VarChar, contrasena)
      .query(`
        SELECT idusuario, descUsuario, nombre, apellido, idPerfil, activo
        FROM dbo.TBL_USUARIOS_APPS
        WHERE descUsuario = @usuario AND contraseña = @contrasena AND activo = 1
      `);

    if (!result2.recordset.length) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const user = result2.recordset[0];
    const token = jwt.sign(
      { id: user.idusuario, usuario: user.descUsuario, perfil: user.idPerfil },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.idusuario,
        usuario: user.descUsuario,
        nombre: `${user.nombre} ${user.apellido}`,
        perfil: user.idPerfil
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error de servidor' });
  }
});

export default router;
