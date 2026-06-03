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

// ---- Agent-based server monitoring ----
interface DiskDrive {
  drive: string;
  usedGB: number;
  freeGB: number;
  totalGB: number;
  usedPct: number;
}

interface AgentReport {
  id: string;
  ts: number;
  processes: Record<string, boolean>;
  users: string[];
  cpu: number;
  ram: number;
  disk: DiskDrive[];
}

const AGENT_TOKEN    = process.env.AGENT_TOKEN ?? 'sucursal-agent-token';
const AGENT_TIMEOUT  = 10 * 60 * 1000; // 10 min sin señal = offline

const agentReports = new Map<string, AgentReport>();

// Recibe reporte del agente instalado en cada servidor
app.post('/api/agent', (req, res) => {
  const { token, id, ts, processes, users, cpu, ram, disk } = req.body ?? {};
  if (!token || token !== AGENT_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  if (!id || !processes) return res.status(400).json({ error: 'Bad payload' });
  agentReports.set(String(id), {
    id: String(id),
    ts: Number(ts) || Date.now(),
    processes,
    users: Array.isArray(users) ? users : [],
    cpu: typeof cpu === 'number' ? cpu : 0,
    ram: typeof ram === 'number' ? ram : 0,
    disk: Array.isArray(disk) ? disk : [],
  });
  const diskSummary = Array.isArray(disk) ? disk.map((d: DiskDrive) => `${d.drive} ${d.freeGB}GB libre`).join(' | ') : '';
  console.log(`[agent] ${id} reportó: CPU ${cpu}% RAM ${ram}% | ${diskSummary} | procesos: ${JSON.stringify(processes)}`);
  res.json({ ok: true });
});

// Devuelve el estado de todos los servidores conocidos
app.get('/api/servers', (_req, res) => {
  const knownServers = (process.env.REMOTE_SERVERS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const now = Date.now();
  const data: Record<string, { online: boolean; FileAppCliente: boolean; DOAStatus: boolean; lastSeen: number | null; users: string[]; cpu: number; ram: number; disk: DiskDrive[] }> = {};

  for (const id of knownServers) {
    const report = agentReports.get(id);
    const online = !!report && (now - report.ts) < AGENT_TIMEOUT;
    data[id] = {
      online,
      FileAppCliente: online ? !!(report!.processes['FileAppCliente'] ?? report!.processes['FileAppCliente.exe']) : false,
      DOAStatus:      online ? !!(report!.processes['DOAStatus']      ?? report!.processes['DOAStatus.exe'])      : false,
      lastSeen:       report ? report.ts : null,
      users:          report ? report.users : [],
      cpu:            online ? report!.cpu : 0,
      ram:            online ? report!.ram : 0,
      disk:           online ? report!.disk : [],
    };
  }

  res.json({ data, cachedAt: now, error: '' });
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
