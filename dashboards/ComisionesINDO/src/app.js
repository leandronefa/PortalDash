import { renderSidebar } from './components/sidebar.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderMillon } from './pages/millon.js';
import { renderSupervisores } from './pages/supervisores.js';
import { renderCajeros } from './pages/cajeros.js';
import { renderOperadores } from './pages/operadores.js';
import { renderOperadoresMillon } from './pages/operadores-millon.js';
import { renderEncargados } from './pages/encargados.js';
import { renderEncargadosMillon } from './pages/encargados-millon.js';
import { renderResultadoSupervisores } from './pages/resultado-supervisores.js';
import { renderTotal } from './pages/total.js';
import { renderSucursales } from './pages/sucursales.js';
import { renderVisorMontos } from './pages/visor-montos.js';
import { renderRanking } from './pages/ranking.js';
import { renderVisorObjetivos } from './pages/visor-objetivos.js';
import { renderVisorVentas } from './pages/visor-ventas.js';
import { initToast } from './components/toast.js';

const ROUTES = {
  dashboard:              renderDashboard,
  millon:                 renderMillon,
  supervisores:           renderSupervisores,
  cajeros:                renderCajeros,
  'operadores-retail':    (c, p) => renderOperadores(c, p, 'retail'),
  'operadores-millon':    renderOperadoresMillon,
  encargados:             renderEncargados,
  'encargados-millon':    renderEncargadosMillon,
  'resultado-supervisores': renderResultadoSupervisores,
  total:                  renderTotal,
  'visor-sucursales':     renderSucursales,
  'visor-montos':         renderVisorMontos,
  'visor-ranking':        renderRanking,
  'visor-objetivos':      renderVisorObjetivos,
  'visor-ventas':         renderVisorVentas,
};

export let periodoActual = getCurrentPeriodo();
let rutaActual = 'dashboard';

function getCurrentPeriodo() {
  const saved = localStorage.getItem('periodo');
  if (saved) return saved;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function setPeriodo(p) {
  periodoActual = p;
  localStorage.setItem('periodo', p);
  navigate(rutaActual);
}

export function isLoggedIn() {
  return !!localStorage.getItem('token');
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
}

export function navigate(route) {
  if (!isLoggedIn()) { renderLoginPage(); return; }
  const fn = ROUTES[route];
  if (!fn) return;
  rutaActual = route;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  const root = document.getElementById('page-root');
  root.innerHTML = '';
  fn(root, periodoActual);
}

function renderLoginPage() {
  const app = document.getElementById('app');
  app.classList.add('no-sidebar');
  app.innerHTML = '';
  renderLogin(app, onLogin);
}

function onLogin(user, token) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  renderMainLayout();
  navigate('dashboard');
}

function renderMainLayout() {
  const app = document.getElementById('app');
  app.classList.remove('no-sidebar');
  app.innerHTML = `
    <div id="sidebar"></div>
    <div id="main-content">
      <div class="page-body">
        <div id="page-root"></div>
      </div>
    </div>
  `;
  renderSidebar(document.getElementById('sidebar'), { navigate, onLogout, setPeriodo });
}

function onLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  renderLoginPage();
}

export function renderApp() {
  initToast();

  window.addEventListener('unauthorized', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    renderLoginPage();
  });

  if (!isLoggedIn()) {
    renderLoginPage();
  } else {
    renderMainLayout();
    navigate('dashboard');
  }
}
