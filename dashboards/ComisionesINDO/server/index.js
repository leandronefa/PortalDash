import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import authRoutes from './routes/auth.js';
import datosRoutes from './routes/datos.js';
import montosRoutes from './routes/montos.js';
import rankingRoutes from './routes/ranking.js';
import objetivosRoutes from './routes/objetivos.js';
import sucursalesRoutes from './routes/sucursales.js';
import calculoRoutes from './routes/calculo.js';
import millonRoutes from './routes/millon.js';
import supervisoresRoutes from './routes/supervisores.js';
import cajerosRoutes from './routes/cajeros.js';
import operadoresRoutes from './routes/operadores.js';
import manualRoutes from './routes/manual.js';
import vendedoresRoutes from './routes/vendedores.js';
import { getPool } from './config/db.js';
import { backfillMontosHistorial } from './services/montosHistorial.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth',        authRoutes);
app.use('/api/datos',       datosRoutes);
app.use('/api/montos',      montosRoutes);
app.use('/api/ranking',     rankingRoutes);
app.use('/api/objetivos',   objetivosRoutes);
app.use('/api/sucursales',  sucursalesRoutes);
app.use('/api/calculo',     calculoRoutes);
app.use('/api/millon',      millonRoutes);
app.use('/api/supervisores',supervisoresRoutes);
app.use('/api/cajeros',      cajerosRoutes);
app.use('/api/operadores',   operadoresRoutes);
app.use('/api/manual',       manualRoutes);
app.use('/api/vendedores',   vendedoresRoutes);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Servir frontend compilado (producción)
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const PORT = process.env.PORT || 3011;
// Solo loopback: los usuarios entran por el proxy del portal (puerto 80).
// Puerto 3011 (no 3005): el conector de QlikView ocupa 127.0.0.1:3005.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`[ComisionesINDO] ${HOST}:${PORT}`));

// Fire-and-forget: no bloquea el arranque del servidor.
getPool()
  .then(pool => backfillMontosHistorial(pool))
  .then(n => { if (n) console.log(`[MontosHistorial] backfill: ${n} período(s) revisado(s)`); })
  .catch(err => console.error('[MontosHistorial backfill]', err));
