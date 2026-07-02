import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const TABLAS = {
  base:        'dbo.tbl_CoVenAppINDO_Montos',
  vendedor:    'dbo.tbl_CoVenAppINDO_MontosVendedor',
  supervisor:  'dbo.tbl_CoVenAppINDO_MontosSupervisor',
  prestamos:   'dbo.tbl_CoVenAppINDO_MontosPrestamos',
  cajero:      'dbo.tbl_CoVenAppINDO_MontosCajero'
};

// GET /api/montos/:tipo?categoria=C
router.get('/:tipo', async (req, res) => {
  const tabla = TABLAS[req.params.tipo];
  if (!tabla) return res.status(404).json({ error: 'Tipo inválido' });
  const { categoria } = req.query;
  try {
    const pool = await getPool();
    const q = pool.request();
    let where = '';
    if (categoria) { q.input('cat', sql.Char, categoria); where = 'WHERE categoria_suc = @cat'; }
    const r = await q.query(`SELECT * FROM ${tabla} ${where} ORDER BY id`);
    res.json(r.recordset);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor' }); }
});

// Campos numéricos editables por tipo (los que se guardan en UPDATE)
const NUMERIC_FIELDS = {
  base:        ['participacion', 'escalon_monto', 'subtotal', 'ticket_promedio', 'operacion', 'total'],
  supervisor:  ['monto', 'factor_plaza'],
  prestamos:   ['monto'],
  vendedor:    ['monto'],
  cajero:      ['monto'],
};

// Campos clave para encontrar filas equivalentes en otras categorías (cascade)
// Vacío = sin cascade
const KEY_FIELDS = {
  base:       ['seccion', 'escalon'],
  supervisor: ['concepto', 'tipo'],
  prestamos:  ['escalon', 'tipo'],
  vendedor:   [],   // sin cascade
  cajero:     [],   // sin cascade
};

function roundTo1000(v) { return Math.round(v / 1000) * 1000; } // cascade helper

// PUT /api/montos/vendedor-pivot/:escalon — guarda monto C de FULL y PART, cascadea B y A con multiplicadores
router.put('/vendedor-pivot/:escalon', async (req, res) => {
  const tabla   = TABLAS.vendedor;
  const escalon = parseInt(req.params.escalon, 10);
  const { monto_full, monto_part } = req.body;
  if (!Number.isInteger(escalon)) return res.status(400).json({ error: 'Escalón inválido' });
  try {
    const pool = await getPool();

    const multR = await pool.request()
      .query(`SELECT categoria, multiplicador FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador WHERE categoria IN ('A','B')`);
    const mults = { B: 1.15, A: 1.30 };
    multR.recordset.forEach(m => { mults[m.categoria] = parseFloat(m.multiplicador); });

    const fullC = parseFloat(monto_full) || 0;
    const partC = parseFloat(monto_part) || 0;

    // Guardar categoría C (valor base ingresado)
    await pool.request()
      .input('monto', sql.Decimal(18, 4), fullC).input('esc', sql.Int, escalon)
      .query(`UPDATE ${tabla} SET monto = @monto WHERE escalon = @esc AND tipo_vendedor = 'FULL' AND categoria_suc = 'C'`);
    await pool.request()
      .input('monto', sql.Decimal(18, 4), partC).input('esc', sql.Int, escalon)
      .query(`UPDATE ${tabla} SET monto = @monto WHERE escalon = @esc AND tipo_vendedor = 'PART' AND categoria_suc = 'C'`);

    // Cascade B y A con multiplicadores
    for (const cat of ['B', 'A']) {
      const factor = mults[cat] ?? 1;
      await pool.request()
        .input('monto', sql.Decimal(18, 4), roundTo1000(fullC * factor))
        .input('esc', sql.Int, escalon).input('cat', sql.Char(1), cat)
        .query(`UPDATE ${tabla} SET monto = @monto WHERE escalon = @esc AND tipo_vendedor = 'FULL' AND categoria_suc = @cat`);
      await pool.request()
        .input('monto', sql.Decimal(18, 4), roundTo1000(partC * factor))
        .input('esc', sql.Int, escalon).input('cat', sql.Char(1), cat)
        .query(`UPDATE ${tabla} SET monto = @monto WHERE escalon = @esc AND tipo_vendedor = 'PART' AND categoria_suc = @cat`);
    }

    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// PUT /api/montos/:tipo/:id  — actualizar un registro y cascadear a B y A
router.put('/:tipo/:id', async (req, res) => {
  const tipo  = req.params.tipo;
  const tabla = TABLAS[tipo];
  if (!tabla) return res.status(404).json({ error: 'Tipo inválido' });

  const d           = req.body;
  const numFields   = NUMERIC_FIELDS[tipo] || [];
  const keyFields   = KEY_FIELDS[tipo]     || [];

  try {
    const pool = await getPool();

    // ── 1. Actualizar fila C ──────────────────────────────────────
    const qUpd = pool.request().input('id', sql.Int, req.params.id);
    const sets = [];
    for (const f of numFields) {
      if (f in d) {
        qUpd.input(f, sql.Decimal(18, 4), parseFloat(d[f]) || 0);
        sets.push(`${f} = @${f}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Sin campos numéricos' });
    await qUpd.query(`UPDATE ${tabla} SET ${sets.join(', ')} WHERE id = @id`);

    // ── 2. Cascade a B y A (solo si hay campos numéricos y claves) ─
    if (numFields.length && keyFields.length && d.categoria_suc === 'C') {
      // Los campos clave (ej. seccion/escalon) se leen de la fila recién actualizada
      // en la DB — no del body, que no siempre los incluye (ej. tabs ENC_MILLON/Encargados
      // solo mandan los montos), y eso hacía que el WHERE del cascade no matcheara
      // ninguna fila de B/A y quedaran con el valor viejo.
      const keyRowR = await pool.request()
        .input('id', sql.Int, req.params.id)
        .query(`SELECT ${keyFields.join(', ')} FROM ${tabla} WHERE id = @id`);
      const keyRow = keyRowR.recordset[0];
      if (!keyRow) return res.status(404).json({ error: 'Registro no encontrado' });

      const multR = await pool.request()
        .query(`SELECT categoria, multiplicador FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador WHERE categoria IN ('A','B')`);
      const mults = {};
      multR.recordset.forEach(m => { mults[m.categoria] = parseFloat(m.multiplicador); });

      for (const cat of ['B', 'A']) {
        const factor = mults[cat] ?? 1;
        const qCat = pool.request()
          .input('cat', sql.Char(1), cat);

        // Construir WHERE por campos clave (valores reales de la fila C en DB)
        const whereKey = keyFields.map((kf, i) => {
          qCat.input(`kf${i}`, keyRow[kf]);
          return `${kf} = @kf${i}`;
        }).join(' AND ');

        const catSets = [];
        for (const f of numFields) {
          if (f in d) {
            const val = roundTo1000((parseFloat(d[f]) || 0) * factor);
            qCat.input(`cf_${f}`, sql.Decimal(18, 4), val);
            catSets.push(`${f} = @cf_${f}`);
          }
        }

        await qCat.query(
          `UPDATE ${tabla} SET ${catSets.join(', ')} WHERE categoria_suc = @cat AND ${whereKey}`
        );
      }
    }

    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

export default router;
