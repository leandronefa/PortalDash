/**
 * Modal component
 * Usage:
 *   const m = createModal({ title, content, onConfirm, confirmLabel })
 *   document.body.appendChild(m.el)
 *   m.open() / m.close()
 */
export function createModal({ title, content, onConfirm, confirmLabel = 'Guardar', onCancel }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <span>${title}</span>
        <button class="modal-close" aria-label="Cerrar">&times;</button>
      </div>
      <div class="modal-body">${content}</div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-cancel">Cancelar</button>
        <button class="btn btn-primary btn-confirm">${confirmLabel}</button>
      </div>
    </div>
  `;

  function close() {
    backdrop.remove();
    if (onCancel) onCancel();
  }

  backdrop.querySelector('.modal-close').addEventListener('click', close);
  backdrop.querySelector('.btn-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector('.btn-confirm').addEventListener('click', () => {
    if (onConfirm) onConfirm(backdrop);
  });

  return {
    el: backdrop,
    open() { document.body.appendChild(backdrop); },
    close,
    getField: (name) => backdrop.querySelector(`[name="${name}"]`)
  };
}
