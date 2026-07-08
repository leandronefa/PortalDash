const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const { execFile } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3006;

const MAPEO_PATH  = path.join(__dirname, 'mapeo.json');
const PUBLIC_DIR  = path.join(__dirname, 'public');
const ARCHIVOS_DIR = path.join(__dirname, 'archivos');

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// -----------------------------------------------
// Mapeo
// -----------------------------------------------
app.get('/api/mapeo', (req, res) => {
  try {
    res.json(fs.existsSync(MAPEO_PATH) ? JSON.parse(fs.readFileSync(MAPEO_PATH, 'utf8')) : {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mapeo', (req, res) => {
  try {
    fs.writeFileSync(MAPEO_PATH, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------
// Períodos disponibles
// -----------------------------------------------
app.get('/api/periodos', (req, res) => {
  try {
    const archivos = fs.readdirSync(PUBLIC_DIR).filter(f => /^data-\d{6}\.js$/.test(f));
    const periodos = archivos
      .map(f => f.replace('data-', '').replace('.js', ''))
      .sort().reverse();
    res.json(periodos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------
// Upload y procesamiento de un período
// -----------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const periodo = req.body.periodo || 'temp';
    const dir = path.join(ARCHIVOS_DIR, periodo);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Conservar nombre original del archivo
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

app.post('/api/procesar',
  upload.fields([{ name: 'archivo1400', maxCount: 1 }, { name: 'archivoMayor', maxCount: 1 }]),
  (req, res) => {
    const periodo = (req.body.periodo || '').trim();
    if (!periodo || !/^\d{6}$/.test(periodo)) {
      return res.status(400).json({ error: 'Período inválido. Debe ser YYYYMM (ej: 202507).' });
    }
    if (!req.files?.archivo1400 || !req.files?.archivoMayor) {
      return res.status(400).json({ error: 'Faltan archivos: se requieren archivo1400 y archivoMayor.' });
    }

    const dirPeriodo = path.join(ARCHIVOS_DIR, periodo);
    console.log(`[procesar] período ${periodo} — dir: ${dirPeriodo}`);

    execFile(
      'node',
      [path.join(__dirname, 'generar.cjs'), periodo, dirPeriodo],
      { cwd: __dirname, timeout: 180000 },
      (err, stdout, stderr) => {
        if (err) {
          console.error('[procesar] ERROR:', stderr || err.message);
          return res.status(500).json({ error: stderr || err.message, stdout });
        }
        console.log('[procesar] OK:', stdout.slice(-200));
        res.json({ ok: true, periodo, log: stdout });
      }
    );
  }
);

// -----------------------------------------------
// Recalcular un período ya cargado
// -----------------------------------------------
app.post('/api/recalcular/:periodo', (req, res) => {
  const periodo = req.params.periodo;
  if (!/^\d{6}$/.test(periodo)) return res.status(400).json({ error: 'Período inválido' });

  const dirPeriodo = path.join(ARCHIVOS_DIR, periodo);
  const args = fs.existsSync(dirPeriodo)
    ? [path.join(__dirname, 'generar.cjs'), periodo, dirPeriodo]
    : [path.join(__dirname, 'generar.cjs'), periodo];

  console.log(`[recalcular] ${periodo} — dir: ${fs.existsSync(dirPeriodo) ? dirPeriodo : __dirname}`);
  execFile('node', args, { cwd: __dirname, timeout: 180000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[recalcular] ERROR:', stderr || err.message);
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ ok: true, log: stdout });
  });
});

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log('Conciliacion Punitorios corriendo en http://' + HOST + ':' + PORT);
});
