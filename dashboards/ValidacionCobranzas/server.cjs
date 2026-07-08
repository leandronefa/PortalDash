const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const multer     = require('multer');
const { execFile } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3007;

const PUBLIC_DIR   = path.join(__dirname, 'public');
const ARCHIVOS_DIR = path.join(__dirname, 'archivos');

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ── Períodos disponibles ──────────────────────────────────────────────────────
app.get('/api/periodos', (req, res) => {
  try {
    const archivos = fs.existsSync(PUBLIC_DIR)
      ? fs.readdirSync(PUBLIC_DIR).filter(f => /^data-\d{6}\.js$/.test(f))
      : [];
    const periodos = archivos
      .map(f => f.replace('data-', '').replace('.js', ''))
      .sort().reverse();
    res.json(periodos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Upload y procesamiento ────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const periodo = req.body.periodo || 'temp';
    const dir = path.join(ARCHIVOS_DIR, periodo);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => { cb(null, file.originalname); }
});
const upload = multer({ storage });

app.post('/api/procesar',
  upload.fields([
    { name: 'archivo1167',  maxCount: 1 },
    { name: 'archivo1400',  maxCount: 1 },
    { name: 'archivoMayor', maxCount: 1 }
  ]),
  (req, res) => {
    const periodo = (req.body.periodo || '').trim();
    if (!periodo || !/^\d{6}$/.test(periodo))
      return res.status(400).json({ error: 'Período inválido. Debe ser YYYYMM (ej: 202603).' });
    if (!req.files?.archivo1167)
      return res.status(400).json({ error: 'Falta el archivo 1167.' });
    if (!req.files?.archivo1400)
      return res.status(400).json({ error: 'Falta el archivo 1400.' });
    if (!req.files?.archivoMayor)
      return res.status(400).json({ error: 'Falta el Libro Mayor SAP.' });

    const dirPeriodo = path.join(ARCHIVOS_DIR, periodo);
    const fecha      = (req.body.fecha || '').trim();
    console.log(`[procesar] período ${periodo} — fecha: ${fecha || 'auto'} — dir: ${dirPeriodo}`);

    execFile(
      'node',
      [path.join(__dirname, 'generar.cjs'), periodo, dirPeriodo, fecha],
      { cwd: __dirname, timeout: 300000 },
      (err, stdout, stderr) => {
        if (err) {
          console.error('[procesar] ERROR:', stderr || err.message);
          return res.status(500).json({ error: stderr || err.message, stdout });
        }
        console.log('[procesar] OK:', stdout.slice(-300));
        res.json({ ok: true, periodo, log: stdout });
      }
    );
  }
);

// ── Recalcular período existente ──────────────────────────────────────────────
app.post('/api/recalcular/:periodo', (req, res) => {
  const periodo = req.params.periodo;
  if (!/^\d{6}$/.test(periodo)) return res.status(400).json({ error: 'Período inválido' });

  const dirPeriodo = path.join(ARCHIVOS_DIR, periodo);
  const args = fs.existsSync(dirPeriodo)
    ? [path.join(__dirname, 'generar.cjs'), periodo, dirPeriodo]
    : [path.join(__dirname, 'generar.cjs'), periodo];

  execFile('node', args, { cwd: __dirname, timeout: 300000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true, log: stdout });
  });
});

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log('Validación Cobranzas corriendo en http://' + HOST + ':' + PORT);
});
