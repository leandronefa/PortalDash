import { getUser, periodoActual, navigate, setPeriodo } from '../app.js';

const MENU = [
  { section: 'Principal' },
  { route: 'dashboard',    icon: '📊', label: 'Dashboard' },

  { section: 'DATOS' },
  { route: 'visor-sucursales', icon: '🏪', label: 'Sucursales Retail' },
  { route: 'millon',            icon: '⭐', label: 'Sucursales Millón' },
  { route: 'visor-montos',     icon: '💰', label: 'Montos' },
  { route: 'visor-ranking',    icon: '🏆', label: 'Ranking' },
  { route: 'visor-objetivos',  icon: '🎯', label: 'Objetivos' },
  { route: 'visor-ventas',     icon: '📈', label: 'Ventas' },
  { route: 'supervisores',     icon: '👤', label: 'Supervisores' },

  { section: 'Cálculos' },
  { route: 'total',               icon: '🧮', label: 'Total' },
  { route: 'cajeros',             icon: '🧾', label: 'Cajeros' },
  { route: 'operadores-retail',   icon: '👥', label: 'Operadores Retail' },
  { route: 'operadores-millon',   icon: '👥', label: 'Operadores Millón' },
  { route: 'encargados',          icon: '👔', label: 'Encargados Retail' },
  { route: 'encargados-millon',   icon: '👔', label: 'Encargados Millón' },
  { route: 'resultado-supervisores', icon: '👤', label: 'Supervisores' },

  { section: 'AYUDA' },
  { route: 'manual',       icon: '📖', label: 'Manual' },
];

function getPeriodos() {
  const periodos = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periodos.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return periodos;
}

function applyTheme() {
  const saved = localStorage.getItem('theme');
  // Si no hay preferencia guardada, respetamos la del sistema
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved ? saved === 'dark' : prefersDark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function renderSidebar(container, { navigate: nav, onLogout, setPeriodo: sp }) {
  applyTheme();
  const user = getUser();
  const periodos = getPeriodos();

  container.innerHTML = `
    <div class="sidebar-brand">Comisiones INDO</div>
    <div class="sidebar-period">
      <div>Período activo</div>
      <select id="periodo-select">
        ${periodos.map(p => `<option value="${p}" ${p === periodoActual ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
    </div>
    <nav class="sidebar-nav">
      ${MENU.map(item => {
        if (item.section) return `<div class="sidebar-section">${item.section}</div>`;
        return `<div class="nav-item" data-route="${item.route}">
          <span class="icon">${item.icon}</span>
          <span>${item.label}</span>
        </div>`;
      }).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">${user?.nombre || user?.usuario || 'Usuario'}</div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button class="btn-theme-toggle" id="btn-theme" title="Modo oscuro/claro" style="background:none;border:1px solid #334155;color:#94a3b8;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:13px;flex:1;transition:all 150ms ease;">🌙 Oscuro</button>
      </div>
      <button class="btn-logout" id="btn-logout">Cerrar sesión</button>
    </div>
  `;

  container.querySelector('#btn-logout').addEventListener('click', onLogout);

  const btnTheme = container.querySelector('#btn-theme');
  function updateThemeBtn() {
    const dark = document.documentElement.dataset.theme === 'dark';
    btnTheme.textContent = dark ? '☀️ Claro' : '🌙 Oscuro';
  }
  updateThemeBtn();
  btnTheme.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    const next = dark ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    document.documentElement.dataset.theme = next;
    updateThemeBtn();
  });

  container.querySelector('#periodo-select').addEventListener('change', (e) => {
    sp(e.target.value);
  });
  container.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => nav(el.dataset.route));
  });
}
