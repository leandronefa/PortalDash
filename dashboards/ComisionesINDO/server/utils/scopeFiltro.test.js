import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarPorSucursal } from './scopeFiltro.js';

test('sin restriccion (permitidas=null) devuelve todas las filas sin tocar', () => {
  const rows = [{ sucursal_id: 1 }, { sucursal_id: 2 }];
  assert.deepEqual(filtrarPorSucursal(rows, null), rows);
});

test('filtra por el campo por defecto sucursal_id', () => {
  const rows = [{ sucursal_id: 1 }, { sucursal_id: 2 }, { sucursal_id: 3 }];
  assert.deepEqual(filtrarPorSucursal(rows, [2, 3]), [{ sucursal_id: 2 }, { sucursal_id: 3 }]);
});

test('permitidas vacio devuelve array vacio', () => {
  const rows = [{ sucursal_id: 1 }];
  assert.deepEqual(filtrarPorSucursal(rows, []), []);
});

test('acepta un nombre de campo distinto (ej. id_sucursal)', () => {
  const rows = [{ id_sucursal: 10 }, { id_sucursal: 20 }];
  assert.deepEqual(filtrarPorSucursal(rows, [20], 'id_sucursal'), [{ id_sucursal: 20 }]);
});

test('acepta el campo "id" (tabla de sucursales, donde la fila ES la sucursal)', () => {
  const rows = [{ id: 1, nombre: 'A' }, { id: 5, nombre: 'B' }];
  assert.deepEqual(filtrarPorSucursal(rows, [5], 'id'), [{ id: 5, nombre: 'B' }]);
});
