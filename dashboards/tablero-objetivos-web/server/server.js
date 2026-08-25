/**
 * Tablero Objetivos Sucursal — servidor.
 *
 * Sirve el tablero estático desde ./public y expone dos endpoints:
 *
 *   GET /api/modelo                        sucursales, objetivos, días hábiles
 *   GET /api/ventas?desde=…&hasta=…        QVENTAS agregada por sucursal × día
 *   GET /api/salud                         para el monitoreo
 *
 * Todo lo que llega al navegador son componentes crudos: el IVA y el recargo
 * financiero se aplican en el cliente. Una sola consulta por mes cubre las
 * cuatro combinaciones de conmutadores.
 */

require('dotenv').config();

const express     = require('express');
const compression = require('compression');
const path        = require('path');
const sql         = require('mssql');
const Q           = require('./consultas');

const PORT        = Number(process.env.PORT || 3000);
const HOST        = process.env.HOST || '127.0.0.1';
const ANIO_DESDE  = Number(process.env.ANIO_DESDE || new Date().getFullYear() - 2);
const TTL_CERRADO = Number(process.env.TTL_MES_CERRADO_MIN || 720) * 60_000;  // 12 h
const TTL_ABIERTO = Number(process.env.TTL_MES_ABIERTO_MIN || 5)   * 60_000;  // 5 min

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port:     Number(process.env.DB_PORT || 1433),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt:                Boolean(Number(process.env.DB_ENCRYPT ?? 1)),
    trustServerCertificate: Boolean(Number(process.env.DB_TRUST_CERT ?? 1)),
    enableArithAbort:       true
  },
  pool:           { max: Number(process.env.DB_POOL_MAX || 6), min: 0, idleTimeoutMillis: 30_000 },
  requestTimeout: Number(process.env.DB_TIMEOUT_MS || 120_000),
  connectionTimeout: 20_000
};

// autenticación integrada de Windows: dejá DB_USER vacío y poné DB_DOMAIN
if(!config.user && process.env.DB_DOMAIN){
  config.domain = process.env.DB_DOMAIN;
  config.user     = process.env.DB_WIN_USER;
  config.password = process.env.DB_WIN_PASSWORD;
}

/* ── conexión ─────────────────────────────────────────────────────────── */

let poolPromesa = null;
function pool(){
  if(!poolPromesa){
    poolPromesa = new sql.ConnectionPool(config).connect()
      .then(p=>{
        p.on('error', e=>{ log('error', 'pool', e.message); poolPromesa = null; });
        log('info', 'db', `conectado a ${config.server}/${config.database}`);
        return p;
      })
      .catch(e=>{ poolPromesa = null; throw e; });
  }
  return poolPromesa;
}

const log = (nivel, ambito, msg) =>
  console[nivel === 'error' ? 'error' : 'log'](
    `${new Date().toISOString()} [${nivel}] ${ambito}: ${msg}`);

/* ── caché ────────────────────────────────────────────────────────────────
   Un mes ya cerrado no vuelve a cambiar, así que se guarda mucho más tiempo
   que el mes en curso. `enVuelo` evita que dos pedidos simultáneos del mismo
   mes disparen dos consultas.                                              */

const cacheMes    = new Map();   // AAAAMM → {filas, ts}
const enVueloMes  = new Map();   // AAAAMM → Promise
let   cacheModelo = null;        // {datos, ts}
let   mesAbierto  = null;        // AAAAMM del mes de la última venta

const vigente = (ts, mk) =>
  Date.now() - ts < (mk === mesAbierto ? TTL_ABIERTO : TTL_CERRADO);

/* ── consultas ────────────────────────────────────────────────────────── */

async function traerModelo(){
  const p = await pool();

  const [suc, obj, hab, ult] = await Promise.all([
    p.request().query(Q.SUCURSALES),
    p.request().input('anioDesde', sql.Int, ANIO_DESDE).query(Q.OBJETIVOS),
    p.request().input('anioDesde', sql.Int, ANIO_DESDE).query(Q.DIAS_HABILES),
    p.request().query(Q.ULTIMOS)
  ]);

  const objetivos = {};
  for(const r of obj.recordset){
    objetivos[`${r.cod}|${r.anio}${String(r.mes).padStart(2,'0')}`] = {
      OBJ_VTAS_SIN_IVA:      num(r.OBJ_VTAS_SIN_IVA),
      OBJ_VTAS_CON_IVA:      num(r.OBJ_VTAS_CON_IVA),
      OBJ_UNIDADES_VTAS:     num(r.OBJ_UNIDADES_VTAS),
      OBJ_OPERACIONES:       num(r.OBJ_OPERACIONES),
      OBJ_UNIDADES_CLIENTES: num(r.OBJ_UNIDADES_CLIENTES),
      OBJ_MARGEN_TOT:        num(r.OBJ_MARGEN_TOT),
      OBJ_MARGEN_OPE:        num(r.OBJ_MARGEN_OPE)
    };
  }

  // Los días hábiles varían fuerte por sucursal (se vio 16 a 31 en el mismo
  // mes): clave `cod|AAAAMM`, igual que objetivos — no un valor de red.
  const diasHabiles = {};
  for(const r of hab.recordset) diasHabiles[`${r.cod}|${r.anio}${String(r.mes).padStart(2,'0')}`] = num(r.dias);

  const ultimaVenta = ult.recordset[0]?.ultimaVenta
    ? isoFecha(ult.recordset[0].ultimaVenta) : null;

  if(ultimaVenta){
    mesAbierto = +ultimaVenta.slice(0,4)*100 + +ultimaVenta.slice(5,7);
  }

  return {
    sucursales: suc.recordset.map(r=>({
      cod: r.cod, nombre: r.nombre, provincia: r.provincia, encargado: r.encargado, empresa: r.empresa
    })),
    objetivos,
    diasHabiles,
    ultimos: {
      ultimaVenta,
      ultimoStock: ultimaVenta,
      recarga: new Date().toLocaleString('es-AR', {
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
      })
    }
  };
}

async function traerMes(mk){
  const hit = cacheMes.get(mk);
  if(hit && vigente(hit.ts, mk)) return hit.filas;
  if(enVueloMes.has(mk)) return enVueloMes.get(mk);

  const anio = Math.floor(mk/100), mes = mk%100;
  const desde = new Date(Date.UTC(anio, mes-1, 1));
  const hasta = new Date(Date.UTC(anio, mes,   0));

  const tarea = (async ()=>{
    const t0 = Date.now();
    const p  = await pool();
    const r  = await p.request()
      .input('desde', sql.Date, desde)
      .input('hasta', sql.Date, hasta)
      .query(Q.VENTAS_AGREGADO);

    const filas = r.recordset.map(x=>({
      cod: x.cod, f: x.f,
      importe:     num(x.importe),
      iva_importe: num(x.iva_importe),
      descuento:   num(x.descuento),
      rec_envio:     num(x.rec_envio),
      iva_rec_envio: num(x.iva_rec_envio),
      rec_fin:       num(x.rec_fin),
      iva_rec_fin:   num(x.iva_rec_fin),
      recfin_var:     num(x.recfin_var),
      iva_recfin_var: num(x.iva_recfin_var),
      costo:     num(x.costo),
      iva_costo: num(x.iva_costo),
      cantidad:  num(x.cantidad),
      oper_pos:  num(x.oper_pos),
      oper_neg:  num(x.oper_neg)
    }));

    cacheMes.set(mk, {filas, ts: Date.now()});
    enVueloMes.delete(mk);
    log('info','ventas',`${mk}: ${filas.length} filas en ${Date.now()-t0} ms`);
    return filas;
  })().catch(e=>{ enVueloMes.delete(mk); throw e; });

  enVueloMes.set(mk, tarea);
  return tarea;
}

const num = v => v == null ? 0 : Number(v);
const isoFecha = d => d instanceof Date
  ? `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
  : String(d).slice(0,10);

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function mesesEntre(desde, hasta){
  const out = [];
  let y = +desde.slice(0,4), m = +desde.slice(5,7);
  const fin = +hasta.slice(0,4)*100 + +hasta.slice(5,7);
  while(y*100+m <= fin){
    out.push(y*100+m);
    if(++m > 12){ m = 1; y++; }
    if(out.length > 120) break;      // tope de seguridad: 10 años
  }
  return out;
}

/* ── app ──────────────────────────────────────────────────────────────── */

const app = express();
app.disable('x-powered-by');
app.use(compression());

app.use((_req, res, next)=>{
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/api/salud', async (_req, res)=>{
  try{
    const p = await pool();
    await p.request().query('SELECT 1 AS ok');
    res.json({ok:true, mesesEnCache:[...cacheMes.keys()], mesAbierto});
  }catch(e){
    res.status(503).json({ok:false, error:e.message});
  }
});

app.get('/api/modelo', async (_req, res)=>{
  try{
    if(!cacheModelo || Date.now() - cacheModelo.ts > TTL_ABIERTO){
      cacheModelo = {datos: await traerModelo(), ts: Date.now()};
    }
    res.set('Cache-Control','no-cache').json(cacheModelo.datos);
  }catch(e){
    log('error','modelo',e.message);
    res.status(502).json({error:'No se pudo leer el modelo', detalle:e.message});
  }
});

app.get('/api/ventas', async (req, res)=>{
  const {desde, hasta} = req.query;
  if(!ES_FECHA.test(desde || '') || !ES_FECHA.test(hasta || ''))
    return res.status(400).json({error:'desde y hasta deben venir como AAAA-MM-DD'});
  if(desde > hasta)
    return res.status(400).json({error:'desde no puede ser posterior a hasta'});

  try{
    const meses = mesesEntre(desde, hasta);
    const lotes = await Promise.all(meses.map(traerMes));
    // se devuelve el mes completo: el cliente cachea por mes y filtra el rango
    const filas = lotes.flat();
    res.set('Cache-Control','no-cache').json({meses, filas});
  }catch(e){
    log('error','ventas',e.message);
    res.status(502).json({error:'No se pudieron traer las ventas', detalle:e.message});
  }
});

app.use(express.static(path.join(__dirname,'public'), {
  extensions:['html'],
  setHeaders(res, ruta){
    // el HTML se revalida siempre; los assets con hash pueden cachearse
    if(ruta.endsWith('.html')) res.setHeader('Cache-Control','no-cache');
  }
}));

app.use((_req,res)=> res.status(404).json({error:'No existe'}));

/* ── arranque y apagado ───────────────────────────────────────────────── */

const servidor = app.listen(PORT, HOST, ()=>{
  log('info','http',`escuchando en http://${HOST}:${PORT}`);
  pool().catch(e=> log('error','db',`no conectó al arrancar: ${e.message}`));
});

for(const senal of ['SIGTERM','SIGINT']){
  process.on(senal, ()=>{
    log('info','http',`${senal}: cerrando`);
    servidor.close(async ()=>{
      try{ if(poolPromesa) (await poolPromesa).close(); }catch{}
      process.exit(0);
    });
    setTimeout(()=>process.exit(1), 10_000).unref();
  });
}
