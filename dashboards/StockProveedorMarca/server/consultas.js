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

/* ── Matriz completa: TODOS los períodos, agrupado por fecha+proveedor+marca.
   ~19.000 filas para el histórico completo (56 meses × ~340 combinaciones
   proveedor/marca) — se trae entero de una y se filtra/suma en el cliente
   (por año×mes, por proveedor y por marca) sin volver a pegarle a SQL. ────── */
function matriz(empresaFiltrada) {
  const filtroEmpresa = empresaFiltrada ? 'WHERE fs.nomfilial = @empresa' : '';
  return `
    SELECT
        fs.fecha                  AS fecha,
        fs.nomprov                AS proveedor,
        fs.nommarca                AS marca,
        SUM(fs.stock)              AS stock,
        SUM(fs.stockPesos)         AS stockPesos
    FROM ${T.fotoStock} fs
    ${filtroEmpresa}
    GROUP BY fs.fecha, fs.nomprov, fs.nommarca;
  `;
}

module.exports = { matriz };
