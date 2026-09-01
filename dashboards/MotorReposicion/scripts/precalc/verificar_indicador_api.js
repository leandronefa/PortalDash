// scripts/precalc/verificar_indicador_api.js
// Step 3 del brief de Task 6: verifica el indicador principal (el 0,4% original)
// consultando la API real de la app (server.js debe estar corriendo en :3050).
// Usa fetch nativo de Node en vez de curl + archivo temporal.

async function main() {
  const res = await fetch('http://localhost:3050/api/tablero/quiebre');
  if (!res.ok) {
    throw new Error(`API respondio ${res.status}`);
  }
  const d = await res.json();
  const cols = d.detalleColumnas;
  const idx = k => cols.indexOf(k);
  const rows = d.detalle.filter(r => r[idx('estado')] === 'QUIEBRE');
  const conDias = rows.filter(r => (r[idx('diasQuiebrePeriodo')] || 0) > 0);
  const pct = (conDias.length / rows.length * 100).toFixed(1);
  console.log('Filas QUIEBRE:', rows.length, '| con diasQuiebrePeriodo>0:', conDias.length, '| porcentaje:', pct + '%');
  console.log('  (antes del cambio: 228 de 56.135 = 0,4% -- deberia subir claramente por encima de eso)');
}
main().catch(e => { console.error(e); process.exit(1); });
