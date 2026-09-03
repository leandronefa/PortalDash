import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularSupervisores } from './calcEngine.js';

// ── Fixtures ──────────────────────────────────────────────────────────────
// ctx mínimo: 1 supervisor con sucursales Retail (id<100) y Millón (id>=100).
// objConsumo.participacion = 0.50 → G = (vta/100 − 0.5)/0.5
//   vta 50 → G = 0        (llega)
//   vta 48.5 → G = -0.03  (llega, dentro de tolerancia 4%)
//   vta 47 → G = -0.06    (NO llega)

const montosSupervisor = [
  { concepto: 'consumo',  tipo: 'por_sucursal', categoria_suc: 'A', monto: 10000, factor_plaza: 0.5 },
  { concepto: 'consumo',  tipo: 'por_sucursal', categoria_suc: 'B', monto: 9000,  factor_plaza: 0.5 },
  { concepto: 'consumo',  tipo: 'por_sucursal', categoria_suc: 'C', monto: 8000,  factor_plaza: 0.5 },
  { concepto: 'efectivo', tipo: 'por_plaza',    categoria_suc: 'C', monto: 23000, factor_plaza: 0.5 },
  { concepto: 'efectivo', tipo: 'por_sucursal', categoria_suc: 'C', monto: 6000,  factor_plaza: 0.5 },
];

function makeCtx({ asignaciones, datosConsumo, objConsumo }) {
  return {
    supervisores: [{ id: 1, nombre: 'SUP TEST', activo: true }],
    supervisorSucursales: asignaciones.map(id => ({ supervisor_id: 1, sucursal_id: id })),
    montosSupervisor,
    datosConsumo,
    objConsumo,
  };
}

const sucRetail = (id, cat, escCon, prov = 'MENDOZA') => ({
  sucursal_id: id, sucursal_nombre: `SUC ${id}`, categoria: cat,
  provincia: prov, escalon_consumo: escCon, escalon_efectivo: 0, ratio_consumo: 1,
});
const sucMillon = (id, escEf, prov = 'MENDOZA') => ({
  sucursal_id: id, sucursal_nombre: `MILLON ${id}`, categoria: 'C',
  provincia: prov, escalon_consumo: 0, escalon_efectivo: escEf, ratio_efectivo: 1,
});
const consumo = (id, vta) => ({ sucursal_id: id, vta_vta_tot: vta });
const objetivo = (id) => ({ sucursal_id: id, participacion: 0.5 });

// ── Pago por sucursal Retail ──────────────────────────────────────────────

test('pesos + participación → monto ABM completo', () => {
  const ctx = makeCtx({
    asignaciones: [2],
    datosConsumo: [consumo(2, 50)],   // G = 0 → llega
    objConsumo:   [objetivo(2)],
  });
  const [sup] = calcularSupervisores(ctx, [sucRetail(2, 'A', 1)]);
  const det = sup.sucursales[0];
  assert.equal(det.llega_pesos, true);
  assert.equal(det.llega_particip, true);
  assert.equal(det.pago, 'completo');
  assert.equal(det.monto_por_suc, 10000);
  assert.equal(sup.total_por_sucursales, 10000);
});

test('pesos sin participación → mitad redondeada a miles (B: 9000 → 5000)', () => {
  const ctx = makeCtx({
    asignaciones: [2],
    datosConsumo: [consumo(2, 47)],   // G = -0.06 → NO llega
    objConsumo:   [objetivo(2)],
  });
  const [sup] = calcularSupervisores(ctx, [sucRetail(2, 'B', 2)]);
  const det = sup.sucursales[0];
  assert.equal(det.llega_pesos, true);
  assert.equal(det.llega_particip, false);
  assert.equal(det.pago, 'mitad');
  assert.equal(det.monto_por_suc, 5000);  // Math.round(4500/1000)*1000
});

test('mitad de C (8000) → 4000', () => {
  const ctx = makeCtx({
    asignaciones: [2],
    datosConsumo: [consumo(2, 47)],
    objConsumo:   [objetivo(2)],
  });
  const [sup] = calcularSupervisores(ctx, [sucRetail(2, 'C', 1)]);
  assert.equal(sup.sucursales[0].monto_por_suc, 4000);
});

test('sin pesos → $0 aunque llegue a participación', () => {
  const ctx = makeCtx({
    asignaciones: [2],
    datosConsumo: [consumo(2, 50)],   // G = 0 → llega particip
    objConsumo:   [objetivo(2)],
  });
  const [sup] = calcularSupervisores(ctx, [sucRetail(2, 'A', 0)]);  // escalón 0
  const det = sup.sucursales[0];
  assert.equal(det.llega_pesos, false);
  assert.equal(det.llega_particip, true);
  assert.equal(det.pago, 'nada');
  assert.equal(det.monto_por_suc, 0);
});

test('tolerancia 4%: G = -0.03 llega, se paga completo', () => {
  const ctx = makeCtx({
    asignaciones: [2],
    datosConsumo: [consumo(2, 48.5)],  // G = -0.03
    objConsumo:   [objetivo(2)],
  });
  const [sup] = calcularSupervisores(ctx, [sucRetail(2, 'A', 1)]);
  assert.equal(sup.sucursales[0].llega_particip, true);
  assert.equal(sup.sucursales[0].monto_por_suc, 10000);
});

test('sin objetivo de participación → G = -1, no llega (paga mitad si tiene pesos)', () => {
  const ctx = makeCtx({
    asignaciones: [2],
    datosConsumo: [consumo(2, 50)],
    objConsumo:   [],                  // sin fila de objetivo
  });
  const [sup] = calcularSupervisores(ctx, [sucRetail(2, 'A', 1)]);
  assert.equal(sup.sucursales[0].indicador_g, -1);
  assert.equal(sup.sucursales[0].pago, 'mitad');
  assert.equal(sup.sucursales[0].monto_por_suc, 5000);
});

// ── Plus de plaza Retail (solo participación) ─────────────────────────────

test('plaza cumple si TODAS llegan a participación aunque una no llegue a pesos; plus = suma pagada × 0.5', () => {
  const ctx = makeCtx({
    asignaciones: [2, 3],
    datosConsumo: [consumo(2, 50), consumo(3, 50)],   // ambas llegan particip
    objConsumo:   [objetivo(2), objetivo(3)],
  });
  const [sup] = calcularSupervisores(ctx, [
    sucRetail(2, 'A', 1),   // completo: 10000
    sucRetail(3, 'B', 0),   // sin pesos: 0 (pero llega particip)
  ]);
  const plaza = sup.plazas.find(p => p.tipo === 'retail');
  assert.equal(plaza.cumplida, true);
  assert.equal(plaza.suma_sucursales, 10000);
  assert.equal(plaza.monto, 5000);           // 10000 × 0.5
  assert.equal(sup.total_por_plaza, 5000);
  assert.equal(sup.monto, 15000);            // 10000 por sucursales + 5000 plus
});

test('plaza NO cumple si una falla participación, aunque todas lleguen a pesos', () => {
  const ctx = makeCtx({
    asignaciones: [2, 3],
    datosConsumo: [consumo(2, 50), consumo(3, 47)],   // suc 3 no llega particip
    objConsumo:   [objetivo(2), objetivo(3)],
  });
  const [sup] = calcularSupervisores(ctx, [
    sucRetail(2, 'A', 1),   // completo: 10000
    sucRetail(3, 'B', 1),   // mitad: 5000
  ]);
  const plaza = sup.plazas.find(p => p.tipo === 'retail');
  assert.equal(plaza.cumplida, false);
  assert.equal(plaza.monto, 0);
  assert.equal(sup.total_por_sucursales, 15000);  // 10000 + 5000 se pagan igual
  assert.equal(sup.total_por_plaza, 0);
});

// ── Millón intacto ────────────────────────────────────────────────────────

test('Millón sin cambios: todas llegan por efectivo → plaza paga 23000 fijo', () => {
  const ctx = makeCtx({
    asignaciones: [105],
    datosConsumo: [],
    objConsumo:   [],
  });
  const [sup] = calcularSupervisores(ctx, [sucMillon(105, 1)]);
  const plaza = sup.plazas.find(p => p.tipo === 'millon');
  assert.equal(plaza.cumplida, true);
  assert.equal(plaza.monto, 23000);
  assert.equal(sup.sucursales[0].monto_por_suc, 0);  // Millón no paga por sucursal vía plaza
});

test('Millón: una no llega por efectivo → plaza no paga', () => {
  const ctx = makeCtx({
    asignaciones: [105, 110],
    datosConsumo: [],
    objConsumo:   [],
  });
  const [sup] = calcularSupervisores(ctx, [sucMillon(105, 1), sucMillon(110, 0)]);
  const plaza = sup.plazas.find(p => p.tipo === 'millon');
  assert.equal(plaza.cumplida, false);
  assert.equal(plaza.monto, 0);
});

// ── Efectivo por sucursal (Millón, convive con la plaza) ───────────────────

test('Millón: sucursal llega por efectivo → cobra 6000 individual aunque la plaza no cumpla', () => {
  const ctx = makeCtx({
    asignaciones: [105, 110],
    datosConsumo: [],
    objConsumo:   [],
  });
  const [sup] = calcularSupervisores(ctx, [sucMillon(105, 1), sucMillon(110, 0)]);  // plaza no cumple
  const plaza = sup.plazas.find(p => p.tipo === 'millon');
  assert.equal(plaza.cumplida, false);
  assert.equal(plaza.monto, 0);                              // plaza no paga
  assert.equal(sup.sucursales[0].monto_efectivo_suc, 6000);  // 105 sí llegó → cobra individual
  assert.equal(sup.sucursales[1].monto_efectivo_suc, 0);     // 110 no llegó
  assert.equal(sup.total_efectivo_sucursal, 6000);
  assert.equal(sup.monto, 6000);                              // total = 0 (suc) + 0 (plaza) + 6000 (efectivo suc)
});

test('Millón: plaza cumple y además cada sucursal cobra su Efectivo individual (se suman)', () => {
  const ctx = makeCtx({
    asignaciones: [105, 110],
    datosConsumo: [],
    objConsumo:   [],
  });
  const [sup] = calcularSupervisores(ctx, [sucMillon(105, 1), sucMillon(110, 1)]);  // ambas llegan
  const plaza = sup.plazas.find(p => p.tipo === 'millon');
  assert.equal(plaza.cumplida, true);
  assert.equal(plaza.monto, 23000);
  assert.equal(sup.total_efectivo_sucursal, 12000);  // 6000 + 6000
  assert.equal(sup.monto, 35000);                    // 23000 (plaza) + 12000 (efectivo suc)
});
