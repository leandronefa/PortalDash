import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

const TABS = [
  { key: 'cajero',      label: 'Cajeros',                  endpoint: '/montos/cajero',     type: 'cajero' },
  { key: 'oper-con',    label: 'Operadores CON Efectivo',  seccion: 'OPER_CON_EFECT',      type: 'base', withCats: true },
  { key: 'oper-sin',    label: 'Operadores SIN Efectivo',  seccion: 'OPER_SIN_EFECT',      type: 'base', withCats: true },
  { key: 'encargado',   label: 'Encargados',               type: 'encargados-merged' },
  { key: 'enc-millon',  label: 'Encargados Millón',        seccion: 'ENC_MILLON',          type: 'base' },
  { key: 'supervisor',  label: 'Supervisores',             endpoint: '/montos/supervisor', type: 'supervisor' },
  { key: 'prestamos',   label: 'Préstamos',               endpoint: '/montos/prestamos',  type: 'prestamos' },
];

function fmt(v) {
  if (v == null || v === '') return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function round1000(v) { return Math.round(v / 1000) * 1000; }

// Parsea un string con separadores de miles (. en es-AR) a número
function parseNum(s) {
  return parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0;
}

function inputNum(val, cls, extra = '') {
  const display = (val != null && val !== '' && !isNaN(val))
    ? Number(val).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : '0';
  return `<input type="text" inputmode="numeric" class="${cls} inp-miles" value="${display}" ${extra}
    style="width:90px;padding:3px 6px;border:1px solid var(--color-border);border-radius:4px;
           background:var(--color-input);color:var(--color-text);font-size:12px;text-align:center">`;
}

function saveBtn(dataAttrs = '') {
  return `<button class="btn-save btn" ${dataAttrs}
    style="font-size:12px;padding:3px 10px">💾</button>`;
}

const NOTE = `<div style="font-size:11px;color:var(--color-muted);padding:8px 12px 4px">
  ✏️ Editá los valores de <strong>Categoría C</strong> — B y A se calculan automáticamente.
</div>`;

export async function renderVisorMontos(container) {
  container.innerHTML = `
    <style>
      #montos-wrap table th,
      #montos-wrap table td { text-align:center; }
      #montos-wrap table td input { margin:0 auto; display:block; }
      .tab-btn {
        padding:8px 14px;font-size:13px;font-weight:600;
        border:none;border-radius:6px 6px 0 0;cursor:pointer;
        background:var(--color-card);color:var(--color-text);
        border-bottom:3px solid transparent;transition:background 120ms,color 120ms;
      }
      .tab-btn.active {
        background:var(--color-primary);color:#fff;
        border-bottom:3px solid var(--color-primary);
      }
    </style>
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">💰 Montos</h2>
    <div style="display:flex;gap:4px;margin-bottom:0;border-bottom:2px solid var(--color-border);flex-wrap:wrap">
      ${TABS.map((t, i) => `
        <button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>
      `).join('')}
    </div>
    <div id="montos-wrap" style="margin-top:0">
      <p style="color:var(--color-muted);text-align:center;padding:40px">Cargando…</p>
    </div>
  `;

  let baseData = null;
  let mults = { A: 1.30, B: 1.15, C: 1.00 };
  const cache = {};
  let activeTab = TABS[0].key;

  // Cargar multiplicadores una sola vez
  try {
    const raw = await api.get('/ranking/multiplicadores');
    for (const r of (Array.isArray(raw) ? raw : [])) mults[r.categoria] = parseFloat(r.multiplicador);
  } catch { /* usa defaults */ }

  // ─── Tab switching ────────────────────────────────────────────────
  function switchTab(key) {
    activeTab = key;
    container.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === key);
    });
    loadTab(key);
  }

  async function loadTab(key, reload = false) {
    const wrap = container.querySelector('#montos-wrap');
    const tab  = TABS.find(t => t.key === key);
    if (!tab) return;

    if (tab.type === 'base') {
      if (!baseData || reload) {
        wrap.innerHTML = '<p style="color:var(--color-muted);text-align:center;padding:30px">Cargando…</p>';
        try {
          const raw = await api.get('/montos/base');
          baseData = Array.isArray(raw) ? raw : [];
        } catch (err) { showToast(err.message, 'error'); return; }
      }
      renderBase(wrap, baseData.filter(r => r.seccion === tab.seccion), tab);
      return;
    }

    if (tab.type === 'encargados-merged') {
      if (!baseData || reload) {
        wrap.innerHTML = '<p style="color:var(--color-muted);text-align:center;padding:30px">Cargando…</p>';
        try {
          const raw = await api.get('/montos/base');
          baseData = Array.isArray(raw) ? raw : [];
        } catch (err) { showToast(err.message, 'error'); return; }
      }
      renderEncargadosMerged(wrap, baseData.filter(r => r.seccion === 'ENCARGADO'));
      return;
    }

    if (cache[key] && !reload) { renderByType(wrap, tab, cache[key]); return; }
    wrap.innerHTML = '<p style="color:var(--color-muted);text-align:center;padding:30px">Cargando…</p>';
    try {
      const raw = await api.get(tab.endpoint);
      cache[key] = Array.isArray(raw) ? raw : [];
      renderByType(wrap, tab, cache[key]);
    } catch (err) { showToast(err.message, 'error'); }
  }

  // ─── BASE (4 secciones) ───────────────────────────────────────────
  function renderBase(wrap, rows, tab) {
    // Agrupar por escalón y categoría
    const byEsc = {};
    for (const r of rows) {
      if (!byEsc[r.escalon]) byEsc[r.escalon] = {};
      byEsc[r.escalon][r.categoria_suc] = r;
    }
    const escalones = Object.keys(byEsc).sort((a, b) => Number(a) - Number(b));

    if (tab.withCats) {
      // ── Sub-solapas C / B / A ──────────────────────────────────────
      const CATS = ['C', 'B', 'A'];
      const catLabels = { C: 'Categoría C', B: 'Categoría B', A: 'Categoría A' };
      let activeCat = 'C';

      function catTabsHtml(active) {
        return CATS.map(cat => `
          <button class="cat-tab-btn" data-cat="${cat}"
            style="padding:6px 16px;font-size:12px;font-weight:600;border:none;border-radius:4px 4px 0 0;cursor:pointer;
                   background:${cat === active ? 'var(--color-surface,#fff)' : 'var(--color-card)'};
                   color:${cat === active ? 'var(--color-primary)' : 'var(--color-muted)'};
                   border-bottom:${cat === active ? '2px solid var(--color-primary)' : '2px solid transparent'};
                   margin-right:2px">
            ${catLabels[cat]}
          </button>`).join('');
      }

      function renderCatTable(cat) {
        const mult    = mults[cat] ?? 1.0;
        const editable = cat === 'C';

        const trs = escalones.map(esc => {
          const rowC = byEsc[esc]['C'] || {};
          const rowX = byEsc[esc][cat] || {};
          // Valores: si cat=C usar directo; si B/A calcular desde C
          const val = f => {
            if (editable) return rowX[f] ?? 0;
            return rowX[f] != null ? rowX[f] : round1000((rowC[f] || 0) * mult);
          };

          if (editable) {
            return `<tr data-id="${rowX.id || ''}">
              <td style="font-weight:700">${esc}</td>
              <td>${inputNum(val('participacion'),  'inp-particip')}</td>
              <td>${inputNum(val('escalon_monto'),  'inp-escmonto')}</td>
              <td>${inputNum(val('ticket_promedio'), 'inp-ticket')}</td>
              <td>${inputNum(val('operacion'),       'inp-operacion')}</td>
              <td>${saveBtn()}</td>
            </tr>`;
          } else {
            return `<tr>
              <td style="font-weight:700">${esc}</td>
              <td style="">${fmt(val('participacion'))}</td>
              <td style="">${fmt(val('escalon_monto'))}</td>
              <td style="">${fmt(val('ticket_promedio'))}</td>
              <td style="">${fmt(val('operacion'))}</td>
            </tr>`;
          }
        }).join('');

        const saveTh = editable ? '<th></th>' : '';
        return `
          <div class="table-wrap"><table>
            <thead><tr>
              <th>Escalón</th>
              <th>Participación</th><th>Esc.Monto</th>
              <th>Ticket Prom.</th><th>Operación</th>${saveTh}
            </tr></thead>
            <tbody>${trs}</tbody>
          </table></div>`;
      }

      function mountCatHandlers() {
        // Sub-tab switching
        wrap.querySelectorAll('.cat-tab-btn').forEach(b => {
          b.addEventListener('click', () => {
            activeCat = b.dataset.cat;
            wrap.querySelectorAll('.cat-tab-btn').forEach(x => {
              const on = x.dataset.cat === activeCat;
              x.style.background   = on ? 'var(--color-surface,#fff)' : 'var(--color-card)';
              x.style.color        = on ? 'var(--color-primary)' : 'var(--color-muted)';
              x.style.borderBottom = on ? '2px solid var(--color-primary)' : '2px solid transparent';
            });
            wrap.querySelector('#cat-content').innerHTML = renderCatTable(activeCat);
            if (activeCat === 'C') mountSaveHandlers();
          });
        });
        mountSaveHandlers();
      }

      function mountSaveHandlers() {
        wrap.querySelectorAll('.btn-save').forEach(btn => {
          btn.addEventListener('click', async () => {
            const row = btn.closest('tr');
            const id  = row.dataset.id;
            if (!id) return;
            const body = {
              categoria_suc:   'C',
              participacion:   parseNum(row.querySelector('.inp-particip').value),
              escalon_monto:   parseNum(row.querySelector('.inp-escmonto').value),
              ticket_promedio: parseNum(row.querySelector('.inp-ticket').value),
              operacion:       parseNum(row.querySelector('.inp-operacion').value),
            };
            btn.disabled = true; btn.textContent = '…';
            try {
              await api.put(`/montos/base/${id}`, body);
              showToast('Guardado', 'success');
              baseData = null;
              loadTab(activeTab, true);
            } catch (err) {
              showToast(err.message, 'error');
              btn.disabled = false; btn.textContent = '💾';
            }
          });
        });
      }

      wrap.innerHTML = `<div class="card" style="margin-top:0">
        ${NOTE}
        <div style="display:flex;gap:0;padding:8px 12px 0;border-bottom:1px solid var(--color-border)">
          ${catTabsHtml(activeCat)}
        </div>
        <div id="cat-content" style="padding:0">
          ${renderCatTable(activeCat)}
        </div>
      </div>`;

      mountCatHandlers();

    } else {
      // ── Vista simple (Encargado / Enc. Millón) — pivot C/B/A en columnas ──
      const trs = escalones.map(esc => {
        const c = byEsc[esc]['C'] || {};
        const b = byEsc[esc]['B'] || {};
        const a = byEsc[esc]['A'] || {};
        return `<tr data-id="${c.id || ''}">
          <td style="font-weight:700">${esc}</td>
          <td>${inputNum(c.total, 'inp-total')}</td>
          <td class="calc-b" style="color:var(--color-muted)">${fmt(b.total ?? round1000((c.total||0)*mults.B))}</td>
          <td class="calc-a" style="color:var(--color-muted)">${fmt(a.total ?? round1000((c.total||0)*mults.A))}</td>
          <td>${saveBtn()}</td>
        </tr>`;
      }).join('');

      wrap.innerHTML = `<div class="card" style="margin-top:0">${NOTE}
        <div class="table-wrap"><table>
          <thead><tr><th>Escalón</th><th>Total C</th><th>Total B</th><th>Total A</th><th></th></tr></thead>
          <tbody>${trs}</tbody>
        </table></div></div>`;

      wrap.querySelectorAll('.inp-total').forEach(inp => {
        inp.addEventListener('input', () => {
          const row = inp.closest('tr');
          const v = parseNum(inp.value);
          row.querySelector('.calc-b').textContent = fmt(round1000(v * mults.B));
          row.querySelector('.calc-a').textContent = fmt(round1000(v * mults.A));
        });
      });

      wrap.querySelectorAll('.btn-save').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('tr');
          const id  = row.dataset.id;
          if (!id) return;
          // Esta vista (solo Encargados Millón) no usa participación —
          // escalon_monto es el campo que lee el motor de cálculo, debe
          // quedar igual a total para que el cascade lo actualice también.
          const total = parseNum(row.querySelector('.inp-total').value);
          const body = {
            categoria_suc: 'C',
            total,
            escalon_monto: total,
          };
          btn.disabled = true; btn.textContent = '…';
          try {
            await api.put(`/montos/base/${id}`, body);
            showToast('Guardado', 'success');
            baseData = null;
            loadTab(activeTab, true);
          } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false; btn.textContent = '💾';
          }
        });
      });
    }
  }

  // ─── ENCARGADOS (sub-solapas C / B / A, ambos campos editables) ───
  function renderEncargadosMerged(wrap, baseRows) {
    const byEsc = {};
    for (const r of baseRows) {
      if (!byEsc[r.escalon]) byEsc[r.escalon] = {};
      byEsc[r.escalon][r.categoria_suc] = r;
    }
    const escalones = Object.keys(byEsc).sort((a, b) => Number(a) - Number(b));

    const CATS = ['C', 'B', 'A'];
    const catLabels = { C: 'Categoría C', B: 'Categoría B', A: 'Categoría A' };
    let activeCat = 'C';

    function catTabsHtml(active) {
      return CATS.map(cat => `
        <button class="enc-cat-btn" data-cat="${cat}"
          style="padding:6px 16px;font-size:12px;font-weight:600;border:none;border-radius:4px 4px 0 0;cursor:pointer;
                 background:${cat === active ? 'var(--color-surface,#fff)' : 'var(--color-card)'};
                 color:${cat === active ? 'var(--color-primary)' : 'var(--color-muted)'};
                 border-bottom:${cat === active ? '2px solid var(--color-primary)' : '2px solid transparent'};
                 margin-right:2px">
          ${catLabels[cat]}
        </button>`).join('');
    }

    function renderCatTable(cat) {
      const editable = cat === 'C';
      const mult     = mults[cat] ?? 1.0;
      const trs = escalones.map(esc => {
        const rowC = byEsc[esc]['C'] || {};
        const rowX = byEsc[esc][cat]  || {};
        const part = editable ? (rowX.participacion ?? 0) : (rowX.participacion ?? round1000((rowC.participacion||0) * mult));
        const escm = editable ? (rowX.escalon_monto  ?? 0) : (rowX.escalon_monto  ?? round1000((rowC.escalon_monto ||0) * mult));
        const tot  = part + escm;

        if (editable) {
          return `<tr data-id="${rowX.id || ''}">
            <td style="font-weight:700">${esc}</td>
            <td>${inputNum(part, 'inp-particip')}</td>
            <td>${inputNum(escm, 'inp-escmonto')}</td>
            <td class="calc-total" style="color:var(--color-muted)">${fmt(tot)}</td>
            <td>${saveBtn()}</td>
          </tr>`;
        } else {
          return `<tr>
            <td style="font-weight:700">${esc}</td>
            <td>${fmt(part)}</td>
            <td>${fmt(escm)}</td>
            <td style="color:var(--color-muted)">${fmt(tot)}</td>
          </tr>`;
        }
      }).join('');

      const saveTh = editable ? '<th></th>' : '';
      return `<div class="table-wrap"><table>
        <thead><tr>
          <th>Escalón</th>
          <th>Participación</th><th>Escalón Monto</th>
          <th>Total</th>${saveTh}
        </tr></thead>
        <tbody>${trs}</tbody>
      </table></div>`;
    }

    wrap.innerHTML = `<div class="card" style="margin-top:0">
      <div style="font-size:11px;color:var(--color-muted);padding:8px 12px 4px">
        ✏️ Editá los valores de <strong>Categoría C</strong> — B y A son solo visualización.
      </div>
      <div style="display:flex;gap:0;padding:8px 12px 0;border-bottom:1px solid var(--color-border)">
        ${catTabsHtml(activeCat)}
      </div>
      <div id="enc-cat-content">${renderCatTable(activeCat)}</div>
    </div>`;

    function mountHandlers() {
      wrap.querySelectorAll('.inp-particip, .inp-escmonto').forEach(inp => {
        inp.addEventListener('input', () => {
          const row = inp.closest('tr');
          const p   = parseNum(row.querySelector('.inp-particip').value);
          const e   = parseNum(row.querySelector('.inp-escmonto').value);
          row.querySelector('.calc-total').textContent = fmt(p + e);
        });
      });

      wrap.querySelectorAll('.btn-save').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row           = btn.closest('tr');
          const id            = row.dataset.id;
          if (!id) return;
          const participacion = parseNum(row.querySelector('.inp-particip').value);
          const escalon_monto = parseNum(row.querySelector('.inp-escmonto').value);
          const total         = participacion + escalon_monto;
          btn.disabled = true; btn.textContent = '…';
          try {
            await api.put(`/montos/base/${id}`, { categoria_suc: 'C', participacion, escalon_monto, total });
            showToast('Guardado', 'success');
            baseData = null;
            loadTab(activeTab, true);
          } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false; btn.textContent = '💾';
          }
        });
      });
    }

    wrap.querySelectorAll('.enc-cat-btn').forEach(b => {
      b.addEventListener('click', () => {
        activeCat = b.dataset.cat;
        wrap.querySelectorAll('.enc-cat-btn').forEach(x => {
          const on = x.dataset.cat === activeCat;
          x.style.background   = on ? 'var(--color-surface,#fff)' : 'var(--color-card)';
          x.style.color        = on ? 'var(--color-primary)' : 'var(--color-muted)';
          x.style.borderBottom = on ? '2px solid var(--color-primary)' : '2px solid transparent';
        });
        wrap.querySelector('#enc-cat-content').innerHTML = renderCatTable(activeCat);
        mountHandlers();
      });
    });

    mountHandlers();
  }

  // ─── SUPERVISOR ───────────────────────────────────────────────────
  function renderSupervisor(wrap, rows) {
    const grouped = {};
    for (const r of rows) {
      const k = `${r.concepto}|${r.tipo}`;
      if (!grouped[k]) grouped[k] = { concepto: r.concepto, tipo: r.tipo };
      grouped[k][r.categoria_suc] = r;
    }

    const trs = Object.values(grouped).map(g => {
      const c = g['C'] || {};
      const b = g['B'] || {};
      const a = g['A'] || {};
      return `<tr>
        <td>${g.concepto}</td><td>${g.tipo}</td>
        <td>${inputNum(c.monto, 'inp-c', `data-id="${c.id || ''}" data-concepto="${g.concepto}" data-tipo="${g.tipo}"`)}</td>
        <td class="calc-b" style="color:var(--color-muted)">${fmt(b.monto ?? round1000((c.monto||0)*mults.B))}</td>
        <td class="calc-a" style="color:var(--color-muted)">${fmt(a.monto ?? round1000((c.monto||0)*mults.A))}</td>
        <td>${c.factor_plaza ?? '—'}</td>
        <td>${saveBtn()}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `<div class="card" style="margin-top:0">${NOTE}
      <div class="table-wrap"><table>
        <thead><tr><th>Concepto</th><th>Tipo</th><th>Monto C</th><th>Monto B</th><th>Monto A</th><th>Factor Plaza</th><th></th></tr></thead>
        <tbody>${trs}</tbody>
      </table></div></div>`;

    wrap.querySelectorAll('.inp-c').forEach(inp => {
      inp.addEventListener('input', () => {
        const row = inp.closest('tr');
        const v = parseNum(inp.value);
        row.querySelector('.calc-b').textContent = fmt(round1000(v * mults.B));
        row.querySelector('.calc-a').textContent = fmt(round1000(v * mults.A));
      });
    });

    wrap.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const inp = row.querySelector('.inp-c');
        const id  = inp.dataset.id;
        if (!id) return;
        const body = { concepto: inp.dataset.concepto, tipo: inp.dataset.tipo, monto: parseNum(inp.value), categoria_suc: 'C' };
        btn.disabled = true; btn.textContent = '…';
        try {
          await api.put(`/montos/supervisor/${id}`, body);
          showToast('Guardado', 'success');
          delete cache['supervisor'];
          loadTab('supervisor', true);
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false; btn.textContent = '💾';
        }
      });
    });
  }

  // ─── VTA EF. RETAIL ──────────────────────────────────────────────
  function renderPrestamos(wrap, rows) {
    // Solo tipo='suc' (Operadores Retail); suc13 y enc_millon no aplican aquí
    const rowsSuc = rows.filter(r => r.tipo === 'suc');

    const grouped = {};
    for (const r of rowsSuc) {
      if (!grouped[r.escalon]) grouped[r.escalon] = { escalon: r.escalon };
      grouped[r.escalon][r.categoria_suc] = r;
    }

    const trs = Object.values(grouped).sort((a, b) => a.escalon - b.escalon).map(g => {
      const c = g['C'] || {};
      const b = g['B'] || {};
      const a = g['A'] || {};
      return `<tr>
        <td style="text-align:center">${g.escalon}</td>
        <td>${inputNum(c.monto, 'inp-c', `data-id="${c.id||''}" data-escalon="${g.escalon}" data-tipo="suc"`)}</td>
        <td class="calc-b" style="color:var(--color-muted)">${fmt(b.monto ?? round1000((c.monto||0)*mults.B))}</td>
        <td class="calc-a" style="color:var(--color-muted)">${fmt(a.monto ?? round1000((c.monto||0)*mults.A))}</td>
        <td>${saveBtn()}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `<div class="card" style="margin-top:0">${NOTE}
      <div class="table-wrap"><table>
        <thead><tr><th>Escalón</th><th>Monto C</th><th>Monto B</th><th>Monto A</th><th></th></tr></thead>
        <tbody>${trs}</tbody>
      </table></div>
    </div>`;

    wrap.querySelectorAll('.inp-c').forEach(inp => {
      inp.addEventListener('input', () => {
        const row = inp.closest('tr');
        const v = parseNum(inp.value);
        row.querySelector('.calc-b').textContent = fmt(round1000(v * mults.B));
        row.querySelector('.calc-a').textContent = fmt(round1000(v * mults.A));
      });
    });

    wrap.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const inp = row.querySelector('.inp-c');
        const id  = inp.dataset.id;
        if (!id) return;
        const body = { escalon: inp.dataset.escalon, tipo: inp.dataset.tipo, monto: parseNum(inp.value), categoria_suc: 'C' };
        btn.disabled = true; btn.textContent = '…';
        try {
          await api.put(`/montos/prestamos/${id}`, body);
          showToast('Guardado', 'success');
          delete cache['prestamos'];
          loadTab('prestamos', true);
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false; btn.textContent = '💾';
        }
      });
    });
  }

  // ─── CAJERO FIJO ──────────────────────────────────────────────────
  function renderCajero(wrap, rows) {
    const bycat = {};
    for (const r of rows) bycat[r.categoria_suc] = r;
    const c = bycat['C'] || {};
    const b = bycat['B'] || {};
    const a = bycat['A'] || {};

    wrap.innerHTML = `<div class="card" style="margin-top:0">
      <div style="font-size:11px;color:var(--color-muted);padding:8px 12px 4px">
        ✏️ El monto de cajero es único — B y A toman el mismo valor que C.
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Monto C</th><th>Monto B</th><th>Monto A</th><th></th></tr></thead>
        <tbody><tr>
          <td>${inputNum(c.monto, 'inp-caj-c', `data-id="${c.id||''}"`)}</td>
          <td id="caj-b" style="color:var(--color-muted)">${fmt(c.monto ?? 0)}</td>
          <td id="caj-a" style="color:var(--color-muted)">${fmt(c.monto ?? 0)}</td>
          <td>${saveBtn()}</td>
        </tr></tbody>
      </table></div></div>`;

    wrap.querySelector('.inp-caj-c').addEventListener('input', e => {
      const v = parseNum(e.target.value);
      wrap.querySelector('#caj-b').textContent = fmt(v);
      wrap.querySelector('#caj-a').textContent = fmt(v);
    });

    wrap.querySelector('.btn-save').addEventListener('click', async () => {
      const inp = wrap.querySelector('.inp-caj-c');
      const id  = inp.dataset.id;
      if (!id) return;
      const btn = wrap.querySelector('.btn-save');
      btn.disabled = true; btn.textContent = '…';
      try {
        await api.put(`/montos/cajero/${id}`, { monto: parseNum(inp.value), categoria_suc: 'C' });
        showToast('Guardado', 'success');
        delete cache['cajero'];
        loadTab('cajero', true);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false; btn.textContent = '💾';
      }
    });
  }

  function renderByType(wrap, tab, rows) {
    switch (tab.type) {
      case 'supervisor': renderSupervisor(wrap, rows); break;
      case 'prestamos':  renderPrestamos(wrap, rows);  break;
      case 'cajero':     renderCajero(wrap, rows);     break;
    }
  }

  container.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  // Formateo de miles en inputs: al salir del campo re-formatea
  container.addEventListener('blur', e => {
    if (!e.target.classList.contains('inp-miles')) return;
    const n = parseNum(e.target.value);
    e.target.value = n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }, true);

  // Mientras escribe: solo permite dígitos y punto/coma
  container.addEventListener('input', e => {
    if (!e.target.classList.contains('inp-miles')) return;
    const inp = e.target;
    const raw = inp.value.replace(/[^\d]/g, '');
    if (raw === '') { inp.value = ''; return; }
    const cursor = inp.selectionStart;
    const prev = inp.value.length;
    inp.value = Number(raw).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    // Ajustar cursor
    const diff = inp.value.length - prev;
    inp.setSelectionRange(cursor + diff, cursor + diff);
  }, false);

  loadTab(activeTab);
}
