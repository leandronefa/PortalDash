const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------
const SQL_MASTER = {
  server: '10.0.0.115', user: 'sa', password: 'MicroS123', database: 'master',
  options: { trustServerCertificate: true, enableArithAbort: true, encrypt: false },
  connectionTimeout: 15000, requestTimeout: 60000
};
const SQL_DB = { ...SQL_MASTER, database: 'DashboardsDB' };

const periodoCLI  = process.argv[2] || null;
// Directorio de origen de los archivos Excel (por defecto: raíz del proyecto)
const dirArchivos = process.argv[3] ? path.resolve(process.argv[3]) : __dirname;

// Mapeo: Medio Pago 1400 → descripción de cuenta en el Mayor
// Se carga desde mapeo.json (editado manualmente desde la UI)
const MAPEO_PATH = path.join(__dirname, 'mapeo.json');
const MAPEO_1400_A_MAYOR = fs.existsSync(MAPEO_PATH)
  ? JSON.parse(fs.readFileSync(MAPEO_PATH, 'utf8'))
  : {};
if (Object.keys(MAPEO_1400_A_MAYOR).length)
  console.log('Mapeo cargado desde mapeo.json:', Object.keys(MAPEO_1400_A_MAYOR).length, 'asignaciones');
else
  console.warn('  AVISO: mapeo.json vacío o inexistente — ningún medio tendrá mayor asignado');

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function encontrarArchivo(dir, patronRegex) {
  const archivos = fs.readdirSync(dir).filter(f => patronRegex.test(f));
  if (archivos.length === 0) throw new Error(`No se encontró archivo con patrón ${patronRegex}`);
  if (archivos.length > 1) console.warn(`  Atención: varios archivos coinciden con ${patronRegex}, usando: ${archivos[0]}`);
  return path.join(dir, archivos[0]);
}

const sumarCols = r =>
  (Number(r['Total Punitorios'])  || 0) + (Number(r['CUCGastos'])         || 0) +
  (Number(r['CUCGastosIVA'])      || 0) + (Number(r['CUCMSellado'])       || 0) +
  (Number(r['Cargo Seg Vto'])     || 0) + (Number(r['Cargo Seg Vto IVA']) || 0);

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
function periodoLabel(p) {
  return MESES[parseInt(p.substring(4, 6)) - 1] + ' ' + p.substring(0, 4);
}

// ------------------------------------------------------------
// Parsear Mayor completo: divide por secciones "Activo"
// Retorna: { [descripcionCuenta]: { porPrestamo, totalDebe, totalHaber, movimientos } }
// La clave es la descripción de la cuenta (ej: "Mastercard"), no el Medio Pago.
// El mapeo a Medio Pago del 1400 se hace externamente con MAPEO_1400_A_MAYOR.
// ------------------------------------------------------------
function parsearMayorCompleto(data) {
  const secciones = [];
  let seccionActual = null;
  data.forEach(r => {
    if (r['Fecha de contabilización'] === 'Activo') {
      seccionActual = { descripcion: r['Comentarios'], cuenta: r['Fecha de vencimiento'], movs: [] };
      secciones.push(seccionActual);
    } else if (seccionActual && String(r['Fecha de contabilización']).trim()) {
      seccionActual.movs.push(r);
    }
  });

  // Normaliza descripciones con patrón "Nombre Suc N" → agrupa en "Nombre"
  // Ej: "Caja Recaudadora Suc 1", "Caja Recaudadora Suc 2" → "Caja Recaudadora"
  function nombreGrupo(desc) {
    const m = desc.match(/^(.+?)\s+(?:Suc|Sucursal)\s+\d+$/i);
    return m ? m[1].trim() : desc;
  }

  const resultado = {};
  secciones.forEach(s => {
    const grupo = nombreGrupo(s.descripcion);
    if (!resultado[grupo]) {
      resultado[grupo] = {
        descripcion: grupo,
        cuenta: s.cuenta,   // cuenta del primer sub-elemento; se pisa si hay más
        porPrestamo: {},
        totalDebe: 0, totalHaber: 0, movimientos: 0,
        subcuentas: []
      };
    }
    const g = resultado[grupo];
    g.subcuentas.push(s.descripcion);
    // Acumular movimientos en el grupo
    s.movs.forEach(r => {
      const m = String(r['Comentarios'] || '').match(/Int Punitorios(\d+)-/);
      const id = m ? m[1] : null;
      if (!id) return;
      if (!g.porPrestamo[id]) g.porPrestamo[id] = { debe: 0, haber: 0, neto: 0, movimientos: 0 };
      const debe  = Number(r['Debe'])  || 0;
      const haber = Number(r['Haber']) || 0;
      g.porPrestamo[id].debe  += debe;
      g.porPrestamo[id].haber += haber;
      g.porPrestamo[id].neto  += debe - haber;
      g.porPrestamo[id].movimientos++;
    });
    g.totalDebe   += s.movs.reduce((acc, r) => acc + (Number(r['Debe'])  || 0), 0);
    g.totalHaber  += s.movs.reduce((acc, r) => acc + (Number(r['Haber']) || 0), 0);
    g.movimientos += s.movs.length;
  });

  Object.values(resultado).forEach(g => {
    const sub = g.subcuentas.length > 1 ? ` (${g.subcuentas.length} subcuentas)` : ` (${g.cuenta})`;
    console.log(`  Mayor: "${g.descripcion}"${sub} | ${g.movimientos} movs | ${Object.keys(g.porPrestamo).length} préstamos`);
  });

  return resultado; // keyed by descripcion agrupada, e.g. "Caja Recaudadora"
}

// ------------------------------------------------------------
// Determinar motivo de diferencia
// ------------------------------------------------------------
// mediosPago puede ser string (un medio) o array (grupo de medios)
function determinarMotivo(estado, diferencia, idPrestamo, mediosPago, tieneMayor, data1All) {
  if (estado === 'CONCILIADO') return null;
  if (estado === 'SOLO_MAYOR') return 'Movimiento contable sin registro en archivo 1400';
  if (estado === 'SIN_MAYOR') {
    if (!tieneMayor) return 'Medio de pago sin mayor contable disponible para el período';
    return 'Sin movimiento registrado en el Mayor contable';
  }

  // DIFERENCIA: buscar en el 1400 completo (todos los medios del grupo)
  const mediosArr = Array.isArray(mediosPago) ? mediosPago : [mediosPago];
  const mismoId = data1All.filter(r =>
    String(r['IdPrestamo']) === idPrestamo &&
    mediosArr.includes(r['Medio Pago']) &&
    r['Tipo Cartera'] === 'PROPIA' &&
    r['Entidad'] === 'CREDITO MILLON' &&
    r['Canal de Pago'] === 'CAJA'
  );

  const anulados   = mismoId.filter(r => r['Estado'] === 'ANULADO');
  const pendientes = mismoId.filter(r => r['Estado'] === 'PENDIENTE DE CONFIRMAR');
  const sumAnulados   = anulados.reduce((s, r)   => s + sumarCols(r), 0);
  const sumPendientes = pendientes.reduce((s, r)  => s + sumarCols(r), 0);

  if (anulados.length > 0 && Math.abs(diferencia + sumAnulados) < 0.10) {
    const n = anulados.length;
    return `${n} pago${n>1?'s':''} ANULADO${n>1?'S':''} ($${Math.abs(sumAnulados).toFixed(2)}) contabilizado${n>1?'s':''} en Mayor, excluido${n>1?'s':''} del filtro CONFIRMADO`;
  }
  if (anulados.length > 0 && Math.abs(sumAnulados) > 0) {
    const resto = diferencia + sumAnulados;
    return `${anulados.length} pago(s) ANULADO(S) ($${Math.abs(sumAnulados).toFixed(2)}) explican parcialmente — resto inexplicado $${resto.toFixed(2)}`;
  }
  if (pendientes.length > 0 && Math.abs(diferencia + sumPendientes) < 0.10) {
    return `${pendientes.length} pago(s) PENDIENTE(S) ($${Math.abs(sumPendientes).toFixed(2)}) contabilizados en Mayor, aún sin confirmar en 1400`;
  }
  if (Math.abs(diferencia) < 1) return `Diferencia de redondeo ($${diferencia.toFixed(2)})`;
  if (diferencia > 0) return `1400 supera al Mayor en $${diferencia.toFixed(2)} — posible movimiento pendiente de contabilizar`;
  return `Mayor supera al 1400 en $${Math.abs(diferencia).toFixed(2)} — posible movimiento contable sin correspondencia en cobros`;
}

// ------------------------------------------------------------
// Conciliar un grupo de medios contra una cuenta del mayor
// label     : nombre de la cuenta del mayor (o del medio si no tiene mayor)
// medios1400: array de medios del 1400 que componen el grupo
// ------------------------------------------------------------
function conciliarMedio(label, medios1400, filasDelMedio, mayorDelMedio, tieneMayor, data1All) {
  // Agrupar por IdPrestamo (totales + filas raw para popup de detalle)
  const por1400    = {};
  const rawPor1400 = {};   // id → [[medioPago, aa, as, at, au, av, aw], ...]
  filasDelMedio.forEach(r => {
    const id = String(r['IdPrestamo'] || '').trim();
    if (!id) return;
    if (!por1400[id]) {
      por1400[id] = {
        nombre: r['Apellido Nombre'] || '', idPrestamo: id,
        punitorio: 0, cucGastos: 0, cucGastosIVA: 0,
        cucSellado: 0, cargoSegVto: 0, cargoSegVtoIVA: 0, registros: 0
      };
    }
    por1400[id].punitorio      += Number(r['Total Punitorios'])  || 0;
    por1400[id].cucGastos      += Number(r['CUCGastos'])         || 0;
    por1400[id].cucGastosIVA   += Number(r['CUCGastosIVA'])      || 0;
    por1400[id].cucSellado     += Number(r['CUCMSellado'])       || 0;
    por1400[id].cargoSegVto    += Number(r['Cargo Seg Vto'])     || 0;
    por1400[id].cargoSegVtoIVA += Number(r['Cargo Seg Vto IVA']) || 0;
    por1400[id].registros++;
    // Fila raw compacta (array para ahorrar espacio en JSON)
    if (!rawPor1400[id]) rawPor1400[id] = [];
    rawPor1400[id].push([
      r['Medio Pago'] || '',
      Number(r['Total Punitorios'])  || 0,
      Number(r['CUCGastos'])         || 0,
      Number(r['CUCGastosIVA'])      || 0,
      Number(r['CUCMSellado'])       || 0,
      Number(r['Cargo Seg Vto'])     || 0,
      Number(r['Cargo Seg Vto IVA']) || 0,
    ]);
  });

  const idsEn1400  = new Set(Object.keys(por1400));
  const idsEnMayor = tieneMayor ? new Set(Object.keys(mayorDelMedio.porPrestamo)) : new Set();
  const todosIds   = new Set([...idsEn1400, ...idsEnMayor]);

  const filas = [];
  todosIds.forEach(id => {
    const e1 = por1400[id];
    const e2 = tieneMayor ? mayorDelMedio.porPrestamo[id] : null;
    const total1400 = e1
      ? e1.punitorio + e1.cucGastos + e1.cucGastosIVA + e1.cucSellado + e1.cargoSegVto + e1.cargoSegVtoIVA
      : 0;
    const totalMayor = e2 ? e2.neto : 0;
    const diferencia = total1400 - totalMayor;

    let estado;
    if (!e1)                              estado = 'SOLO_MAYOR';
    else if (!e2)                         estado = 'SIN_MAYOR';
    else if (Math.abs(diferencia) < 0.05) estado = 'CONCILIADO';
    else                                  estado = 'DIFERENCIA';

    filas.push({
      idPrestamo: id,
      nombre: e1 ? e1.nombre : '',
      registros: e1 ? e1.registros : 0,
      punitorio:      e1 ? e1.punitorio      : 0,
      cucGastos:      e1 ? e1.cucGastos      : 0,
      cucGastosIVA:   e1 ? e1.cucGastosIVA   : 0,
      cucSellado:     e1 ? e1.cucSellado     : 0,
      cargoSegVto:    e1 ? e1.cargoSegVto    : 0,
      cargoSegVtoIVA: e1 ? e1.cargoSegVtoIVA : 0,
      total1400,
      mayorDebe:  e2 ? e2.debe  : 0,
      mayorHaber: e2 ? e2.haber : 0,
      totalMayor,
      diferencia,
      estado,
      motivo: determinarMotivo(estado, diferencia, id, medios1400, tieneMayor, data1All),
      // Filas raw del 1400 para popup de detalle (solo si hay datos en el 1400)
      rawFilas: e1 ? (rawPor1400[id] || []) : [],
    });
  });

  const tot1400 = { punitorio:0, cucGastos:0, cucGastosIVA:0, cucSellado:0, cargoSegVto:0, cargoSegVtoIVA:0, total:0 };
  Object.values(por1400).forEach(r => {
    tot1400.punitorio      += r.punitorio;
    tot1400.cucGastos      += r.cucGastos;
    tot1400.cucGastosIVA   += r.cucGastosIVA;
    tot1400.cucSellado     += r.cucSellado;
    tot1400.cargoSegVto    += r.cargoSegVto;
    tot1400.cargoSegVtoIVA += r.cargoSegVtoIVA;
  });
  tot1400.total = tot1400.punitorio + tot1400.cucGastos + tot1400.cucGastosIVA +
                  tot1400.cucSellado + tot1400.cargoSegVto + tot1400.cargoSegVtoIVA;

  const estados = {
    conciliado: filas.filter(f => f.estado === 'CONCILIADO').length,
    diferencia:  filas.filter(f => f.estado === 'DIFERENCIA').length,
    sinMayor:    filas.filter(f => f.estado === 'SIN_MAYOR').length,
    soloMayor:   filas.filter(f => f.estado === 'SOLO_MAYOR').length,
  };

  return {
    filas,
    resumen: {
      label,
      medios1400,
      cuentaMayor: tieneMayor ? mayorDelMedio.descripcion : null,
      tieneMayor,
      registros1400: filasDelMedio.length,
      idsUnicos1400: idsEn1400.size,
      movimientosMayor: tieneMayor ? mayorDelMedio.movimientos : 0,
      idsMayor: idsEnMayor.size,
      totalDebeGlobal:  tieneMayor ? mayorDelMedio.totalDebe  : 0,
      totalHaberGlobal: tieneMayor ? mayorDelMedio.totalHaber : 0,
      tot1400,
      estados
    }
  };
}

// ============================================================
// PASO 1 — Leer Excel
// ============================================================
console.log('Leyendo archivos Excel desde:', dirArchivos);
const archivo1400  = encontrarArchivo(dirArchivos, /^1400.*\.xlsx$/i);
const archivoMayor = encontrarArchivo(dirArchivos, /libr.*mayor.*\.xlsx$/i);
console.log('1400:', path.basename(archivo1400));
console.log('Mayor:', path.basename(archivoMayor));

const wb1 = XLSX.readFile(archivo1400);
const hojaReporte = wb1.SheetNames.includes('Reporte') ? 'Reporte' : wb1.SheetNames[0];
const data1All = XLSX.utils.sheet_to_json(wb1.Sheets[hojaReporte], { defval: '', range: 12 });
console.log('Total filas 1400:', data1All.length);

// Filtrar: Tipo Cartera=PROPIA + Estado=CONFIRMADO + Entidad=CREDITO MILLON + Canal de Pago=CAJA + suma no cero
const filtradoTotal = data1All.filter(r =>
  r['Tipo Cartera'] === 'PROPIA' &&
  r['Estado'] === 'CONFIRMADO' &&
  r['Entidad'] === 'CREDITO MILLON' &&
  r['Canal de Pago'] === 'CAJA' &&
  sumarCols(r) !== 0
);
console.log('Filas filtradas (PROPIA+CONFIRMADO+CREDITO MILLON+CAJA+no-cero):', filtradoTotal.length);

// Auto-detectar período
let periodo = periodoCLI;
if (!periodo) {
  const freq = {};
  filtradoTotal.forEach(r => { const p = String(r['Periodo'] || ''); freq[p] = (freq[p] || 0) + 1; });
  periodo = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'DESCONOCIDO';
}
console.log('Período:', periodo, periodoCLI ? '(CLI)' : '(auto)');

// Leer Mayor completo
const wb2 = XLSX.readFile(archivoMayor);
const dataMayor = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { defval: '' });
console.log('\nParsando Mayor...');
const mayorPorDescripcion = parsearMayorCompleto(dataMayor);

// ============================================================
// PASO 2 — Conciliar agrupando por CUENTA DEL MAYOR
// (todos los medios del 1400 que apuntan a la misma cuenta
//  se combinan en un solo grupo, evitando falsos SOLO_MAYOR)
// ============================================================
console.log('\nConciliando por cuenta del Mayor...');

// Índice rápido: medio 1400 → cuenta del mayor
const medioACuenta = {};
filtradoTotal.forEach(r => {
  const mp = r['Medio Pago'] || '(sin medio)';
  medioACuenta[mp] = MAPEO_1400_A_MAYOR[mp] || null;
});

// Agrupar filas por CUENTA DEL MAYOR (o por medio si no tiene mayor)
const gruposFilas  = {};   // key → filas[]
const gruposMedios = {};   // key → Set<medio>

filtradoTotal.forEach(r => {
  const mp    = r['Medio Pago'] || '(sin medio)';
  const cuenta = MAPEO_1400_A_MAYOR[mp] || null;
  const key   = cuenta || `__SINMAYOR__${mp}`;
  if (!gruposFilas[key])  gruposFilas[key]  = [];
  if (!gruposMedios[key]) gruposMedios[key] = new Set();
  gruposFilas[key].push(r);
  gruposMedios[key].add(mp);
});

// Agregar cuentas del mayor que existen en el mapeo pero no tienen filas en el 1400
Object.entries(MAPEO_1400_A_MAYOR).forEach(([mp, cuenta]) => {
  if (!cuenta) return;
  const key = cuenta;
  if (!gruposFilas[key]) {
    gruposFilas[key]  = [];
    gruposMedios[key] = new Set([mp]);
  }
});

const resultadosPorGrupo = {};
Object.entries(gruposFilas).forEach(([key, filas]) => {
  const esSinMayor = key.startsWith('__SINMAYOR__');
  const label      = esSinMayor ? key.replace('__SINMAYOR__', '') : key;
  const mayorObj   = esSinMayor ? null : mayorPorDescripcion[key];
  const tieneMayor = !!mayorObj;
  const medios     = [...(gruposMedios[key] || [])];

  resultadosPorGrupo[key] = conciliarMedio(label, medios, filas, mayorObj, tieneMayor, data1All);
  const r = resultadosPorGrupo[key].resumen;
  console.log(`  "${label.padEnd(30)}" medios:[${medios.join(',')}] | 1400:${r.idsUnicos1400} C:${r.estados.conciliado} D:${r.estados.diferencia} SM:${r.estados.sinMayor} SL:${r.estados.soloMayor}`);
});

// ============================================================
// PASO 3 — Escribir data.js
// ============================================================
// Ordenar: primero los grupos con mayor, luego sin mayor, por total descendente
const gruposOrdenados = Object.keys(resultadosPorGrupo).sort((a, b) => {
  const ta = a.startsWith('__SINMAYOR__') ? 1 : 0;
  const tb = b.startsWith('__SINMAYOR__') ? 1 : 0;
  if (ta !== tb) return ta - tb;
  return (resultadosPorGrupo[b].resumen.tot1400?.total || 0) -
         (resultadosPorGrupo[a].resumen.tot1400?.total || 0);
});

// Metadatos para la tab de Mapeo
const mediosen1400 = {};
filtradoTotal.forEach(r => {
  const mp = r['Medio Pago'] || '(sin medio)';
  if (!mediosen1400[mp]) mediosen1400[mp] = 0;
  mediosen1400[mp]++;
});
const metaMedios1400 = Object.entries(mediosen1400)
  .map(([label, registros]) => ({ label, registros }))
  .sort((a, b) => b.registros - a.registros);

const metaCuentasMayor = Object.values(mayorPorDescripcion)
  .map(c => ({ descripcion: c.descripcion, cuenta: c.cuenta, movimientos: c.movimientos }));

const salida = {
  periodo,
  periodoLabel: periodoLabel(periodo),
  generadoEn: new Date().toLocaleString('es-AR'),
  metaMedios1400,
  metaCuentasMayor,
  mediosPago: gruposOrdenados.map(key => {
    const { resumen, filas } = resultadosPorGrupo[key];
    return {
      label:       resumen.label,
      cuentaMayor: resumen.cuentaMayor,
      tieneMayor:  resumen.tieneMayor,
      medios1400:  resumen.medios1400,
      resumen,
      filas
    };
  })
};

const contenidoJS = `window.CONCILIACION_DATA = ${JSON.stringify(salida, null, 0)};`;
// Siempre escribir el archivo del período específico
const destinoPeriodo = path.join(__dirname, 'public', `data-${periodo}.js`);
fs.writeFileSync(destinoPeriodo, contenidoJS, 'utf8');
console.log(`\ndata-${periodo}.js generado:`, destinoPeriodo, '|', Math.round(fs.statSync(destinoPeriodo).size / 1024), 'KB');
// También actualizar data.js (compatibilidad y período activo por defecto)
const destino = path.join(__dirname, 'public', 'data.js');
fs.writeFileSync(destino, contenidoJS, 'utf8');
console.log('data.js actualizado (período activo).');

// ============================================================
// PASO 4 — Persistir en SQL Server
// ============================================================
async function guardarEnSQL() {
  console.log('\nConectando a SQL Server...');
  const pm = await sql.connect(SQL_MASTER);
  await pm.request().query(`IF NOT EXISTS (SELECT name FROM sys.databases WHERE name='DashboardsDB') CREATE DATABASE DashboardsDB;`);
  await pm.close();

  const pool = await sql.connect(SQL_DB);

  // Tabla Periodos
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='DashConciliacionPunitorios_Periodos' AND type='U')
    CREATE TABLE DashConciliacionPunitorios_Periodos (
      Id INT IDENTITY(1,1) PRIMARY KEY, Periodo VARCHAR(6) NOT NULL, MedioPago VARCHAR(100) NOT NULL,
      Descripcion VARCHAR(200) NULL, TieneMayor BIT DEFAULT 0,
      TotalRegistros1400 INT NULL, TotalIdPrestamos1400 INT NULL,
      TotalMovimientosMayor INT NULL, TotalIdPrestamosMayor INT NULL,
      TotalDebeGlobal DECIMAL(18,2) NULL, TotalHaberGlobal DECIMAL(18,2) NULL,
      TotalCol_AA DECIMAL(18,2) NULL, TotalCol_AS DECIMAL(18,2) NULL,
      TotalCol_AT DECIMAL(18,2) NULL, TotalCol_AU DECIMAL(18,2) NULL,
      TotalCol_AV DECIMAL(18,2) NULL, TotalCol_AW DECIMAL(18,2) NULL,
      Conciliados INT NULL, ConDiferencia INT NULL, SinMayor INT NULL, SoloMayor INT NULL,
      FechaProceso DATETIME DEFAULT GETDATE(),
      CONSTRAINT UQ_DashConc_Periodo UNIQUE (Periodo, MedioPago)
    );`);
  // Agregar columna TieneMayor si falta en instalaciones anteriores
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('DashConciliacionPunitorios_Periodos') AND name='TieneMayor')
      ALTER TABLE DashConciliacionPunitorios_Periodos ADD TieneMayor BIT DEFAULT 0;`);

  // Tabla Detalle
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name='DashConciliacionPunitorios_Detalle' AND type='U')
    CREATE TABLE DashConciliacionPunitorios_Detalle (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      PeriodoId INT NOT NULL REFERENCES DashConciliacionPunitorios_Periodos(Id) ON DELETE CASCADE,
      IdPrestamo VARCHAR(20) NOT NULL, Nombre VARCHAR(200) NULL, RegistrosArchivo INT NULL,
      Col_AA_Punitorio DECIMAL(18,2) NULL, Col_AS_CUCGastos DECIMAL(18,2) NULL,
      Col_AT_CUCGastosIVA DECIMAL(18,2) NULL, Col_AU_CUCMSellado DECIMAL(18,2) NULL,
      Col_AV_CargoSegVto DECIMAL(18,2) NULL, Col_AW_CargoSegVtoIVA DECIMAL(18,2) NULL,
      Total1400 DECIMAL(18,2) NULL, MayorDebe DECIMAL(18,2) NULL,
      MayorHaber DECIMAL(18,2) NULL, TotalMayor DECIMAL(18,2) NULL,
      Diferencia DECIMAL(18,2) NULL, Estado VARCHAR(20) NULL, Motivo NVARCHAR(500) NULL,
      FechaActualizacion DATETIME DEFAULT GETDATE()
    );`);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('DashConciliacionPunitorios_Detalle') AND name='Motivo')
      ALTER TABLE DashConciliacionPunitorios_Detalle ADD Motivo NVARCHAR(500) NULL;`);

  // Índices
  for (const [nm, col] of [
    ['IX_DashConc_Det_PeriodoId','PeriodoId'], ['IX_DashConc_Det_IdPrestamo','IdPrestamo'], ['IX_DashConc_Det_Estado','Estado']
  ]) await pool.request().query(
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${nm}') CREATE INDEX ${nm} ON DashConciliacionPunitorios_Detalle(${col});`
  );

  // SPs
  for (const [nm, body] of [
    ['DashConciliacionPunitorios_SP_LimpiarPeriodo',
     `CREATE PROCEDURE DashConciliacionPunitorios_SP_LimpiarPeriodo @Periodo VARCHAR(6), @MedioPago VARCHAR(100)=NULL
      AS BEGIN SET NOCOUNT ON;
        IF @MedioPago IS NULL
          DELETE FROM DashConciliacionPunitorios_Periodos WHERE Periodo=@Periodo;
        ELSE
          DELETE FROM DashConciliacionPunitorios_Periodos WHERE Periodo=@Periodo AND MedioPago=@MedioPago;
      END`],
    ['DashConciliacionPunitorios_SP_GetResumen',
     `CREATE PROCEDURE DashConciliacionPunitorios_SP_GetResumen @Periodo VARCHAR(6)=NULL, @MedioPago VARCHAR(100)=NULL
      AS BEGIN SET NOCOUNT ON;
        SELECT * FROM DashConciliacionPunitorios_Periodos
        WHERE (@Periodo IS NULL OR Periodo=@Periodo) AND (@MedioPago IS NULL OR MedioPago=@MedioPago)
        ORDER BY Periodo DESC, MedioPago;
      END`],
    ['DashConciliacionPunitorios_SP_GetDetalle',
     `CREATE PROCEDURE DashConciliacionPunitorios_SP_GetDetalle @Periodo VARCHAR(6), @MedioPago VARCHAR(100)=NULL, @Estado VARCHAR(20)=NULL
      AS BEGIN SET NOCOUNT ON;
        SELECT d.*, p.MedioPago FROM DashConciliacionPunitorios_Detalle d
        JOIN DashConciliacionPunitorios_Periodos p ON p.Id=d.PeriodoId
        WHERE p.Periodo=@Periodo AND (@MedioPago IS NULL OR p.MedioPago=@MedioPago)
          AND (@Estado IS NULL OR d.Estado=@Estado)
        ORDER BY ABS(d.Diferencia) DESC;
      END`],
  ]) {
    await pool.request().query(`IF OBJECT_ID('${nm}','P') IS NOT NULL DROP PROCEDURE ${nm};`);
    await pool.request().query(body);
  }

  console.log('Schema verificado.');

  // Limpiar período completo antes de reinsertar
  await pool.request().input('Periodo', sql.VarChar(6), periodo)
    .query(`DELETE FROM DashConciliacionPunitorios_Periodos WHERE Periodo=@Periodo`);

  // Insertar un registro por cada grupo (cuenta del mayor)
  let totalFilasSQL = 0;
  for (const key of gruposOrdenados) {
    const { resumen, filas } = resultadosPorGrupo[key];
    const t = resumen.tot1400;
    const e = resumen.estados;

    const resP = await pool.request()
      .input('Periodo',               sql.VarChar(6),    periodo)
      .input('MedioPago',             sql.VarChar(100),  resumen.label)
      .input('Descripcion',           sql.VarChar(200),  `Conciliación ${resumen.label} - Período ${periodo}`)
      .input('TieneMayor',            sql.Bit,           resumen.tieneMayor ? 1 : 0)
      .input('TotalRegistros1400',    sql.Int,           resumen.registros1400)
      .input('TotalIdPrestamos1400',  sql.Int,           resumen.idsUnicos1400)
      .input('TotalMovimientosMayor', sql.Int,           resumen.movimientosMayor)
      .input('TotalIdPrestamosMayor', sql.Int,           resumen.idsMayor)
      .input('TotalDebeGlobal',       sql.Decimal(18,2), resumen.totalDebeGlobal)
      .input('TotalHaberGlobal',      sql.Decimal(18,2), resumen.totalHaberGlobal)
      .input('TotalCol_AA',           sql.Decimal(18,2), t.punitorio)
      .input('TotalCol_AS',           sql.Decimal(18,2), t.cucGastos)
      .input('TotalCol_AT',           sql.Decimal(18,2), t.cucGastosIVA)
      .input('TotalCol_AU',           sql.Decimal(18,2), t.cucSellado)
      .input('TotalCol_AV',           sql.Decimal(18,2), t.cargoSegVto)
      .input('TotalCol_AW',           sql.Decimal(18,2), t.cargoSegVtoIVA)
      .input('Conciliados',           sql.Int,           e.conciliado)
      .input('ConDiferencia',         sql.Int,           e.diferencia)
      .input('SinMayor',              sql.Int,           e.sinMayor)
      .input('SoloMayor',             sql.Int,           e.soloMayor)
      .query(`INSERT INTO DashConciliacionPunitorios_Periodos
        (Periodo,MedioPago,Descripcion,TieneMayor,TotalRegistros1400,TotalIdPrestamos1400,
         TotalMovimientosMayor,TotalIdPrestamosMayor,TotalDebeGlobal,TotalHaberGlobal,
         TotalCol_AA,TotalCol_AS,TotalCol_AT,TotalCol_AU,TotalCol_AV,TotalCol_AW,
         Conciliados,ConDiferencia,SinMayor,SoloMayor)
        OUTPUT INSERTED.Id
        VALUES (@Periodo,@MedioPago,@Descripcion,@TieneMayor,@TotalRegistros1400,@TotalIdPrestamos1400,
          @TotalMovimientosMayor,@TotalIdPrestamosMayor,@TotalDebeGlobal,@TotalHaberGlobal,
          @TotalCol_AA,@TotalCol_AS,@TotalCol_AT,@TotalCol_AU,@TotalCol_AV,@TotalCol_AW,
          @Conciliados,@ConDiferencia,@SinMayor,@SoloMayor)`);
    const periodoId = resP.recordset[0].Id;

    // Bulk insert detalle
    const COLS = [
      ['PeriodoId', sql.Int], ['IdPrestamo', sql.VarChar(20)], ['Nombre', sql.VarChar(200)],
      ['RegistrosArchivo', sql.Int], ['Col_AA_Punitorio', sql.Decimal(18,2)],
      ['Col_AS_CUCGastos', sql.Decimal(18,2)], ['Col_AT_CUCGastosIVA', sql.Decimal(18,2)],
      ['Col_AU_CUCMSellado', sql.Decimal(18,2)], ['Col_AV_CargoSegVto', sql.Decimal(18,2)],
      ['Col_AW_CargoSegVtoIVA', sql.Decimal(18,2)], ['Total1400', sql.Decimal(18,2)],
      ['MayorDebe', sql.Decimal(18,2)], ['MayorHaber', sql.Decimal(18,2)],
      ['TotalMayor', sql.Decimal(18,2)], ['Diferencia', sql.Decimal(18,2)],
      ['Estado', sql.VarChar(20)], ['Motivo', sql.NVarChar(500)]
    ];
    const LOTE = 500;
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      const tbl = new sql.Table('DashConciliacionPunitorios_Detalle');
      tbl.create = false;
      for (const [col, tipo] of COLS)
        tbl.columns.add(col, tipo, { nullable: col !== 'PeriodoId' && col !== 'IdPrestamo' });
      lote.forEach(f => tbl.rows.add(
        periodoId, f.idPrestamo, f.nombre||null, f.registros||null,
        f.punitorio||null, f.cucGastos||null, f.cucGastosIVA||null,
        f.cucSellado||null, f.cargoSegVto||null, f.cargoSegVtoIVA||null,
        f.total1400||null, f.mayorDebe||null, f.mayorHaber||null,
        f.totalMayor||null, f.diferencia, f.estado, f.motivo||null
      ));
      await pool.request().bulk(tbl);
    }
    totalFilasSQL += filas.length;
    process.stdout.write(`  SQL: ${resumen.label} → ${filas.length} filas\n`);
  }

  await pool.close();
  console.log(`\nSQL: ${totalFilasSQL} filas totales en DashboardsDB.`);
}

guardarEnSQL()
  .then(() => console.log('\nListo. Período', periodo, '—', periodoLabel(periodo)))
  .catch(err => { console.error('\nERROR SQL:', err.message); process.exit(1); });
