const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

// GET /api/indices - Listar indices de categoria (ComisionesEspeciales)
router.get('/', async (req, res) => {
    try {
        const { seccion, marca, vigentes } = req.query;
        const pool = await getPool();
        let q = `SELECT idComision, seccion, genero, familia, linea, proveedor, marca, 
                        articulo, operacion, porcentaje, tipo, 
                        empresa, Nivel 
                 FROM dbo.tbl_CoVenApp_ComisionesEspeciales WHERE 1=1`;
        const request = pool.request();

        if (seccion) {
            q += ' AND seccion = @seccion';
            request.input('seccion', sql.VarChar(200), seccion);
        }
        if (marca) {
            q += ' AND marca = @marca';
            request.input('marca', sql.VarChar(200), marca);
        }
        q += ' ORDER BY Nivel DESC, seccion, marca';

        const result = await request.query(q);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/indices/filtros - Distinct values for filters
router.get('/filtros', async (req, res) => {
    try {
        const pool = await getPool();
        const secciones = await pool.request().query(
            'SELECT DISTINCT seccion FROM dbo.tbl_CoVenApp_ComisionesEspeciales WHERE seccion IS NOT NULL ORDER BY seccion'
        );
        const marcas = await pool.request().query(
            'SELECT DISTINCT marca FROM dbo.tbl_CoVenApp_ComisionesEspeciales WHERE marca IS NOT NULL AND marca <> \'\' ORDER BY marca'
        );
        const niveles = await pool.request().query(
            'SELECT DISTINCT Nivel FROM dbo.tbl_CoVenApp_ComisionesEspeciales ORDER BY Nivel'
        );
        res.json({
            secciones: secciones.recordset.map(r => r.seccion),
            marcas: marcas.recordset.map(r => r.marca),
            niveles: niveles.recordset.map(r => r.Nivel)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/indices/jerarquia - Distinct values from cgd_ARTICULOS for dropdowns
router.get('/jerarquia', async (req, res) => {
    try {
        const pool = await getPool();
        const [secciones, generos, familias, lineas, marcas, proveedores] = await Promise.all([
            pool.request().query("SELECT DISTINCT NOMSECCION AS val FROM dbo.cgd_ARTICULOS WHERE NOMSECCION IS NOT NULL AND NOMSECCION <> '' ORDER BY NOMSECCION"),
            pool.request().query("SELECT DISTINCT NOMGENERO AS val FROM dbo.cgd_ARTICULOS WHERE NOMGENERO IS NOT NULL AND NOMGENERO <> '' ORDER BY NOMGENERO"),
            pool.request().query("SELECT DISTINCT NOMFLIA AS val FROM dbo.cgd_ARTICULOS WHERE NOMFLIA IS NOT NULL AND NOMFLIA <> '' ORDER BY NOMFLIA"),
            pool.request().query("SELECT DISTINCT NOMLINEA AS val FROM dbo.cgd_ARTICULOS WHERE NOMLINEA IS NOT NULL AND NOMLINEA <> '' ORDER BY NOMLINEA"),
            pool.request().query("SELECT DISTINCT NOMMARCA AS val FROM dbo.cgd_ARTICULOS WHERE NOMMARCA IS NOT NULL AND NOMMARCA <> '' ORDER BY NOMMARCA"),
            pool.request().query("SELECT DISTINCT NOMPROV AS val FROM dbo.cgd_ARTICULOS WHERE NOMPROV IS NOT NULL AND NOMPROV <> '' ORDER BY NOMPROV")
        ]);
        res.json({
            secciones: secciones.recordset.map(r => r.val),
            generos: generos.recordset.map(r => r.val),
            familias: familias.recordset.map(r => r.val),
            lineas: lineas.recordset.map(r => r.val),
            marcas: marcas.recordset.map(r => r.val),
            proveedores: proveedores.recordset.map(r => r.val)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/indices - Crear indice
router.post('/', async (req, res) => {
    try {
        const { seccion, genero, familia, linea, proveedor, marca, articulo,
                operacion, porcentaje, tipo, empresa, Nivel } = req.body;
        const pool = await getPool();
        await pool.request()
            .input('seccion', sql.VarChar(200), seccion || null)
            .input('genero', sql.VarChar(200), genero || null)
            .input('familia', sql.VarChar(200), familia || null)
            .input('linea', sql.VarChar(200), linea || null)
            .input('proveedor', sql.VarChar(200), proveedor || null)
            .input('marca', sql.VarChar(200), marca || null)
            .input('articulo', sql.VarChar(200), articulo || null)
            .input('operacion', sql.VarChar(200), operacion || 'Incluye')
            .input('porcentaje', sql.Float, porcentaje)
            .input('tipo', sql.VarChar(200), tipo || 'VENDEDOR')
            .input('empresa', sql.VarChar(50), empresa || 'Tesi')
            .input('nivel', sql.Int, Nivel)
            .query(`INSERT INTO dbo.tbl_CoVenApp_ComisionesEspeciales 
                    (seccion, genero, familia, linea, proveedor, marca, articulo,
                     operacion, porcentaje, tipo, empresa, Nivel) 
                    VALUES (@seccion, @genero, @familia, @linea, @proveedor, @marca, @articulo,
                            @operacion, @porcentaje, @tipo, @empresa, @nivel)`);
        res.json({ message: 'Indice creado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/indices/:id
router.put('/:id', async (req, res) => {
    try {
        const { seccion, genero, familia, linea, proveedor, marca, articulo,
                porcentaje, Nivel } = req.body;
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('seccion', sql.VarChar(200), seccion || null)
            .input('genero', sql.VarChar(200), genero || null)
            .input('familia', sql.VarChar(200), familia || null)
            .input('linea', sql.VarChar(200), linea || null)
            .input('proveedor', sql.VarChar(200), proveedor || null)
            .input('marca', sql.VarChar(200), marca || null)
            .input('articulo', sql.VarChar(200), articulo || null)
            .input('porcentaje', sql.Float, porcentaje)
            .input('nivel', sql.Int, Nivel)
            .query(`UPDATE dbo.tbl_CoVenApp_ComisionesEspeciales 
                    SET seccion = @seccion, genero = @genero, familia = @familia,
                        linea = @linea, proveedor = @proveedor, marca = @marca,
                        articulo = @articulo, porcentaje = @porcentaje, Nivel = @nivel
                    WHERE idComision = @id`);
        if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'No encontrado' });
        res.json({ message: 'Indice actualizado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/indices/:id
router.delete('/:id', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .query('DELETE FROM dbo.tbl_CoVenApp_ComisionesEspeciales WHERE idComision = @id');
        res.json({ message: 'Indice eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
