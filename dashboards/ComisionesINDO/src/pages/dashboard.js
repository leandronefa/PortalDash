import { api } from '../api/client.js';

export async function renderDashboard(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px);overflow-y:auto">

      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <h2 style="font-size:20px;font-weight:700;margin:0">Dashboard — ${periodo}</h2>
      </div>

      <div id="estado-wrap" style="flex-shrink:0;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        ${['consumo','efectivo','ranking','calculo'].map(k => `
          <div class="card" style="padding:12px 16px">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted);margin-bottom:6px">${{
              consumo:'Datos consumo', efectivo:'Datos efectivo', ranking:'Ranking', calculo:'Último cálculo'
            }[k]}</div>
            <div id="est-${k}" style="font-size:13px">…</div>
          </div>
        `).join('')}
      </div>

      <div id="kpi-wrap" style="flex-shrink:0;display:grid;grid-template-columns:repeat(2,1fr);gap:16px"></div>

    </div>
  `;

  await cargarDatos(container, periodo);
}

async function cargarDatos(container, periodo) {
  const [consumoR, efectivoR, rankingR, ultimoR] = await Promise.allSettled([
    api.get(`/datos/consumo?periodo=${periodo}`),
    api.get(`/datos/efectivo?periodo=${periodo}`),
    api.get(`/ranking?periodo=${periodo}`),
    api.get(`/calculo/ultimo?periodo=${periodo}`),
  ]);

  const consumo  = consumoR.status  === 'fulfilled' ? consumoR.value  : [];
  const efectivo = efectivoR.status === 'fulfilled' ? efectivoR.value : [];
  const ranking  = rankingR.status  === 'fulfilled' ? rankingR.value  : [];
  const ultimo   = ultimoR.status   === 'fulfilled' ? ultimoR.value   : null;

  // ── Estado ────────────────────────────────────────────────────────────────
  const ok = `<span style="color:var(--color-success)">✔</span>`;
  const no = `<span style="color:var(--color-muted)">—</span>`;

  container.querySelector('#est-consumo').innerHTML = consumo.length
    ? `${ok} <strong>${consumo.length}</strong> sucursales`
    : `${no} <span style="color:var(--color-muted)">Sin datos</span>`;

  container.querySelector('#est-efectivo').innerHTML = efectivo.length
    ? `${ok} <strong>${efectivo.length}</strong> sucursales`
    : `${no} <span style="color:var(--color-muted)">Sin datos</span>`;

  if (ranking.length) {
    const cat = { A: 0, B: 0, C: 0 };
    ranking.forEach(r => r.categoria && (cat[r.categoria] = (cat[r.categoria] || 0) + 1));
    container.querySelector('#est-ranking').innerHTML =
      `${ok} <span class="badge badge-a">A:${cat.A}</span> <span class="badge badge-b">B:${cat.B}</span> <span class="badge badge-c">C:${cat.C}</span>`;
  } else {
    container.querySelector('#est-ranking').innerHTML = `${no} <span style="color:var(--color-muted)">Sin ranking</span>`;
  }

  if (ultimo) {
    const fecha = new Date(ultimo.fecha_calculo).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    container.querySelector('#est-calculo').innerHTML =
      `${ok} ${fecha}<br><span style="font-size:11px;color:var(--color-muted)">${ultimo.usuario}</span>`;
  } else {
    container.querySelector('#est-calculo').innerHTML = `${no} <span style="color:var(--color-muted)">Sin cálculo</span>`;
  }

  // ── KPIs del último cálculo ───────────────────────────────────────────────
  if (!ultimo?.resultado) {
    container.querySelector('#kpi-wrap').innerHTML = `
      <div class="card" style="grid-column:1/-1;padding:30px;text-align:center;color:var(--color-muted)">
        Sin cálculo para este período. Usá <strong>Ejecutar cálculo completo</strong> para generarlo.
      </div>`;
    return;
  }

  const sucursales  = ultimo.resultado.sucursales  || [];
  const cajeros     = ultimo.resultado.cajeros     || [];

  // Semáforo consumo
  const sem = { verde: 0, amarillo: 0, rojo: 0 };
  sucursales.forEach(s => s.semaforo_consumo && (sem[s.semaforo_consumo] = (sem[s.semaforo_consumo] || 0) + 1));

  // Escalón consumo
  const esc = { 3: 0, 2: 0, 1: 0, 0: 0 };
  sucursales.forEach(s => { const e = s.escalon_consumo ?? 0; esc[e] = (esc[e] || 0) + 1; });

  // Categoría ranking (de sucursales del resultado)
  const cat = { A: 0, B: 0, C: 0 };
  sucursales.forEach(s => s.categoria && (cat[s.categoria] = (cat[s.categoria] || 0) + 1));

  // Cajeros
  const cajComisionan   = cajeros.filter(c => c.comisiona).length;
  const cajNoComisionan = cajeros.filter(c => !c.comisiona).length;

  const total = sucursales.length;

  container.querySelector('#kpi-wrap').innerHTML = `

    <!-- Semáforo -->
    <div class="card" style="padding:18px 20px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted);margin-bottom:14px">
        Semáforo — ${total} sucursales
      </div>
      <div style="display:flex;gap:0;border-radius:8px;overflow:hidden;height:12px;margin-bottom:14px">
        ${sem.verde    ? `<div style="flex:${sem.verde};background:var(--color-success);title='Verde'"></div>`    : ''}
        ${sem.amarillo ? `<div style="flex:${sem.amarillo};background:#f59e0b"></div>` : ''}
        ${sem.rojo     ? `<div style="flex:${sem.rojo};background:var(--color-danger)"></div>`    : ''}
      </div>
      <div style="display:flex;gap:20px">
        <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--color-success);margin-right:5px"></span>
          <strong>${sem.verde}</strong> <span style="font-size:12px;color:var(--color-muted)">cumplen</span></div>
        <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b;margin-right:5px"></span>
          <strong>${sem.amarillo}</strong> <span style="font-size:12px;color:var(--color-muted)">marginal</span></div>
        <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--color-danger);margin-right:5px"></span>
          <strong>${sem.rojo}</strong> <span style="font-size:12px;color:var(--color-muted)">no cumplen</span></div>
      </div>
    </div>

    <!-- Escalones consumo -->
    <div class="card" style="padding:18px 20px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted);margin-bottom:14px">
        Escalones consumo — ${total} sucursales
      </div>
      <div style="display:flex;gap:12px;align-items:flex-end">
        ${[3,2,1,0].map(e => {
          const n = esc[e] || 0;
          const pct = total ? Math.round(n / total * 100) : 0;
          const colors = { 3:'var(--badge-a-bg,#16a34a)', 2:'var(--badge-b-bg,#ca8a04)', 1:'var(--badge-d-bg,#2563eb)', 0:'var(--color-border)' };
          const labels = { 3:'E3', 2:'E2', 1:'E1', 0:'E0' };
          return `
            <div style="flex:1;text-align:center">
              <div style="font-size:22px;font-weight:800;color:${colors[e]}">${n}</div>
              <div style="font-size:11px;color:var(--color-muted)">${labels[e]}</div>
              <div style="margin-top:4px;height:4px;border-radius:2px;background:${colors[e]};opacity:.6;width:${pct}%;min-width:${n?'8%':'0'};margin-inline:auto"></div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Categorías ranking -->
    <div class="card" style="padding:18px 20px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted);margin-bottom:14px">
        Categorías ranking — ${total} sucursales
      </div>
      <div style="display:flex;gap:0;border-radius:8px;overflow:hidden;height:12px;margin-bottom:14px">
        ${cat.A ? `<div style="flex:${cat.A};background:#16a34a"></div>` : ''}
        ${cat.B ? `<div style="flex:${cat.B};background:#ca8a04"></div>` : ''}
        ${cat.C ? `<div style="flex:${cat.C};background:#dc2626"></div>` : ''}
      </div>
      <div style="display:flex;gap:20px">
        <div><span class="badge badge-a">A</span> <strong style="margin-left:4px">${cat.A}</strong></div>
        <div><span class="badge badge-b">B</span> <strong style="margin-left:4px">${cat.B}</strong></div>
        <div><span class="badge badge-c">C</span> <strong style="margin-left:4px">${cat.C}</strong></div>
      </div>
    </div>

    <!-- Cajeros -->
    <div class="card" style="padding:18px 20px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted);margin-bottom:14px">
        Cajeros — ${cajeros.length} total
      </div>
      <div style="display:flex;gap:0;border-radius:8px;overflow:hidden;height:12px;margin-bottom:14px">
        ${cajComisionan   ? `<div style="flex:${cajComisionan};background:var(--color-success)"></div>` : ''}
        ${cajNoComisionan ? `<div style="flex:${cajNoComisionan};background:var(--color-danger)"></div>` : ''}
      </div>
      <div style="display:flex;gap:24px">
        <div>
          <div style="font-size:28px;font-weight:800;color:var(--color-success)">${cajComisionan}</div>
          <div style="font-size:12px;color:var(--color-muted)">comisionan</div>
        </div>
        <div>
          <div style="font-size:28px;font-weight:800;color:var(--color-danger)">${cajNoComisionan}</div>
          <div style="font-size:12px;color:var(--color-muted)">no comisionan</div>
        </div>
      </div>
    </div>

  `;
}
