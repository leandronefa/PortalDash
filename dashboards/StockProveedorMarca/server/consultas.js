/**
 * consultas.js — mapeo contra el esquema real de SQL Server (servidor 10.0.0.115, db_Cegid).
 *
 *   dbo.FotoStockMES2 → una fila por artículo/color/talle/sucursal, con una
 *     "foto" (snapshot) por cada fin de mes desde 2021-12-31 (56 fechas al
 *     27/08/2026). `fecha` es siempre el último día del mes — un período
 *     cerrado ya no cambia, así que se puede cachear sin TTL corto.
 *   nomfilial: 'Tesi ' / 'Pueblo ' (con espacio final) / NULL (~1900 filas
 *     residuales en 4+ años de histórico, se ignoran al filtrar por empresa).
 *   Árbol de clase: nomSec (Sección) → nomgenero (Género) → nomflia (Familia)
 *     → nomlinea (Línea). Cada uno, igual que nommarca, puede venir NULL en
 *     ~1500-1900 filas residuales — se agrupan bajo un valor centinela
 *     "(sin X)" (ver CAMPOS_FILTRO) en vez de descartarse.
 *
 *   El cruce completo fecha×proveedor×marca×sección×género×familia×línea es
 *     ENORME (≈139.000 combinaciones) — no se trae entero al cliente. En
 *     cambio:
 *     - DIMENSIONES trae sólo las combinaciones DISTINCT de las 6 dimensiones
 *       (sin fecha ni números, ≈6.200 filas) — el cliente arma con eso las
 *       listas de filtro relacionales, sin pegarle a SQL en cada click.
 *     - matrizFiltrada agrega por fecha, YA filtrado server-side por lo que
 *       el usuario tenga tildado — sólo trae hasta 56 filas por pedido.
 */

const T = {
  fotoStock: process.env.TBL_FOTOSTOCK || 'dbo.FotoStockMES2'
};

function DIMENSIONES(empresaFiltrada) {
  return `
    SELECT DISTINCT
        fs.nomprov   AS proveedor,
        fs.nommarca  AS marca,
        fs.nomSec    AS seccion,
        fs.nomgenero AS genero,
        fs.nomflia   AS familia,
        fs.nomlinea  AS linea
    FROM ${T.fotoStock} fs
    ${empresaFiltrada ? 'WHERE fs.nomfilial = @empresa' : ''};
  `;
}

// key = como llega el filtro desde el front (body.proveedores, body.marcas, ...)
const CAMPOS_FILTRO = [
  { key: 'proveedores', columna: 'nomprov' },
  { key: 'marcas', columna: 'nommarca', sentinel: '(sin marca)' },
  { key: 'secciones', columna: 'nomSec', sentinel: '(sin sección)' },
  { key: 'generos', columna: 'nomgenero', sentinel: '(sin género)' },
  { key: 'familias', columna: 'nomflia', sentinel: '(sin familia)' },
  { key: 'lineas', columna: 'nomlinea', sentinel: '(sin línea)' }
];

// IN (@p0,@p1,...) + "OR columna IS NULL" si el centinela "(sin X)" está
// tildado — un IN nunca matchea NULL en SQL Server, hay que pedirlo aparte.
function condicionIn(campo, valoresSel, prefijo) {
  if (!valoresSel || !valoresSel.length) return null;
  const incluyeNulo = campo.sentinel && valoresSel.includes(campo.sentinel);
  const reales = campo.sentinel ? valoresSel.filter((v) => v !== campo.sentinel) : valoresSel;
  const binds = reales.map((v, i) => ({ name: `${prefijo}${i}`, value: v }));
  const partes = [];
  if (binds.length) partes.push(`fs.${campo.columna} IN (${binds.map((b) => '@' + b.name).join(',')})`);
  if (incluyeNulo) partes.push(`fs.${campo.columna} IS NULL`);
  if (!partes.length) return null;
  return { sql: partes.length > 1 ? `(${partes.join(' OR ')})` : partes[0], binds };
}

// Arma el SELECT agregado por fecha con el WHERE dinámico (empresa + hasta 6
// filtros del árbol de clase). Devuelve { sql, binds } — server.js hace el
// req.input() de cada bind, así esto no necesita conocer el objeto `sql` de mssql.
function matrizFiltrada(filtros, empresaFiltrada) {
  const condiciones = [];
  const binds = [];
  if (empresaFiltrada) condiciones.push('fs.nomfilial = @empresa');
  for (const campo of CAMPOS_FILTRO) {
    const cond = condicionIn(campo, filtros[campo.key], campo.key[0]);
    if (cond) { condiciones.push(cond.sql); binds.push(...cond.binds); }
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const sqlTexto = `
    SELECT fs.fecha AS fecha, SUM(fs.stock) AS stock, SUM(fs.stockPesos) AS stockPesos
    FROM ${T.fotoStock} fs
    ${where}
    GROUP BY fs.fecha;
  `;
  return { sql: sqlTexto, binds };
}

module.exports = { DIMENSIONES, CAMPOS_FILTRO, matrizFiltrada };
