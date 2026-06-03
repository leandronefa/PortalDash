const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

// GET /api/reglas - Listar todas las reglas de configuracion
router.get('/', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(
            'SELECT idRegla, clave, valor, descripcion, activo, fechaModificacion FROM dbo.tbl_CoVenApp_ConfigReglas ORDER BY idRegla'
        );
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/reglas/:id - Actualizar una regla
router.put('/:id', async (req, res) => {
    try {
        const { valor, activo } = req.body;
        const pool = await getPool();

        // Obtener valor anterior para log
        const prev = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT clave, valor FROM dbo.tbl_CoVenApp_ConfigReglas WHERE idRegla = @id');

        if (prev.recordset.length === 0) {
            return res.status(404).json({ error: 'Regla no encontrada' });
        }

        const old = prev.recordset[0];

        // Actualizar
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('valor', sql.VarChar(200), valor)
            .input('activo', sql.Bit, activo)
            .query(`UPDATE dbo.tbl_CoVenApp_ConfigReglas 
                    SET valor = @valor, activo = @activo, fechaModificacion = GETDATE() 
                    WHERE idRegla = @id`);

        // Log de auditoria
        await pool.request()
            .input('idRegla', sql.Int, req.params.id)
            .input('clave', sql.VarChar(100), old.clave)
            .input('valorAnterior', sql.VarChar(200), old.valor)
            .input('valorNuevo', sql.VarChar(200), valor)
            .query(`INSERT INTO dbo.tbl_CoVenApp_ConfigReglasLog 
                    (idRegla, clave, valorAnterior, valorNuevo) 
                    VALUES (@idRegla, @clave, @valorAnterior, @valorNuevo)`);

        res.json({ message: 'Regla actualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
