let container;

export function initToast() {
  container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
}

export function showToast(message, type = 'info', duration = 3000) {
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
