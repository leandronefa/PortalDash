// Agente de monitoreo - corre en cada servidor monitoreado
// Verifica procesos locales y reporta al servidor central cada 5 minutos
// Sin dependencias externas - solo Node.js built-ins

'use strict';

const http  = require('http');
const https = require('https');
const { execSync } = require('child_process');
const os = require('os');

const CENTRAL_URL  = (process.env.CENTRAL_URL  || 'http://10.0.0.118:3002').replace(/\/$/, '');
const AGENT_TOKEN  = process.env.AGENT_TOKEN   || 'sucursal-agent-token';
const SERVER_ID    = process.env.SERVER_ID     || getLocalIP();
const INTERVAL_MS  = parseInt(process.env.INTERVAL_MS || '300000', 10); // 5 min
const PROCESSES    = (process.env.PROCESSES    || 'FileAppCliente.exe,DOAStatus.exe').split(',').map(s => s.trim());

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

console.log(`[${new Date().toISOString()}] Agente iniciado - SERVER_ID=${SERVER_ID} -> ${CENTRAL_URL} cada ${INTERVAL_MS / 1000}s`);
console.log(`[${new Date().toISOString()}] Monitoreando: ${PROCESSES.join(', ')}`);

report(); // reporte inmediato al arrancar
setInterval(report, INTERVAL_MS);

