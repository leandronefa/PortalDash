const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

// Nombre real de la columna "año" (puede tener encoding issues)
// Usamos COL_NAME para resolverlo dinamicamente al iniciar
let colYear = 'año';

async function resolveYearColumn() {
    try {
        const pool = await getPool();
        const r = await pool.request().query(
            "SELECT COL_NAME(OBJECT_ID('dbo.tbl_CoVenApp_Comisiones'), 7) AS colName"
        );
        if (r.recordset.length > 0 && r.recordset[0].colName) {
            colYear = r.recordset[0].colName;
        }
    } catch (e) { /* use default */ }
}
resolveYearColumn();

// GET /api/escalones?empresa=Tesi&mes=9&anio=2025
router.get('/', async (req, res) => {
    try {
        const { empresa, mes, anio } = req.query;
        const pool = await getPool();
        let q = `SELECT idComision, valorInferior, valorSuperior, comision, 
                        empresa, mes, [${colYear}] AS anio, tipo 
                 FROM dbo.tbl_CoVenApp_Comisiones WHERE 1=1`;
        const request = pool.request();

        if (empresa) {
            q += ' AND empresa = @empresa';
            request.input('empresa', sql.VarChar(50), empresa);
        }
        if (mes) {
            q += ' AND mes = @mes';
            request.input('mes', sql.Int, parseInt(mes));
        }
        if (anio) {
            q += ` AND [${colYear}] = @anio`;
            request.input('anio', sql.Int, parseInt(anio));
        }
        q += ` ORDER BY tipo, valorInferior`;

        const result = await request.query(q);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/escalones/periodos - Listar meses/años disponibles
router.get('/periodos', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(
            `SELECT DISTINCT empresa, mes, [${colYear}] AS anio 
             FROM dbo.tbl_CoVenApp_Comisiones 
             ORDER BY [${colYear}] DESC, mes DESC`
        );
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/escalones - Crear escalon
router.post('/', async (req, res) => {
    try {
        const { valorInferior, valorSuperior, comision, empresa, mes, anio, tipo } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('valorInf', sql.Float, valorInferior)
            .input('valorSup', sql.Float, valorSuperior)
            .input('comision', sql.Float, comision)
            .input('empresa', sql.VarChar(50), empresa)
            .input('mes', sql.Int, mes)
            .input('anio', sql.Int, anio)
            .input('tipo', sql.VarChar(200), tipo)
            .query(`INSERT INTO dbo.tbl_CoVenApp_Comisiones 
                    (valorInferior, valorSuperior, comision, empresa, mes, [${colYear}], tipo) 
                    VALUES (@valorInf, @valorSup, @comision, @empresa, @mes, @anio, @tipo)`);
        res.json({ message: 'Escalon creado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/escalones/:id
router.put('/:id', async (req, res) => {
    try {
        const { valorInferior, valorSuperior, comision } = req.body;
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('valorInf', sql.Float, valorInferior)
            .input('valorSup', sql.Float, valorSuperior)
            .input('comision', sql.Float, comision)
            .query(`UPDATE dbo.tbl_CoVenApp_Comisiones 
                    SET valorInferior = @valorInf, valorSuperior = @valorSup, comision = @comision 
                    WHERE idComision = @id`);
        if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ message: 'Escalon actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/escalones/:id
router.delete('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM dbo.tbl_CoVenApp_Comisiones WHERE idComision = @id');
        res.json({ message: 'Escalon eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/escalones/copiar - Copiar escalones de un periodo a otro
router.post('/copiar', async (req, res) => {
    try {
        const { empresaOrigen, mesOrigen, anioOrigen, mesDestino, anioDestino } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('empOrig', sql.VarChar(50), empresaOrigen)
            .input('mesOrig', sql.Int, mesOrigen)
            .input('anioOrig', sql.Int, anioOrigen)
            .input('mesDest', sql.Int, mesDestino)
            .input('anioDest', sql.Int, anioDestino)
            .query(`INSERT INTO dbo.tbl_CoVenApp_Comisiones 
                    (valorInferior, valorSuperior, comision, empresa, mes, [${colYear}], tipo)
                    SELECT valorInferior, valorSuperior, comision, empresa, @mesDest, @anioDest, tipo
                    FROM dbo.tbl_CoVenApp_Comisiones
                    WHERE empresa = @empOrig AND mes = @mesOrig AND [${colYear}] = @anioOrig`);
        res.json({ message: 'Escalones copiados' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
