// Diagnóstico: corroborar venta efectivo de Operadores Millón
// Compara: cache del dashboard vs SP en vivo (con y sin exclusión de planes).
// Uso: node scripts/corroborar-venta-millon.mjs [YYYY-MM]
import { getPool, sql } from '../server/config/db.js';
import { getPoolBC } from '../server/config/dbBeClever.js';
import dotenv from 'dotenv'; dotenv.config();

const PLANES_EXCLUIDOS = new Set([24, 29, 41, 44, 45, 46]);

const pool = await getPool();

let periodo = process.argv[2];
if (!periodo) {
  const r = await pool.request().query(`
    SELECT TOP 1 periodo FROM dbo.tbl_CoVenAppINDO_MillonCache ORDER BY periodo DESC`);
  periodo = r.recordset[0]?.periodo;
  if (!periodo) { console.log('Sin cache de Millón. Pasá el período como argumento.'); process.exit(1); }
}
console.log(`\n════ Período: ${periodo} ════`);

// 1) Cache del dashboard (lo que ve la página)
const cacheR = await pool.request()
  .input('periodo', sql.VarChar(7), periodo)
  .query(`SELECT sucursal_id, sucursal, operador, total_operaciones, total_importe, fecha_carga
          FROM dbo.tbl_CoVenAppINDO_MillonCache WHERE periodo = @periodo`);
const fechaCarga = cacheR.recordset[0]?.fecha_carga;
console.log(`Cache del dashboard: ${cacheR.recordset.length} filas, cargado el ${fechaCarga ? new Date(fechaCarga).toLocaleString('es-AR') : '—'}`);

// 2) SP en vivo
const [yr, mo] = periodo.split('-').map(Number);
const bcPool = await getPoolBC();
const comR = await bcPool.request().query(
  "SELECT Cod_Comercio, RTRIM(Descripcion) AS descr FROM dbo.COMERCIO WHERE RTRIM(Descripcion) LIKE 'MILLON%'");
const milonIds = new Set(comR.recordset.map(x => x.Cod_Comercio));
const spR = await bcPool.request()
  .input('Anio', sql.Int, yr).input('Mes', sql.Int, mo)
  .execute('dbo.sp_ReporteOriginacionesCreditos');

const filas = spR.recordset.filter(r => milonIds.has(r.IdSucursalEntidad));
console.log(`SP en vivo: ${spR.recordset.length} filas totales, ${filas.length} de sucursales Millón`);

// Estados presentes (el dashboard NO filtra por estado — suma todos)
const estados = {};
for (const r of filas) {
  const e = (r.Des || 's/estado').trim();
  if (!estados[e]) estados[e] = { n: 0, imp: 0 };
  estados[e].n++; estados[e].imp += r.ImpFin || 0;
}
console.log('\n── Estados (Des) en filas Millón — el dashboard suma TODOS:');
for (const [e, v] of Object.entries(estados).sort((a, b) => b[1].imp - a[1].imp))
  console.log(`   ${e.padEnd(30)} ${String(v.n).padStart(5)} ops  $ ${v.imp.toLocaleString('es-AR', {maximumFractionDigits: 0})}`);

// Agregado por operador: bruto vs neto (exclusión de planes)
const porOp = {};
for (const r of filas) {
  const key = `${r.IdSucursalEntidad}|${(r.IdUsuario || '(SIN USUARIO)').toUpperCase().trim()}`;
  if (!porOp[key]) porOp[key] = { suc: r.IdSucursalEntidad, sucNom: r.SucDes, op: (r.IdUsuario || '(SIN USUARIO)').toUpperCase().trim(),
                                  bruto: 0, nBruto: 0, neto: 0, nNeto: 0, excluido: {} };
  const x = porOp[key];
  x.bruto += r.ImpFin || 0; x.nBruto++;
  if (PLANES_EXCLUIDOS.has(r.IdPlan)) {
    x.excluido[r.IdPlan] = (x.excluido[r.IdPlan] || 0) + (r.ImpFin || 0);
  } else {
    x.neto += r.ImpFin || 0; x.nNeto++;
  }
}

const cacheMap = {};
for (const c of cacheR.recordset)
  cacheMap[`${c.sucursal_id}|${c.operador}`] = +c.total_importe;

const fmt = v => v.toLocaleString('es-AR', { maximumFractionDigits: 0 }).padStart(14);
console.log('\n── Por operador: CACHE (dashboard) vs SP neto (con exclusiones) vs SP bruto (sin excluir):');
console.log('   Suc  Operador              Cache$         SP neto$       SP bruto$      Excluido$ (planes)');
let totC = 0, totN = 0, totB = 0;
for (const x of Object.values(porOp).sort((a, b) => a.suc - b.suc || a.op.localeCompare(b.op))) {
  const cache = cacheMap[`${x.suc}|${x.op}`] ?? null;
  const exc = x.bruto - x.neto;
  const planes = Object.entries(x.excluido).map(([p, v]) => `plan ${p}: $${v.toLocaleString('es-AR', {maximumFractionDigits: 0})}`).join(', ');
  const marca = cache != null && Math.abs(cache - x.neto) > 1 ? ' ⚠ CACHE≠SP' : '';
  console.log(`   ${String(x.suc).padStart(4)} ${x.op.padEnd(18)} ${cache != null ? fmt(cache) : '   (no en cache)'} ${fmt(x.neto)} ${fmt(x.bruto)}  ${exc > 0 ? `−${exc.toLocaleString('es-AR', {maximumFractionDigits: 0})} (${planes})` : ''}${marca}`);
  totC += cache ?? 0; totN += x.neto; totB += x.bruto;
}
console.log(`   ${'TOTAL'.padStart(23)} ${fmt(totC)} ${fmt(totN)} ${fmt(totB)}  diferencia bruto−neto: $ ${(totB - totN).toLocaleString('es-AR', {maximumFractionDigits: 0})}`);

// Totales excluidos por plan (global)
const excPorPlan = {};
for (const r of filas) if (PLANES_EXCLUIDOS.has(r.IdPlan)) {
  if (!excPorPlan[r.IdPlan]) excPorPlan[r.IdPlan] = { n: 0, imp: 0, prod: r.ProdDesc };
  excPorPlan[r.IdPlan].n++; excPorPlan[r.IdPlan].imp += r.ImpFin || 0;
}
console.log('\n── Excluido por plan (global Millón):');
for (const [p, v] of Object.entries(excPorPlan))
  console.log(`   plan ${p} (${v.prod || '?'}): ${v.n} ops, $ ${v.imp.toLocaleString('es-AR', {maximumFractionDigits: 0})}`);

process.exit(0);
