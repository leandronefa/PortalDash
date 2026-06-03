const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

// GET /api/escalas - Listar escalones (opcional: filtrar por empresa, tipo, año, mes)
router.get('/', async (req, res) => {
    try {
        const { empresa, tipo, anio, mes } = req.query;
        const pool = await getPool();
        let query = 'SELECT idComision, valorInferior, valorSuperior, comision, empresa, mes, [año] as anio, tipo FROM dbo.tbl_CoVenApp_Comisiones WHERE 1=1';
        const request = pool.request();

        if (empresa) {
            query += ' AND empresa = @empresa';
            request.input('empresa', sql.VarChar(50), empresa);
        }
        if (tipo) {
            query += ' AND tipo = @tipo';
            request.input('tipo', sql.VarChar(50), tipo);
        }
        if (anio) {
            query += ' AND [año] = @anio';
            request.input('anio', sql.Int, parseInt(anio));
        }
        if (mes) {
            query += ' AND mes = @mes';
            request.input('mes', sql.Int, parseInt(mes));
        }

        query += ' ORDER BY [año] DESC, mes DESC, tipo, valorInferior';
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/escalas/periodos - Listar periodos disponibles
router.get('/periodos', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(
            'SELECT DISTINCT [año] as anio, mes FROM dbo.tbl_CoVenApp_Comisiones ORDER BY [año] DESC, mes DESC'
        );
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/escalas/vigente - Obtener escalones vigentes (MAX año, MAX mes)
router.get('/vigente', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            DECLARE @maxAnio INT, @maxMes INT;
            SELECT @maxAnio = MAX([año]) FROM dbo.tbl_CoVenApp_Comisiones;
            SELECT @maxMes = MAX(mes) FROM dbo.tbl_CoVenApp_Comisiones WHERE [año] = @maxAnio;
            SELECT idComision, valorInferior, valorSuperior, comision, empresa, mes, @maxAnio as anio, tipo
            FROM dbo.tbl_CoVenApp_Comisiones
            WHERE [año] = @maxAnio AND mes = @maxMes
            ORDER BY tipo, empresa, valorInferior;
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/escalas - Crear un nuevo escalon
router.post('/', async (req, res) => {
    try {
        const { valorInferior, valorSuperior, comision, empresa, mes, anio, tipo } = req.body;
        if (!valorInferior && valorInferior !== 0 || !valorSuperior || !comision && comision !== 0 || !empresa || !mes || !anio || !tipo) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }
        const pool = await getPool();
        await pool.request()
            .input('valorInferior', sql.Float, parseFloat(valorInferior))
            .input('valorSuperior', sql.Float, parseFloat(valorSuperior))
            .input('comision', sql.Float, parseFloat(comision))
            .input('empresa', sql.VarChar(50), empresa)
            .input('mes', sql.Int, parseInt(mes))
            .input('anio', sql.Int, parseInt(anio))
            .input('tipo', sql.VarChar(50), tipo)
            .query(`INSERT INTO dbo.tbl_CoVenApp_Comisiones 
                    (valorInferior, valorSuperior, comision, empresa, mes, [año], tipo)
                    VALUES (@valorInferior, @valorSuperior, @comision, @empresa, @mes, @anio, @tipo)`);
        res.json({ message: 'Escalon creado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/escalas/:id - Actualizar un escalon
router.put('/:id', async (req, res) => {
    try {
        const { valorInferior, valorSuperior, comision, empresa, mes, anio, tipo } = req.body;
        const pool = await getPool();

        const prev = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('SELECT * FROM dbo.tbl_CoVenApp_Comisiones WHERE idComision = @id');

        if (prev.recordset.length === 0) {
            return res.status(404).json({ error: 'Escalon no encontrado' });
        }

        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('valorInferior', sql.Float, parseFloat(valorInferior))
            .input('valorSuperior', sql.Float, parseFloat(valorSuperior))
            .input('comision', sql.Float, parseFloat(comision))
            .input('empresa', sql.VarChar(50), empresa)
            .input('mes', sql.Int, parseInt(mes))
            .input('anio', sql.Int, parseInt(anio))
            .input('tipo', sql.VarChar(50), tipo)
            .query(`UPDATE dbo.tbl_CoVenApp_Comisiones 
                    SET valorInferior = @valorInferior, valorSuperior = @valorSuperior, 
                        comision = @comision, empresa = @empresa, mes = @mes, [año] = @anio, tipo = @tipo
                    WHERE idComision = @id`);

        res.json({ message: 'Escalon actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/escalas/:id - Eliminar un escalon
router.delete('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM dbo.tbl_CoVenApp_Comisiones WHERE idComision = @id');
        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Escalon no encontrado' });
        }
        res.json({ message: 'Escalon eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/escalas/copiar - Copiar escalones de un periodo a otro
router.post('/copiar', async (req, res) => {
    try {
        const { anioOrigen, mesOrigen, anioDestino, mesDestino } = req.body;
        if (!anioOrigen || !mesOrigen || !anioDestino || !mesDestino) {
            return res.status(400).json({ error: 'Origen y destino son obligatorios' });
        }
        const pool = await getPool();

        // Verificar que no exista ya el destino
        const existe = await pool.request()
            .input('anioD', sql.Int, parseInt(anioDestino))
            .input('mesD', sql.Int, parseInt(mesDestino))
            .query('SELECT COUNT(*) as cnt FROM dbo.tbl_CoVenApp_Comisiones WHERE [año] = @anioD AND mes = @mesD');
        
        if (existe.recordset[0].cnt > 0) {
            return res.status(400).json({ error: 'Ya existen escalones para el periodo destino' });
        }

        await pool.request()
            .input('anioO', sql.Int, parseInt(anioOrigen))
            .input('mesO', sql.Int, parseInt(mesOrigen))
            .input('anioD', sql.Int, parseInt(anioDestino))
            .input('mesD', sql.Int, parseInt(mesDestino))
            .query(`INSERT INTO dbo.tbl_CoVenApp_Comisiones (valorInferior, valorSuperior, comision, empresa, mes, [año], tipo)
                    SELECT valorInferior, valorSuperior, comision, empresa, @mesD, @anioD, tipo
                    FROM dbo.tbl_CoVenApp_Comisiones
                    WHERE [año] = @anioO AND mes = @mesO`);

        res.json({ message: 'Escalones copiados al nuevo periodo' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
