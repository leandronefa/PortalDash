export function filtrarPorSucursal(rows, permitidas, campo = 'sucursal_id') {
  if (permitidas === null) return rows;
  return rows.filter(r => permitidas.includes(r[campo]));
}
