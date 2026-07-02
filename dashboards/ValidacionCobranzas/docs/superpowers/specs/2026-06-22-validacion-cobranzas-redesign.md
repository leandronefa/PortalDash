# Spec: Rediseño Validación Cobranzas — Dashboard Conciliación Financiera

**Fecha:** 2026-06-22  
**Proyecto:** `C:\apps\dashboards\ValidacionCobranzas`  
**Alcance:** Reescritura de `generar.cjs`, ajuste de `server.cjs`, rediseño de `public/index.html`

---

## Contexto

El dashboard anterior conciliaba datos de un archivo 1167 contra un Libro Mayor SAP segmentado por secciones de tarjeta (Mastercard, Visa, etc.), con dos carteras (Propia y No Vendible).

La nueva arquitectura incorpora:
- Un tercer archivo de entrada: **1400 Detalle de Pagos** (fallback al 1167)
- Un **SAP unificado** con todas las cuentas en un solo archivo (efectivo + tarjetas)
- Un tercer módulo de cruce: **Diferencias de Caja** (faltantes/sobrantes)
- Regla de tolerancia explícita: `|diff| >= $1 → REVISAR`, `|diff| < $1 → OK`

---

## Archivos de entrada

Los tres archivos se depositan en `archivos/{YYYYMM}/` al momento del upload, y se detectan por patrón de nombre:

| # | Patrón de nombre | Fuente | Hoja |
|---|---|---|---|
| 1 | `/1167.*\.xlsx$/i` | Be Clever — Movimientos | `Reporte` |
| 2 | `/1400.*\.xlsx$/i` | Be Clever — Auxiliar | `Reporte` |
| 3 | `/libro\s*mayor.*\.xlsx$/i` o `/mayor.*medios.*\.xlsx$/i` | SAP — Mayor Unificado | `Sheet1` |

---

## Normalización de Medios de Pago

Ambas fuentes (Be Clever y SAP) se normalizan a etiquetas canónicas:

| Raw Be Clever | Cuenta SAP | Etiqueta |
|---|---|---|
| `EFECTIVO` | `1.1.001.01.*` (Caja Recaudadora) | `EFECTIVO` |
| `DEBITO MAESTRO`, `TARJETA CREDITO MASTERCARD` | `1.1.003.03.001` | `MASTER` |
| `DEBITO VISA ELECTRON`, `TARJETA CREDITO VISA` | `1.1.003.03.002` | `VISA` |
| `TARJETA CREDITO AMEX` | `1.1.003.03.003` | `AMEX` |
| `TARJETA CREDITO CABAL` | `1.1.003.03.004` | `CABAL` |
| `TARJETA CREDITO NARANJA` | `1.1.003.03.006` | `NARANJA` |
| `PAGO INMEDIATO - QR` | `1.1.003.03.111` | `QR` |

Medios excluidos en Be Clever: `TRANSFERENCIA EN CUENTA`, `TRANSFERENCIA CVU/CBU`.

---

## Módulos de cruce

| ID | Tab | Filtro Be Clever | Filtro SAP (Comentarios) |
|---|---|---|---|
| M1 | Cartera Propia | `tipoCartera=PROPIA` + `desProducto ∈ [CONSUMO, CONSUMO PREMIUM, EFECTIVO]` + `tipoMov ∈ [COBRANZA, REVERSO DE COBRANZA]` | `/^COBRANZA\s+{fecha}/i` OR `/^Int Punitorios/i` |
| M2 | Cartera No Vendible | `tipoCartera=NO VENDIBLE` + `tipoMov ∈ [COBRANZA, REVERSO DE COBRANZA]` | `/^QCOBRANZA\s+{fecha}/i` |
| M3 | Diferencias de Caja | `tipoMov ∈ [FALTANTE, SOBRANTE]` | `/^DIFERENCIA DE CAJA.*{fecha}/i` |

---

## generar.cjs — Lógica paso a paso

### Constantes

```js
const MEDIO_NORM = {
  'EFECTIVO': 'EFECTIVO',
  'DEBITO MAESTRO': 'MASTER', 'TARJETA CREDITO MASTERCARD': 'MASTER',
  'DEBITO VISA ELECTRON': 'VISA', 'TARJETA CREDITO VISA': 'VISA',
  'TARJETA CREDITO AMEX': 'AMEX',
  'TARJETA CREDITO CABAL': 'CABAL',
  'TARJETA CREDITO NARANJA': 'NARANJA',
  'PAGO INMEDIATO - QR': 'QR',
};

const SAP_CUENTA_MEDIO = {
  // prefijo: todas las cuentas 1.1.001.01.XXX son EFECTIVO
  '1.1.003.03.001': 'MASTER',
  '1.1.003.03.002': 'VISA',
  '1.1.003.03.003': 'AMEX',
  '1.1.003.03.004': 'CABAL',
  '1.1.003.03.006': 'NARANJA',
  '1.1.003.03.111': 'QR',
};

const MEDIOS_EXCLUIDOS = new Set([
  'TRANSFERENCIA EN CUENTA', 'TRANSFERENCIA CVU/CBU'
]);
```

### PASO 1 — Localizar archivos

`encontrarArchivo(dir, regex)` lanza error descriptivo si no encuentra exactamente uno.  
Los tres archivos deben existir en `dirPeriodo`; si falta alguno, el proceso falla con mensaje claro.

### PASO 2 — Leer 1167

- Leer hoja `Reporte` con `header:1`
- Detectar cabecera dinámicamente: `findIndex(r => r.includes('Id Sucursal Entidad'))`
- **Columnas por índice** (0-based):
  - `2` = Id Sucursal Entidad
  - `3` = Descripción Sucursal
  - `9` = Medio de Pago (raw)
  - `10` = Tipo Mov Caja
  - `11` = Importe Débito
  - `12` = Importe Crédito
  - `19` = Estado
  - `24` = Tipo cartera
  - `25` = DesProducto
- **Filtros base:** `Estado === 'CONFIRMADO'` + `medio ∉ MEDIOS_EXCLUIDOS`
- **Asignación de módulo:**

```
tipoMov = COBRANZA | REVERSO DE COBRANZA:
  tipoCartera=PROPIA + desProducto ∈ [CONSUMO, CONSUMO PREMIUM, EFECTIVO] → M1
  tipoCartera=NO VENDIBLE                                                   → M2
tipoMov = FALTANTE → M3
tipoMov = SOBRANTE → M3
```

- **Cálculo de neto:**

```
COBRANZA            → +Crédito (idx 12)
REVERSO DE COBRANZA → -Débito  (idx 11)
FALTANTE            → -Débito  (idx 11)
SOBRANTE            → +Crédito (idx 12)
```

- **Acumulación:** `Map` con key `${sucId}|${medioNorm}|${modulo}` → `{ nombre, neto, fuente:'1167' }`

### PASO 3 — Leer 1400 (fallback)

- Leer hoja `Reporte` con `header:1`
- Detectar cabecera dinámicamente: `findIndex(r => r.includes('IdPago'))`
- **Columnas por índice:**
  - `8` = Producto
  - `9` = Tipo Cartera
  - `11` = Sucursal Entidad
  - `14` = Medio Pago (raw)
  - `16` = Estado
  - `18` = Total Confirmado
- **Filtros:** `Estado === 'CONFIRMADO'` + `medio ∉ MEDIOS_EXCLUIDOS`
- **Módulo:** igual que 1167 (M1/M2 por cartera+producto). Sin M3 (el 1400 no tiene FALTANTE/SOBRANTE).
- **Neto:** Total Confirmado (idx 18) como cobranzas.
- **Condición de inserción:** solo si la key `${sucId}|${medioNorm}|${modulo}` **no existe** en el mapa del 1167. Marca `fuente:'1400'`.

### PASO 4 — Detectar fecha de operación

Prioridad:
1. `process.argv[4]` si fue pasado explícitamente (formato `DD/MM/YYYY`)
2. Scan de Comentarios del SAP: primera coincidencia de `/COBRANZA\s+(\d{2}\/\d{2}\/\d{4})/i`
3. Fecha de hoy en formato `DD/MM/YYYY`

La fecha se usa como literal en los regex de filtro del SAP. Se guarda en el JSON de salida como `fechaDetectada`.

### PASO 5 — Leer SAP

Single-pass sobre todas las filas. Variables de estado: `seccionMedio = null`.

```
IF row[0] === 'Activo':
  cuenta = String(row[1]).trim()
  IF cuenta.startsWith('1.1.001.01') → seccionMedio = 'EFECTIVO'
  ELSE IF SAP_CUENTA_MEDIO[cuenta]   → seccionMedio = SAP_CUENTA_MEDIO[cuenta]
  ELSE                               → seccionMedio = null
  CONTINUE

IF row[0] === '' (vacío) → CONTINUE

IF seccionMedio === null → SKIP

cc   = String(row[13] || '').trim()          // Centro de Costo → sucursal code
com  = String(row[5]  || '').trim()          // Comentarios
debe = Number(row[9]  || 0)
hab  = Number(row[10] || 0)

Determinar módulo por comentario:
  /^COBRANZA\s+{fecha}/i          → M1
  /^Int Punitorios/i              → M1
  /^QCOBRANZA\s+{fecha}/i         → M2
  /^DIFERENCIA DE CAJA.*{fecha}/i → M3
  otros                           → SKIP

key = `${seccionMedio}|${cc}|${modulo}`
Acumular en Map:
  M1 / M2 → debe_acum += debe
  M3      → debe_acum += debe, haber_acum += hab
```

**Nota M3:** El neto SAP para Diferencias = `debe_acum - haber_acum` (sobrante en Debe, faltante en Haber).

### PASO 6 — Cruce por módulo

Para cada módulo `['propia','noVendible','diferencias']`:

1. Unión de keys de BC y SAP → conjunto de pares `(sucId, medio)`
2. Agrupar por sucursal para la estructura de UI (fila principal = sucursal, sub-filas = medios)
3. Por cada `(sucId, medio)`:
   - `bc_neto`  = mapa BC [key].neto (0 si no existe) → estado `sinBC` si no existe
   - `sap_neto` = M1/M2: `debe_acum`; M3: `debe_acum - haber_acum` (0 si no existe) → estado `sinSAP`
   - `diferencia = bc_neto - sap_neto`
   - `estado = Math.abs(diferencia) >= 1 ? 'REVISAR' : 'OK'`
4. Fila de sucursal = suma de sub-filas; `estado` = `'REVISAR'` si algún sub-fila es `REVISAR`, sino `'OK'`
5. Ordenar por `|diferencia|` descendente

### PASO 7 — Escribir data-YYYYMM.js

```js
window.COBRANZAS_DATA = {
  periodo,           // "202603"
  periodoLabel,      // "Marzo 2026"
  generadoEn,
  fechaDetectada,    // "31/03/2026"
  fuente: {
    sucursalesSolo1167:      N,  // para auditoria
    sucursales1400Fallback:  N,
  },
  modulos: {
    propia:      { resumen, estados, filas },
    noVendible:  { resumen, estados, filas },
    diferencias: { resumen, estados, filas },
  }
}
```

Estructura de `resumen`:
```js
{ totalBC, totalSAP, totalDiferencia }
```

Estructura de `estados`:
```js
{ ok, revisar, sinSAP, sinBC }
```

Estructura de cada `fila`:
```js
{
  id, centroCosto, nombre,
  bc, sap, diferencia, estado,   // totales de sucursal
  detalleMedio: [{
    medio, bc, sap, diferencia, estado,
    fuente: '1167' | '1400'
  }]
}
```

### PASO 8 — Persistir en SQL

Mismas tablas `DashValCobranzas_Periodos` y `DashValCobranzas_Detalle`.  
Columna `Cartera` toma valores: `'PROPIA'`, `'NO_VENDIBLE'`, `'DIFERENCIAS'`.  
Se agregan columnas `MedioNorm VARCHAR(20)` y `Fuente VARCHAR(10)` si no existen (con `ALTER TABLE IF NOT EXISTS` pattern).

---

## server.cjs — Cambios

### Upload: campo adicional `archivo1400`

```js
upload.fields([
  { name: 'archivo1167',  maxCount: 1 },
  { name: 'archivo1400',  maxCount: 1 },   // nuevo
  { name: 'archivoMayor', maxCount: 1 }
])
```

Validación: los tres archivos son obligatorios.

### Pasar fecha al generador

```js
execFile('node', [
  path.join(__dirname, 'generar.cjs'),
  periodo,
  dirPeriodo,
  req.body.fecha || ''   // opcional, auto-detectada si vacío
], ...)
```

---

## index.html — Cambios

### Tabs (de 3 a 4)
```
Cartera Propia | Cartera No Vendible | Diferencias de Caja | Por Medio de Pago
```

### Modal de carga (de 2 a 3 inputs de archivo + fecha opcional)
```
Período (YYYYMM)          [text]
Archivo 1167 (.xlsx)      [file]
Archivo 1400 (.xlsx)      [file]     ← nuevo
Libro Mayor SAP (.xlsx)   [file]
Fecha operación (DD/MM/YYYY) [text, placeholder "auto-detectada"]   ← nuevo
```

### Estados y colores

| Estado | Etiqueta UI | Color |
|---|---|---|
| `OK` | `✅ OK` | verde |
| `REVISAR` | `⚠ REVISAR` | amarillo |
| `SIN_SAP` | `— Sin SAP` | naranja |
| `SIN_BC` | `— Sin BC` | rojo |

### Columnas de tabla por módulo

**Fila principal (por sucursal):**  
`Suc | Nombre | Be Clever | SAP | Diferencia | Estado`

**Sub-fila expandible (por medio):**  
`Medio | Be Clever | SAP | Diferencia | Estado | Fuente`

### Cards de resumen (por tab)
```
[ Be Clever Total ] [ SAP Total ] [ Diferencia Total ] [ ✅ OK: N ] [ ⚠ REVISAR: N ]
```

### Backward compatibility

```js
// El período 202507 existente usa DATA.carteras; los nuevos usan DATA.modulos
const src = DATA.modulos ?? {
  propia:     DATA.carteras?.propia,
  noVendible: DATA.carteras?.noVendible,
};
```

---

## Criterio de éxito

- Al procesar los archivos de marzo 2026, el log de consola muestra las 3 carteras con sus contadores de `OK` / `REVISAR`.
- Los períodos con `DATA.carteras` (pre-rediseño) siguen mostrando correctamente en el frontend.
- Ninguna sucursal con diferencia ≥ $1 aparece como `OK`.
- La columna Fuente en el detalle identifica correctamente cuándo el dato viene del 1400.
