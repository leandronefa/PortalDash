// Agente de monitoreo - corre en cada servidor monitoreado
// Verifica procesos locales y reporta al servidor central cada 5 minutos
// Dependencias: mssql (PassReset)

'use strict';

const http  = require('http');
const https = require('https');
const { execSync } = require('child_process');
const os     = require('os');
const crypto = require('crypto');

const CENTRAL_URL  = (process.env.CENTRAL_URL  || 'http://10.0.0.118:3002').replace(/\/$/, '');
const AGENT_TOKEN  = process.env.AGENT_TOKEN   || 'sucursal-agent-token';
const SERVER_ID    = process.env.SERVER_ID     || getLocalIP();
const INTERVAL_MS  = parseInt(process.env.INTERVAL_MS || '300000', 10); // 5 min
const PROCESSES    = (process.env.PROCESSES    || 'FileAppCliente.exe,DOAStatus.exe').split(',').map(s => s.trim());

const PASSRESET_ENABLED      = process.env.PASSRESET_ENABLED === 'true';
const sql    = PASSRESET_ENABLED ? require('mssql') : null;
const PASSRESET_SQL_SERVER   = process.env.PASSRESET_SQL_SERVER || '10.0.0.115';
const PASSRESET_SQL_DB       = process.env.PASSRESET_SQL_DB     || 'db_Cegid';
const PASSRESET_SQL_USER     = process.env.PASSRESET_SQL_USER   || 'sa';
const PASSRESET_SQL_PASSWORD = process.env.PASSRESET_SQL_PASSWORD || '';

// ---- PassReset: pool SQL ----
let prPool = null;
let passresetRunning = false;

async function getPassResetPool() {
  if (prPool && prPool.connected) return prPool;
  if (prPool) { try { await prPool.close(); } catch {} }
  prPool = new sql.ConnectionPool({
    server:   PASSRESET_SQL_SERVER,
    user:     PASSRESET_SQL_USER,
    password: PASSRESET_SQL_PASSWORD,
    database: PASSRESET_SQL_DB,
    options:  { trustServerCertificate: true, encrypt: false },
    pool:     { max: 3, min: 0, idleTimeoutMillis: 30000 },
  });
  await prPool.connect();
  return prPool;
}

function generatePassword() {
  const lower   = 'abcdefghijklmnopqrstuvwxyz';
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits  = '0123456789';
  const special = '@#$!';
  const all     = lower + upper + digits + special;

  const mandatory = [
    lower  [crypto.randomBytes(1)[0] % lower.length],
    upper  [crypto.randomBytes(1)[0] % upper.length],
    digits [crypto.randomBytes(1)[0] % digits.length],
    special[crypto.randomBytes(1)[0] % special.length],
  ];

  const rest = Array.from({ length: 8 }, () => all[crypto.randomBytes(1)[0] % all.length]);

  const chars = [...mandatory, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function getLocalIP() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
  } catch {}
  return os.hostname();
}

function isRunning(exeName) {
  try {
    const name = exeName.replace(/\.exe$/i, '');
    const out = execSync(`tasklist /FI "IMAGENAME eq ${name}.exe" /NH 2>nul`, { encoding: 'utf8', timeout: 5000 });
    return out.toLowerCase().includes(name.toLowerCase());
  } catch { return false; }
}

function getLocalUsers() {
  try {
    const out = execSync(
      'powershell -NoProfile -NonInteractive -Command "Get-LocalUser | Where-Object { $_.Enabled } | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"',
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      const out = execSync('net user 2>nul', { encoding: 'utf8', timeout: 5000 });
      return out
        .split('\n').slice(4).join(' ').split(/\s+/)
        .map(s => s.trim())
        .filter(s => s && s !== '---' && !s.includes('complet') && !s.includes('The command'));
    } catch { return []; }
  }
}

function getDiskInfo() {
  try {
    const out = execSync(
      'powershell -NoProfile -NonInteractive -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{N=\'Used\';E={$_.Used}},@{N=\'Free\';E={$_.Free}} | ConvertTo-Json -Compress"',
      { encoding: 'utf8', timeout: 8000 }
    ).trim();
    const drives = JSON.parse(out);
    const arr = Array.isArray(drives) ? drives : [drives];
    return arr
      .filter(d => d.Free !== null && d.Used !== null)
      .map(d => ({
        drive:     d.Name + ':',
        usedGB:    Math.round(d.Used  / 1073741824 * 10) / 10,
        freeGB:    Math.round(d.Free  / 1073741824 * 10) / 10,
        totalGB:   Math.round((d.Used + d.Free) / 1073741824 * 10) / 10,
        usedPct:   Math.round(d.Used / (d.Used + d.Free) * 1000) / 10,
      }));
  } catch { return []; }
}

// ---- CPU sampling ----
// Tomamos muestras de os.cpus() al inicio y al final del intervalo
// para calcular el uso promedio real durante el periodo
function cpuSample() {
  return os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
}

function cpuPercent(s1, s2) {
  let idleDiff = 0, totalDiff = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length); i++) {
    idleDiff  += s2[i].idle  - s1[i].idle;
    totalDiff += s2[i].total - s1[i].total;
  }
  if (totalDiff === 0) return 0;
  return Math.round((1 - idleDiff / totalDiff) * 1000) / 10; // un decimal
}

function ramPercent() {
  const total = os.totalmem();
  const free  = os.freemem();
  return Math.round((1 - free / total) * 1000) / 10;
}

// Muestra inicial al arrancar
let lastCpuSample = cpuSample();

// Actualizar muestra cada 60s para tener promedio continuo
setInterval(() => { lastCpuSample = cpuSample(); }, 60000);

function report() {
  const cpuNow = cpuSample();
  const cpu = cpuPercent(lastCpuSample, cpuNow);
  lastCpuSample = cpuNow; // reset para el próximo ciclo

  const ram = ramPercent();

  const processes = {};
  for (const p of PROCESSES) {
    const key = p.replace(/\.exe$/i, '');
    processes[key] = isRunning(p);
  }

  const users = getLocalUsers();
  const disk  = getDiskInfo();

  const payload = JSON.stringify({
    token: AGENT_TOKEN,
    id: SERVER_ID,
    ts: Date.now(),
    processes,
    users,
    cpu,
    ram,
    disk,
  });

  try {
    const url = new URL('/api/agent', CENTRAL_URL);
    const lib = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = lib.request(options, (res) => {
      const diskSummary = disk.map(d => `${d.drive} ${d.freeGB}GB libre`).join(' | ');
      console.log(`[${new Date().toISOString()}] Reported OK - HTTP ${res.statusCode} | CPU ${cpu}% RAM ${ram}% | ${diskSummary}`);
    });
    req.setTimeout(8000, () => { req.destroy(); console.error(`[${new Date().toISOString()}] Request timeout`); });
    req.on('error', (e) => console.error(`[${new Date().toISOString()}] Error: ${e.message}`));
    req.write(payload);
    req.end();
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Error building request: ${e.message}`);
  }
}

// ---- PassReset: registro de usuarios locales ----
async function passresetRegistrarUsuarios(db) {
  const localUsers = getLocalUsers();
  if (!localUsers.length) return;

  let ok = 0;
  for (const usuario of localUsers) {
    if (!/^[\w.\-]+$/.test(usuario)) continue;
    try {
      await db.request()
        .input('Servidor',       sql.NVarChar, SERVER_ID)
        .input('UsuarioWindows', sql.NVarChar, usuario)
        // Sin correo: SP no sobreescribe si ya tiene uno asignado
        .execute('sp_PassReset_AgentUpsertUsuario');
      ok++;
    } catch (e) {
      console.error(`[${new Date().toISOString()}] [passreset] Error registrando usuario ${usuario}: ${e.message}`);
    }
  }
  console.log(`[${new Date().toISOString()}] [passreset] Usuarios registrados/verificados: ${ok}/${localUsers.length}`);
}

// ---- PassReset: ciclo de cambio de contraseñas ----
async function passreset() {
  if (!PASSRESET_ENABLED) return;
  if (passresetRunning) {
    console.log(`[${new Date().toISOString()}] [passreset] Ciclo anterior en progreso, saltando`);
    return;
  }
  passresetRunning = true;
  try {
    let db;
    try {
      db = await getPassResetPool();
    } catch (e) {
      console.error(`[${new Date().toISOString()}] [passreset] Error conectando a SQL: ${e.message}`);
      prPool = null;
      return;
    }

    // Registrar usuarios locales (inserta nuevos, preserva correo de los existentes)
    await passresetRegistrarUsuarios(db);

    let pendientes;
    try {
      const result = await db.request()
        .input('Servidor', sql.NVarChar, SERVER_ID)
        .execute('sp_PassReset_AgentGetPendientes');
      pendientes = result.recordset;
    } catch (e) {
      console.error(`[${new Date().toISOString()}] [passreset] Error consultando pendientes: ${e.message}`);
      return;
    }

    if (!pendientes || pendientes.length === 0) {
      console.log(`[${new Date().toISOString()}] [passreset] Sin pendientes para ${SERVER_ID}`);
      return;
    }

    console.log(`[${new Date().toISOString()}] [passreset] ${pendientes.length} usuario(s) pendiente(s)`);

    for (const u of pendientes) {
      const { Id, UsuarioWindows, CorreoDestino, MaxDias } = u;

      if (!/^[\w.\-]+$/.test(UsuarioWindows)) {
        console.error(`[${new Date().toISOString()}] [passreset] Usuario inválido ignorado: ${UsuarioWindows}`);
        continue;
      }

      const password = generatePassword();
      const fechaProximoCambio = new Date(Date.now() + MaxDias * 86400000);

      let resultado    = 'OK';
      let mensajeError = null;

      try {
        execSync(`net user "${UsuarioWindows}" "${password}"`, { encoding: 'utf8', timeout: 10000 });
        console.log(`[${new Date().toISOString()}] [passreset] Contraseña cambiada: ${UsuarioWindows}`);
      } catch (e) {
        resultado    = 'ERROR';
        mensajeError = e.message.slice(0, 500);
        console.error(`[${new Date().toISOString()}] [passreset] Error net user ${UsuarioWindows}: ${mensajeError}`);
      }

      try {
        await db.request()
          .input('IdUsuario',          sql.Int,      Id)
          .input('Servidor',           sql.NVarChar, SERVER_ID)
          .input('UsuarioWindows',     sql.NVarChar, UsuarioWindows)
          .input('PasswordGenerada',   sql.NVarChar, password)
          .input('CorreoDestino',      sql.NVarChar, CorreoDestino)
          .input('Resultado',          sql.NVarChar, resultado)
          .input('MensajeError',       sql.NVarChar, mensajeError)
          .input('FechaProximoCambio', sql.DateTime, fechaProximoCambio)
          .input('Origen',             sql.NVarChar, 'AUTO')
          .execute('sp_PassReset_AgentReportarCambio');
      } catch (e) {
        console.error(`[${new Date().toISOString()}] [passreset] Error reportando cambio ${UsuarioWindows}: ${e.message}`);
      }
    }
  } finally {
    passresetRunning = false;
  }
}

console.log(`[${new Date().toISOString()}] Agente iniciado - SERVER_ID=${SERVER_ID} -> ${CENTRAL_URL} cada ${INTERVAL_MS / 1000}s`);
console.log(`[${new Date().toISOString()}] Monitoreando: ${PROCESSES.join(', ')}`);

report();
passreset().catch(e => console.error(`[${new Date().toISOString()}] [passreset] Unhandled: ${e.message}`));

setInterval(() => {
  report();
  passreset().catch(e => console.error(`[${new Date().toISOString()}] [passreset] Unhandled: ${e.message}`));
}, INTERVAL_MS);

