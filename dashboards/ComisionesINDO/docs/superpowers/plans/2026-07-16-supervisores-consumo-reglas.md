# Supervisores — reglas nuevas de consumo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar en `calcularSupervisores()` el pago por sucursal Retail según pesos+participación (completo/mitad/$0) y el plus de plaza condicionado solo a participación, con su reflejo en la página de resultado.

**Architecture:** Cambio autocontenido en la función pura `calcularSupervisores()` de `server/services/calcEngine.js` (el indicador G se calcula localmente, mismo patrón que `calcularEncargados` — NO se toca Encargados ni `calcularTotal`, blindados) + actualización de presentación en `src/pages/resultado-supervisores.js`. Sin cambios de SQL ni endpoints: el resultado viaja como JSON dentro de `CalculoHistorial`.

**Tech Stack:** Node.js v24 ESM, Express, Vanilla JS SPA (Vite). Tests nuevos con `node:test` nativo (el repo no tiene framework de tests; `calcEngine` es puro y se testea sin DB).

**Spec:** `docs/superpowers/specs/2026-07-16-supervisores-consumo-reglas-design.md`

## Global Constraints

- PROHIBIDO tocar módulos blindados: `calcularTotal`, `calcularEncargados`, `calcularOperadores`, Cajeros, visores, ABM.
- Los montos de `MontosSupervisor` ya están por categoría: NUNCA multiplicar por `mult`.
- Tolerancia 4%: participación llega si `G > -0.04`; el escalón ya la incluye vía `getEscalon`.
- Redondeo a miles con `Math.round` (`redondeoMil`): mitad de 9000 → 5000, mitad de 8000 → 4000.
- NO editar archivos fuente con PowerShell `Get-Content`/`Set-Content`/`-replace` (rompe UTF-8); usar Edit/Write.
- Tras cambios de frontend: `npm run build` ANTES de `Restart-Service dashcomisionesindo.exe` (el server sirve `dist/`).
- Working dir del proyecto: `C:\apps\dashboards\ComisionesINDO` (repo git raíz: `C:\apps`).

---

### Task 1: Tests del motor (reglas nuevas de Supervisores)

**Files:**
- Create: `server/services/calcEngine.supervisores.test.js`

**Interfaces:**
- Consumes: `calcularSupervisores(ctx, sucResultados)` de `./calcEngine.js` (ya exportada).
- Produces: suite de tests que define el contrato nuevo — campos `indicador_g`, `llega_pesos`, `llega_particip`, `pago` en filas Retail del detalle; plaza Retail `cumplida` por participación; Millón intacto.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `server/services/calcEngine.supervisores.test.js` con este contenido completo:

```js
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
  assert.equal(sup.sucursales[0].monto_por_suc, 0);  // Millón no paga por sucursal
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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```powershell
node --test server/services/calcEngine.supervisores.test.js
```

Esperado: FAIL — los tests de mitad/participación fallan (hoy `pago`, `llega_pesos`, `llega_particip` no existen y la mitad no se paga; el test "pesos sin participación" espera 5000 y hoy devuelve 9000). Los 2 tests de Millón y el de "pesos + participación → completo" pueden pasar ya (comportamiento vigente) — es esperable.

- [ ] **Step 3: Commit de los tests**

```powershell
git -C C:\apps add dashboards/ComisionesINDO/server/services/calcEngine.supervisores.test.js
git -C C:\apps commit -m "test(comisiones-indo): contrato de reglas nuevas de Supervisores consumo (pesos+participacion)"
```

---

### Task 2: Motor — `calcularSupervisores()` con pesos + participación

**Files:**
- Modify: `server/services/calcEngine.js:674-799` (comentario de cabecera + función `calcularSupervisores`)
- Test: `server/services/calcEngine.supervisores.test.js` (de Task 1)

**Interfaces:**
- Consumes: `ctx.datosConsumo` (`[{ sucursal_id, vta_vta_tot }]`) y `ctx.objConsumo` (`[{ sucursal_id, participacion }]`) — ya presentes en el ctx que arma `cargarContexto()` (`server/routes/calculo.js:184,187`); no hay que tocar la carga.
- Produces: filas Retail de `sucursales[]` con campos nuevos `indicador_g` (number, 4 decimales), `llega_pesos` (bool), `llega_particip` (bool), `pago` (`'completo'|'mitad'|'nada'`). `llego` se mantiene (= `llega_pesos` en Retail; por efectivo en Millón). Plazas Retail: `cumplida` ahora significa "todas llegan a participación". Resto del shape sin cambios.

- [ ] **Step 1: Actualizar el comentario de cabecera de la función**

Reemplazar el bloque de reglas del comentario (líneas ~680-692) por:

```js
//   Reglas (confirmadas por el usuario 2026-07-16):
//   RETAIL (id < 100), mirando SOLO consumo — dos indicadores por sucursal:
//     PESOS:         llega_pesos    = escalon_consumo >= 1  (tolerancia 4% via getEscalon)
//     PARTICIPACIÓN: llega_particip = G > -0.04, con
//       G = (vta_vta_tot/100 - objConsumo.participacion) / objConsumo.participacion
//       (mismo indicador que Encargados; sin objetivo → G = -1, no llega)
//     $ por sucursal → pesos y particip: monto ABM 'consumo'/'por_sucursal' de su
//       categoría completo; pesos sin particip: la MITAD redondeada a miles;
//       sin pesos: $0 (los pesos son condición necesaria). SIN factor, sin mult.
//     Plus por plaza → plaza = PROVINCIA. Si TODAS las Retail asignadas llegan a
//       PARTICIPACIÓN (sin importar pesos) → plus = (suma de lo efectivamente
//       pagado por esas sucursales) × factor_plaza (0.5), redondeado a miles.
//   MILLÓN (id >= 100), mirando SOLO efectivo (sin cambios 2026-07-14):
//     No paga por sucursal. Si TODAS las Millón asignadas de la provincia
//     llegaron por efectivo (escalon_efectivo >= 1), la plaza paga UNA sola
//     vez el monto 'efectivo'/'por_plaza' del ABM, SIN factor.
//   Retail y Millón forman plazas SEPARADAS aunque compartan provincia.
```

- [ ] **Step 2: Implementar la lógica nueva**

En `calcularSupervisores`, cambiar el destructuring inicial:

```js
const { supervisores, supervisorSucursales, montosSupervisor, datosConsumo, objConsumo } = ctx;
```

Reemplazar el cuerpo del `for (const asig of asigs)` (el bloque `let escalon, llego, subtotal; if (esMillon) {...} else {...}` y el `sucDetails.push`) por:

```js
        let escalon, llego, subtotal;
        let indicadorG = null, llegaPesos = null, llegaParticip = null, pago = null;
        if (esMillon) {
          // Millón: no paga por sucursal; solo cuenta para su plaza (por efectivo).
          escalon  = sucRes.escalon_efectivo;
          llego    = escalon >= 1;
          subtotal = 0;
          const plaza = (millonPorProvincia[provincia] ??= { llegadas: [] });
          plaza.llegadas.push(llego);
        } else {
          // Retail (reglas 2026-07-16): dos indicadores — pesos (escalón consumo)
          // y participación (G, igual que Encargados). Montos ABM ya por categoría,
          // NO multiplicar por mult.
          escalon    = sucRes.escalon_consumo;
          llegaPesos = escalon >= 1;

          const datCon = datosConsumo?.find(d => d.sucursal_id === sucRes.sucursal_id);
          const objCon = objConsumo?.find(d => d.sucursal_id === sucRes.sucursal_id);
          const G = (objCon?.participacion > 0)
            ? ((datCon?.vta_vta_tot ?? 0) / 100 - objCon.participacion) / objCon.participacion
            : -1;
          indicadorG    = +G.toFixed(4);
          llegaParticip = G > -0.04;

          const fila       = filaSup('consumo', 'por_sucursal', cat);
          const montoPleno = redondeoMil(fila?.monto || 0);
          if (!llegaPesos)          { subtotal = 0;                        pago = 'nada'; }
          else if (llegaParticip)   { subtotal = montoPleno;               pago = 'completo'; }
          else                      { subtotal = redondeoMil(montoPleno / 2); pago = 'mitad'; }

          llego = llegaPesos;
          totalPorSucursales += subtotal;
          // La plaza cumple por PARTICIPACIÓN (no por pesos); suma lo efectivamente pagado.
          const plaza = (llegadasPorProvincia[provincia] ??= { llegadas: [], suma: 0 });
          plaza.llegadas.push(llegaParticip);
          plaza.suma += subtotal;
        }

        sucDetails.push({
          sucursal_id:     sucRes.sucursal_id,
          sucursal_nombre: sucRes.sucursal_nombre,
          tipo:            esMillon ? 'millon' : 'retail',
          categoria:       cat,
          provincia,
          escalon,
          llego,
          indicador_g:     indicadorG,
          llega_pesos:     llegaPesos,
          llega_particip:  llegaParticip,
          pago,
          monto_por_suc:   subtotal
        });
```

El resto de la función (plazas Retail/Millón, totales, retorno) queda igual: `cumplida = plaza.llegadas.every(Boolean)` ahora evalúa participación porque eso es lo que se acumula.

- [ ] **Step 3: Correr los tests y verificar que pasan**

```powershell
node --test server/services/calcEngine.supervisores.test.js
```

Esperado: PASS (11 tests).

- [ ] **Step 4: Commit**

```powershell
git -C C:\apps add dashboards/ComisionesINDO/server/services/calcEngine.js
git -C C:\apps commit -m "feat(comisiones-indo): Supervisores consumo por pesos+participacion, plus de plaza solo por participacion"
```

---

### Task 3: Página de resultado — condiciones visibles + aviso de formato viejo

**Files:**
- Modify: `src/pages/resultado-supervisores.js`

**Interfaces:**
- Consumes: filas del detalle con `llega_pesos`, `llega_particip`, `indicador_g`, `pago` (Task 2). Cálculos guardados viejos NO traen esos campos (son `undefined`) — la página debe detectarlo y avisar sin romperse.
- Produces: solo presentación; sin cambios de API.

- [ ] **Step 1: Aviso de formato viejo**

Después de `const supervisores = data.resultado || [];` y del early-return de lista vacía, agregar:

```js
  // Formato viejo (reglas < 2026-07-16): las filas retail no traen llega_particip.
  const formatoViejo = supervisores.some(s =>
    (s.sucursales || []).some(suc => suc.tipo === 'retail' && suc.llega_particip === undefined));
  if (formatoViejo) {
    document.getElementById('rsup-alert').innerHTML = `
      <div style="background:var(--badge-e-bg,#fef9c3);color:var(--badge-e-t,#854d0e);
                  border:1px solid var(--badge-e-t,#854d0e);border-radius:6px;
                  padding:8px 14px;font-size:13px">
        ⚠️ Este cálculo es anterior a las reglas de participación (2026-07-16). Re-ejecutá el cálculo del período desde la página Total para ver pesos/participación y los montos vigentes.
      </div>`;
  }
```

- [ ] **Step 2: Tabla de Sucursales — columnas de las dos condiciones y el pago**

Reemplazar el `<thead>` de la tabla de Sucursales (la segunda tabla del detalle expandible) por:

```html
                      <tr>
                        <th style="text-align:left;padding:4px 8px;color:var(--color-muted)">Suc</th>
                        <th style="text-align:left;padding:4px 8px;color:var(--color-muted)">Sucursal</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)">Tipo</th>
                        <th style="text-align:left;padding:4px 8px;color:var(--color-muted)">Provincia</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)">Cat</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="Retail: escalón consumo · Millón: escalón efectivo">Esc</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="Retail: llegó a los pesos (escalón consumo ≥ 1) · Millón: llegó por efectivo">¿Pesos?</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="Indicador G vs objetivo de participación (tolerancia 4%) — solo Retail">Particip.</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="Completo (pesos+particip) · Mitad (pesos sin particip) · — (sin pesos)">Pago</th>
                        <th style="text-align:right;padding:4px 8px;color:var(--color-muted)">$ Sucursal</th>
                      </tr>
```

Y el cuerpo de filas (`(s.sucursales || []).map(suc => ...)`) por:

```js
                      ${(s.sucursales || []).map(suc => {
                        const esRetail = suc.tipo === 'retail';
                        const dash = '<span style="color:var(--color-muted)">—</span>';
                        const particip = esRetail && suc.llega_particip !== undefined
                          ? `${suc.llega_particip ? '✔' : '✘'} <span style="color:var(--color-muted)">(${suc.indicador_g != null ? (suc.indicador_g * 100).toFixed(1) + '%' : 's/obj'})</span>`
                          : dash;
                        const pagoLbl = { completo: 'Completo', mitad: 'Mitad', nada: dash }[suc.pago]
                          ?? (esRetail ? dash : '<span style="color:var(--color-muted)" title="Millón no paga por sucursal">n/a</span>');
                        return `
                        <tr>
                          <td style="padding:3px 8px;color:var(--color-muted)">${suc.sucursal_id}</td>
                          <td style="padding:3px 8px">${suc.sucursal_nombre}</td>
                          <td style="padding:3px 8px;text-align:center">${suc.tipo === 'millon' ? 'Millón' : (esRetail ? 'Retail' : '—')}</td>
                          <td style="padding:3px 8px">${suc.provincia ?? '—'}</td>
                          <td style="padding:3px 8px;text-align:center">${suc.categoria}</td>
                          <td style="padding:3px 8px;text-align:center">${suc.escalon ?? '—'}</td>
                          <td style="padding:3px 8px;text-align:center">${(esRetail ? (suc.llega_pesos ?? suc.llego) : suc.llego) ? '✔' : '✘'}</td>
                          <td style="padding:3px 8px;text-align:center">${particip}</td>
                          <td style="padding:3px 8px;text-align:center">${pagoLbl}</td>
                          <td style="padding:3px 8px;text-align:right">${suc.tipo === 'millon' ? '<span style="color:var(--color-muted)" title="Millón no paga por sucursal">n/a</span>' : fmtMoney(suc.monto_por_suc)}</td>
                        </tr>`;
                      }).join('')}
```

- [ ] **Step 3: Encabezados de Plazas y leyendas**

En la tabla de Plazas, cambiar el `<th>` "¿Cumple?" del bloque Retail por:

```html
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="TODAS las Retail de la plaza llegan a PARTICIPACIÓN (sin importar pesos)">¿Cumple?</th>
```

Actualizar la leyenda superior del detalle (línea del texto "Plazas (provincia) — Retail: ..."):

```html
                  <div style="font-size:11px;font-weight:600;color:var(--color-muted);margin:8px 0 4px">Plazas (provincia) — Retail: si TODAS llegan a PARTICIPACIÓN, plus = suma pagada de la plaza × factor (0,5) · Millón: si TODAS llegaron por efectivo, monto fijo del ABM (sin factor, uno por plaza)</div>
```

Y la leyenda de Sucursales:

```html
                  <div style="font-size:11px;font-weight:600;color:var(--color-muted);margin:8px 0 4px">Sucursales — Retail paga por consumo: completo con pesos+participación, mitad con pesos sin participación, nada sin pesos · Millón no paga por sucursal, solo cuenta para su plaza (efectivo)</div>
```

- [ ] **Step 4: Build de verificación**

```powershell
npm run build
```

Esperado: build de Vite OK, sin errores de sintaxis.

- [ ] **Step 5: Commit**

```powershell
git -C C:\apps add dashboards/ComisionesINDO/src/pages/resultado-supervisores.js
git -C C:\apps commit -m "feat(comisiones-indo): resultado Supervisores muestra pesos/participacion/pago y aviso de formato viejo"
```

---

### Task 4: Deploy y verificación funcional

**Files:**
- Modify: (ninguno — despliegue y verificación)

**Interfaces:**
- Consumes: build de Task 3, motor de Task 2.
- Produces: servicio corriendo con las reglas nuevas; cálculo 2026-06 regenerado para validación del usuario.

- [ ] **Step 1: Reiniciar el servicio**

```powershell
Restart-Service dashcomisionesindo.exe
Get-Service dashcomisionesindo.exe | Format-Table Name,Status
```

Esperado: `Running`. Si falla: `Get-Content C:\apps\dashboards\ComisionesINDO\server\daemon\dashcomisionesindo.err.log -Tail 30`.

- [ ] **Step 2: Smoke test local**

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3011/ | Select-Object StatusCode
```

Esperado: 200.

- [ ] **Step 3: Verificar aviso de formato viejo (antes de recalcular)**

En el navegador (portal `/d/8/` → período 2026-06 → Cálculos → Supervisores): el cálculo guardado (historial id 35, reglas viejas) debe mostrar el aviso amarillo y NO romperse.

- [ ] **Step 4: Re-ejecutar el cálculo 2026-06 (lo hace el usuario o vía UI)**

Portal → período 2026-06 → Cálculos → Total → "▶ Ejecutar cálculo". Luego en Supervisores revisar Eric Vidable y Josefina Rossini: filas Retail con ¿Pesos?/Particip./Pago coherentes, plazas cumpliendo por participación, componente Millón idéntico a antes ($23.000 por plaza cumplida). Los totales van a diferir de $219.000/$118.000 (referencia de reglas viejas) — el usuario valida contra `comisiones 03-2026 REFINADA.xlsx`.

- [ ] **Step 5: Actualizar documentación**

- `RETOMAR.md`: nueva sección "Sesión 2026-07-16" con las reglas y el estado (pendiente: validación del usuario contra planilla → blindar).
- `CONTEXT.md`: actualizar la sección de Supervisores con las reglas 2026-07-16.

```powershell
git -C C:\apps add dashboards/ComisionesINDO/RETOMAR.md dashboards/ComisionesINDO/CONTEXT.md
git -C C:\apps commit -m "docs(comisiones-indo): reglas 2026-07-16 de Supervisores (pesos+participacion) en RETOMAR y CONTEXT"
```
