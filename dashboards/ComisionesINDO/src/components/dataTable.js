/**
 * DataTable component
 * Usage: renderDataTable(container, { columns, data, onEdit, onDelete })
 *
 * columns: [{ key, label, render? }]
 */
export function renderDataTable(container, { columns, data, onEdit, onDelete, actions = true }) {
  const heads = columns.map(c => `<th>${c.label}</th>`).join('');
  const actHead = actions ? '<th style="width:100px">Acciones</th>' : '';

  const rows = data.map((row, i) => {
    const cells = columns.map(c => {
      const val = c.render ? c.render(row[c.key], row) : (row[c.key] ?? '');
      return `<td>${val}</td>`;
    }).join('');

    const actCell = actions ? `
      <td>
        <button class="btn btn-sm btn-secondary btn-edit" data-idx="${i}" title="Editar">✏️</button>
        <button class="btn btn-sm btn-danger btn-del"  data-idx="${i}" title="Eliminar">🗑️</button>
      </td>` : '';

    return `<tr>${cells}${actCell}</tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>${heads}${actHead}</tr></thead>
        <tbody>${rows || '<tr><td colspan="100" style="text-align:center;color:var(--color-muted);padding:24px">Sin datos</td></tr>'}</tbody>
      </table>
    </div>
  `;

  if (actions) {
    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => onEdit && onEdit(data[+btn.dataset.idx], +btn.dataset.idx));
    });
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => onDelete && onDelete(data[+btn.dataset.idx], +btn.dataset.idx));
    });
  }
}
