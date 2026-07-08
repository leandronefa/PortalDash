const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Servir frontend estático
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/reglas', require('./routes/reglas'));
app.use('/api/indices', require('./routes/indices'));
app.use('/api/comisiones', require('./routes/comisiones'));
app.use('/api/licencias', require('./routes/licencias'));
app.use('/api/escalas', require('./routes/escalas'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
    console.log(`\n  Comisiones Admin Panel`);
    console.log(`  =====================`);
    console.log(`  Server running at http://localhost:${PORT}`);
    console.log(`  API:     http://localhost:${PORT}/api/`);
    console.log(`  Admin:   http://localhost:${PORT}\n`);
});
