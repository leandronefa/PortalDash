import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

export function renderLogin(container, onLogin) {
  container.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          <h1>Comisiones INDO</h1>
          <p>Sistema de gestión de comisiones</p>
        </div>
        <form id="login-form">
          <div class="form-group">
            <label class="form-label">Usuario</label>
            <input type="text" id="login-user" class="form-control" placeholder="Ingresá tu usuario" autocomplete="username" />
          </div>
          <div class="form-group">
            <label class="form-label">Contraseña</label>
            <input type="password" id="login-pass" class="form-control" placeholder="••••••••" autocomplete="current-password" />
          </div>
          <p id="login-error" class="form-error" style="min-height:18px"></p>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:4px">
            Iniciar sesión
          </button>
        </form>
      </div>
    </div>
  `;

  const form  = container.querySelector('#login-form');
  const errEl = container.querySelector('#login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario   = container.querySelector('#login-user').value.trim();
    const contrasena = container.querySelector('#login-pass').value;
    errEl.textContent = '';

    if (!usuario || !contrasena) {
      errEl.textContent = 'Completá usuario y contraseña';
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Verificando…';

    try {
      const resp = await api.post('/auth/login', { usuario, contrasena });
      onLogin(resp.user, resp.token);
    } catch (err) {
      errEl.textContent = err.message || 'Error al iniciar sesión';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Iniciar sesión';
    }
  });
}
