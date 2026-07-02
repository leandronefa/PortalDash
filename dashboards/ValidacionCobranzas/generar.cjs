const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');
const sql  = require('mssql');

// ── Constantes ────────────────────────────────────────────────────────────────
const MEDIO_NORM = {
  'EFECTIVO':                   'EFECTIVO',
  'DEBITO MAESTRO':             'MASTER',
  'TARJETA CREDITO MASTERCARD': 'MASTER',
  'DEBITO VISA ELECTRON':       'VISA',
  'TARJETA CREDITO VISA':       'VISA',
  'TARJETA CREDITO AMEX':       'AMEX',
  'TARJETA CREDITO CABAL':      'CABAL',
  'TARJETA CREDITO NARANJA':    'NARANJA',
  'PAGO INMEDIATO - QR':        'QR',
};

const SAP_CUENTA_MEDIO = {
  '1.1.003.03.001': 'MASTER',
  '1.1.003.03.002': 'VISA',
  '1.1.003.03.003': 'AMEX',
  '1.1.003.03.004': 'CABAL',
  '1.1.003.03.006': 'NARANJA',
  '1.1.003.03.111': 'QR',
};

const MEDIOS_EXCLUIDOS = new Set([
  'TRANSFERENCIA EN CUENTA',
  'TRANSFERENCIA CVU/CBU',
]);

const PRODUCTOS_PROPIA = new Set(['CONSUMO', 'CONSUMO PREMIUM', 'EFECTIVO']);

const SQL_MASTER = {
  server: '10.0.0.115', user: 'sa', password: 'MicroS123', database: 'master',
  options: { trustServerCertificate: true, enableArithAbort: true, encrypt: false },
  connectionTimeout: 15000, requestTimeout: 60000,
};
const SQL_DB = { ...SQL_MASTER, database: 'DashboardsDB' };

const periodoCLI  = process.argv[2] || null;
const dirArchivos = process.argv[3] ? path.resolve(process.argv[3]) : __dirname;
const fechaCLI    = process.argv[4] || '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function encontrarArchivo(dir, patronRegex) {
  const archivos = fs.readdirSync(dir).filter(f => patronRegex.test(f));
  if (!archivos.length) throw new Error(`No se encontró archivo con patrón ${patronRegex} en ${dir}`);
  if (archivos.length > 1) console.warn(`  Atención: varios archivos coinciden, usando: ${archivos[0]}`);
  return path.join(dir, archivos[0]);
}

function normMedio(raw) {
  return MEDIO_NORM[String(raw || '').toUpperCase().trim()] || null;
}

function idToCC(id) {
  return String(id).padStart(3, '0');
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
               'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
function periodoLabel(p) {
  return MESES[parseInt(p.substring(4, 6)) - 1] + ' ' + p.substring(0, 4);
}

// ── PASO 1 — Localizar archivos ───────────────────────────────────────────────
console.log('Buscando archivos en:', dirArchivos);
const archivo1167  = encontrarArchivo(dirArchivos, /1167.*\.xlsx$/i);
const archivo1400  = encontrarArchivo(dirArchivos, /1400.*\.xlsx$/i);
const archivoMayor = encontrarArchivo(dirArchivos, /libro\s*mayor.*\.xlsx$/i);
console.log('1167 :', path.basename(archivo1167));
console.log('1400 :', path.basename(archivo1400));
console.log('Mayor:', path.basename(archivoMayor));

// ── PASO 2 — Leer 1167 ───────────────────────────────────────────────────────
const wb1   = XLSX.readFile(archivo1167);
const hoja1 = wb1.SheetNames.includes('Reporte') ? 'Reporte' : wb1.SheetNames[0];
const raw1  = XLSX.utils.sheet_to_json(wb1.Sheets[hoja1], { header: 1, defval: '' });

const hdrIdx1 = raw1.findIndex(r => r.includes('Id Sucursal Entidad'));
if (hdrIdx1 < 0) throw new Error('No se encontró la cabecera "Id Sucursal Entidad" en el 1167.');
console.log(`1167: cabecera en fila Excel ${hdrIdx1 + 1}, total filas: ${raw1.length - hdrIdx1 - 1}`);

// bcMap: key = `${sucId}|${medioNorm}|${modulo}` → { nombre, neto, fuente }
const bcMap = new Map();

// nombrePorSuc para lookup posterior
const nombrePorSuc = new Map();

let cnt1167 = 0, cntSkip1167 = 0;
for (let i = hdrIdx1 + 1; i < raw1.length; i++) {
  const r     = raw1[i];
  const sucId = r[2];
  if (sucId === '' || sucId === undefined || sucId === null) continue;

  const estado = String(r[19] || '').toUpperCase().trim();
  if (estado !== 'CONFIRMADO') { cntSkip1167++; continue; }

  const medioRaw = String(r[9] || '').toUpperCase().trim();
  if (MEDIOS_EXCLUIDOS.has(medioRaw)) { cntSkip1167++; continue; }

  const medio = normMedio(medioRaw);
  if (!medio) { cntSkip1167++; continue; }

  const tipoMov     = String(r[10] || '').toUpperCase().trim();
  const tipoCartera = String(r[24] || '').toUpperCase().trim();
  const desProducto = String(r[25] || '').toUpperCase().trim();
  const debito      = Number(r[11]) || 0;
  const credito     = Number(r[12]) || 0;
  const nombre      = String(r[3]  || '');

  if (nombre && !nombrePorSuc.has(String(sucId))) nombrePorSuc.set(String(sucId), nombre);

  let modulo = null;
  let neto   = 0;

  if (tipoMov === 'COBRANZA' || tipoMov === 'REVERSO DE COBRANZA') {
    if (tipoCartera === 'PROPIA' && PRODUCTOS_PROPIA.has(desProducto)) {
      modulo = 'propia';
    } else if (tipoCartera === 'NO VENDIBLE') {
      modulo = 'noVendible';
    }
    neto = tipoMov === 'COBRANZA' ? credito : -debito;
  } else if (tipoMov === 'FALTANTE') {
    modulo = 'diferencias';
    neto   = -debito;
  } else if (tipoMov === 'SOBRANTE') {
    modulo = 'diferencias';
    neto   = credito;
  }

  if (!modulo) { cntSkip1167++; continue; }

  const key = `${sucId}|${medio}|${modulo}`;
  if (!bcMap.has(key)) bcMap.set(key, { neto: 0, fuente: '1167' });
  bcMap.get(key).neto += neto;
  cnt1167++;
}
console.log(`1167: ${cnt1167} filas procesadas, ${cntSkip1167} descartadas`);

// ── PASO 3 — Leer 1400 (fallback) ────────────────────────────────────────────
const wb2   = XLSX.readFile(archivo1400);
const hoja2 = wb2.SheetNames.includes('Reporte') ? 'Reporte' : wb2.SheetNames[0];
const raw2  = XLSX.utils.sheet_to_json(wb2.Sheets[hoja2], { header: 1, defval: '' });

const hdrIdx2 = raw2.findIndex(r => r.includes('IdPago'));
if (hdrIdx2 < 0) throw new Error('No se encontró la cabecera "IdPago" en el 1400.');
console.log(`1400: cabecera en fila Excel ${hdrIdx2 + 1}`);

let cnt1400 = 0, cntSkip1400 = 0, cntFallback = 0;
for (let i = hdrIdx2 + 1; i < raw2.length; i++) {
  const r     = raw2[i];
  const sucId = r[11];
  if (sucId === '' || sucId === undefined || sucId === null) continue;

  const estado = String(r[16] || '').toUpperCase().trim();
  if (estado !== 'CONFIRMADO') { cntSkip1400++; continue; }

  const medioRaw = String(r[14] || '').toUpperCase().trim();
  if (MEDIOS_EXCLUIDOS.has(medioRaw)) { cntSkip1400++; continue; }

  const medio = normMedio(medioRaw);
  if (!medio) { cntSkip1400++; continue; }

  const tipoCartera = String(r[9] || '').toUpperCase().trim();
  const producto    = String(r[8] || '').toUpperCase().trim();
  const neto        = Number(r[18]) || 0;

  let modulo = null;
  if (tipoCartera === 'PROPIA' && PRODUCTOS_PROPIA.has(producto)) {
    modulo = 'propia';
  } else if (tipoCartera === 'NO VENDIBLE') {
    modulo = 'noVendible';
  }

  if (!modulo) { cntSkip1400++; continue; }
  cnt1400++;

  const key = `${sucId}|${medio}|${modulo}`;
  if (!bcMap.has(key)) {
    bcMap.set(key, { neto: 0, fuente: '1400' });
    cntFallback++;
  }
  if (bcMap.get(key).fuente === '1400') {
    bcMap.get(key).neto += neto;
  }
}
console.log(`1400: ${cnt1400} filas procesadas, ${cntSkip1400} descartadas, ${cntFallback} keys nuevas (fallback)`);

// ── PASO 4 — Detectar período y fecha ────────────────────────────────────────
let periodo = periodoCLI;
if (!periodo) {
  const freq = {};
  for (let i = hdrIdx1 + 1; i < raw1.length; i++) {
    const fech = String(raw1[i][16] || '');
    const m = fech.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) { const p = m[3] + m[2]; freq[p] = (freq[p] || 0) + 1; }
  }
  periodo = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'DESCONOCIDO';
}
console.log('Período:', periodo);

// Detectar fecha de operación (DD/MM/YYYY)
let fechaOp = fechaCLI;
if (!fechaOp) {
  const wb3pre  = XLSX.readFile(archivoMayor);
  const raw3pre = XLSX.utils.sheet_to_json(wb3pre.Sheets[wb3pre.SheetNames[0]], { header: 1, defval: '' });
  for (const r of raw3pre) {
    const m = String(r[5] || '').match(/COBRANZA\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (m) { fechaOp = m[1]; break; }
  }
}
if (!fechaOp) {
  const hoy = new Date();
  fechaOp = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;
}
console.log('Fecha de operación:', fechaOp);

// ── PASO 5 — Leer SAP ────────────────────────────────────────────────────────
const wb3  = XLSX.readFile(archivoMayor);
const raw3 = XLSX.utils.sheet_to_json(wb3.Sheets[wb3.SheetNames[0]], { header: 1, defval: '' });
console.log('SAP: total filas:', raw3.length);

const fechaEsc = fechaOp.replace(/\//g, '\\/');
const RE_M1   = new RegExp(`^COBRANZA\\s+${fechaEsc}`, 'i');
const RE_M1P  = /^Int Punitorios/i;
const RE_M2   = new RegExp(`^QCOBRANZA\\s+${fechaEsc}`, 'i');
const RE_M3   = new RegExp(`^DIFERENCIA DE CAJA.*${fechaEsc}`, 'i');

// sapMap: key = `${medioNorm}|${cc}|${modulo}` → { debe, haber }
const sapMap = new Map();

let seccionMedio = null;
let cntSAP = 0;

for (const r of raw3) {
  const col0 = String(r[0] || '').trim();

  if (col0 === 'Activo') {
    const cuenta = String(r[1] || '').trim();
    if (cuenta.startsWith('1.1.001.01')) {
      seccionMedio = 'EFECTIVO';
    } else {
      seccionMedio = SAP_CUENTA_MEDIO[cuenta] || null;
    }
    continue;
  }

  if (!col0 || !seccionMedio) continue;

  const cc   = String(r[13] || '').trim();
  const com  = String(r[5]  || '').trim();
  const debe = Number(r[9]  || 0);
  const hab  = Number(r[10] || 0);

  if (!cc) continue;

  let modulo = null;
  if      (RE_M1.test(com) || RE_M1P.test(com)) modulo = 'propia';
  else if (RE_M2.test(com))                      modulo = 'noVendible';
  else if (RE_M3.test(com))                      modulo = 'diferencias';
  else continue;

  const key = `${seccionMedio}|${cc}|${modulo}`;
  if (!sapMap.has(key)) sapMap.set(key, { debe: 0, haber: 0 });
  sapMap.get(key).debe  += debe;
  sapMap.get(key).haber += hab;
  cntSAP++;
}
console.log(`SAP: ${cntSAP} filas clasificadas en ${sapMap.size} keys`);

// ── PASO 6 — Cruce por módulo ─────────────────────────────────────────────────
function procesarModulo(moduloKey) {
  // Recolectar pares (sucId, medio) de BC
  const pares = new Map(); // key = `${sucId}|${medio}` → { bc, sap, fuente }

  for (const [key, val] of bcMap.entries()) {
    const [sucId, medio, mod] = key.split('|');
    if (mod !== moduloKey) continue;
    const pk = `${sucId}|${medio}`;
    if (!pares.has(pk)) pares.set(pk, { bc: 0, sap: 0, fuente: val.fuente });
    pares.get(pk).bc += val.neto;
  }

  // Incorporar SAP
  for (const [key, val] of sapMap.entries()) {
    const [medio, cc, mod] = key.split('|');
    if (mod !== moduloKey) continue;
    const sucId = String(parseInt(cc, 10));
    const pk    = `${sucId}|${medio}`;
    const sapNeto = moduloKey === 'diferencias'
      ? val.debe - val.haber
      : val.debe;
    if (!pares.has(pk)) pares.set(pk, { bc: 0, sap: 0, fuente: null });
    pares.get(pk).sap += sapNeto;
  }

  // Agrupar por sucursal
  const porSuc = new Map();
  for (const [pk, v] of pares.entries()) {
    const [sucId, medio] = pk.split('|');
    if (!porSuc.has(sucId)) {
      porSuc.set(sucId, {
        id:          parseInt(sucId) || 0,
        centroCosto: idToCC(sucId),
        nombre:      nombrePorSuc.get(sucId) || '',
        medios:      [],
      });
    }
    const bc  = Math.round(v.bc  * 100) / 100;
    const sap = Math.round(v.sap * 100) / 100;
    const dif = Math.round((bc - sap) * 100) / 100;

    let estado;
    if      (v.bc === 0 && v.sap !== 0) estado = 'SIN_BC';
    else if (v.bc !== 0 && v.sap === 0) estado = 'SIN_SAP';
    else if (Math.abs(dif) >= 1)        estado = 'REVISAR';
    else                                estado = 'OK';

    porSuc.get(sucId).medios.push({ medio, bc, sap, diferencia: dif, estado, fuente: v.fuente || null });
  }

  // Construir filas con totales de sucursal
  const filas = [];
  for (const [, s] of porSuc.entries()) {
    s.medios.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

    const bcTot  = Math.round(s.medios.reduce((a, m) => a + m.bc,  0) * 100) / 100;
    const sapTot = Math.round(s.medios.reduce((a, m) => a + m.sap, 0) * 100) / 100;
    const difTot = Math.round((bcTot - sapTot) * 100) / 100;

    const estadoSuc = s.medios.some(m => m.estado === 'REVISAR') ? 'REVISAR'
                    : s.medios.some(m => m.estado === 'SIN_SAP') ? 'SIN_SAP'
                    : s.medios.some(m => m.estado === 'SIN_BC')  ? 'SIN_BC'
                    : 'OK';

    filas.push({
      id: s.id, centroCosto: s.centroCosto, nombre: s.nombre,
      bc: bcTot, sap: sapTot, diferencia: difTot, estado: estadoSuc,
      detalleMedio: s.medios,
    });
  }

  filas.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia) || a.id - b.id);

  const totalBC  = Math.round(filas.reduce((s, r) => s + r.bc,  0) * 100) / 100;
  const totalSAP = Math.round(filas.reduce((s, r) => s + r.sap, 0) * 100) / 100;
  const totalDif = Math.round((totalBC - totalSAP) * 100) / 100;

  const estados = {
    ok:      filas.filter(f => f.estado === 'OK').length,
    revisar: filas.filter(f => f.estado === 'REVISAR').length,
    sinSAP:  filas.filter(f => f.estado === 'SIN_SAP').length,
    sinBC:   filas.filter(f => f.estado === 'SIN_BC').length,
  };

  console.log(`  [${moduloKey}] ${filas.length} suc | ✅${estados.ok} ⚠${estados.revisar} sinSAP:${estados.sinSAP} sinBC:${estados.sinBC}`);
  return { resumen: { totalBC, totalSAP, totalDiferencia: totalDif }, estados, filas };
}

console.log('\nCruce por módulo:');
const modulos = {
  propia:      procesarModulo('propia'),
  noVendible:  procesarModulo('noVendible'),
  diferencias: procesarModulo('diferencias'),
};

// ── PASO 7 — Escribir data-YYYYMM.js ─────────────────────────────────────────
const cntSolo1167  = [...bcMap.values()].filter(v => v.fuente === '1167').length;
const cntFallback2 = [...bcMap.values()].filter(v => v.fuente === '1400').length;

const salida = {
  periodo,
  periodoLabel: periodoLabel(periodo),
  generadoEn:    new Date().toLocaleString('es-AR'),
  fechaDetectada: fechaOp,
  fuente: { keysSolo1167: cntSolo1167, keysFallback1400: cntFallback2 },
  modulos,
};

const publicDir = path.join(__dirname, 'public');
fs.mkdirSync(publicDir, { recursive: true });

const contenidoJS = `window.COBRANZAS_DATA = ${JSON.stringify(salida, null, 0)};`;
const destPeriodo = path.join(publicDir, `data-${periodo}.js`);
fs.writeFileSync(destPeriodo, contenidoJS, 'utf8');
fs.writeFileSync(path.join(publicDir, 'data.js'), contenidoJS, 'utf8');

const kb = Math.round(fs.statSync(destPeriodo).size / 1024);
console.log(`\ndata-${periodo}.js generado: ${kb} KB`);

// ── PASO 8 — Persistir en SQL ─────────────────────────────────────────────────
async function guardarEnSQL() {
  console.log('\nConectando a SQL Server...');
  const pm = await sql.connect(SQL_MASTER);
  await pm.request().query(
    `IF NOT EXISTS (SELECT name FROM sys.databases WHERE name='DashboardsDB') CREATE DATABASE DashboardsDB;`
  );
  await pm.close();

  const pool = await sql.connect(SQL_DB);

  // Detectar schema viejo (tiene columna MedioPago en Detalle → incompatible)
  const schemaCheck = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='DashValCobranzas_Detalle' AND COLUMN_NAME='MedioPago'`);
  if (schemaCheck.recordset.length > 0) {
    console.log('  Migrando schema viejo: recreando tablas...');
    await pool.request().query(`
      IF OBJECT_ID('DashValCobranzas_Detalle','U')  IS NOT NULL DROP TABLE DashValCobranzas_Detalle;
      IF OBJECT_ID('DashValCobranzas_Periodos','U') IS NOT NULL DROP TABLE DashValCobranzas_Periodos;`);
  }

  // Crear tabla Periodos
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='DashValCobranzas_Periodos' AND type='U')
    CREATE TABLE DashValCobranzas_Periodos (
      Id           INT IDENTITY(1,1) PRIMARY KEY,
      Periodo      VARCHAR(6)     NOT NULL,
      Cartera      VARCHAR(30)    NOT NULL,
      IdSucursal   INT            NULL,
      CentroCosto  VARCHAR(10)    NULL,
      NombreSuc    VARCHAR(200)   NULL,
      BC           DECIMAL(18,2)  NULL,
      SAP          DECIMAL(18,2)  NULL,
      Diferencia   DECIMAL(18,2)  NULL,
      Estado       VARCHAR(20)    NULL,
      FechaProceso DATETIME       DEFAULT GETDATE(),
      CONSTRAINT UQ_DashValCob_Periodo UNIQUE (Periodo, Cartera, IdSucursal)
    );`);

  // Crear tabla Detalle
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='DashValCobranzas_Detalle' AND type='U')
    CREATE TABLE DashValCobranzas_Detalle (
      Id         INT IDENTITY(1,1) PRIMARY KEY,
      PeriodoId  INT            NOT NULL REFERENCES DashValCobranzas_Periodos(Id) ON DELETE CASCADE,
      MedioNorm  VARCHAR(20)    NOT NULL,
      BC         DECIMAL(18,2)  NULL,
      SAP        DECIMAL(18,2)  NULL,
      Diferencia DECIMAL(18,2)  NULL,
      Estado     VARCHAR(20)    NULL,
      Fuente     VARCHAR(10)    NULL
    );`);

  console.log('Schema verificado.');

  // Limpiar período antes de reinsertar
  await pool.request()
    .input('Periodo', sql.VarChar(6), periodo)
    .query(`DELETE FROM DashValCobranzas_Periodos WHERE Periodo=@Periodo`);

  let totalFilas = 0;
  for (const [cartKey, modulo] of Object.entries(modulos)) {
    const cartLabel = cartKey === 'propia' ? 'PROPIA'
                    : cartKey === 'noVendible' ? 'NO_VENDIBLE' : 'DIFERENCIAS';
    for (const fila of modulo.filas) {
      const resP = await pool.request()
        .input('Periodo',     sql.VarChar(6),   periodo)
        .input('Cartera',     sql.VarChar(30),  cartLabel)
        .input('IdSucursal',  sql.Int,           fila.id || null)
        .input('CentroCosto', sql.VarChar(10),   fila.centroCosto)
        .input('NombreSuc',   sql.VarChar(200),  fila.nombre || null)
        .input('BC',          sql.Decimal(18,2), fila.bc)
        .input('SAP',         sql.Decimal(18,2), fila.sap)
        .input('Diferencia',  sql.Decimal(18,2), fila.diferencia)
        .input('Estado',      sql.VarChar(20),   fila.estado)
        .query(`INSERT INTO DashValCobranzas_Periodos
          (Periodo,Cartera,IdSucursal,CentroCosto,NombreSuc,BC,SAP,Diferencia,Estado)
          OUTPUT INSERTED.Id
          VALUES (@Periodo,@Cartera,@IdSucursal,@CentroCosto,@NombreSuc,@BC,@SAP,@Diferencia,@Estado)`);
      const periodoId = resP.recordset[0].Id;

      for (const det of fila.detalleMedio) {
        await pool.request()
          .input('PeriodoId', sql.Int,           periodoId)
          .input('MedioNorm', sql.VarChar(20),   det.medio)
          .input('BC',        sql.Decimal(18,2), det.bc)
          .input('SAP',       sql.Decimal(18,2), det.sap)
          .input('Diferencia',sql.Decimal(18,2), det.diferencia)
          .input('Estado',    sql.VarChar(20),   det.estado)
          .input('Fuente',    sql.VarChar(10),   det.fuente || null)
          .query(`INSERT INTO DashValCobranzas_Detalle
            (PeriodoId,MedioNorm,BC,SAP,Diferencia,Estado,Fuente)
            VALUES (@PeriodoId,@MedioNorm,@BC,@SAP,@Diferencia,@Estado,@Fuente)`);
      }
      totalFilas++;
    }
  }

  await pool.close();
  console.log(`SQL: ${totalFilas} filas insertadas en DashboardsDB.`);
}

guardarEnSQL()
  .then(() => console.log('\nListo. Período', periodo, '—', periodoLabel(periodo)))
  .catch(err => { console.error('\nERROR SQL:', err.message); process.exit(1); });
