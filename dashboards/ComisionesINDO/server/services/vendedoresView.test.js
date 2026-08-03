import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escalonAlcanzado, agruparVigencias, vigenciaParaPeriodo, periodosAlcanzados,
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
