import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escalonAlcanzado, agruparVigencias, vigenciaParaPeriodo, periodosAlcanzados,
  armarVista, validarVigencia,
} from './vendedoresView.js';

const UMBRALES = { primer: 100, segundo: 110, tercer: 126.5 };

test('escalonAlcanzado cubre los cuatro tramos', () => {
  assert.equal(escalonAlcanzado(99.99, UMBRALES), 0);
  assert.equal(escalonAlcanzado(105,   UMBRALES), 1);
  assert.equal(escalonAlcanzado(120,   UMBRALES), 2);
  assert.equal(escalonAlcanzado(130,   UMBRALES), 3);
});

test('escalonAlcanzado: venta igual al umbral alcanza ese escalon (>= como el SP)', () => {
  assert.equal(escalonAlcanzado(100,   UMBRALES), 1);
  assert.equal(escalonAlcanzado(110,   UMBRALES), 2);
  assert.equal(escalonAlcanzado(126.5, UMBRALES), 3);
});

test('escalonAlcanzado devuelve 0 si los umbrales son 0 o nulos', () => {
  assert.equal(escalonAlcanzado(5000, { primer: 0, segundo: 0, tercer: 0 }), 0);
  assert.equal(escalonAlcanzado(5000, { primer: null, segundo: null, tercer: null }), 0);
});

test('agruparVigencias arma una fila por vigencia, ordenada de la mas nueva a la mas vieja', () => {
  const rows = [
    { Descripcion: 'PRIMER ESCALON',  FullTime: 10000, Mes: 5, Año: 2025 },
    { Descripcion: 'SEGUNDO ESCALON', FullTime: 13000, Mes: 5, Año: 2025 },
    { Descripcion: 'TERCER ESCALON',  FullTime: 26000, Mes: 5, Año: 2025 },
    { Descripcion: 'PRIMER ESCALON',  FullTime: 12000, Mes: 9, Año: 2025 },
    { Descripcion: 'SEGUNDO ESCALON', FullTime: 15000, Mes: 9, Año: 2025 },
    { Descripcion: 'TERCER ESCALON',  FullTime: 30000, Mes: 9, Año: 2025 },
  ];
  assert.deepEqual(agruparVigencias(rows), [
    { anio: 2025, mes: 9, primer: 12000, segundo: 15000, tercer: 30000 },
    { anio: 2025, mes: 5, primer: 10000, segundo: 13000, tercer: 26000 },
  ]);
});

test('agruparVigencias tolera una vigencia incompleta poniendo 0 en el escalon faltante', () => {
  const rows = [{ Descripcion: 'PRIMER ESCALON', FullTime: 9000, Mes: 1, Año: 2026 }];
  assert.deepEqual(agruparVigencias(rows), [
    { anio: 2026, mes: 1, primer: 9000, segundo: 0, tercer: 0 },
  ]);
});

const VIGENCIAS = [
  { anio: 2025, mes: 9, primer: 12000, segundo: 15000, tercer: 30000 },
  { anio: 2025, mes: 5, primer: 10000, segundo: 13000, tercer: 26000 },
  { anio: 2025, mes: 1, primer: 80000, segundo: 10000, tercer: 18000 },
];

test('vigenciaParaPeriodo elige la ultima vigencia <= periodo', () => {
  assert.equal(vigenciaParaPeriodo(VIGENCIAS, '2026-06').mes, 9);
  assert.equal(vigenciaParaPeriodo(VIGENCIAS, '2025-07').mes, 5);
  assert.equal(vigenciaParaPeriodo(VIGENCIAS, '2025-09').mes, 9, 'el mes exacto de la vigencia ya la aplica');
  assert.equal(vigenciaParaPeriodo(VIGENCIAS, '2025-01').anio, 2025);
});

test('vigenciaParaPeriodo devuelve null si no hay ninguna vigencia aplicable', () => {
  assert.equal(vigenciaParaPeriodo(VIGENCIAS, '2024-12'), null);
  assert.equal(vigenciaParaPeriodo([], '2026-06'), null);
});

test('periodosAlcanzados de una vigencia intermedia termina el mes antes de la siguiente', () => {
  assert.deepEqual(periodosAlcanzados(VIGENCIAS, VIGENCIAS[1]), { desde: '2025-05', hasta: '2025-08' });
});

test('periodosAlcanzados de la vigencia mas nueva no tiene fin', () => {
  assert.deepEqual(periodosAlcanzados(VIGENCIAS, VIGENCIAS[0]), { desde: '2025-09', hasta: null });
});

test('periodosAlcanzados cruza el fin de año', () => {
  const vigs = [
    { anio: 2026, mes: 1, primer: 1, segundo: 2, tercer: 3 },
    { anio: 2025, mes: 12, primer: 1, segundo: 2, tercer: 3 },
  ];
  assert.deepEqual(periodosAlcanzados(vigs, vigs[1]), { desde: '2025-12', hasta: '2025-12' });
});

// Filas como las devuelve la query del router: una por vendedor, con los
// datos de la sucursal repetidos.
function fila(over = {}) {
  return {
    sucursal_id: 2, sucursal_nombre: 'VALLEJO CALZADOS 02',
    cant_vendedores: 3, primer_escalon: 100, segundo_escalon: 110, tercer_escalon: 126.5,
    importe_primer: 12000, importe_segundo: 15000, importe_tercer: 30000,
    legajo: '1621', nombre: 'PEREZ JUAN', parcial: '-', parcial_actual: '-',
    venta_real: 105, dias_venta: 25, venta_calculada: 105, vta_proporcional: 0,
    dias_licencia: 0, comisiona: 1, comision: 12000,
    ...over,
  };
}

test('armarVista agrupa por sucursal, ordena y suma totales', () => {
  const vista = armarVista([
    fila({ legajo: '1680', venta_calculada: 130, comision: 30000 }),
    fila({ legajo: '1621', venta_calculada: 105, comision: 12000 }),
    fila({ sucursal_id: 3, sucursal_nombre: 'VALLEJO CALZADOS 03', legajo: '1035',
           venta_calculada: 50, comision: 0, cant_vendedores: 2.5 }),
  ]);

  assert.equal(vista.sucursales.length, 2);
  assert.deepEqual(vista.sucursales.map(s => s.sucursal_id), [2, 3]);
  assert.deepEqual(vista.sucursales[0].vendedores.map(v => v.legajo), ['1621', '1680']);
  assert.equal(vista.sucursales[0].total_comision, 42000);
  assert.equal(vista.sucursales[1].total_comision, 0);
  assert.deepEqual(vista.totales, { sucursales: 2, vendedores: 3, comision: 42000 });
});

test('armarVista deriva el escalon sumando venta calculada mas proporcional', () => {
  const vista = armarVista([fila({ venta_calculada: 100, vta_proporcional: 11, comision: 15000 })]);
  assert.equal(vista.sucursales[0].vendedores[0].escalon, 2);
  assert.equal(vista.sucursales[0].vendedores[0].desfasado, false);
});

test('armarVista: part time cobra la mitad y no se marca desfasado', () => {
  const vista = armarVista([fila({ parcial: 'X', venta_calculada: 130, comision: 15000 })]);
  const v = vista.sucursales[0].vendedores[0];
  assert.equal(v.jornada, 'part');
  assert.equal(v.escalon, 3);
  assert.equal(v.desfasado, false, '30000 / 2 = 15000 es lo esperado para part time');
});

test('armarVista marca desfasado cuando la comision guardada no coincide con el escalon', () => {
  const vista = armarVista([fila({ venta_calculada: 130, comision: 15000 })]);
  const v = vista.sucursales[0].vendedores[0];
  assert.equal(v.escalon, 3);
  assert.equal(v.desfasado, true, 'full time en esc.3 deberia cobrar 30000');
});

test('armarVista trata la comision nula como 0 y la marca desfasada si correspondia cobrar', () => {
  const vista = armarVista([fila({ venta_calculada: 130, comision: null })]);
  assert.equal(vista.sucursales[0].vendedores[0].comision, 0);
  assert.equal(vista.sucursales[0].vendedores[0].desfasado, true);
});

test('armarVista no marca desfasado por diferencias de centavos', () => {
  const vista = armarVista([fila({ venta_calculada: 130, comision: 30000.0000001 })]);
  assert.equal(vista.sucursales[0].vendedores[0].desfasado, false);
});

test('armarVista avisa si la jornada actual difiere de la congelada', () => {
  const vista = armarVista([fila({ parcial: '-', parcial_actual: 'X' })]);
  assert.equal(vista.sucursales[0].vendedores[0].jornada_cambio, true);
  const igual = armarVista([fila({ parcial: '-', parcial_actual: '-' })]);
  assert.equal(igual.sucursales[0].vendedores[0].jornada_cambio, false);
});

test('armarVista con cero filas devuelve estructura vacia, no error', () => {
  assert.deepEqual(armarVista([]), {
    sucursales: [],
    totales: { sucursales: 0, vendedores: 0, comision: 0 },
  });
});

test('validarVigencia acepta una vigencia nueva bien formada', () => {
  const r = validarVigencia({ anio: 2026, mes: 8, primer: 15000, segundo: 18000, tercer: 35000 },
                            VIGENCIAS, 'crear');
  assert.deepEqual(r, { ok: true });
});

test('validarVigencia rechaza duplicar una vigencia existente al crear', () => {
  const r = validarVigencia({ anio: 2025, mes: 9, primer: 1, segundo: 2, tercer: 3 },
                            VIGENCIAS, 'crear');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.error, /ya existe/i);
});

test('validarVigencia rechaza editar o borrar una vigencia inexistente', () => {
  for (const modo of ['editar', 'borrar']) {
    const r = validarVigencia({ anio: 2030, mes: 4, primer: 1, segundo: 2, tercer: 3 },
                              VIGENCIAS, modo);
    assert.equal(r.ok, false, modo);
    assert.equal(r.status, 404, modo);
  }
});

test('validarVigencia rechaza borrar la ultima vigencia que queda', () => {
  const una = [{ anio: 2025, mes: 9, primer: 1, segundo: 2, tercer: 3 }];
  const r = validarVigencia({ anio: 2025, mes: 9 }, una, 'borrar');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.error, /unica vigencia|única vigencia/i);
});

test('validarVigencia valida mes, anio y montos', () => {
  const base = { anio: 2026, mes: 8, primer: 1000, segundo: 2000, tercer: 3000 };
  const casos = [
    { ...base, mes: 0 },
    { ...base, mes: 13 },
    { ...base, mes: 'agosto' },
    { ...base, anio: 1999 },
    { ...base, anio: 2101 },
    { ...base, primer: -1 },
    { ...base, segundo: 1500.5 },
    { ...base, tercer: 'mucho' },
    { ...base, tercer: null },
  ];
  for (const c of casos) {
    const r = validarVigencia(c, VIGENCIAS, 'crear');
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.equal(r.status, 400, JSON.stringify(c));
  }
});

test('validarVigencia acepta monto 0 (escalon que no paga)', () => {
  const r = validarVigencia({ anio: 2026, mes: 8, primer: 0, segundo: 0, tercer: 0 },
                            VIGENCIAS, 'crear');
  assert.equal(r.ok, true);
});

test('validarVigencia en modo borrar no exige montos', () => {
  const r = validarVigencia({ anio: 2025, mes: 5 }, VIGENCIAS, 'borrar');
  assert.deepEqual(r, { ok: true });
});
