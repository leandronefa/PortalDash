const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

// GET /api/licencias/politicas - Listar politicas de licencias
router.get('/politicas', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(
            'SELECT idPolitica, idPoliticaHumand, descripcion, habilitado FROM dbo.tbl_CoVenApp_PoliticasDeLicencias ORDER BY idPolitica'
        );
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/licencias/politicas/:id - Activar/desactivar politica
router.put('/politicas/:id', async (req, res) => {
    try {
        const { habilitado } = req.body;
        const pool = await getPool();

        const prev = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT idPolitica, descripcion, habilitado FROM dbo.tbl_CoVenApp_PoliticasDeLicencias WHERE idPolitica = @id');

        if (prev.recordset.length === 0) {
            return res.status(404).json({ error: 'Politica no encontrada' });
        }

        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('habilitado', sql.Bit, habilitado)
            .query('UPDATE dbo.tbl_CoVenApp_PoliticasDeLicencias SET habilitado = @habilitado WHERE idPolitica = @id');

        // Log de auditoria
        const old = prev.recordset[0];
        await pool.request()
            .input('idRegla', sql.Int, 0)
            .input('clave', sql.VarChar(100), 'LICENCIA_' + old.descripcion)
            .input('valorAnterior', sql.VarChar(200), old.habilitado ? '1' : '0')
            .input('valorNuevo', sql.VarChar(200), habilitado ? '1' : '0')
            .query(`INSERT INTO dbo.tbl_CoVenApp_ConfigReglasLog 
                    (idRegla, clave, valorAnterior, valorNuevo) 
                    VALUES (@idRegla, @clave, @valorAnterior, @valorNuevo)`);

        res.json({ message: 'Politica actualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
