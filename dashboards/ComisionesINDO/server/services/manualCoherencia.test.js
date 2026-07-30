/**
 * manualCoherencia.test.js
 *
 * Guardarraíl contra la desincronización entre el manual de uso
 * (docs/MANUAL.md, la sección AYUDA de la app) y el motor de cálculo.
 *
 * El manual afirma números concretos. Si alguien cambia una regla del motor
 * y no actualiza el manual, los usuarios liquidan con instrucciones falsas.
 * Este archivo cierra el candado por los dos lados:
 *
 *   1. Deriva el umbral REAL del motor probando su comportamiento
 *      (no lee constantes: las llama y mira qué devuelve).
 *   2. Exige que el manual afirme textualmente ese mismo número.
 *
 * Si falla la parte 1 → cambió el motor: actualizá docs/MANUAL.md.
 * Si falla la parte 2 → alguien reescribió el manual: verificá el número.
 *
 * NO cubre (no se puede desde acá, y conviene saberlo):
 *   - Los montos en pesos ($10.000 / $9.000 / $8.000 de Supervisores,
 *     $23.000 por plaza Millón, el factor 0,5 de plaza, los montos de
 *     cajeros y operadores). No son constantes del código: viven en la DB
 *     (tbl_CoVenAppINDO_Montos*) y se editan desde el ABM de Montos. Un test
 *     sin DB no puede verificarlos.
 *   - Operadores Millón (full-equivalentes, venta × 2): necesita un contexto
 *     de fixtures mucho más grande; queda pendiente si aparece una tercera
 *     regla que dependa de eso.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calcularSucursal, calcularCajeros, calcularEncargados } from './calcEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUTA_MANUAL = path.join(__dirname, '..', '..', 'docs', 'MANUAL.md');

const manual = await readFile(RUTA_MANUAL, 'utf8');

// Afirmar que el manual dice algo, con un mensaje que explique qué revisar.
function manualAfirma(texto, seccion) {
  assert.ok(
    manual.includes(texto),
    `El manual ya no afirma "${texto}" (${seccion}). ` +
    `Si cambió una regla del motor, actualizá docs/MANUAL.md; ` +
    `si solo se reescribió la redacción, ajustá este test.`
  );
}

// ── Escalones ─────────────────────────────────────────────────────────────────
// El motor no exporta getEscalon(), así que el umbral se deriva de
// calcularSucursal(): con objetivo = 1, el ratio es igual a las ventas.
function escalonDe(ratio) {
  const fila = calcularSucursal({
    sucursal:      { id: 1, nombre: 'Test', con_efectivo: 0 },
    ranking:       { categoria: 'C' },
    multiplicador: 1,
    consumo:       { ventas: ratio },
    efectivo:      null,
    reporte:       null,
    objConsumo:    { primer_escalon: 1 },
    objEfectivo:   null,
    // Vacías: el escalón no depende de los montos, y `.find()` sobre []
    // devuelve undefined, que el motor resuelve como 0.
    montos: [], montosVendedor: [], montosSupervisor: [],
    montosPrestamaos: [], montosCajero: []
  });
  return fila.escalon_consumo;
}

// Los umbrales tal como los afirma el manual (sección 9).
const UMBRAL_E1 = 1.00;
const UMBRAL_E2 = 1.10;
const UMBRAL_E3 = 1.10 * 1.15;   // 1,265 = 126,5%
const TOLERANCIA = 0.04;         // 4%

const EPS = 1e-4;                // margen relativo, para no depender del último bit del float

test('los umbrales de escalón del motor son los que afirma el manual', () => {
  for (const [nombre, umbral, escalon] of [
    ['E1', UMBRAL_E1, 1],
    ['E2', UMBRAL_E2, 2],
    ['E3', UMBRAL_E3, 3]
  ]) {
    const borde = umbral * (1 - TOLERANCIA);
    assert.equal(
      escalonDe(borde * (1 + EPS)), escalon,
      `Justo por encima del borde de ${nombre} (${umbral} con tolerancia del ${TOLERANCIA * 100}%) el motor debería dar escalón ${escalon}`
    );
    assert.equal(
      escalonDe(borde * (1 - EPS)), escalon - 1,
      `Justo por debajo del borde de ${nombre} el motor debería quedar en escalón ${escalon - 1} — cambió el umbral o la tolerancia: actualizá la sección 9 del manual`
    );
  }

  manualAfirma('**E1**: 100% del objetivo', 'sección 9, umbral E1');
  manualAfirma('**E2**: 110% del objetivo', 'sección 9, umbral E2');
  manualAfirma('126,5% del objetivo (110% × 1,15)', 'sección 9, umbral E3');
  manualAfirma('**tolerancia del 4%**', 'sección 9, tolerancia');
});

// ── Cajeros ───────────────────────────────────────────────────────────────────
function cajero({ vtaVtaTot, objParticip, montoCajero, jornada }) {
  const sucResultados = [{ sucursal_id: 1, sucursal_nombre: 'Test', categoria: 'C' }];
  const ctx = {
    cajerosSucursal: [{ nro_vendedor: 1, nombre: 'Test', sucursal_id: 1, parcial_override: jornada }],
    montosCajero:    [{ categoria_suc: 'C', monto: montoCajero }],
    datosConsumo:    [{ sucursal_id: 1, vta_vta_tot: vtaVtaTot, obj_particip_pct: objParticip }]
  };
  return calcularCajeros(ctx, sucResultados)[0];
}

test('la condición de comisión de cajeros es la que afirma el manual', () => {
  // El manual dice: supera el 96% del objetivo, estricto (96% exacto no alcanza).
  assert.equal(
    cajero({ vtaVtaTot: 96, objParticip: 100, montoCajero: 20000, jornada: 'full' }).comisiona,
    false,
    'Al 96% exacto el cajero NO debería comisionar — cambió el umbral: actualizá la sección 11 del manual'
  );
  assert.equal(
    cajero({ vtaVtaTot: 96.01, objParticip: 100, montoCajero: 20000, jornada: 'full' }).comisiona,
    true,
    'Por encima del 96% el cajero debería comisionar'
  );

  // El manual dice: sin objetivo de participación cargado, no comisiona.
  assert.equal(
    cajero({ vtaVtaTot: 80, objParticip: 0, montoCajero: 20000, jornada: 'full' }).comisiona,
    false,
    'Sin objetivo de participación el cajero no debería comisionar'
  );

  manualAfirma('supera el 96% del objetivo de participación', 'sección 11, umbral de cajeros');
  manualAfirma('96% exacto no alcanza', 'sección 11, umbral estricto');
  manualAfirma('no tiene objetivo de participación cargado, el cajero no comisiona', 'sección 11, sin objetivo');
});

test('el part-time de cajeros cobra el 50% redondeado a miles, como afirma el manual', () => {
  // 21.000 / 2 = 10.500 → redondeo a miles = 11.000. Fija el 0,5 y el paso de 1.000
  // en una sola aserción: con otro divisor o otro paso, el número cambia.
  const r = cajero({ vtaVtaTot: 100, objParticip: 100, montoCajero: 21000, jornada: 'part' });
  assert.equal(r.comisiona, true);
  assert.equal(
    r.monto, 11000,
    'El part-time debería cobrar 11.000 (50% de 21.000 redondeado a miles) — cambió el porcentaje o el redondeo: actualizá la sección 11 del manual'
  );

  const full = cajero({ vtaVtaTot: 100, objParticip: 100, montoCajero: 21000, jornada: 'full' });
  assert.equal(full.monto, 21000, 'El full-time debería cobrar el monto completo');

  manualAfirma('cobra el **50%** de ese monto, redondeado a múltiplos de $1.000', 'sección 11, part-time');
});

// ── Indicador G (participación) ───────────────────────────────────────────────
function llegaParticip(vtaVtaTot, participacionObjetivo) {
  const sucResultados = [{
    sucursal_id: 1, sucursal_nombre: 'Test', categoria: 'C',
    escalon_consumo: 0, ratio_consumo: 0
  }];
  const ctx = {
    montos:       [],
    datosConsumo: [{ sucursal_id: 1, vta_vta_tot: vtaVtaTot }],
    objConsumo:   [{ sucursal_id: 1, participacion: participacionObjetivo }]
  };
  return calcularEncargados(ctx, sucResultados)[0].llega_particip;
}

test('el umbral del indicador G es el 4% que afirma el manual', () => {
  // G = (vta_vta_tot/100 − objetivo) / objetivo, y llega si G > −0,04.
  // El objetivo es 0,10 (10%), así que el borde está en vta_vta_tot = 9,6.
  const OBJ = 0.10;
  const bordeVta = 100 * OBJ * (1 - TOLERANCIA);   // 9,6

  assert.equal(
    llegaParticip(bordeVta * (1 + EPS), OBJ), true,
    'Justo por encima del borde, G debería llegar'
  );
  assert.equal(
    llegaParticip(bordeVta * (1 - EPS), OBJ), false,
    'Justo por debajo del borde, G no debería llegar — cambió el umbral del 4%: actualizá las secciones 12, 13 y 14 del manual'
  );

  // El manual dice: sin objetivo de participación cargado, no llega.
  assert.equal(
    llegaParticip(50, 0), false,
    'Sin objetivo de participación, G no debería llegar'
  );

  manualAfirma('el indicador G es mayor a −4%', 'sección 14, umbral de participación');
  manualAfirma('no tiene objetivo de participación cargado', 'sección 14, sin objetivo');
});
