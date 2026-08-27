/**
 * consultas.js — mapeo contra el esquema real de SQL Server (servidor 10.0.0.115, db_Cegid).
 *
 *   dbo.FotoStockMES2 → una fila por artículo/color/talle/sucursal, con una
 *     "foto" (snapshot) por cada fin de mes desde 2021-12-31 (56 fechas al
 *     27/08/2026). `fecha` es siempre el último día del mes — un período
 *     cerrado ya no cambia, así que se puede cachear sin TTL corto.
 *   nomfilial: 'Tesi ' / 'Pueblo ' (con espacio final) / NULL (~1900 filas
 *     residuales en 4+ años de histórico, se ignoran al filtrar por empresa).
 *   nommarca: puede venir NULL (proveedor sin marca cargada en origen) — se
 *     agrupa igual bajo el proveedor, con etiqueta "(sin marca)" en el front.
 */

const T = {
  fotoStock: process.env.TBL_FOTOSTOCK || 'dbo.FotoStockMES2'
};

/* ── Períodos disponibles (fin de mes con foto tomada) ────────────────────── */
const PERIODOS = `
  SELECT DISTINCT fecha
  FROM ${T.fotoStock}
  ORDER BY fecha DESC;
`;

/* ── Stock sumado por proveedor y marca, para un período y empresa ────────── */
function stockPorProveedorMarca(empresaFiltrada) {
  const filtroEmpresa = empresaFiltrada ? 'AND fs.nomfilial = @empresa' : '';
  return `
    SELECT
        fs.nomprov               AS proveedor,
        fs.nommarca               AS marca,
        SUM(fs.stock)             AS stock,
        SUM(fs.stockPesos)        AS stockPesos,
        COUNT(DISTINCT fs.artprove) AS articulos
    FROM ${T.fotoStock} fs
    WHERE fs.fecha = @fecha
      ${filtroEmpresa}
    GROUP BY fs.nomprov, fs.nommarca
    ORDER BY stock DESC;
  `;
}

module.exports = { PERIODOS, stockPorProveedorMarca };
