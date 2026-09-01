// scripts/precalc/verificar_sin_regresion.js
//
// Referencia de combo SIN huecos: 1023016-23007 / NEGRO / U, sucursal 000002 -- reemplaza a
// KC1575-1074 (Task 7 original), que resulto tener huecos reales y por eso NO servia como
// prueba de "sin regresion" (ver task-7-report.md para el detalle de por que se reemplazo).
// Verificado con SQL antes de este script: 52 semanas consecutivas reales en
// MotorReposicion_StockSemanal, desde 2025-08-23 hasta 2026-08-15, sin ningun hueco, stock
// siempre positivo (minimo 1). Por construccion de la logica de relleno (Task 3), un combo con
// cero huecos no recibe ninguna fila nueva insertada -- su velocidad no deberia haber cambiado.
//
// CORREGIDO (revision final, Hallazgo 3, 2026-08-18): la version anterior de este script filtraba
// solo por color/talle y sumaba las 19 filas de TODAS las sucursales/canales donde existe esta
// variante (dando 3.1877) -- ese es exactamente el numero que task-7-report.md ya declaro
// INVALIDO como prueba de "sin regresion", porque solo la sucursal 000002 fue verificada
// rigurosamente como libre de huecos (una de las otras 18 filas, "Calzados 21"/000021, SI tenia un
// hueco real de 3 semanas para este mismo combo -- ver Verificacion 3 de task-7-report.md). Sin
// ningun valor esperado ni assert, el script tampoco detectaba ninguna regresion si se volvia a
// correr en el futuro. Ahora filtra especificamente a la sucursal 000002 (ademas de color/talle,
// resolviendo el nombre real via una consulta SQL de solo lectura en vez de asumirlo hardcodeado)
// y compara contra los valores ya confirmados en task-7-report.md, terminando con
// process.exit(1) si no coinciden.
require('dotenv').config();
const http = require('http');
const sql = require('mssql');

const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
};

const SUCURSAL_REFERENCIA = '000002';
// Valores confirmados en task-7-report.md (Verificacion 1 y 2) para
// 1023016-23007 / NEGRO / U / sucursal 000002 ("Calzados 02"):
const ESPERADO = { vd: 0.164835, ventasVd: 15, diasStockVd: 91 };
const TOLERANCIA_VD = 0.000001;

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  // Resolver el nombre real de la sucursal de referencia contra la base (en vez de asumir
  // "Calzados 02" hardcodeado) -- el detalle de la API solo trae NomSucursal, no el codigo, asi
  // que hace falta este paso para poder filtrar por sucursal 000002 desde el lado del cliente.
  const pool = await sql.connect(dbConfig);
  const rNom = await pool.request()
    .input('suc', sql.VarChar(20), SUCURSAL_REFERENCIA)
    .query('SELECT nomSucursal FROM Sucursales WHERE Sucursal = @suc');
  await pool.close();
  if (!rNom.recordset.length) {
    throw new Error(`No se encontro la sucursal ${SUCURSAL_REFERENCIA} en la tabla Sucursales.`);
  }
  const nomSucursalReferencia = rNom.recordset[0].nomSucursal;
  console.log(`Sucursal de referencia: ${SUCURSAL_REFERENCIA} = "${nomSucursalReferencia}"`);

  const d = await get('http://localhost:3050/api/tablero/articulo?modelo=1023016-23007&riesgoDias=3');
  const cols = d.detalleColumnas; const idx = k => cols.indexOf(k);
  const rowsColorTalle = d.detalle.filter(row => {
    const cat = d.catalogo[row[idx('sku')]];
    return cat && cat.color === 'NEGRO' && cat.talle === 'U';
  });
  console.log('Filas encontradas (color/talle, todas las sucursales):', rowsColorTalle.length);

  // Filtro adicional por sucursal 000002 -- esta es la unica fila que task-7-report.md verifico
  // rigurosamente como libre de huecos; las otras 18 no sirven como prueba de "sin regresion".
  const rowsSucursal = rowsColorTalle.filter(row => row[idx('suc')] === nomSucursalReferencia);
  console.log(`Filas encontradas (color/talle + sucursal ${SUCURSAL_REFERENCIA}):`, rowsSucursal.length);
  rowsColorTalle.forEach(row => {
    console.log(' ', row[idx('suc')], '| vd=', row[idx('vd')], 'ventasVd=', row[idx('ventasVd')], 'diasStockVd=', row[idx('diasStockVd')]);
  });

  if (rowsSucursal.length !== 1) {
    console.error(`FALLO: se esperaba exactamente 1 fila para la sucursal ${SUCURSAL_REFERENCIA}, se encontraron ${rowsSucursal.length}.`);
    process.exit(1);
  }

  const fila = rowsSucursal[0];
  const real = {
    vd: fila[idx('vd')],
    ventasVd: fila[idx('ventasVd')],
    diasStockVd: fila[idx('diasStockVd')],
  };

  console.log('\nComparacion contra los valores confirmados en task-7-report.md:');
  console.log('  Esperado:', ESPERADO);
  console.log('  Real:    ', real);

  const okVd = Math.abs(real.vd - ESPERADO.vd) < TOLERANCIA_VD;
  const okVentas = real.ventasVd === ESPERADO.ventasVd;
  const okDias = real.diasStockVd === ESPERADO.diasStockVd;

  if (!okVd || !okVentas || !okDias) {
    console.error('\nFALLO: los valores reales no coinciden con los confirmados -- posible regresion en el calculo de velocidad para un combo/sucursal sin huecos.');
    if (!okVd) console.error(`  vd esperado=${ESPERADO.vd} real=${real.vd}`);
    if (!okVentas) console.error(`  ventasVd esperado=${ESPERADO.ventasVd} real=${real.ventasVd}`);
    if (!okDias) console.error(`  diasStockVd esperado=${ESPERADO.diasStockVd} real=${real.diasStockVd}`);
    process.exit(1);
  }

  console.log('\nOK: sin regresion. La sucursal 000002 (unica verificada rigurosamente como libre de huecos) sigue dando exactamente los valores confirmados.');
}
main().catch(e => { console.error(e); process.exit(1); });
