// scripts/precalc/medir_tiempos_quiebre.js
// Uso: node scripts/precalc/medir_tiempos_quiebre.js antes|despues
// Mide el tiempo real de /api/tablero/quiebre (servidor local, puerto 3050) para 3 combinaciones
// de fecha que NO son el combo default (para forzar cache-miss real en cacheQuiebre y medir el
// camino completo contra SQL Server, no una respuesta ya cacheada). Requiere el servidor corriendo
// (`npm start`).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTO = process.env.PORT || 3050;
const ARCHIVO_RESULTADOS = path.join(__dirname, '_resultados_medicion_indices.json');

// 3 combinaciones reales distintas, elegidas para no pisar el combo default (ultimos 90/365 dias) --
// asi cada corrida es garantizado un cache-miss real, no una que ya quedo tibia de una corrida previa.
const COMBOS = [
  { desde: '2025-11-01', hasta: '2026-01-31', ucDesde: '2025-01-01', ucHasta: '2025-12-31' },
  { desde: '2025-06-01', hasta: '2025-08-31', ucDesde: '2024-06-01', ucHasta: '2025-05-31' },
  { desde: '2026-02-01', hasta: '2026-04-30', ucDesde: '2025-04-01', ucHasta: '2026-03-31' },
];

function pedir(params) {
  const qs = new URLSearchParams({ ...params, riesgoDias: '3' }).toString();
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    http.get(`http://127.0.0.1:${PUERTO}/api/tablero/quiebre?${qs}`, (res) => {
      res.on('data', () => {}); // descartamos el body, solo nos importa el tiempo total
      res.on('end', () => resolve({ ms: Date.now() - inicio, status: res.statusCode }));
    }).on('error', reject);
  });
}

async function main() {
  const etiqueta = process.argv[2];
  if (etiqueta !== 'antes' && etiqueta !== 'despues') {
    throw new Error('Uso: node scripts/precalc/medir_tiempos_quiebre.js antes|despues');
  }
  const resultados = [];
  for (const combo of COMBOS) {
    const r = await pedir(combo);
    console.log(`${JSON.stringify(combo)} -> ${r.ms}ms (status ${r.status})`);
    resultados.push({ etiqueta, combo, ms: r.ms, timestamp: new Date().toISOString() });
  }
  const previos = fs.existsSync(ARCHIVO_RESULTADOS) ? JSON.parse(fs.readFileSync(ARCHIVO_RESULTADOS, 'utf8')) : [];
  fs.writeFileSync(ARCHIVO_RESULTADOS, JSON.stringify([...previos, ...resultados], null, 2));
  console.log(`Guardado en ${ARCHIVO_RESULTADOS}`);
}
main().catch(e => { console.error(e); process.exit(1); });
