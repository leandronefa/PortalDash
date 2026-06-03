const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

// POST /api/comisiones/calcular - Ejecutar SP
router.post('/calcular', async (req, res) => {
    try {
        const { fechaEjecucion, empresa, mostrarDetalle } = req.body;
        const pool = await getPool();
        const request = pool.request();

        if (fechaEjecucion) request.input('FechaEjecucion', sql.Date, fechaEjecucion);
        if (empresa) request.input('Empresa', sql.VarChar(50), empresa);
        request.input('MostrarDetalle', sql.Bit, mostrarDetalle ? 1 : 0);

        const result = await request.execute('dbo.SP_CalcularComisionesVendedores');

        // recordsets[0] = resumen, recordsets[1] = detalle (si se pidio)
        const response = {
            resumen: result.recordsets[0] || [],
            detalle: mostrarDetalle ? (result.recordsets[1] || []) : []
        };
        res.json(response);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/comisiones/vendedores - Lista de vendedores habilitados
router.get('/vendedores', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(
            `SELECT NRO_VENDEDOR, NOMBRE, APELLIDO, TIPO, COMISIONA 
             FROM dbo.tbl_CoVenApp_Vendedores 
             WHERE ISNUMERIC(NRO_VENDEDOR) = 1
             ORDER BY APELLIDO, NOMBRE`
        );
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/comisiones/auditoria - Log de cambios
router.get('/auditoria', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(
            `SELECT TOP 100 idLog, idRegla, clave, valorAnterior, valorNuevo, usuario, fechaCambio 
             FROM dbo.tbl_CoVenApp_ConfigReglasLog 
             ORDER BY fechaCambio DESC`
        );
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
