# Módulo Vendedores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al dashboard ComisionesINDO una página de Vendedores que muestre el resultado del batch SQL de comisiones por período, más un ABM de los importes de escalones por vigencia para no tener que editarlos por base de datos.

**Architecture:** Toda la lógica derivable vive en un servicio puro sin DB (`server/services/vendedoresView.js`) con tests `node --test`; un router nuevo (`server/routes/vendedores.js`) hace las queries y delega el armado; una página vanilla JS (`src/pages/vendedores.js`) renderiza tabla por sucursal expandible y el modal de vigencias. **No se crea ni modifica ningún stored procedure** y el único write nuevo va a `tbl_CoVenApp_ImportesEscalonesINDO`.

**Tech Stack:** Node.js 24 (ESM), Express 4, `mssql`, Vite 6, vanilla JS SPA, SQL Server 2008 R2 (`db_Cegid` en 10.0.0.115), tests con `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-03-vendedores-design.md` — leerlo antes de empezar.

## Global Constraints

- **Directorio de trabajo**: `C:\apps\dashboards\ComisionesINDO`. Rutas locales, nunca UNC.
- **No tocar módulos blindados**: Cajeros, Operadores Retail/Millón, Encargados Retail/Millón, Supervisores, Total, Dashboard, visores DATOS. Este plan solo **agrega** archivos y hace 3 inserciones puntuales en `server/index.js`, `src/app.js` y `src/components/sidebar.js`.
- **No tocar ningún SP** ni `server/services/calcEngine.js`.
- **SQL Server 2008 R2**: prohibido `TRY_CONVERT`, `DATEFROMPARTS`, `IIF`, `CONCAT`, `OFFSET/FETCH`. Usar `CAST`, `CASE`, `ISNULL`, `+` para concatenar.
- **Nombres de columna con ñ y acentos** (`año`, `tbl_CoVenApp_EscalonesINDO.año`): usarlos tal cual en el SQL.
- **Encoding**: NUNCA editar archivos fuente con `Set-Content`/`-replace` de PowerShell (rompe UTF-8 sin BOM). Usar las herramientas de edición o Node.
- **Frontend**: tras editar cualquier cosa en `src/` hay que correr `npm run build` antes de `Restart-Service` — el server sirve `dist/` estático. **`dist/` está en el `.gitignore` de la raíz: nunca hacer `git add dist`** (falla con "paths are ignored").
- **Strings exactos que el SP busca** en `ImportesEscalonesINDO.Descripcion`: `PRIMER ESCALON`, `SEGUNDO ESCALON`, `TERCER ESCALON` (mayúsculas, sin acento, singular).
- **Tabla de importes sin PK ni índice único**: la unicidad de vigencia se valida en la app, nunca se asume en la DB.
- **`idImportesEscalones` es IDENTITY**: los `INSERT` no la mandan.
- Tests se corren siempre con: `node --test server/services/vendedoresView.test.js`
- Suite completa del repo (debe quedar en verde al final): `node --test server/services/manualDoc.test.js src/components/markdown.test.js server/services/calcEngine.supervisores.test.js server/services/manualCoherencia.test.js server/services/vendedoresView.test.js`
- Commits en español, sin acentos en el subject (convención del repo), con el trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Servicio puro `vendedoresView.js`

Toda la lógica derivable, sin DB. Es la base de todo lo demás.

**Files:**
- Create: `server/services/vendedoresView.js`
- Test: `server/services/vendedoresView.test.js`

**Interfaces:**
- Consumes: nada (primer task).
- Produces:
  - `escalonAlcanzado(venta: number, umbrales: {primer, segundo, tercer}) → 0|1|2|3`
  - `agruparVigencias(rows: [{Descripcion, FullTime, Mes, Año}]) → [{anio, mes, primer, segundo, tercer}]` ordenado descendente por (anio, mes)
  - `vigenciaParaPeriodo(vigencias, periodo: 'YYYY-MM') → vigencia | null`
  - `periodosAlcanzados(vigencias, vigencia) → {desde: 'YYYY-MM', hasta: 'YYYY-MM' | null}`
  - `armarVista(filas) → {sucursales: [...], totales: {sucursales, vendedores, comision}}`
  - `validarVigencia(body, vigencias, modo: 'crear'|'editar'|'borrar') → {ok: boolean, status?: number, error?: string}`

- [ ] **Step 1: Escribir el test de `escalonAlcanzado` y `agruparVigencias`**

Crear `server/services/vendedoresView.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escalonAlcanzado, agruparVigencias, vigenciaParaPeriodo,
  periodosAlcanzados, armarVista, validarVigencia
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test server/services/vendedoresView.test.js`
Expected: FAIL — `Cannot find module './vendedoresView.js'`

- [ ] **Step 3: Implementación mínima de las dos funciones**

Crear `server/services/vendedoresView.js`:

```js
// Lógica pura del módulo Vendedores. No accede a la DB: recibe filas ya
// leídas y devuelve la vista que consume el frontend.
//
// Replica criterios que viven en SQL (sp_CoVenApp_LlenarEscalonesINDO y
// sp_CoVenApp_CalcularComisionesINDO). Si esos SPs cambian, estos tests
// son el lugar donde se nota.

const DESCRIPCIONES = {
  'PRIMER ESCALON':  'primer',
  'SEGUNDO ESCALON': 'segundo',
  'TERCER ESCALON':  'tercer',
};

/**
 * Escalón alcanzado por una venta. Mismo criterio que
 * sp_CoVenApp_CalcularComisionesINDO: compara de mayor a menor con >=.
 * Un umbral en 0 o nulo no se puede alcanzar (sucursal sin objetivo).
 */
export function escalonAlcanzado(venta, umbrales) {
  const v = Number(venta) || 0;
  const t = Number(umbrales?.tercer)  || 0;
  const s = Number(umbrales?.segundo) || 0;
  const p = Number(umbrales?.primer)  || 0;
  if (t > 0 && v >= t) return 3;
  if (s > 0 && v >= s) return 2;
  if (p > 0 && v >= p) return 1;
  return 0;
}

/**
 * Las 3 filas por vigencia de tbl_CoVenApp_ImportesEscalonesINDO
 * colapsadas en una fila por vigencia, de la más nueva a la más vieja.
 */
export function agruparVigencias(rows) {
  const mapa = new Map();
  for (const r of rows || []) {
    const clave = `${r.Año}-${r.Mes}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, { anio: Number(r.Año), mes: Number(r.Mes), primer: 0, segundo: 0, tercer: 0 });
    }
    const campo = DESCRIPCIONES[String(r.Descripcion || '').trim().toUpperCase()];
    if (campo) mapa.get(clave)[campo] = Number(r.FullTime) || 0;
  }
  return [...mapa.values()].sort((a, b) => (b.anio * 100 + b.mes) - (a.anio * 100 + a.mes));
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test server/services/vendedoresView.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Escribir el test de `vigenciaParaPeriodo` y `periodosAlcanzados`**

Agregar al final de `server/services/vendedoresView.test.js`:

```js
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
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `node --test server/services/vendedoresView.test.js`
Expected: FAIL — `vigenciaParaPeriodo is not a function`

- [ ] **Step 7: Implementar `vigenciaParaPeriodo` y `periodosAlcanzados`**

Agregar a `server/services/vendedoresView.js`:

```js
function clave(anio, mes) { return Number(anio) * 100 + Number(mes); }

function claveDePeriodo(periodo) {
  const [a, m] = String(periodo).split('-');
  return clave(a, m);
}

function fmtPeriodo(anio, mes) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

/**
 * Réplica del TOP 1 ... WHERE (Año*100+Mes) <= periodo ORDER BY Año DESC, Mes DESC
 * de sp_CoVenApp_LlenarEscalonesINDO. Sin vigencia aplicable → null.
 */
export function vigenciaParaPeriodo(vigencias, periodo) {
  const k = claveDePeriodo(periodo);
  const aplicables = (vigencias || []).filter(v => clave(v.anio, v.mes) <= k);
  if (!aplicables.length) return null;
  return aplicables.reduce((mejor, v) =>
    clave(v.anio, v.mes) > clave(mejor.anio, mejor.mes) ? v : mejor);
}

/**
 * Rango de períodos que gobierna una vigencia: desde ella misma hasta el mes
 * anterior a la vigencia siguiente. La más nueva no tiene fin (hasta: null).
 * Sirve para advertir en la UI qué períodos cambiarían si se los recalcula.
 */
export function periodosAlcanzados(vigencias, vigencia) {
  const k = clave(vigencia.anio, vigencia.mes);
  const siguientes = (vigencias || [])
    .filter(v => clave(v.anio, v.mes) > k)
    .sort((a, b) => clave(a.anio, a.mes) - clave(b.anio, b.mes));
  const desde = fmtPeriodo(vigencia.anio, vigencia.mes);
  if (!siguientes.length) return { desde, hasta: null };
  const sig = siguientes[0];
  const mesPrevio = sig.mes === 1 ? 12 : sig.mes - 1;
  const anioPrevio = sig.mes === 1 ? sig.anio - 1 : sig.anio;
  return { desde, hasta: fmtPeriodo(anioPrevio, mesPrevio) };
}
```

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `node --test server/services/vendedoresView.test.js`
Expected: PASS — 10 tests

- [ ] **Step 9: Commit del avance**

```bash
git add server/services/vendedoresView.js server/services/vendedoresView.test.js
git commit -m "$(cat <<'EOF'
test(comisiones-indo): escalones y vigencias de importes de vendedores

Logica pura que replica los criterios de sp_CoVenApp_LlenarEscalonesINDO
y sp_CoVenApp_CalcularComisionesINDO, sin tocar la DB.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Escribir el test de `armarVista`**

Agregar al final de `server/services/vendedoresView.test.js`:

```js
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
```

- [ ] **Step 11: Correr el test y verificar que falla**

Run: `node --test server/services/vendedoresView.test.js`
Expected: FAIL — `armarVista is not a function`

- [ ] **Step 12: Implementar `armarVista`**

Agregar a `server/services/vendedoresView.js`:

```js
function importeDeEscalon(suc, escalon) {
  if (escalon === 3) return Number(suc.importe_tercer)  || 0;
  if (escalon === 2) return Number(suc.importe_segundo) || 0;
  if (escalon === 1) return Number(suc.importe_primer)  || 0;
  return 0;
}

/**
 * Filas planas del JOIN → sucursales con sus vendedores anidados.
 *
 * La comisión que se expone es SIEMPRE la persistida en
 * tbl_CoVenApp_GrillaComisionesINDO: acá no se recalcula nada. Lo que sí se
 * deriva es el escalón alcanzado, y de la comparación entre ambos sale
 * `desfasado` — que significa "se editaron importes y este período no se
 * volvió a procesar".
 *
 * La jornada usada es la CONGELADA (`parcial`, de la grilla del período), no
 * la actual del legajo: es la que el SP aplicó al dividir por 2.
 */
export function armarVista(filas) {
  const porSucursal = new Map();

  for (const f of filas || []) {
    const id = Number(f.sucursal_id);
    if (!porSucursal.has(id)) {
      porSucursal.set(id, {
        sucursal_id: id,
        sucursal_nombre: f.sucursal_nombre || `Sucursal ${id}`,
        cant_vendedores: Number(f.cant_vendedores) || 0,
        primer_escalon:  Number(f.primer_escalon)  || 0,
        segundo_escalon: Number(f.segundo_escalon) || 0,
        tercer_escalon:  Number(f.tercer_escalon)  || 0,
        importe_primer:  Number(f.importe_primer)  || 0,
        importe_segundo: Number(f.importe_segundo) || 0,
        importe_tercer:  Number(f.importe_tercer)  || 0,
        total_comision: 0,
        vendedores: [],
      });
    }
    const suc = porSucursal.get(id);

    const ventaTotal = (Number(f.venta_calculada) || 0) + (Number(f.vta_proporcional) || 0);
    const escalon = escalonAlcanzado(ventaTotal, {
      primer: suc.primer_escalon, segundo: suc.segundo_escalon, tercer: suc.tercer_escalon,
    });
    const esPart = String(f.parcial || '').trim().toUpperCase() === 'X';
    const comision = Number(f.comision) || 0;
    const esperado = esPart ? importeDeEscalon(suc, escalon) / 2 : importeDeEscalon(suc, escalon);

    suc.vendedores.push({
      legajo: String(f.legajo).trim(),
      nombre: (f.nombre || '').trim() || `Legajo ${f.legajo}`,
      jornada: esPart ? 'part' : 'full',
      jornada_cambio: String(f.parcial_actual || '').trim().toUpperCase() !== String(f.parcial || '').trim().toUpperCase(),
      venta_real:       Number(f.venta_real)       || 0,
      dias_venta:       Number(f.dias_venta)       || 0,
      venta_calculada:  Number(f.venta_calculada)  || 0,
      vta_proporcional: Number(f.vta_proporcional) || 0,
      venta_total:      ventaTotal,
      dias_licencia:    Number(f.dias_licencia)    || 0,
      comisiona: Number(f.comisiona) === 1,
      escalon,
      comision,
      // Tolerancia de medio peso: los montos son float en SQL.
      desfasado: Math.abs(comision - esperado) > 0.5,
    });
    suc.total_comision += comision;
  }

  const sucursales = [...porSucursal.values()].sort((a, b) => a.sucursal_id - b.sucursal_id);
  for (const s of sucursales) {
    s.vendedores.sort((a, b) => (Number(a.legajo) || 0) - (Number(b.legajo) || 0));
  }

  return {
    sucursales,
    totales: {
      sucursales: sucursales.length,
      vendedores: sucursales.reduce((n, s) => n + s.vendedores.length, 0),
      comision:   sucursales.reduce((n, s) => n + s.total_comision, 0),
    },
  };
}
```

- [ ] **Step 13: Correr el test y verificar que pasa**

Run: `node --test server/services/vendedoresView.test.js`
Expected: PASS — 18 tests

- [ ] **Step 14: Escribir el test de `validarVigencia`**

Agregar al final de `server/services/vendedoresView.test.js`:

```js
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
```

- [ ] **Step 15: Correr el test y verificar que falla**

Run: `node --test server/services/vendedoresView.test.js`
Expected: FAIL — `validarVigencia is not a function`

- [ ] **Step 16: Implementar `validarVigencia`**

Agregar a `server/services/vendedoresView.js`:

```js
function esEnteroNoNegativo(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * Reglas de negocio del ABM de vigencias. La tabla no tiene PK ni índice
 * único, así que la unicidad se valida acá.
 * modo: 'crear' | 'editar' | 'borrar'
 */
export function validarVigencia(body, vigencias, modo) {
  const anio = Number(body?.anio);
  const mes  = Number(body?.mes);

  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) {
    return { ok: false, status: 400, error: 'El año debe ser un entero entre 2020 y 2100' };
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    return { ok: false, status: 400, error: 'El mes debe ser un entero entre 1 y 12' };
  }

  if (modo !== 'borrar') {
    for (const campo of ['primer', 'segundo', 'tercer']) {
      if (!esEnteroNoNegativo(body?.[campo])) {
        return { ok: false, status: 400, error: `El importe del escalón "${campo}" debe ser un entero mayor o igual a 0` };
      }
    }
  }

  const existe = (vigencias || []).some(v => v.anio === anio && v.mes === mes);

  if (modo === 'crear' && existe) {
    return { ok: false, status: 409, error: `La vigencia ${fmtPeriodo(anio, mes)} ya existe: editala en vez de crearla de nuevo` };
  }
  if (modo !== 'crear' && !existe) {
    return { ok: false, status: 404, error: `No existe la vigencia ${fmtPeriodo(anio, mes)}` };
  }
  if (modo === 'borrar' && (vigencias || []).length <= 1) {
    return { ok: false, status: 409, error: 'No se puede borrar la única vigencia: sin ninguna, el cálculo resolvería importe $0 para todos los períodos' };
  }

  return { ok: true };
}
```

- [ ] **Step 17: Correr el test y verificar que pasa**

Run: `node --test server/services/vendedoresView.test.js`
Expected: PASS — 25 tests

- [ ] **Step 18: Correr la suite completa del repo (no-regresión)**

Run:
```bash
node --test server/services/manualDoc.test.js src/components/markdown.test.js server/services/calcEngine.supervisores.test.js server/services/manualCoherencia.test.js server/services/vendedoresView.test.js
```
Expected: PASS — 58 tests (33 previos + 25 nuevos)

- [ ] **Step 19: Commit**

```bash
git add server/services/vendedoresView.js server/services/vendedoresView.test.js
git commit -m "$(cat <<'EOF'
feat(comisiones-indo): servicio puro de la vista de vendedores

armarVista agrupa por sucursal, deriva el escalon alcanzado y marca
desfasado cuando la comision guardada no coincide con el importe del
escalon (importes editados sin reprocesar el periodo). validarVigencia
cubre la unicidad que la tabla no tiene por indice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Router de lectura `GET /api/vendedores` y `GET /api/vendedores/importes`

**Files:**
- Create: `server/routes/vendedores.js`
- Modify: `server/index.js` (import + `app.use`)

**Interfaces:**
- Consumes: `armarVista`, `agruparVigencias`, `vigenciaParaPeriodo` de `server/services/vendedoresView.js` (Task 1); `filtrarPorSucursal(rows, permitidas, campo='sucursal_id')` de `server/utils/scopeFiltro.js`; `authMiddleware` de `server/middleware/auth.js`; `attachScope` + `blockWriteIfSupervisor` de `server/middleware/supervisorScope.js`.
- Produces: `GET /api/vendedores?periodo=YYYY-MM` → `{ok, periodo, vigencia, sucursales, totales}`; `GET /api/vendedores/importes?periodo=YYYY-MM` → `{ok, vigencias, vigente}`. Los consume la página del Task 4.

- [ ] **Step 1: Crear el router con los dos GET**

Crear `server/routes/vendedores.js`:

```js
import { Router } from 'express';
import { getPool, sql } from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { attachScope, blockWriteIfSupervisor } from '../middleware/supervisorScope.js';
import { filtrarPorSucursal } from '../utils/scopeFiltro.js';
import { armarVista, agruparVigencias, vigenciaParaPeriodo } from '../services/vendedoresView.js';

const router = Router();
router.use(authMiddleware);
router.use(attachScope);
router.use(blockWriteIfSupervisor);

// El cálculo de comisiones de vendedores lo corre un job SQL
// (SP_ComisionesINDO): este router SOLO lee sus resultados. Lo único que
// escribe es la tabla de vigencias de importes (ver más abajo).

function parsePeriodo(periodo) {
  if (!/^\d{4}-\d{2}$/.test(String(periodo || ''))) return null;
  const [anio, mes] = String(periodo).split('-').map(Number);
  if (mes < 1 || mes > 12) return null;
  return { anio, mes };
}

async function leerVigencias(pool) {
  const r = await pool.request().query(`
    SELECT Descripcion, FullTime, Mes, Año
    FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO
  `);
  return agruparVigencias(r.recordset);
}

// GET /api/vendedores?periodo=YYYY-MM — resultado del período por sucursal
router.get('/', async (req, res) => {
  const p = parsePeriodo(req.query.periodo);
  if (!p) return res.status(400).json({ ok: false, error: 'Período inválido (formato YYYY-MM)' });

  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('anio', sql.Int, p.anio)
      .input('mes',  sql.Int, p.mes)
      .query(`
        SELECT CAST(g.idSucursal AS INT)                AS sucursal_id,
               s.nombre                                 AS sucursal_nombre,
               e.CantidadVendedores                     AS cant_vendedores,
               e.PrimerEscalon                          AS primer_escalon,
               e.SegundoEcalon                          AS segundo_escalon,
               e.TercerEscalon                          AS tercer_escalon,
               e.ImportePrimerEscalon                   AS importe_primer,
               e.ImporteSegundoEcalon                   AS importe_segundo,
               e.ImporteTercerEscalon                   AS importe_tercer,
               g.idVendedor                             AS legajo,
               LTRIM(RTRIM(ISNULL(v.APELLIDO,'') + ' ' + ISNULL(v.NOMBRE,''))) AS nombre,
               g.parcial                                AS parcial,
               v.GCL_TEMPSPARTIEL                       AS parcial_actual,
               g.ventareal                              AS venta_real,
               g.DiasVenta                              AS dias_venta,
               g.ventacalculada                         AS venta_calculada,
               g.vtaproporcional                        AS vta_proporcional,
               g.diaslicencia                           AS dias_licencia,
               g.comisiona                              AS comisiona,
               c.comision                               AS comision
        FROM dbo.tbl_CoVenApp_GrillaVendedoresINDO g
        INNER JOIN dbo.tbl_CoVenApp_EscalonesINDO e
          ON e.Sucursal = CAST(g.idSucursal AS INT)
         AND e.mes = g.mes AND e.año = g.año
        LEFT JOIN dbo.tbl_CoVenApp_GrillaComisionesINDO c
          ON c.idVendedor = g.idVendedor AND c.mes = g.mes AND c.año = g.año
        LEFT JOIN dbo.tbl_CoVenApp_Vendedores v
          ON v.NRO_VENDEDOR = g.idVendedor
        LEFT JOIN dbo.tbl_CoVenAppINDO_Sucursales s
          ON s.id = CAST(g.idSucursal AS INT)
        WHERE g.año = @anio AND g.mes = @mes
        ORDER BY CAST(g.idSucursal AS INT), g.idVendedor
      `);

    // Scope de supervisor (perfil 8): se filtra ANTES de agrupar.
    const filas = filtrarPorSucursal(r.recordset, req.sucursalesPermitidas);
    const vista = armarVista(filas);
    const vigencias = await leerVigencias(pool);

    res.json({
      ok: true,
      periodo: req.query.periodo,
      vigencia: vigenciaParaPeriodo(vigencias, req.query.periodo),
      ...vista,
    });
  } catch (err) {
    console.error('[vendedores GET /]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

// GET /api/vendedores/importes?periodo=YYYY-MM — vigencias, marcando la vigente
router.get('/importes', async (req, res) => {
  try {
    const pool = await getPool();
    const vigencias = await leerVigencias(pool);
    const periodo = /^\d{4}-\d{2}$/.test(String(req.query.periodo || '')) ? req.query.periodo : null;
    res.json({
      ok: true,
      vigencias,
      vigente: periodo ? vigenciaParaPeriodo(vigencias, periodo) : null,
    });
  } catch (err) {
    console.error('[vendedores GET /importes]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

export default router;
```

**Nota sobre los JOIN**: la spec decía `INNER JOIN` para Comisiones y Vendedores; acá van `LEFT JOIN` a propósito, para que un vendedor sin fila en `GrillaComisionesINDO` (o sin ficha en `Vendedores`) aparezca igual con comisión 0 y quede marcado `desfasado` en vez de desaparecer de la vista. El `INNER JOIN` a `EscalonesINDO` sí se mantiene: sin escalones no hay nada que mostrar.

- [ ] **Step 2: Registrar el router en `server/index.js`**

Agregar el import junto a los otros (después de `import operadoresRoutes ...`):

```js
import vendedoresRoutes from './routes/vendedores.js';
```

Y el montaje después de `app.use('/api/operadores',   operadoresRoutes);`:

```js
app.use('/api/vendedores',   vendedoresRoutes);
```

- [ ] **Step 3: Verificar que el server arranca sin errores**

Run: `node -e "import('./server/routes/vendedores.js').then(()=>console.log('router OK'))"`
Expected: `router OK` (valida imports y sintaxis sin levantar el puerto ni pegarle a la DB).

- [ ] **Step 4: Smoke test contra la DB real, sin pasar por el servicio de Windows**

Crear un script temporal `scripts/smoke-vendedores.mjs`:

```js
// Smoke test de lectura del módulo Vendedores. Solo lee.
import { getPool, sql } from '../server/config/db.js';
import { armarVista, agruparVigencias, vigenciaParaPeriodo } from '../server/services/vendedoresView.js';
import dotenv from 'dotenv'; dotenv.config();

const [anio, mes] = (process.argv[2] || '2026-06').split('-').map(Number);
const pool = await getPool();

const r = await pool.request().input('anio', sql.Int, anio).input('mes', sql.Int, mes).query(`
  SELECT CAST(g.idSucursal AS INT) AS sucursal_id, s.nombre AS sucursal_nombre,
         e.CantidadVendedores AS cant_vendedores, e.PrimerEscalon AS primer_escalon,
         e.SegundoEcalon AS segundo_escalon, e.TercerEscalon AS tercer_escalon,
         e.ImportePrimerEscalon AS importe_primer, e.ImporteSegundoEcalon AS importe_segundo,
         e.ImporteTercerEscalon AS importe_tercer, g.idVendedor AS legajo,
         LTRIM(RTRIM(ISNULL(v.APELLIDO,'') + ' ' + ISNULL(v.NOMBRE,''))) AS nombre,
         g.parcial AS parcial, v.GCL_TEMPSPARTIEL AS parcial_actual,
         g.ventareal AS venta_real, g.DiasVenta AS dias_venta,
         g.ventacalculada AS venta_calculada, g.vtaproporcional AS vta_proporcional,
         g.diaslicencia AS dias_licencia, g.comisiona AS comisiona, c.comision AS comision
  FROM dbo.tbl_CoVenApp_GrillaVendedoresINDO g
  INNER JOIN dbo.tbl_CoVenApp_EscalonesINDO e
    ON e.Sucursal = CAST(g.idSucursal AS INT) AND e.mes = g.mes AND e.año = g.año
  LEFT JOIN dbo.tbl_CoVenApp_GrillaComisionesINDO c
    ON c.idVendedor = g.idVendedor AND c.mes = g.mes AND c.año = g.año
  LEFT JOIN dbo.tbl_CoVenApp_Vendedores v ON v.NRO_VENDEDOR = g.idVendedor
  LEFT JOIN dbo.tbl_CoVenAppINDO_Sucursales s ON s.id = CAST(g.idSucursal AS INT)
  WHERE g.año = @anio AND g.mes = @mes
  ORDER BY CAST(g.idSucursal AS INT), g.idVendedor
`);

const vista = armarVista(r.recordset);
const vigs  = agruparVigencias((await pool.request().query(
  'SELECT Descripcion, FullTime, Mes, Año FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO')).recordset);

console.log('filas SQL:', r.recordset.length);
console.log('totales  :', vista.totales);
console.log('vigencia :', vigenciaParaPeriodo(vigs, process.argv[2] || '2026-06'));
console.log('desfasados:', vista.sucursales.flatMap(s => s.vendedores).filter(v => v.desfasado).length);
console.log('primera suc:', JSON.stringify(vista.sucursales[0], null, 1).slice(0, 900));
process.exit(0);
```

Run: `node scripts/smoke-vendedores.mjs 2026-06`

Expected: ~158 filas, 32 sucursales, `vigencia` = `{anio:2025, mes:9, primer:12000, segundo:15000, tercer:30000}`, y `desfasados: 0` (los datos están recién calculados por el batch, así que no debería haber ninguno). **Si aparecen desfasados, no seguir: revisar `escalonAlcanzado` o el mapeo de columnas antes de avanzar.**

- [ ] **Step 5: Verificar el período vacío**

Run: `node scripts/smoke-vendedores.mjs 2030-01`
Expected: `filas SQL: 0`, `totales: { sucursales: 0, vendedores: 0, comision: 0 }`, sin excepción.

- [ ] **Step 6: Borrar el script temporal y commitear**

```bash
rm scripts/smoke-vendedores.mjs
git add server/routes/vendedores.js server/index.js
git commit -m "$(cat <<'EOF'
feat(comisiones-indo): endpoints de lectura de vendedores

GET /api/vendedores devuelve el resultado del batch SQL agrupado por
sucursal (con scope de supervisor aplicado antes de agrupar) y la vigencia
de importes que rige el periodo; GET /api/vendedores/importes lista las
vigencias. Ningun SP se toca.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ABM de vigencias — `POST`, `PUT`, `DELETE /api/vendedores/importes`

**Files:**
- Modify: `server/routes/vendedores.js` (agregar los 3 handlers al final, antes del `export default`)

**Interfaces:**
- Consumes: `validarVigencia(body, vigencias, modo)` y `leerVigencias(pool)` (helper local del Task 2).
- Produces: `POST /importes` con body `{anio, mes, primer, segundo, tercer}` → `201 {ok, vigencia}`; `PUT /importes/:anio/:mes` con body `{primer, segundo, tercer}` → `200 {ok, vigencia}`; `DELETE /importes/:anio/:mes` → `200 {ok}`. Los consume el modal del Task 5.

- [ ] **Step 1: Agregar los 3 handlers**

En `server/routes/vendedores.js`, agregar el import de `validarVigencia`:

```js
import { armarVista, agruparVigencias, vigenciaParaPeriodo, validarVigencia } from '../services/vendedoresView.js';
```

Y antes de `export default router;`:

```js
// ── ABM de vigencias de importes ─────────────────────────────────────────────
// Único write del módulo. La semántica es la que ya tiene el SQL: una vigencia
// rige desde su (año, mes) hasta que aparece una posterior. Para cambiar los
// montos se crea una vigencia nueva; los períodos anteriores siguen resolviendo
// la vieja, así que recalcularlos da el mismo resultado que hoy.

const DESCRIPCIONES_SQL = [
  ['PRIMER ESCALON',  'primer'],
  ['SEGUNDO ESCALON', 'segundo'],
  ['TERCER ESCALON',  'tercer'],
];

async function insertarVigencia(tx, anio, mes, body) {
  for (const [descripcion, campo] of DESCRIPCIONES_SQL) {
    await new sql.Request(tx)
      .input('desc',  sql.VarChar(50), descripcion)
      .input('monto', sql.Decimal(18, 2), body[campo])
      .input('mes',   sql.Int, mes)
      .input('anio',  sql.Int, anio)
      .query(`INSERT INTO dbo.tbl_CoVenApp_ImportesEscalonesINDO (Descripcion, FullTime, Mes, Año)
              VALUES (@desc, @monto, @mes, @anio)`);
  }
}

// POST /api/vendedores/importes — nueva vigencia (3 filas, en transacción)
router.post('/importes', async (req, res) => {
  try {
    const pool = await getPool();
    const vigencias = await leerVigencias(pool);
    const v = validarVigencia(req.body, vigencias, 'crear');
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    const anio = Number(req.body.anio), mes = Number(req.body.mes);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await insertarVigencia(tx, anio, mes, req.body);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    console.log(`[vendedores] vigencia creada ${anio}-${mes} por ${req.user?.usuario}`);
    res.status(201).json({ ok: true, vigencia: { anio, mes, primer: req.body.primer, segundo: req.body.segundo, tercer: req.body.tercer } });
  } catch (err) {
    console.error('[vendedores POST /importes]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

// PUT /api/vendedores/importes/:anio/:mes — reemplaza los 3 montos
router.put('/importes/:anio/:mes', async (req, res) => {
  const anio = Number(req.params.anio), mes = Number(req.params.mes);
  try {
    const pool = await getPool();
    const vigencias = await leerVigencias(pool);
    const v = validarVigencia({ ...req.body, anio, mes }, vigencias, 'editar');
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    // Borrar + reinsertar: la tabla no tiene clave por (Descripcion, Mes, Año),
    // así que un UPDATE por descripción podría tocar filas duplicadas de una
    // carga manual vieja. Reinsertar deja la vigencia con exactamente 3 filas.
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input('mes', sql.Int, mes).input('anio', sql.Int, anio)
        .query('DELETE FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO WHERE Mes=@mes AND Año=@anio');
      await insertarVigencia(tx, anio, mes, req.body);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    console.log(`[vendedores] vigencia editada ${anio}-${mes} por ${req.user?.usuario}`);
    res.json({ ok: true, vigencia: { anio, mes, primer: req.body.primer, segundo: req.body.segundo, tercer: req.body.tercer } });
  } catch (err) {
    console.error('[vendedores PUT /importes]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});

// DELETE /api/vendedores/importes/:anio/:mes — borra la vigencia completa
router.delete('/importes/:anio/:mes', async (req, res) => {
  const anio = Number(req.params.anio), mes = Number(req.params.mes);
  try {
    const pool = await getPool();
    const vigencias = await leerVigencias(pool);
    const v = validarVigencia({ anio, mes }, vigencias, 'borrar');
    if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });

    await pool.request()
      .input('mes', sql.Int, mes).input('anio', sql.Int, anio)
      .query('DELETE FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO WHERE Mes=@mes AND Año=@anio');
    console.log(`[vendedores] vigencia borrada ${anio}-${mes} por ${req.user?.usuario}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[vendedores DELETE /importes]', err);
    res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
});
```

- [ ] **Step 2: Verificar sintaxis e imports**

Run: `node -e "import('./server/routes/vendedores.js').then(()=>console.log('router OK'))"`
Expected: `router OK`

- [ ] **Step 3: Probar el ciclo completo contra la DB real con una vigencia ficticia**

Crear `scripts/smoke-vigencias.mjs`:

```js
// Prueba el ciclo crear → editar → borrar con una vigencia FICTICIA (2099-01).
// No toca ninguna de las 3 vigencias reales.
import { getPool, sql } from '../server/config/db.js';
import { agruparVigencias, validarVigencia } from '../server/services/vendedoresView.js';
import dotenv from 'dotenv'; dotenv.config();

const pool = await getPool();
const leer = async () => agruparVigencias((await pool.request().query(
  'SELECT Descripcion, FullTime, Mes, Año FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO')).recordset);

const antes = await leer();
console.log('vigencias antes:', antes.map(v => `${v.anio}-${v.mes}`).join(' '));

const ins = async (anio, mes, m) => {
  for (const [d, k] of [['PRIMER ESCALON','primer'],['SEGUNDO ESCALON','segundo'],['TERCER ESCALON','tercer']]) {
    await pool.request().input('d', sql.VarChar(50), d).input('m', sql.Decimal(18,2), m[k])
      .input('mes', sql.Int, mes).input('a', sql.Int, anio)
      .query('INSERT INTO dbo.tbl_CoVenApp_ImportesEscalonesINDO (Descripcion, FullTime, Mes, Año) VALUES (@d,@m,@mes,@a)');
  }
};

await ins(2099, 1, { primer: 1, segundo: 2, tercer: 3 });
console.log('creada  :', (await leer()).find(v => v.anio === 2099));
console.log('duplicar:', validarVigencia({ anio: 2099, mes: 1, primer: 1, segundo: 2, tercer: 3 }, await leer(), 'crear'));

await pool.request().input('mes', sql.Int, 1).input('a', sql.Int, 2099)
  .query('DELETE FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO WHERE Mes=@mes AND Año=@a');
await ins(2099, 1, { primer: 111, segundo: 222, tercer: 333 });
console.log('editada :', (await leer()).find(v => v.anio === 2099));

await pool.request().input('mes', sql.Int, 1).input('a', sql.Int, 2099)
  .query('DELETE FROM dbo.tbl_CoVenApp_ImportesEscalonesINDO WHERE Mes=@mes AND Año=@a');
const despues = await leer();
console.log('vigencias despues:', despues.map(v => `${v.anio}-${v.mes}`).join(' '));
console.log(JSON.stringify(antes) === JSON.stringify(despues) ? 'LIMPIO: la tabla quedo igual' : '⚠ QUEDO BASURA');
process.exit(0);
```

Run: `node scripts/smoke-vigencias.mjs`

Expected: `creada: {anio:2099, mes:1, primer:1, segundo:2, tercer:3}`, `duplicar: {ok:false, status:409, ...}`, `editada: {... primer:111 ...}`, y al final **`LIMPIO: la tabla quedo igual`** con las 3 vigencias reales (2025-9, 2025-5, 2025-1) intactas.

- [ ] **Step 4: Borrar el script y commitear**

```bash
rm scripts/smoke-vigencias.mjs
git add server/routes/vendedores.js
git commit -m "$(cat <<'EOF'
feat(comisiones-indo): ABM de vigencias de importes de escalones

POST/PUT/DELETE sobre tbl_CoVenApp_ImportesEscalonesINDO, las 3 filas de
cada vigencia en una transaccion. El PUT borra y reinserta porque la tabla
no tiene clave por (Descripcion, Mes, Anio). Perfil 8 no llega: lo corta
blockWriteIfSupervisor.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Página `vendedores.js` — visor por sucursal

**Files:**
- Create: `src/pages/vendedores.js`
- Modify: `src/app.js` (import + entrada en `ROUTES`)
- Modify: `src/components/sidebar.js` (entrada de menú entre `total` y `cajeros`)

**Interfaces:**
- Consumes: `GET /api/vendedores?periodo=` (Task 2); `api` e `isSupervisorReadonly` de `src/api/client.js`; `showToast` de `src/components/toast.js`; `exportToCSV` de `src/components/exportExcel.js`.
- Produces: `renderVendedores(container, periodo)` (default-exportada como named export). El Task 5 le agrega el modal dentro del mismo archivo.

- [ ] **Step 1: Crear la página**

Crear `src/pages/vendedores.js`:

```js
import { api, isSupervisorReadonly } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(v) {
  if (v == null || v === 0) return '<span style="color:var(--color-muted)">—</span>';
  return '$' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function fmtNum(v) {
  return Number(v || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function fmtVend(v) {
  // CantidadVendedores es decimal: los part time pesan 0,5.
  return Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function escBadge(esc) {
  if (esc === 3) return '<span class="badge badge-a">E3</span>';
  if (esc === 2) return '<span class="badge badge-b">E2</span>';
  if (esc === 1) return '<span class="badge badge-d">E1</span>';
  return '<span class="badge badge-c">E0</span>';
}

function jornadaBadge(v) {
  return v === 'part'
    ? '<span class="badge badge-e" title="Part time: cobra la mitad del importe">PT</span>'
    : '<span class="badge badge-c" title="Full time">FT</span>';
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Render principal ──────────────────────────────────────────────────────────

export async function renderVendedores(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">

      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="font-size:20px;font-weight:700;margin:0">🛍️ Vendedores — ${esc(periodo)}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="vend-search" type="text" placeholder="Sucursal o vendedor…"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   font-size:13px;background:var(--color-surface);color:var(--color-text);width:200px">
          <button id="vend-export" class="btn btn-outline" style="font-size:12px;padding:6px 12px">↓ CSV</button>
          <button id="vend-vigencias" class="btn btn-primary"
            style="font-size:12px;padding:6px 12px${isSupervisorReadonly() ? ';display:none' : ''}">💰 Vigencias</button>
        </div>
      </div>

      <div id="vend-importes" style="flex-shrink:0;margin-bottom:10px"></div>
      <div id="vend-summary"  style="flex-shrink:0;margin-bottom:10px"></div>

      <div id="vend-body" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <div style="text-align:center;padding:60px;color:var(--color-muted)">
          <div style="font-size:32px;margin-bottom:12px">⏳</div>
          <p>Cargando…</p>
        </div>
      </div>

    </div>
  `;

  let data;
  try {
    data = await api.get(`/vendedores?periodo=${periodo}`);
  } catch (err) {
    const body = document.getElementById('vend-body');
    body.innerHTML = '<div style="text-align:center;padding:60px;color:var(--color-danger)"></div>';
    body.firstElementChild.textContent = `No se pudo cargar: ${err.message}`;
    return;
  }

  const sucursales = data.sucursales || [];

  // ── Card de importes vigentes ─────────────────────────────────────
  const vig = data.vigencia;
  document.getElementById('vend-importes').innerHTML = vig
    ? `<div class="card" style="padding:10px 14px;display:flex;gap:24px;align-items:center;flex-wrap:wrap">
         <div>
           <div style="font-size:11px;color:var(--color-muted)">Importes vigentes</div>
           <div style="font-size:12px;color:var(--color-muted)">desde ${vig.anio}-${String(vig.mes).padStart(2, '0')}</div>
         </div>
         <div><div style="font-size:11px;color:var(--color-muted)">1er escalón</div>
              <div style="font-size:16px;font-weight:700">$${fmtNum(vig.primer)}</div></div>
         <div><div style="font-size:11px;color:var(--color-muted)">2do escalón</div>
              <div style="font-size:16px;font-weight:700">$${fmtNum(vig.segundo)}</div></div>
         <div><div style="font-size:11px;color:var(--color-muted)">3er escalón</div>
              <div style="font-size:16px;font-weight:700">$${fmtNum(vig.tercer)}</div></div>
         <div style="font-size:11px;color:var(--color-muted);max-width:280px">
           Part time cobra la mitad. El cálculo lo corre el job SQL de INDO, no esta página.
         </div>
       </div>`
    : `<div class="card" style="padding:10px 14px;font-size:13px;color:var(--badge-e-t,#854d0e);
              background:var(--badge-e-bg,#fef9c3);border:1px solid var(--badge-e-t,#854d0e)">
         ⚠️ No hay ninguna vigencia de importes cargada para este período: el cálculo resolvería $0.
       </div>`;

  // ── Estado vacío ──────────────────────────────────────────────────
  if (!sucursales.length) {
    document.getElementById('vend-summary').innerHTML = '';
    document.getElementById('vend-body').innerHTML = `
      <div style="text-align:center;padding:60px;color:var(--color-muted)">
        <div style="font-size:32px;margin-bottom:12px">📭</div>
        <p style="font-size:14px;font-weight:600">Sin comisiones de vendedores para ${esc(periodo)}</p>
        <p style="font-size:12px;max-width:460px;margin:8px auto">
          El cálculo de vendedores lo corre el job SQL de INDO (<code>SP_ComisionesINDO</code>), no el dashboard.
          Si el período ya cerró y no aparece, el job todavía no lo procesó.
        </p>
      </div>`;
    return;
  }

  // ── Resumen ───────────────────────────────────────────────────────
  const todos      = sucursales.flatMap(s => s.vendedores);
  const cobran     = todos.filter(v => v.comision > 0).length;
  const desfasados = todos.filter(v => v.desfasado).length;

  document.getElementById('vend-summary').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Sucursales</div>
        <div style="font-size:20px;font-weight:700">${data.totales.sucursales}</div>
      </div>
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Vendedores</div>
        <div style="font-size:20px;font-weight:700">${data.totales.vendedores}</div>
      </div>
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Cobran comisión</div>
        <div style="font-size:20px;font-weight:700;color:var(--color-success)">${cobran}</div>
      </div>
      <div class="card" style="flex:1;min-width:140px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Total a pagar</div>
        <div style="font-size:20px;font-weight:700">$${fmtNum(data.totales.comision)}</div>
      </div>
      ${desfasados ? `
      <div class="card" style="flex:1;min-width:180px;padding:10px 14px;border-color:var(--badge-e-t,#854d0e)">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">⚠️ Desfasados</div>
        <div style="font-size:20px;font-weight:700;color:var(--badge-e-t,#854d0e)">${desfasados}</div>
        <div style="font-size:10px;color:var(--color-muted)">importes editados sin reprocesar</div>
      </div>` : ''}
    </div>`;

  // ── Tabla por sucursal, expandible ────────────────────────────────
  const abiertas = new Set();
  let filtradas = sucursales;

  function detalleHTML(s) {
    return `
      <div style="padding:8px 12px 12px 36px;background:var(--color-bg)">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="color:var(--color-muted)">
              <th style="text-align:left;padding:4px 8px">Legajo</th>
              <th style="text-align:left;padding:4px 8px">Nombre</th>
              <th style="text-align:center;padding:4px 8px">Jorn.</th>
              <th style="text-align:right;padding:4px 8px">Venta real</th>
              <th style="text-align:center;padding:4px 8px">Días</th>
              <th style="text-align:right;padding:4px 8px" title="Venta ajustada por días trabajados">Vta calculada</th>
              <th style="text-align:right;padding:4px 8px" title="Ajuste por licencias">Proporcional</th>
              <th style="text-align:center;padding:4px 8px">Lic.</th>
              <th style="text-align:center;padding:4px 8px">¿Comisiona?</th>
              <th style="text-align:center;padding:4px 8px">Esc.</th>
              <th style="text-align:right;padding:4px 8px">Comisión</th>
            </tr>
          </thead>
          <tbody>
            ${s.vendedores.map(v => `
              <tr>
                <td style="padding:4px 8px;color:var(--color-muted)">${esc(v.legajo)}</td>
                <td style="padding:4px 8px;font-weight:500">${esc(v.nombre)}${
                  v.jornada_cambio ? ' <span style="font-size:10px;color:var(--color-muted)" title="La jornada actual del legajo difiere de la usada en el cálculo">(jornada cambió)</span>' : ''}</td>
                <td style="padding:4px 8px;text-align:center">${jornadaBadge(v.jornada)}</td>
                <td style="padding:4px 8px;text-align:right">$${fmtNum(v.venta_real)}</td>
                <td style="padding:4px 8px;text-align:center">${v.dias_venta}</td>
                <td style="padding:4px 8px;text-align:right">$${fmtNum(v.venta_calculada)}</td>
                <td style="padding:4px 8px;text-align:right">${v.vta_proporcional ? '$' + fmtNum(v.vta_proporcional) : '—'}</td>
                <td style="padding:4px 8px;text-align:center">${v.dias_licencia || '—'}</td>
                <td style="padding:4px 8px;text-align:center">${v.comisiona ? '✅' : '—'}</td>
                <td style="padding:4px 8px;text-align:center">${escBadge(v.escalon)}</td>
                <td style="padding:4px 8px;text-align:right;font-weight:600">${fmtMoney(v.comision)}${
                  v.desfasado ? ' <span title="La comisión guardada no coincide con el importe del escalón alcanzado: se editaron importes y el período no se reprocesó">⚠️</span>' : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderTabla(rows) {
    const body = document.getElementById('vend-body');
    if (!rows.length) {
      body.innerHTML = '<p style="color:var(--color-muted);padding:20px">Sin resultados.</p>';
      return;
    }
    const th = 'position:sticky;top:0;z-index:1;background:var(--color-surface);padding:8px 10px;white-space:nowrap';
    body.innerHTML = `
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr>
            <th style="${th};text-align:left">Suc</th>
            <th style="${th};text-align:left">Sucursal</th>
            <th style="${th};text-align:center" title="Full time = 1, part time = 0,5 (solo con más de 5 días de venta)">Vend.</th>
            <th style="${th};text-align:right">1er esc.</th>
            <th style="${th};text-align:right">2do esc.</th>
            <th style="${th};text-align:right">3er esc.</th>
            <th style="${th};text-align:right">Total $</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(s => {
            const open = abiertas.has(s.sucursal_id);
            return `
            <tr class="vend-row" data-suc="${s.sucursal_id}" style="cursor:pointer">
              <td style="padding:7px 10px;color:var(--color-muted);font-size:11px">
                <span style="display:inline-block;font-size:9px;margin-right:6px;transition:transform 150ms;transform:rotate(${open ? 90 : 0}deg)">▶</span>${s.sucursal_id}
              </td>
              <td style="padding:7px 10px;font-weight:500">${esc(s.sucursal_nombre)}</td>
              <td style="padding:7px 10px;text-align:center">${fmtVend(s.cant_vendedores)}</td>
              <td style="padding:7px 10px;text-align:right;font-size:12px">$${fmtNum(s.primer_escalon)}</td>
              <td style="padding:7px 10px;text-align:right;font-size:12px">$${fmtNum(s.segundo_escalon)}</td>
              <td style="padding:7px 10px;text-align:right;font-size:12px">$${fmtNum(s.tercer_escalon)}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:700">${fmtMoney(s.total_comision)}</td>
            </tr>
            <tr class="vend-detail" data-suc="${s.sucursal_id}" style="display:${open ? '' : 'none'}">
              <td colspan="7" style="padding:0;border-bottom:2px solid var(--color-border)">${detalleHTML(s)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    body.querySelectorAll('.vend-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = Number(tr.dataset.suc);
        if (abiertas.has(id)) abiertas.delete(id); else abiertas.add(id);
        renderTabla(rows);
      });
    });
  }

  renderTabla(filtradas);

  // ── Filtro ────────────────────────────────────────────────────────
  document.getElementById('vend-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      filtradas = sucursales;
    } else {
      filtradas = sucursales
        .map(s => {
          const matchSuc = (s.sucursal_nombre || '').toLowerCase().includes(q) || String(s.sucursal_id).includes(q);
          if (matchSuc) return s;
          const vend = s.vendedores.filter(v =>
            v.nombre.toLowerCase().includes(q) || String(v.legajo).includes(q));
          return vend.length ? { ...s, vendedores: vend } : null;
        })
        .filter(Boolean);
    }
    renderTabla(filtradas);
  });

  // ── CSV: una fila por vendedor ────────────────────────────────────
  document.getElementById('vend-export').addEventListener('click', () => {
    const filas = filtradas.flatMap(s => s.vendedores.map(v => ({
      'Suc ID': s.sucursal_id,
      'Sucursal': s.sucursal_nombre,
      'Legajo': v.legajo,
      'Nombre': v.nombre,
      'Jornada': v.jornada === 'part' ? 'Part Time' : 'Full Time',
      'Venta real': Math.round(v.venta_real),
      'Días venta': v.dias_venta,
      'Venta calculada': Math.round(v.venta_calculada),
      'Proporcional': Math.round(v.vta_proporcional),
      'Días licencia': v.dias_licencia,
      '1er escalón': Math.round(s.primer_escalon),
      '2do escalón': Math.round(s.segundo_escalon),
      '3er escalón': Math.round(s.tercer_escalon),
      'Escalón alcanzado': v.escalon,
      'Comisión': Math.round(v.comision),
      'Desfasado': v.desfasado ? 'SI' : '',
    })));
    if (!filas.length) { showToast('Nada para exportar', 'error'); return; }
    exportToCSV(filas, `VENDEDORES_${periodo}`);
    showToast('CSV exportado', 'success');
  });
}
```

- [ ] **Step 2: Registrar la ruta en `src/app.js`**

Agregar el import después de `import { renderTotal } from './pages/total.js';`:

```js
import { renderVendedores } from './pages/vendedores.js';
```

Y en el objeto `ROUTES`, después de `total: renderTotal,`:

```js
  vendedores:             renderVendedores,
```

- [ ] **Step 3: Agregar la entrada de sidebar**

En `src/components/sidebar.js`, en el array `MENU`, insertar entre la entrada `total` y la entrada `cajeros`:

```js
  { route: 'vendedores',          icon: '🛍️', label: 'Vendedores' },
```

El orden de la sección Cálculos queda: Total, **Vendedores**, Cajeros, Operadores Retail, Operadores Millón, Encargados Retail, Encargados Millón, Supervisores.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build exitoso, sin errores de sintaxis ni imports sin resolver.

- [ ] **Step 5: Reiniciar el servicio y hacer smoke por HTTP**

```bash
powershell -Command "Restart-Service dashcomisionesindo.exe; Get-Service dashcomisionesindo.exe | Format-Table Name,Status"
```
Expected: `Running`.

Luego, sin token:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3011/api/vendedores?periodo=2026-06
```
Expected: `401` (router registrado y pidiendo auth).

- [ ] **Step 6: Commit**

```bash
git add src/pages/vendedores.js src/app.js src/components/sidebar.js
git commit -m "$(cat <<'EOF'
feat(comisiones-indo): pagina de Vendedores

Visor por sucursal con fila expandible al detalle por vendedor, card de
importes vigentes, filtro que matchea sucursal o vendedor, CSV plano y
estado vacio que aclara que el calculo lo corre el job SQL. Entra en el
sidebar entre Total y Cajeros.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Modal de vigencias (ABM en la UI)

**Files:**
- Modify: `src/pages/vendedores.js` (markup del modal + lógica al final de `renderVendedores`)

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/vendedores/importes` (Tasks 2 y 3); el helper `fmtNum(v)`, la constante `vig` (= `data.vigencia`) y el botón `#vend-vigencias`, los tres del Task 4.
- Produces: nada para tasks posteriores.

- [ ] **Step 1: Agregar el markup del modal**

En `src/pages/vendedores.js`, dentro del template de `container.innerHTML`, justo antes del `</div>` que cierra el contenedor flex principal (después del `<div id="vend-body">…</div>`), agregar:

```html
      <div id="vend-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center">
        <div style="background:#1e2130;border:1px solid #2e3450;border-radius:8px;padding:24px;width:620px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.6);color:#e2e8f0">
          <h3 style="font-size:16px;font-weight:700;margin-bottom:6px;color:#f1f5f9">Vigencias de importes</h3>
          <p style="font-size:12px;color:#94a3b8;margin-bottom:16px">
            Una vigencia rige desde su mes hasta que aparece una posterior. Para cambiar los montos,
            creá una vigencia nueva: los períodos anteriores no se alteran. El recálculo lo corre el
            job SQL de INDO, no esta página.
          </p>
          <div id="vend-vig-list" style="margin-bottom:16px"></div>
          <div id="vend-vig-form" style="border-top:1px solid #2e3450;padding-top:14px">
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
              <div><label style="font-size:11px;display:block;margin-bottom:4px;color:#cbd5e1">Año</label>
                <input id="vend-vig-anio" class="form-control" type="text" inputmode="numeric" style="width:80px;background:#262c42;color:#e2e8f0;border-color:#3e4a6e"></div>
              <div><label style="font-size:11px;display:block;margin-bottom:4px;color:#cbd5e1">Mes</label>
                <input id="vend-vig-mes" class="form-control" type="text" inputmode="numeric" style="width:70px;background:#262c42;color:#e2e8f0;border-color:#3e4a6e"></div>
              <div><label style="font-size:11px;display:block;margin-bottom:4px;color:#cbd5e1">1er escalón</label>
                <input id="vend-vig-primer" class="form-control" type="text" inputmode="numeric" style="width:110px;background:#262c42;color:#e2e8f0;border-color:#3e4a6e"></div>
              <div><label style="font-size:11px;display:block;margin-bottom:4px;color:#cbd5e1">2do escalón</label>
                <input id="vend-vig-segundo" class="form-control" type="text" inputmode="numeric" style="width:110px;background:#262c42;color:#e2e8f0;border-color:#3e4a6e"></div>
              <div><label style="font-size:11px;display:block;margin-bottom:4px;color:#cbd5e1">3er escalón</label>
                <input id="vend-vig-tercer" class="form-control" type="text" inputmode="numeric" style="width:110px;background:#262c42;color:#e2e8f0;border-color:#3e4a6e"></div>
            </div>
            <div id="vend-vig-aviso" style="font-size:12px;color:#fbbf24;margin-top:10px;min-height:18px"></div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
            <button class="btn btn-secondary" id="vend-vig-cancel">Cerrar</button>
            <button class="btn btn-primary"   id="vend-vig-save">Guardar</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Agregar la lógica del modal al final de `renderVendedores`**

Al final de la función `renderVendedores` (después del listener de CSV), agregar:

```js
  // ── Modal de vigencias ────────────────────────────────────────────
  const modal = document.getElementById('vend-modal');
  let vigencias = [];
  let editando  = null;   // {anio, mes} si se está editando, null si es alta

  function parseNum(s) {
    // Los inputs son texto con separador de miles es-AR: "15.000" → 15000
    const limpio = String(s ?? '').replace(/\./g, '').replace(/\s/g, '').trim();
    return limpio === '' ? NaN : Number(limpio);
  }

  function rango(v) {
    const posteriores = vigencias
      .filter(x => x.anio * 100 + x.mes > v.anio * 100 + v.mes)
      .sort((a, b) => (a.anio * 100 + a.mes) - (b.anio * 100 + b.mes));
    const desde = `${v.anio}-${String(v.mes).padStart(2, '0')}`;
    if (!posteriores.length) return `${desde} en adelante`;
    const sig = posteriores[0];
    const m = sig.mes === 1 ? 12 : sig.mes - 1;
    const a = sig.mes === 1 ? sig.anio - 1 : sig.anio;
    return `${desde} a ${a}-${String(m).padStart(2, '0')}`;
  }

  function renderVigencias() {
    const vigenteKey = vig ? vig.anio * 100 + vig.mes : null;
    document.getElementById('vend-vig-list').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="color:#94a3b8">
          <th style="text-align:left;padding:4px 6px">Vigencia</th>
          <th style="text-align:left;padding:4px 6px">Alcanza</th>
          <th style="text-align:right;padding:4px 6px">1er</th>
          <th style="text-align:right;padding:4px 6px">2do</th>
          <th style="text-align:right;padding:4px 6px">3er</th>
          <th style="padding:4px 6px"></th>
        </tr></thead>
        <tbody>
          ${vigencias.map(v => `
            <tr>
              <td style="padding:4px 6px;font-weight:600">${v.anio}-${String(v.mes).padStart(2, '0')}
                ${v.anio * 100 + v.mes === vigenteKey ? '<span title="Vigente para el período seleccionado" style="color:#4ade80">●</span>' : ''}</td>
              <td style="padding:4px 6px;color:#94a3b8;font-size:11px">${rango(v)}</td>
              <td style="padding:4px 6px;text-align:right">$${fmtNum(v.primer)}</td>
              <td style="padding:4px 6px;text-align:right">$${fmtNum(v.segundo)}</td>
              <td style="padding:4px 6px;text-align:right">$${fmtNum(v.tercer)}</td>
              <td style="padding:4px 6px;text-align:right;white-space:nowrap">
                <button class="btn btn-outline vig-edit" data-anio="${v.anio}" data-mes="${v.mes}" style="font-size:11px;padding:2px 8px">editar</button>
                <button class="btn btn-outline vig-del"  data-anio="${v.anio}" data-mes="${v.mes}" style="font-size:11px;padding:2px 8px;color:#f87171">borrar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    document.getElementById('vend-vig-list').querySelectorAll('.vig-edit').forEach(b => {
      b.addEventListener('click', () => {
        const v = vigencias.find(x => x.anio === Number(b.dataset.anio) && x.mes === Number(b.dataset.mes));
        editando = { anio: v.anio, mes: v.mes };
        document.getElementById('vend-vig-anio').value    = v.anio;
        document.getElementById('vend-vig-mes').value     = v.mes;
        document.getElementById('vend-vig-primer').value  = v.primer;
        document.getElementById('vend-vig-segundo').value = v.segundo;
        document.getElementById('vend-vig-tercer').value  = v.tercer;
        document.getElementById('vend-vig-anio').disabled = true;
        document.getElementById('vend-vig-mes').disabled  = true;
        document.getElementById('vend-vig-aviso').textContent =
          `Editar esta vigencia cambia los períodos ${rango(v)} si se los vuelve a calcular.`;
      });
    });

    document.getElementById('vend-vig-list').querySelectorAll('.vig-del').forEach(b => {
      b.addEventListener('click', async () => {
        const anio = Number(b.dataset.anio), mes = Number(b.dataset.mes);
        const v = vigencias.find(x => x.anio === anio && x.mes === mes);
        if (!confirm(`¿Borrar la vigencia ${anio}-${String(mes).padStart(2, '0')}?\n\n` +
                     `Los períodos ${rango(v)} pasarían a resolver la vigencia anterior si se los recalcula.`)) return;
        try {
          await api.delete(`/vendedores/importes/${anio}/${mes}`);
          showToast('Vigencia borrada', 'success');
          await cargarVigencias();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  }

  async function cargarVigencias() {
    const r = await api.get(`/vendedores/importes?periodo=${periodo}`);
    vigencias = r.vigencias || [];
    renderVigencias();
  }

  function limpiarForm() {
    editando = null;
    for (const id of ['anio', 'mes', 'primer', 'segundo', 'tercer']) {
      document.getElementById(`vend-vig-${id}`).value = '';
    }
    document.getElementById('vend-vig-anio').disabled = false;
    document.getElementById('vend-vig-mes').disabled  = false;
    document.getElementById('vend-vig-aviso').textContent = '';
  }

  document.getElementById('vend-vigencias').addEventListener('click', async () => {
    limpiarForm();
    try {
      await cargarVigencias();
      modal.style.display = 'flex';
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('vend-vig-cancel').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  document.getElementById('vend-vig-save').addEventListener('click', async () => {
    const body = {
      anio:    parseNum(document.getElementById('vend-vig-anio').value),
      mes:     parseNum(document.getElementById('vend-vig-mes').value),
      primer:  parseNum(document.getElementById('vend-vig-primer').value),
      segundo: parseNum(document.getElementById('vend-vig-segundo').value),
      tercer:  parseNum(document.getElementById('vend-vig-tercer').value),
    };
    if (Object.values(body).some(n => !Number.isFinite(n))) {
      showToast('Completá año, mes y los 3 importes con números', 'error');
      return;
    }
    const etiqueta = `${body.anio}-${String(body.mes).padStart(2, '0')}`;
    if (!confirm(`${editando ? 'Guardar cambios en' : 'Crear'} la vigencia ${etiqueta}:\n\n` +
                 `1er $${fmtNum(body.primer)} · 2do $${fmtNum(body.segundo)} · 3er $${fmtNum(body.tercer)}\n\n` +
                 `Los períodos ya calculados no cambian hasta que el job SQL los reprocese.`)) return;
    try {
      if (editando) await api.put(`/vendedores/importes/${editando.anio}/${editando.mes}`, body);
      else          await api.post('/vendedores/importes', body);
      showToast(editando ? 'Vigencia actualizada' : 'Vigencia creada', 'success');
      limpiarForm();
      await cargarVigencias();
    } catch (err) { showToast(err.message, 'error'); }
  });
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Verificar que el botón queda oculto para el supervisor**

Run: `grep -n "isSupervisorReadonly" src/pages/vendedores.js`
Expected: aparece en el botón `#vend-vigencias`. Además el backend corta con 403 (`blockWriteIfSupervisor`), así que la ocultación es cosmética y no la única defensa.

- [ ] **Step 5: Reiniciar el servicio y verificar que sigue vivo**

```bash
powershell -Command "Restart-Service dashcomisionesindo.exe; Get-Service dashcomisionesindo.exe | Format-Table Name,Status"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3011/api/health
```
Expected: `Running` y `200`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/vendedores.js
git commit -m "$(cat <<'EOF'
feat(comisiones-indo): modal de vigencias de importes de vendedores

Alta, edicion y borrado de vigencias desde la web, con el rango de
periodos alcanzados a la vista y confirmacion antes de escribir. El boton
no existe para el perfil 8 y el backend igual lo corta con 403.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Documentación, verificación end-to-end y cierre

**Files:**
- Modify: `docs/MANUAL.md` (sección nueva de Vendedores)
- Modify: `CONTEXT.md` (módulo, tablas, endpoints)
- Modify: `CLAUDE.md` (corregir "no hay tests automatizados" y "SQL Server 2012")
- Modify: `RETOMAR.md` (sesión 2026-08-03)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Correr la suite completa antes de documentar**

Run:
```bash
node --test server/services/manualDoc.test.js src/components/markdown.test.js server/services/calcEngine.supervisores.test.js server/services/manualCoherencia.test.js server/services/vendedoresView.test.js
```
Expected: PASS — 58 tests. **Si `manualCoherencia.test.js` falla, es porque se tocó `docs/MANUAL.md` de una forma que rompió los números que ese test exige; arreglarlo antes de seguir.**

- [ ] **Step 2: Agregar la sección de Vendedores a `docs/MANUAL.md`**

Insertar esta sección nueva **sin alterar ninguna de las secciones existentes** (`manualCoherencia.test.js` verifica números textuales en las secciones de escalones, cajeros y participación). Ubicarla respetando la numeración del manual: si las secciones están numeradas (`## 7. Cajeros`), renumerar **solo** insertándola al final de la lista de módulos de cálculo, antes de la sección de Supervisores, y actualizar el índice si el manual tiene uno.

Texto literal a insertar:

```markdown
## Vendedores

Muestra las comisiones de los vendedores del período, una fila por sucursal.

**El cálculo de este módulo NO lo hace el dashboard.** Lo corre un proceso automático
de la base de datos (`SP_ComisionesINDO`), que además genera la planilla de
comisiones y la manda por mail. Esta página solamente muestra el resultado: no hay
botón de recalcular, y si un período no aparece es porque el proceso todavía no lo
procesó.

### Cómo se leen los escalones

Cada sucursal tiene tres umbrales de venta, calculados a partir del objetivo de
ventas del mes:

| Escalón | Umbral |
|---|---|
| Primer escalón | objetivo de ventas × 0,97 |
| Segundo escalón | primer escalón × 1,10 |
| Tercer escalón | segundo escalón × 1,15 |

Los tres se dividen por la **cantidad de vendedores** de la sucursal, que no es un
conteo simple: un vendedor full time cuenta 1 y un part time cuenta 0,5, y solo se
cuentan los que tienen **más de 5 días de venta** en el mes. Por eso la columna
"Vend." puede mostrar valores como 2,5 o 3,5.

Lo que se compara contra los umbrales es la **venta calculada más el ajuste
proporcional** de cada vendedor, de mayor a menor: si llega al tercer escalón cobra
el importe del tercero, si no llega pero alcanza el segundo cobra el del segundo, y
así. Si no llega al primero, no cobra.

**Un vendedor part time cobra la mitad del importe** del escalón que alcanzó.

Al hacer clic en una sucursal se abre el detalle de sus vendedores: venta real, días
de venta, venta calculada, ajuste proporcional, días de licencia, el escalón
alcanzado y la comisión.

### Importes de escalones: vigencias

Los importes que se pagan por cada escalón se cargan desde el botón **Vigencias**.
Funcionan por fecha de vigencia: una vigencia rige **desde su mes en adelante**,
hasta que se carga otra posterior.

Para cambiar los montos, **creá una vigencia nueva** con el mes desde el cual
empiezan a valer. Los períodos anteriores siguen resolviendo la vigencia vieja, así
que los resultados ya calculados no se alteran.

La tarjeta de arriba de la página muestra qué importes rigen para el período que
tenés seleccionado y de qué vigencia salen.

Editar o borrar una vigencia ya cargada también se puede (sirve para corregir una
carga equivocada), pero afecta a todos los períodos que esa vigencia gobierna **si
alguna vez se los vuelve a calcular**. La pantalla te avisa cuáles son antes de
guardar.

### El símbolo ⚠️ al lado de una comisión

Significa que la comisión guardada no coincide con el importe que hoy correspondería
al escalón alcanzado. Pasa cuando se editaron los importes de una vigencia y ese
período todavía no fue reprocesado por el proceso automático. El monto que se
muestra es siempre el que quedó guardado en el cálculo, no uno recalculado.
```

- [ ] **Step 3: Actualizar `CONTEXT.md`**

Agregar el módulo Vendedores: tablas involucradas (las 6 de la spec §2), los 5 endpoints, la regla de vigencias, y la aclaración de que `GrillaVendedoresINDO.comision` está siempre en 0 (la comisión real vive en `GrillaComisionesINDO`).

- [ ] **Step 4: Corregir las dos afirmaciones desactualizadas de `CLAUDE.md`**

Reemplazar:

```
No hay tests automatizados. La verificación es manual contra los datos reales de SQL Server.
```

por:

```
Tests: `node --test server/services/manualDoc.test.js src/components/markdown.test.js server/services/calcEngine.supervisores.test.js server/services/manualCoherencia.test.js server/services/vendedoresView.test.js` (58 tests). Cubren el motor de Supervisores, el parser del manual, la coherencia manual↔motor y la vista de Vendedores. El resto se verifica manualmente contra los datos reales de SQL Server.
```

Y reemplazar en la sección de arquitectura:

```
**Stack**: Node.js v24, ES Modules, Express 4, Vite 6, Vanilla JS SPA, SQL Server 2012.
```

por:

```
**Stack**: Node.js v24, ES Modules, Express 4, Vite 6, Vanilla JS SPA, SQL Server 2008 R2.
```

Y en el bloque que dice "SQL Server 2012 — `DATEFROMPARTS` no está disponible", cambiar el encabezado a **SQL Server 2008 R2** y agregar que `TRY_CONVERT` tampoco existe (verificado 2026-08-03: la query falla con "'TRY_CONVERT' is not a recognized built-in function name"), por lo que se usa `CAST`.

Agregar además al final de la sección de arquitectura el módulo Vendedores en una línea, aclarando que su cálculo es externo (job SQL) y que el dashboard solo lee.

- [ ] **Step 5: Agregar la sesión a `RETOMAR.md`**

Agregar arriba de la sesión 2026-07-30 una sección `## Sesión 2026-08-03 — Módulo Vendedores` con: qué se construyó, los archivos nuevos, el resultado de la suite de tests, el resultado de los smoke tests contra la DB real, y el pendiente de **verificación visual en el navegador** (no hay navegador en el server) — específicamente: expandir una sucursal, crear/editar/borrar una vigencia ficticia y confirmar los avisos, y ver la página logueado como `EVIDABLE` (perfil 8) para confirmar que no aparece el botón Vigencias.

- [ ] **Step 6: Verificación end-to-end por HTTP con token real**

Crear `scripts/smoke-http-vendedores.mjs`:

```js
// Verificación end-to-end contra el servicio corriendo, con token real de la API.
// SOLO lecturas: no crea ni borra vigencias.
import dotenv from 'dotenv'; dotenv.config();

const BASE = 'http://localhost:3011/api';
const usuario = process.argv[2];
const clave   = process.argv[3];
const periodo = process.argv[4] || '2026-06';

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usuario, password: clave }),
});
const { token } = await login.json();
if (!token) { console.error('login fallido', login.status); process.exit(1); }

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const v = await get(`/vendedores?periodo=${periodo}`);
console.log('GET /vendedores  →', v.status, 'totales:', v.body.totales, 'vigencia:', v.body.vigencia);
const i = await get(`/vendedores/importes?periodo=${periodo}`);
console.log('GET /importes    →', i.status, 'vigencias:', (i.body.vigencias || []).map(x => `${x.anio}-${x.mes}`).join(' '));
const s = await get('/sucursales');
console.log('GET /sucursales  →', s.status, Array.isArray(s.body) ? s.body.length + ' filas (no-regresion)' : s.body);
process.exit(0);
```

Run: `node scripts/smoke-http-vendedores.mjs <USUARIO> <CLAVE> 2026-06`
(pedirle al usuario un login de prueba; **no** hardcodear credenciales en ningún archivo)

Expected: los 3 endpoints en `200`, `totales` con 32 sucursales / ~158 vendedores, `vigencias` con las 3 reales, y `/sucursales` respondiendo normal (no-regresión del resto de la app).

- [ ] **Step 7: Borrar el script y commitear la documentación**

```bash
rm scripts/smoke-http-vendedores.mjs
git add docs/MANUAL.md CONTEXT.md CLAUDE.md RETOMAR.md
git commit -m "$(cat <<'EOF'
docs(comisiones-indo): documentar el modulo Vendedores

Manual con la logica del batch SQL y las vigencias de importes; CONTEXT
con tablas y endpoints; CLAUDE.md corrige dos datos viejos (si hay tests,
y el motor es SQL Server 2008 R2 sin TRY_CONVERT).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Verificar que el árbol quedó limpio**

Run: `git status --short`
Expected: sin archivos modificados ni scripts temporales sueltos en `dashboards/ComisionesINDO`. (`ActualizarPreciosCostos/` sin trackear en la raíz del repo es preexistente y ajeno a este módulo.)

---

## Verificación final del módulo

- [ ] `node --test` con los 5 archivos de test → 58 PASS
- [ ] `npm run build` sin errores
- [ ] `Get-Service dashcomisionesindo.exe` → `Running`
- [ ] `GET /api/vendedores?periodo=2026-06` con token → 200, 32 sucursales, 0 desfasados
- [ ] `GET /api/health` → 200 (el resto de la app sigue viva)
- [ ] Ninguna vigencia de prueba quedó en `tbl_CoVenApp_ImportesEscalonesINDO` (deben ser exactamente 9 filas / 3 vigencias)
- [ ] Ningún SP modificado: `SELECT name, modify_date FROM sys.objects WHERE name LIKE '%INDO%' AND type='P'` sin cambios de fecha
- [ ] Pendiente para el usuario: verificación visual en el navegador (expandir sucursal, ciclo de vigencias, vista como `EVIDABLE`)
