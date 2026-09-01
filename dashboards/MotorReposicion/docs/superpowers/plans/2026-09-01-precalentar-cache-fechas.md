# Precalentar caché del combo de fechas por defecto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la primera carga del día de cualquier usuario (Período de ventas = últimos 90 días terminando ayer, Última compra = últimos 365 días) encuentre `cacheQuiebre` ya tibia, en vez de pagar los ~15-25s de `QUERY_QUIEBRE_DETALLE` en frío.

**Architecture:** Se extrae la lógica de "calcular (o servir de caché) el resultado pesado para un juego de parámetros dado" del handler `/api/tablero/quiebre` a una función reusable (`obtenerDataPesadaQuiebre`), sin cambiar su comportamiento. Se agrega un chequeo periódico liviano (`setInterval` cada 5 minutos, más una corrida al arrancar el proceso) que llama a esa misma función con el combo de fechas por defecto una vez que ya pasó la hora esperada del precálculo nocturno — si ya está cacheado, la llamada es gratis (no pega a SQL Server).

**Tech Stack:** Node.js + Express + `mssql` (ya en uso, sin dependencias nuevas).

**Spec:** `docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md` (sección 2)

## Global Constraints

- No hay test runner en este proyecto (`package.json`: `dotenv`/`express`/`mssql` solamente). La verificación de este plan es manual, contra el servidor local y la base real (mismo patrón que ya usa `scripts/precalc/*.js`): comparar respuestas JSON antes/después del refactor, y observar logs del servidor para confirmar el precalentado.
- No se cambia ningún cálculo/resultado de `/api/tablero/quiebre` — el refactor de Task 1 debe producir EXACTAMENTE la misma respuesta que antes para los mismos parámetros.
- El combo por defecto a precalentar es: Período de ventas = últimos 90 días terminando ayer (mismo default que ya usa el handler cuando no viene `desde`/`hasta` en el query), Última compra = últimos 365 días (mismo default que ya usa el handler cuando no viene `ucDesde`/`ucHasta`), `riesgoDias` = 3 (default actual del handler).
- El precalentado nunca debe romper el arranque del servidor ni bloquear requests reales — si falla (ej. SQL Server no disponible un momento), debe loguear el error y seguir, no tirar el proceso.
- Cambios "quirúrgicos": Task 1 es un refactor puro (mover código, no reescribirlo) — no se aprovecha para tocar nada más del handler.

---

### Task 1: Extraer `obtenerDataPesadaQuiebre` (refactor puro, sin cambio de comportamiento)

**Files:**
- Modify: `server.js:1200-1373` (handler de `/api/tablero/quiebre`)

**Interfaces:**
- Produces: `async function obtenerDataPesadaQuiebre({ fechaDesde, fechaHasta, riesgoDias, ucFechaDesde, ucFechaHasta })` → `Promise<dataPesada>`, donde `dataPesada` tiene la misma forma que hoy (`{ resumenTotal, catalogo, detalleColumnas, detalle, porArticulo, fechaDesde, fechaHasta, riesgoDias, ucFechaDesde, ucFechaHasta }`). Usada por el handler (este task) y por el precalentado (Task 2).

- [ ] **Step 1: Verificación PREVIA — capturar una respuesta real de referencia**

Con el servidor corriendo (`npm start` en `C:\Users\ClaudiaM\MotorReposicion-GitHub`, puerto 3050, contra la base real):

```bash
curl -s "http://127.0.0.1:3050/api/tablero/quiebre?desde=2026-06-01&hasta=2026-08-30&riesgoDias=3&ucDesde=2025-09-01&ucHasta=2026-08-31" -o /tmp/quiebre_antes.json
```

(Elegir fechas que NO sean el combo default de hoy, para forzar un cache-miss real y comparar el camino completo, no solo el cache-hit.) Guardar `/tmp/quiebre_antes.json` — se compara contra la misma llamada después del refactor en Step 4.

- [ ] **Step 2: Insertar la función extraída**

Insertar en `server.js`, inmediatamente ANTES de `app.get('/api/tablero/quiebre', ...)` (antes de la línea 1200):

```js
// Extraido del handler de /api/tablero/quiebre (2026-09-01, ver spec
// docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md) para poder reusarlo desde el
// precalentado del combo default (ver precalentarComboDefaultSiHaceFalta, mas abajo) sin duplicar
// la logica de cache/consulta pesada. Comportamiento IDENTICO al que tenia inline: mismo cache,
// misma clave, misma consulta.
async function obtenerDataPesadaQuiebre({ fechaDesde, fechaHasta, riesgoDias, ucFechaDesde, ucFechaHasta }) {
  const claveCache = `${fechaDesde.toISOString().slice(0, 10)}|${fechaHasta.toISOString().slice(0, 10)}|${riesgoDias}|${ucFechaDesde.toISOString().slice(0, 10)}|${ucFechaHasta.toISOString().slice(0, 10)}`;
  const refrescoQ = ultimoRefrescoEsperado();
  const cacheado = cacheQuiebre.get(claveCache);
  if (cacheado && cacheado.computedAt >= refrescoQ) return cacheado.data;

  const pool = await poolPromise;
  const fechaDesdePedidos = new Date();
  fechaDesdePedidos.setMonth(fechaDesdePedidos.getMonth() - PEDIDOS_ANTIGUEDAD_MESES);
  const fechaDesdeTransito = new Date();
  fechaDesdeTransito.setDate(fechaDesdeTransito.getDate() - TRANSITO_VIGENCIA_DIAS);

  const result = await pool
    .request()
    .input('fechaDesde', sql.Date, fechaDesde)
    .input('fechaHasta', sql.Date, fechaHasta)
    .input('fechaDesdePedidos', sql.Date, fechaDesdePedidos)
    .input('fechaDesdeTransito', sql.Date, fechaDesdeTransito)
    .input('riesgoDias', sql.Int, riesgoDias)
    .input('ucFechaDesde', sql.Date, ucFechaDesde)
    .input('ucFechaHasta', sql.Date, ucFechaHasta)
    .query(QUERY_QUIEBRE_DETALLE);

  const resumenRows = result.recordsets[0] || [];
  const detalleRows = result.recordsets[1] || [];
  const porArticuloRows = result.recordsets[2] || [];
  const catalogoRows = result.recordsets[3] || [];

  const resumenTotal = {};
  resumenRows.forEach((r) => {
    resumenTotal[r.Empresa] = {
      quiebres: r.Quiebres,
      riesgos: r.Riesgos,
      ok: r.Ok,
      impactoQuiebre: r.ImpactoQuiebre,
      nroSucursales: r.NroSucursales,
    };
  });

  const catalogo = construirCatalogoDesdeFilas(catalogoRows);
  const detalle = construirDetalleDesdeFilas(detalleRows);
  const porArticulo = porArticuloRows.map((r) => ({
    empresa: r.Empresa,
    codArticulo: r.CodArticulo,
    color: r.COLOR,
    sku: r.Sku,
    quiebres: r.Quiebres,
    riesgos: r.Riesgos,
    ok: r.Ok,
    impactoQuiebre: r.ImpactoQuiebre,
  }));

  const dataPesada = { resumenTotal, catalogo, detalleColumnas: DETALLE_COLUMNAS, detalle, porArticulo, fechaDesde, fechaHasta, riesgoDias, ucFechaDesde, ucFechaHasta };

  for (const [clave, valor] of cacheQuiebre) {
    if (valor.computedAt < refrescoQ) cacheQuiebre.delete(clave);
  }
  cacheQuiebre.set(claveCache, { data: dataPesada, computedAt: new Date() });
  return dataPesada;
}
```

- [ ] **Step 3: Reemplazar el cuerpo del handler para usar la función extraída**

Reemplazar el bloque completo desde `const claveCache = ...` (línea 1242) hasta el `}` que cierra el `if (!dataPesada) {` (línea 1307) — es decir, todo el cálculo/caché inline — por una sola línea:

```js
    const dataPesada = await obtenerDataPesadaQuiebre({ fechaDesde, fechaHasta, riesgoDias, ucFechaDesde, ucFechaHasta });
```

El resto del handler (parseo de `favModelos`/`favSkus`, el bloque `if (hayFavoritos) {...}` que recalcula `resumen`, y el `res.json(dataQuiebre)` final) queda exactamente igual — no depende de cómo se obtuvo `dataPesada`, solo de su forma.

- [ ] **Step 4: Verificación — respuesta idéntica antes/después**

Reiniciar el servidor (`Ctrl+C` y `npm start` de nuevo, o el mecanismo de `Start-Process` ya documentado en `CLAUDE.md` si corre en background) y repetir EXACTAMENTE la misma llamada del Step 1:

```bash
curl -s "http://127.0.0.1:3050/api/tablero/quiebre?desde=2026-06-01&hasta=2026-08-30&riesgoDias=3&ucDesde=2025-09-01&ucHasta=2026-08-31" -o /tmp/quiebre_despues.json
diff /tmp/quiebre_antes.json /tmp/quiebre_despues.json
```

Expected: `diff` no muestra ninguna diferencia (output vacío). Si hay diferencias, revisar que el Step 3 haya copiado la lógica sin alterar nada (orden de campos en un JSON no importa para esta comparación si se usa una herramienta que compara JSON parseado; si `diff` de texto plano da falsos positivos por orden de claves, usar `node -e "console.log(JSON.stringify(require('/tmp/quiebre_antes.json'))===JSON.stringify(require('/tmp/quiebre_despues.json')))"` como alternativa).

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add server.js
git commit -m "refactor(motor-reposicion): extraer obtenerDataPesadaQuiebre del handler de /api/tablero/quiebre"
```

---

### Task 2: Precalentado automático del combo default

**Files:**
- Modify: `server.js` (agregar junto a `ultimoRefrescoEsperado`, antes de `app.listen`, alrededor de la línea 1634)

**Interfaces:**
- Consumes: `obtenerDataPesadaQuiebre` (Task 1), `ultimoRefrescoEsperado()` (ya existente, línea 1627), `HORA_REFRESCO`/`MINUTO_REFRESCO` (ya existentes, líneas 1624-1625), `USE_MOCK` (ya existente).
- Produces: nada consumido por otro código — este task solo agrega comportamiento en background al arrancar el proceso.

- [ ] **Step 1: Agregar la función de precalentado y el scheduler**

Insertar en `server.js`, después de `ultimoRefrescoEsperado()` (después de la línea 1634) y ANTES de `app.listen(...)` (línea 1636):

```js
// Precalentado del combo de fechas por defecto (2026-09-01, a pedido explicito -- ver spec
// docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md): el default del frontend es
// Periodo de ventas = ultimos 90 dias terminando ayer, Fecha de ultima compra = ultimos 365 dias
// (mismos defaults que ya usa el handler cuando no vienen esos parametros en el query). Sin esto,
// la PRIMERA carga del dia de cualquier usuario paga la consulta pesada en frio (~15-25s, ver
// comentario junto a QUERY_QUIEBRE_DETALLE). obtenerDataPesadaQuiebre ya es idempotente (si ya hay
// cache tibia, no vuelve a pegarle a SQL Server), asi que llamarla de mas acá adentro no tiene
// costo una vez que ya se precalento.
const RIESGO_DIAS_DEFAULT = 3; // mismo default que usa el handler cuando no viene riesgoDias en el query
let precalentandoDefault = false;
async function precalentarComboDefaultSiHaceFalta() {
  if (USE_MOCK || precalentandoDefault) return;
  const ahora = new Date();
  const hoyRefresco = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), HORA_REFRESCO, MINUTO_REFRESCO, 0, 0);
  if (ahora < hoyRefresco) return; // el precalculo nocturno de HOY todavia no corrio -- esperar

  const hastaDefault = new Date();
  const desdeDefault = new Date();
  desdeDefault.setDate(desdeDefault.getDate() - 89);
  const ucHastaDefault = new Date();
  const ucDesdeDefault = new Date();
  ucDesdeDefault.setDate(ucDesdeDefault.getDate() - 364);

  precalentandoDefault = true;
  try {
    await obtenerDataPesadaQuiebre({
      fechaDesde: desdeDefault,
      fechaHasta: hastaDefault,
      riesgoDias: RIESGO_DIAS_DEFAULT,
      ucFechaDesde: ucDesdeDefault,
      ucFechaHasta: ucHastaDefault,
    });
    console.log('Precalentado combo default de /api/tablero/quiebre OK -', new Date().toISOString());
  } catch (err) {
    console.error('Error al precalentar combo default de /api/tablero/quiebre:', err);
  } finally {
    precalentandoDefault = false;
  }
}
setInterval(precalentarComboDefaultSiHaceFalta, 5 * 60 * 1000);
precalentarComboDefaultSiHaceFalta(); // tambien al arrancar -- cubre un reinicio del servicio a mitad de mañana
```

- [ ] **Step 2: Verificación manual — arranque después de la hora de refresco**

Este chequeo solo tiene efecto observable si se corre después de las 06:30 hora local. Si se está implementando en otro horario, verificar la LÓGICA con una prueba temporal (no dejar este cambio en el código final):

1. Temporalmente, cambiar `if (ahora < hoyRefresco) return;` por `if (false) return;` en una copia de trabajo, para forzar la corrida sin importar la hora.
2. Arrancar el servidor (`npm start`) y observar la consola: debe aparecer `Precalentado combo default de /api/tablero/quiebre OK - <timestamp>` unos segundos después de arrancar (el tiempo que tarde la consulta real si era cache-miss).
3. Confirmar que una llamada inmediatamente después con el combo default responde rápido (cache-hit, ver el log de que NO se repite "Precalentado..." dos veces seguidas para el mismo combo) — pero OJO: esa llamada debe usar la URL EXACTA que manda el navegador (copiarla de DevTools → pestaña Network al hacer una carga fresca de `tablero_motor_quiebre.html`, o construirla a mano con `hasta` = ayer, `desde` = ayer−89 días y `riesgoDias=15`). Un `curl` SIN parámetros de fecha pega contra el fallback interno del propio handler (`hastaDefault`/`desdeDefault`/`riesgoDias=3` cuando no vienen en el query), que es una clave de caché DISTINTA a la que precalienta esta función — probar así daría un falso OK aunque el precalentado esté escribiendo la clave equivocada.
4. Revertir el cambio temporal del paso 1 antes de continuar (dejar `if (ahora < hoyRefresco) return;` como está en el Step 1 real).

- [ ] **Step 3: Verificación manual — no rompe el arranque si SQL Server no responde**

1. Con `.env` apuntando a un `DB_SERVER` inválido temporalmente (o desconectando la red un instante), arrancar el servidor.
2. Confirmar que el proceso NO se cae — debe loguear `Error al precalentar combo default de /api/tablero/quiebre: ...` y seguir sirviendo (otros endpoints que no dependan de SQL, o el propio arranque, deben seguir funcionando).
3. Restaurar el `.env` real antes de continuar.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ClaudiaM\MotorReposicion-GitHub"
git add server.js
git commit -m "feat(motor-reposicion): precalentar cache del combo de fechas por defecto tras el precalculo nocturno"
```

---

## Self-Review (completado durante la escritura de este plan)

- **Cobertura del spec:** Sección 2 del spec ("Precalentado del combo de fechas por defecto") — cubierta por Tasks 1-2. El punto "reinicio del servicio a mitad de mañana" del spec está cubierto por la llamada `precalentarComboDefaultSiHaceFalta()` al final del Step 1 de Task 2 (se ejecuta también al arrancar, no solo en el `setInterval`).
- **Placeholders:** ninguno.
- **Consistencia de tipos/nombres:** `obtenerDataPesadaQuiebre` tiene la misma firma en Task 1 (definición) y Task 2 (consumo) — mismos 5 parámetros con nombre (`fechaDesde`, `fechaHasta`, `riesgoDias`, `ucFechaDesde`, `ucFechaHasta`), todos objetos `Date` salvo `riesgoDias` (número).
