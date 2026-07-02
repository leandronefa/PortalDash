/**
 * Export to CSV (safe, no external dependencies)
 * For xlsx format, use a server-side endpoint if needed in the future.
 */
export function exportToExcel(data, filename = 'exportacion') {
  exportToCSV(data, filename);
}

export function exportToCSV(data, filename = 'exportacion') {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const rows = [
    keys.join(';'),
    ...data.map(row => keys.map(k => {
      const v = row[k] ?? '';
      return typeof v === 'string' && v.includes(';') ? `"${v}"` : v;
    }).join(';'))
  ];
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
