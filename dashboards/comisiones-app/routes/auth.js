const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;
        if (!usuario || !password) {
            return res.status(400).json({ error: 'Usuario y password requeridos' });
        }
        const pool = await getPool();

        // Use COL_NAME to reference contraseña column (avoids encoding issues with ñ)
        const colResult = await pool.request()
            .query("SELECT COL_NAME(OBJECT_ID('dbo.TBL_USUARIOS_APPS'), 3) AS pwdCol");
        const pwdCol = colResult.recordset[0].pwdCol;

        const result = await pool.request()
            .input('usuario', sql.VarChar(100), usuario)
            .input('pwd', sql.VarChar(200), password)
            .query(`SELECT idusuario, descUsuario, nombre, apellido, activo, idPerfil
                    FROM dbo.TBL_USUARIOS_APPS 
                    WHERE descUsuario = @usuario 
                      AND [${pwdCol}] = @pwd`);

        if (result.recordset.length === 0) {
            return res.status(401).json({ error: 'Usuario o password incorrectos' });
        }

        const user = result.recordset[0];
        if (!user.activo) {
            return res.status(403).json({ error: 'Usuario inactivo' });
        }

        // Update last login
        await pool.request()
            .input('id', sql.Int, user.idusuario)
            .query('UPDATE dbo.TBL_USUARIOS_APPS SET ultimoLogIn = GETDATE() WHERE idusuario = @id');

        res.json({
            idusuario: user.idusuario,
            usuario: user.descUsuario,
            nombre: (user.nombre || '') + ' ' + (user.apellido || ''),
            idPerfil: user.idPerfil
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
