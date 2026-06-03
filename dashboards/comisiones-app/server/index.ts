import express from 'express';
import sql from 'mssql';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const IS_PROD = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbConfig: sql.config = {
  server: process.env.DB_SERVER ?? '10.0.0.115',
  user: process.env.DB_USER ?? 'sa',
  password: process.env.DB_PASSWORD ?? 'MicroS123',
  database: process.env.DB_NAME ?? 'TABLEROS',
  options: {
    trustServerCertificate: true,
    encrypt: false,
  },
};

let pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = await sql.connect(dbConfig);
  }
  return pool;
}

const LAYOUT_FILE = path.resolve(__dirname, '../layout-state.json');

app.use(express.json({ limit: '2mb' }));

// Layout persistence endpoints
app.get('/api/layout', (_req, res) => {
  try {
    if (fs.existsSync(LAYOUT_FILE)) {
      res.json(JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf-8')));
    } else {
      res.json({});
    }
  } catch {
    res.json({});
  }
});

app.post('/api/layout', (req, res) => {
  try {
    fs.writeFileSync(LAYOUT_FILE, JSON.stringify(req.body), 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save layout' });
  }
});

app.get('/api/data', async (_req, res) => {
  try {
    const db = await getPool();
    const result = await db.request().query('SELECT Sucursal, NombreApellido, Usuario FROM EncargadosSucursal');
    const rows = result.recordset.map((row: Record<string, unknown>) => ({
      sucursal: String(row['Sucursal'] ?? '').trim(),
      nombreApellido: String(row['NombreApellido'] ?? '').trim(),
      usuario: String(row['Usuario'] ?? '').trim(),
    }));
    res.json(rows);
  } catch (err) {
    console.error('DB Error:', err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// En producción servir el build de Vite como archivos estáticos
if (IS_PROD) {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT} [${IS_PROD ? 'production' : 'development'}]`);
});
