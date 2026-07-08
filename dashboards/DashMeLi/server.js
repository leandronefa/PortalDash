require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

const dbConfig = {
  server:   process.env.DB_HOST     || '10.0.0.115',
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASS     || 'MicroS123',
  database: process.env.DB_NAME     || 'db_Cegid',
  options: { encrypt: false, trustServerCertificate: true, connectTimeout: 15000, requestTimeout: 60000 }
};

let pool;
async function getPool() {
  if (!pool) pool = await sql.connect(dbConfig);
  return pool;
}

// Stock depósito 198 y 199 cruzado con ventas
app.get('/api/stock', async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT
        f.artprove,
        f.nomartprove,
        f.nomprov,
        f.nommarca,
        f.nomSec       AS seccion,
        f.nomgenero    AS genero,
        f.nomflia      AS familia,
        f.color,
        f.color_basico,
        f.talle,
        f.Sucursal     AS sucursal,
        f.NomFilial    AS filial,
        f.Tipo         AS tipo,
        f.stock,
        f.costo,
        f.pvp,
        f.stockPesos,
        f.estado,
        f.COMPRADOR    AS comprador,
        ISNULL(v30.unidades, 0)  AS vta30u,
        ISNULL(v30.importe,  0)  AS vta30$,
        ISNULL(v60.unidades, 0)  AS vta60u,
        ISNULL(v60.importe,  0)  AS vta60$,
        ISNULL(v90.unidades, 0)  AS vta90u,
        ISNULL(v90.importe,  0)  AS vta90$,
        ISNULL(vAll.unidades, 0) AS vtaTotu,
        ISNULL(vAll.importe,  0) AS vtaTot$,
        tr.primera_entrada,
        tr.ultima_recepcion
      FROM FOTOSTOCK_Diaria f
      LEFT JOIN (
        SELECT ARTCEGID, COLOR, TALLE,
               SUM(CANTIDAD) AS unidades,
               SUM(CANTIDAD * PRECIO) AS importe
        FROM Vta_detalle
        WHERE FECHA >= DATEADD(day, -30, GETDATE())
        GROUP BY ARTCEGID, COLOR, TALLE
      ) v30 ON v30.ARTCEGID = f.artprove AND v30.COLOR = f.color AND v30.TALLE = f.talle
      LEFT JOIN (
        SELECT ARTCEGID, COLOR, TALLE,
               SUM(CANTIDAD) AS unidades,
               SUM(CANTIDAD * PRECIO) AS importe
        FROM Vta_detalle
        WHERE FECHA >= DATEADD(day, -60, GETDATE())
        GROUP BY ARTCEGID, COLOR, TALLE
      ) v60 ON v60.ARTCEGID = f.artprove AND v60.COLOR = f.color AND v60.TALLE = f.talle
      LEFT JOIN (
        SELECT ARTCEGID, COLOR, TALLE,
               SUM(CANTIDAD) AS unidades,
               SUM(CANTIDAD * PRECIO) AS importe
        FROM Vta_detalle
        WHERE FECHA >= DATEADD(day, -90, GETDATE())
        GROUP BY ARTCEGID, COLOR, TALLE
      ) v90 ON v90.ARTCEGID = f.artprove AND v90.COLOR = f.color AND v90.TALLE = f.talle
      LEFT JOIN (
        SELECT ARTCEGID, COLOR, TALLE,
               SUM(CANTIDAD) AS unidades,
               SUM(CANTIDAD * PRECIO) AS importe
        FROM Vta_detalle
        WHERE FECHA >= DATEADD(month, -12, GETDATE())
        GROUP BY ARTCEGID, COLOR, TALLE
      ) vAll ON vAll.ARTCEGID = f.artprove AND vAll.COLOR = f.color AND vAll.TALLE = f.talle
      LEFT JOIN (
        SELECT arprove, destino,
               MIN(fecha) AS primera_entrada,
               MAX(fecha) AS ultima_recepcion
        FROM dis_transf_recibidas
        WHERE destino IN ('000198', '000199')
        GROUP BY arprove, destino
      ) tr ON tr.arprove = f.artprove AND tr.destino = f.Sucursal
      WHERE f.Sucursal IN ('000198', '000199')
        AND f.stock > 0
      ORDER BY f.nomprov, f.nomartprove, f.color, f.talle
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Detalle de ventas de los depósitos 198 y 199
app.get('/api/ventas', async (req, res) => {
  try {
    const db = await getPool();
    const dias = parseInt(req.query.dias) || 90;
    const result = await db.request()
      .input('dias', sql.Int, dias)
      .query(`
        SELECT
          v.FECHA,
          v.ESTAB,
          v.ARTCEGID,
          v.COLOR,
          v.TALLE,
          v.CANTIDAD,
          v.PRECIO,
          v.costouni,
          v.pvp,
          v.DESCUENTO,
          v.NUMERO,
          f.nomartprove,
          f.nomprov,
          f.nommarca,
          f.nomSec  AS seccion,
          f.nomgenero AS genero
        FROM Vta_detalle v
        LEFT JOIN (
          SELECT DISTINCT artprove, nomartprove, nomprov, nommarca, nomSec, nomgenero, color, talle
          FROM FOTOSTOCK_Diaria
        ) f ON f.artprove = v.ARTCEGID AND f.color = v.COLOR AND f.talle = v.TALLE
        WHERE v.ESTAB IN ('000198', '000199')
          AND v.FECHA >= DATEADD(day, -@dias, GETDATE())
          AND v.CANTIDAD > 0
        ORDER BY v.FECHA DESC, v.ESTAB, v.ARTCEGID
      `);
    res.json(result.recordset);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── MercadoLibre integration ─────────────────────────────
const ML_CONFIG_PATH = path.join(__dirname, 'ml-config.json');

function loadMlConfig() {
  try { return JSON.parse(fs.readFileSync(ML_CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}
function saveMlConfig(cfg) {
  fs.writeFileSync(ML_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── OAuth ML: renovación automática de tokens ────────────
// La app (client_id/client_secret) se guarda en ml-config.json bajo la clave _app.

async function refreshMlToken(account) {
  const cfg = loadMlConfig();
  const appCfg = cfg._app;
  const acc = cfg[account];
  if (!appCfg?.client_id || !appCfg?.client_secret) throw new Error('App ML no configurada (POST /api/ml/app)');
  if (!acc?.refresh_token) throw new Error(`${account}: sin refresh_token — autorizar en /auth/ml/start?account=${account}`);
  const r = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: appCfg.client_id,
      client_secret: appCfg.client_secret,
      refresh_token: acc.refresh_token,
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`refresh ${account}: ${data.message || data.error_description || data.error || `HTTP ${r.status}`}`);
  const cur = loadMlConfig();
  // ML rota el refresh_token en cada renovación
  cur[account] = { ...cur[account], token: data.access_token, refresh_token: data.refresh_token || acc.refresh_token };
  saveMlConfig(cur);
  console.log(`[ML] Token de ${account} renovado (${new Date().toISOString()})`);
  return data.access_token;
}

async function exchangeMlCode(account, code, redirectUri) {
  const cfg = loadMlConfig();
  const appCfg = cfg._app;
  if (!appCfg?.client_id || !appCfg?.client_secret) throw new Error('App ML no configurada (POST /api/ml/app)');
  const r = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: appCfg.client_id,
      client_secret: appCfg.client_secret,
      code,
      redirect_uri: redirectUri,
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || data.error_description || data.error || `HTTP ${r.status}`);
  const u = await fetch('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${data.access_token}` }
  }).then(x => x.json());
  const cur = loadMlConfig();
  cur[account] = { token: data.access_token, refresh_token: data.refresh_token, userId: u.id, nickname: u.nickname };
  saveMlConfig(cur);
  console.log(`[ML] Cuenta ${account} autorizada como ${u.nickname} (refresh_token guardado)`);
  return { userId: u.id, nickname: u.nickname };
}

// Fetch a ML API con reintento automático ante token vencido (401)
async function mlFetch(account, ep, retried) {
  const acc = loadMlConfig()[account];
  if (!acc?.token) throw Object.assign(new Error('Cuenta no configurada'), { status: 400 });
  const r = await fetch(`https://api.mercadolibre.com${ep}`, { headers: { Authorization: `Bearer ${acc.token}` } });
  const d = await r.json();
  if (r.status === 401 && !retried) {
    await refreshMlToken(account);
    return mlFetch(account, ep, true);
  }
  if (!r.ok) throw Object.assign(new Error(d.message || `ML ${r.status}`), { status: r.status });
  return d;
}

// /orders/search acepta limit máximo 51 — pagina y devuelve la misma forma { paging, results }
async function mlOrdersAll(account, query, maxResults = 1000) {
  const results = [];
  let total = 0;
  for (let offset = 0; offset < maxResults; offset += 51) {
    const page = await mlFetch(account, `/orders/search?${query}&limit=51&offset=${offset}`);
    total = page.paging?.total ?? 0;
    if (!page.results?.length) break;
    results.push(...page.results);
    if (results.length >= total) break;
  }
  return { paging: { total }, results };
}

// orders/search solo trae shipping.id; el detalle (logistic_type, fechas, promesa)
// hay que buscarlo en /shipments/{id}. Se cachea en memoria por id de envío,
// pero los envíos aún no cerrados se re-consultan para actualizar su estado.
const shipmentCache = new Map();

function shipmentClosed(s) {
  return s.status === 'delivered' || s.status === 'cancelled' || s.status === 'not_delivered';
}

async function cacheShipments(account, orders) {
  const ids = [...new Set(orders.map(o => o.shipping?.id).filter(Boolean))]
    .filter(id => !shipmentCache.has(id) || !shipmentCache.get(id).closed);
  const CONC = 20;
  for (let i = 0; i < ids.length; i += CONC) {
    await Promise.allSettled(ids.slice(i, i + CONC).map(async id => {
      const s = await mlFetch(account, `/shipments/${id}`);
      shipmentCache.set(id, {
        lt:        s.logistic_type || 'not_specified',
        status:    s.status,
        closed:    shipmentClosed(s),
        shipped:   s.status_history?.date_shipped || null,
        delivered: s.status_history?.date_delivered || null,
        limit:     s.shipping_option?.estimated_delivery_limit?.date || s.shipping_option?.estimated_delivery_final?.date || null,
      });
    }));
  }
}

// Clasifica un envío contra su fecha prometida (fin del día del limit):
// aTiempo | demorado | enCamino | cancelado | sinDato
function classifyShipment(sh) {
  if (!sh) return 'sinDato';
  if (sh.status === 'cancelled') return 'cancelado';
  const eod = sh.limit ? new Date(sh.limit).getTime() + 86399000 : null;
  if (sh.delivered) {
    if (!eod) return 'sinDato';
    return new Date(sh.delivered).getTime() <= eod ? 'aTiempo' : 'demorado';
  }
  if (sh.status === 'not_delivered') return 'demorado';
  if (!eod) return 'sinDato';
  return Date.now() > eod ? 'demorado' : 'enCamino';
}

function mlRedirectUri(req) {
  const appCfg = loadMlConfig()._app;
  return appCfg?.redirect_uri || `${req.protocol}://${req.get('host')}/auth/callback`;
}

app.get('/api/ml/app', (req, res) => {
  const appCfg = loadMlConfig()._app;
  res.json(appCfg ? { configured: true, client_id: appCfg.client_id, redirect_uri: appCfg.redirect_uri || null } : { configured: false });
});

app.post('/api/ml/app', (req, res) => {
  const { client_id, client_secret, redirect_uri } = req.body || {};
  if (!client_id || !client_secret) return res.status(400).json({ error: 'Requerido: client_id y client_secret' });
  const cfg = loadMlConfig();
  cfg._app = { client_id: String(client_id), client_secret: String(client_secret), ...(redirect_uri ? { redirect_uri } : {}) };
  saveMlConfig(cfg);
  res.json({ ok: true });
});

// Paso 1 del OAuth: redirige a la pantalla de autorización de ML.
// Abrir logueado en ML con la cuenta correspondiente: /auth/ml/start?account=sportotal
app.get('/auth/ml/start', (req, res) => {
  const { account } = req.query;
  if (!['sportotal', 'vallejo'].includes(account)) return res.status(400).send('account debe ser sportotal o vallejo');
  const appCfg = loadMlConfig()._app;
  if (!appCfg?.client_id) return res.status(400).send('App ML no configurada (POST /api/ml/app)');
  const url = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${appCfg.client_id}` +
    `&redirect_uri=${encodeURIComponent(mlRedirectUri(req))}&state=${account}`;
  res.redirect(url);
});

// Paso 2: ML vuelve acá con ?code=...&state=cuenta
app.get('/auth/callback', async (req, res) => {
  const { code, state: account } = req.query;
  if (!code || !['sportotal', 'vallejo'].includes(account)) return res.status(400).send('Falta code o state inválido');
  try {
    const info = await exchangeMlCode(account, code, mlRedirectUri(req));
    res.send(`<h2>✅ ${account} autorizada como ${info.nickname}</h2><p>Renovación automática activa. Ya podés cerrar esta pestaña.</p>`);
  } catch (e) {
    res.status(500).send(`<h2>❌ Error autorizando ${account}</h2><pre>${e.message}</pre>`);
  }
});

// Alternativa manual: si el redirect no apunta a este server, pegar el code acá
app.post('/api/ml/exchange', async (req, res) => {
  const { account, code, redirect_uri } = req.body || {};
  if (!account || !code) return res.status(400).json({ error: 'Requerido: account y code' });
  try {
    res.json({ ok: true, ...(await exchangeMlCode(account, code, redirect_uri || mlRedirectUri(req))) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ml/config', (req, res) => {
  const c = loadMlConfig();
  const st = a => c[a] ? { configured: true, userId: c[a].userId, nickname: c[a].nickname, autoRefresh: !!(c[a].refresh_token && c._app) } : { configured: false };
  res.json({ sportotal: st('sportotal'), vallejo: st('vallejo') });
});

app.post('/api/ml/config', async (req, res) => {
  const { account, token } = req.body || {};
  if (!account || !token) return res.status(400).json({ error: 'Requerido: account y token' });
  if (!['sportotal', 'vallejo'].includes(account)) return res.status(400).json({ error: 'account debe ser sportotal o vallejo' });
  try {
    const r = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const user = await r.json();
    if (!r.ok) return res.status(400).json({ error: user.message || `Token inválido (HTTP ${r.status})` });
    const cfg = loadMlConfig();
    cfg[account] = { ...cfg[account], token, userId: user.id, nickname: user.nickname };
    saveMlConfig(cfg);
    res.json({ ok: true, userId: user.id, nickname: user.nickname });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/ml/config/:account', (req, res) => {
  const cfg = loadMlConfig();
  delete cfg[req.params.account];
  saveMlConfig(cfg);
  res.json({ ok: true });
});

app.get('/api/ml/dashboard', async (req, res) => {
  const { account } = req.query;
  const cfg = loadMlConfig();
  const acc = cfg[account];
  if (!acc) return res.status(400).json({ error: 'Cuenta no configurada' });

  const uid = acc.userId;
  const ml  = ep => mlFetch(account, ep);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  const ago7     = new Date(Date.now() - 7  * 86400000).toISOString();
  const ago30    = new Date(Date.now() - 30 * 86400000).toISOString();

  const settle = arr => Promise.allSettled(arr).then(rs => rs.map(r => r.status === 'fulfilled' ? r.value : null));

  const [
    user, questions, questionsReceivedToday,
    itemsTotal, itemsActive, itemsPaused,
    itemsPremiumActive, itemsPremiumExtraActive, itemsClasicaActive,
    itemsPremiumPaused, itemsPremiumExtraPaused, itemsClasicaPaused,
    ordersToday, orders7d, orders30d,
  ] = await settle([
    ml(`/users/${uid}`),
    ml(`/questions/search?seller_id=${uid}&status=UNANSWERED&limit=0`),
    ml(`/questions/search?seller_id=${uid}&date_from=${todayIso}&limit=0`),
    ml(`/users/${uid}/items/search?limit=0`),
    ml(`/users/${uid}/items/search?status=active&limit=0`),
    ml(`/users/${uid}/items/search?status=paused&limit=0`),
    ml(`/users/${uid}/items/search?listing_type_id=gold_pro&status=active&limit=0`),
    ml(`/users/${uid}/items/search?listing_type_id=gold_premium&status=active&limit=0`),
    ml(`/users/${uid}/items/search?listing_type_id=gold_special&status=active&limit=0`),
    ml(`/users/${uid}/items/search?listing_type_id=gold_pro&status=paused&limit=0`),
    ml(`/users/${uid}/items/search?listing_type_id=gold_premium&status=paused&limit=0`),
    ml(`/users/${uid}/items/search?listing_type_id=gold_special&status=paused&limit=0`),
    mlOrdersAll(account, `seller=${uid}&order.date_created.from=${todayIso}`),
    mlOrdersAll(account, `seller=${uid}&order.date_created.from=${ago7}&order.status=paid`),
    mlOrdersAll(account, `seller=${uid}&order.date_created.from=${ago30}&order.status=paid`),
  ]);

  const todayList = ordersToday?.results || [];
  const todayPaid = todayList.filter(o => o.status === 'paid');

  // Build daily aggregation for 30d chart
  const dailySales = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dailySales[d.toISOString().slice(0, 10)] = { ventas: 0, monto: 0 };
  }
  (orders30d?.results || []).forEach(o => {
    const day = o.date_created?.slice(0, 10);
    if (day && dailySales[day]) {
      dailySales[day].ventas++;
      dailySales[day].monto += o.total_amount || 0;
    }
  });

  const rep = user?.seller_reputation;

  res.json({
    user: user ? { id: user.id, nickname: user.nickname, permalink: user.permalink } : null,
    reputation: rep ? {
      level:            rep.level_id,
      transactions:     rep.transactions?.total || 0,
      rating_positive:  (rep.transactions?.ratings?.positive || 0) * 100,
      rating_negative:  (rep.transactions?.ratings?.negative || 0) * 100,
      claims_rate:      (rep.metrics?.claims?.rate || 0) * 100,
      cancellations:    (rep.metrics?.cancellations?.rate || 0) * 100,
      mediations:       (rep.metrics?.mediations?.rate || 0) * 100,
    } : null,
    questions: {
      unanswered:    questions?.total  || 0,
      todayReceived: questionsReceivedToday?.total || 0,
    },
    today: {
      ventas:    todayPaid.length,
      monto:     todayPaid.reduce((s, o) => s + (o.total_amount || 0), 0),
      pendiente: todayList.filter(o => o.status !== 'paid').reduce((s, o) => s + (o.total_amount || 0), 0),
    },
    week7: {
      ventas: orders7d?.paging?.total ?? (orders7d?.results?.length || 0),
      monto:  (orders7d?.results || []).reduce((s, o) => s + (o.total_amount || 0), 0),
    },
    month30: {
      ventas: orders30d?.paging?.total ?? (orders30d?.results?.length || 0),
      monto:  (orders30d?.results || []).reduce((s, o) => s + (o.total_amount || 0), 0),
      daily:  dailySales,
    },
    publicaciones: {
      total:          itemsTotal?.paging?.total  || 0,
      active:         itemsActive?.paging?.total || 0,
      paused:         itemsPaused?.paging?.total || 0,
      premiumActive:  (itemsPremiumActive?.paging?.total  || 0) + (itemsPremiumExtraActive?.paging?.total  || 0),
      premiumPaused:  (itemsPremiumPaused?.paging?.total  || 0) + (itemsPremiumExtraPaused?.paging?.total  || 0),
      clasicaActive:  itemsClasicaActive?.paging?.total  || 0,
      clasicaPaused:  itemsClasicaPaused?.paging?.total  || 0,
    },
  });
});

// Debug: proxy genérico a ML API
app.get('/api/ml/proxy', async (req, res) => {
  const { account, path: mlPath } = req.query;
  const cfg = loadMlConfig();
  const acc = cfg[account];
  if (!acc) return res.status(400).json({ error: 'Cuenta no configurada' });
  const rest = Object.entries(req.query)
    .filter(([k]) => k !== 'account' && k !== 'path')
    .map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  try {
    res.json(await mlFetch(account, `${mlPath}${rest ? '?' + rest : ''}`));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/ml/logistics', async (req, res) => {
  const { account } = req.query;
  const cfg = loadMlConfig();
  const acc = cfg[account];
  if (!acc) return res.status(400).json({ error: 'Cuenta no configurada' });

  const uid = acc.userId;
  const ml  = ep => mlFetch(account, ep);

  const settle = arr => Promise.allSettled(arr).then(rs => rs.map(r => r.status === 'fulfilled' ? r.value : null));

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const ago7  = new Date(Date.now() - 7  * 86400000);
  const ago30 = new Date(Date.now() - 30 * 86400000);

  const [ordersToday, orders7d, orders30d, performance] = await settle([
    mlOrdersAll(account, `seller=${uid}&order.date_created.from=${todayStart.toISOString()}`),
    mlOrdersAll(account, `seller=${uid}&order.date_created.from=${ago7.toISOString()}&order.status=paid`),
    mlOrdersAll(account, `seller=${uid}&order.date_created.from=${ago30.toISOString()}&order.status=paid`),
    ml(`/users/${uid}/seller_performance`),
  ]);

  // Enriquecer con el detalle real de cada envío (cacheado)
  const allOrders = [...(ordersToday?.results || []), ...(orders7d?.results || []), ...(orders30d?.results || [])];
  try { await cacheShipments(account, allOrders); } catch (e) { console.error(`[ML] shipments ${account}: ${e.message}`); }

  function processOrders(data) {
    const results = data?.results || [];
    const byType = {};
    let totalAmount = 0;

    for (const o of results) {
      const lt = shipmentCache.get(o.shipping?.id)?.lt || o.shipping?.logistic_type || 'not_specified';
      const name = lt === 'self_service'  ? 'Flex'
        : lt === 'fulfillment'           ? 'Full'
        : lt === 'not_specified'         ? 'Sin envío'
        : 'Mercado Envíos';

      if (!byType[name]) byType[name] = { count: 0, amount: 0 };
      byType[name].count++;
      byType[name].amount += o.total_amount || 0;
      totalAmount += o.total_amount || 0;
    }

    const total = results.length;
    const tipos = Object.entries(byType)
      .map(([nombre, d]) => ({
        nombre,
        porcentaje: total > 0 ? (d.count / total * 100) : 0,
        cantidad:   d.count,
        dinero:     d.amount,
        ticket:     d.count > 0 ? d.amount / d.count : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad);

    return { total, totalAmount, tipos };
  }

  // Bucket 30d orders by week for historial
  const weekMap = {};
  for (const o of (orders30d?.results || [])) {
    const d  = new Date(o.date_created);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const ws = new Date(d); ws.setDate(d.getDate() + diff); ws.setHours(0,0,0,0);
    const key = ws.toISOString().slice(0, 10);
    if (!weekMap[key]) weekMap[key] = { paid: 0, cancelled: 0, other: 0 };
    if (o.status === 'paid') weekMap[key].paid++;
    else if (o.status === 'cancelled') weekMap[key].cancelled++;
    else weekMap[key].other++;
  }

  const historial = Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, d]) => ({ week, ...d, total: d.paid + d.cancelled + d.other }));

  // ── Desempeño en envíos (réplica aproximada de Métricas ML) ──
  // ML no expone su métrica de "Exposición" por API; se calcula % de envíos
  // a tiempo contra la fecha prometida, por grupo Flex vs Colecta/ME.
  const weekStart = new Date();
  const wd = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() + (wd === 0 ? -6 : 1 - wd));
  weekStart.setHours(0, 0, 0, 0);

  const shipments30d = (orders30d?.results || [])
    .map(o => ({ sh: shipmentCache.get(o.shipping?.id), created: o.date_created }))
    .filter(x => x.sh);

  function perfStats(items) {
    const c = { aTiempo: 0, demorado: 0, enCamino: 0, cancelado: 0, sinDato: 0 };
    for (const { sh } of items) c[classifyShipment(sh)]++;
    const cerrados = c.aTiempo + c.demorado;
    const pct = cerrados > 0 ? c.aTiempo / cerrados * 100 : null;
    const label = pct === null ? null : pct >= 97 ? 'Excelente' : pct >= 94 ? 'Regular' : 'Muy mala';
    return { ...c, cerrados, pct, label };
  }

  const desempeno = {};
  for (const [key, match] of [
    ['flex',    sh => sh.lt === 'self_service'],
    ['colecta', sh => sh.lt !== 'self_service' && sh.lt !== 'not_specified'],
  ]) {
    const grupo = shipments30d.filter(x => match(x.sh));
    desempeno[key] = {
      mes:    perfStats(grupo),
      semana: perfStats(grupo.filter(x => new Date(x.created) >= weekStart)),
    };
  }

  // ── Historial diario de envíos (últimos 28 días) ──
  const dayMap = {};
  for (let i = 27; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dayMap[d.toISOString().slice(0, 10)] = { aTiempo: 0, demorado: 0, enCamino: 0, cancelado: 0 };
  }
  for (const { sh, created } of shipments30d) {
    const day = (sh.shipped || created)?.slice(0, 10);
    const cls = classifyShipment(sh);
    if (day && dayMap[day] && cls !== 'sinDato') dayMap[day][cls]++;
  }
  const historialEnvios = Object.entries(dayMap).map(([day, d]) => ({ day, ...d }));

  res.json({
    hoy:        processOrders(ordersToday),
    semana:     processOrders(orders7d),
    mes:        processOrders(orders30d),
    performance: performance || null,
    desempeno,
    historial,
    historialEnvios,
  });
});

app.get('/api/ml/premium-items', async (req, res) => {
  const { account } = req.query;
  const cfg = loadMlConfig();
  const acc = cfg[account];
  if (!acc) return res.status(400).json({ error: 'Cuenta no configurada' });

  const uid = acc.userId;
  const ml  = ep => mlFetch(account, ep);

  const allIds = [];
  let offset = 0;
  while (true) {
    const page = await ml(`/users/${uid}/items/search?listing_type_id=gold_pro&status=active&limit=100&offset=${offset}`);
    allIds.push(...(page.results || []));
    if (allIds.length >= (page.paging?.total || 0) || (page.results || []).length === 0) break;
    offset += 100;
  }

  const attrs = 'id,title,price,thumbnail,available_quantity,permalink,sold_quantity';
  const items = [];
  for (let i = 0; i < allIds.length; i += 20) {
    const batch = allIds.slice(i, i + 20);
    const data = await ml(`/items?ids=${batch.join(',')}&attributes=${attrs}`);
    for (const entry of (Array.isArray(data) ? data : [])) {
      if (entry.code === 200 && entry.body) items.push(entry.body);
    }
  }

  items.sort((a, b) => (b.available_quantity || 0) - (a.available_quantity || 0));
  res.json(items);
});

// ── Publicaciones ML por artículo ────────────────────────
// Cruce por código de barras: v_cgd_codigosbarraTodos da los EAN de cada artprove
// del stock, y las variaciones de las publicaciones ML llevan ese EAN en
// seller_custom_field (o GTIN). Requiere bajar el catálogo completo de ambas
// cuentas (~5k ítems c/u), por eso se cachea 30 minutos.
let pubCache = { ts: 0, data: null, building: null };

async function fetchAllItemIds(account, uid) {
  const ids = [];
  let scroll = '';
  for (;;) {
    const q = `/users/${uid}/items/search?search_type=scan&limit=100${scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : ''}`;
    const page = await mlFetch(account, q);
    if (!page.results?.length) break;
    ids.push(...page.results);
    scroll = page.scroll_id;
    if (!scroll) break;
  }
  return ids;
}

async function fetchItemsDetail(account, ids) {
  const out = [];
  const batches = [];
  for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
  const CONC = 10;
  for (let i = 0; i < batches.length; i += CONC) {
    const rs = await Promise.allSettled(batches.slice(i, i + CONC).map(b =>
      mlFetch(account, `/items?ids=${b.join(',')}&attributes=id,status,seller_custom_field,variations,attributes`)));
    for (const r of rs) {
      if (r.status !== 'fulfilled') continue;
      for (const it of r.value) if (it.body?.id) out.push(it.body);
    }
  }
  return out;
}

function itemBarcodes(item) {
  const codes = new Set();
  const collect = obj => {
    if (obj.seller_custom_field) codes.add(String(obj.seller_custom_field).trim());
    for (const a of obj.attributes || []) {
      if ((a.id === 'GTIN' || a.id === 'SELLER_SKU') && a.value_name) codes.add(String(a.value_name).trim());
    }
  };
  collect(item);
  for (const v of item.variations || []) collect(v);
  return codes;
}

async function buildPublicaciones() {
  const db = await getPool();
  const barras = await db.request().query(`
    SELECT DISTINCT v.artprove, v.codbar
    FROM (SELECT DISTINCT artprove FROM FOTOSTOCK_Diaria WHERE Sucursal IN ('000198','000199')) s
    JOIN v_cgd_codigosbarraTodos v ON v.artprove = s.artprove
    WHERE LEN(ISNULL(v.codbar, '')) >= 8`);

  // Indexado también sin ceros a la izquierda (EAN-13 vs UPC-12 etc.)
  const codbarToArt = new Map();
  for (const r of barras.recordset) {
    const c = String(r.codbar).trim();
    codbarToArt.set(c, r.artprove);
    const sinCeros = c.replace(/^0+/, '');
    if (sinCeros && sinCeros !== c) codbarToArt.set(sinCeros, r.artprove);
  }
  const lookupArt = code => codbarToArt.get(code) || codbarToArt.get(code.replace(/^0+/, ''));

  const byArt = {};
  const addPub = (art, mla, status, account) => {
    if (!byArt[art]) byArt[art] = [];
    if (!byArt[art].some(p => p.mla === mla)) byArt[art].push({ mla, status, account });
  };

  const catalog = { sportotal: new Map(), vallejo: new Map() }; // mla → status
  const cfg = loadMlConfig();
  for (const account of ['sportotal', 'vallejo']) {
    if (!cfg[account]?.token) continue;
    const uid = cfg[account].userId;
    const ids = await fetchAllItemIds(account, uid);
    const items = await fetchItemsDetail(account, ids);
    console.log(`[ML] publicaciones ${account}: ${items.length} ítems descargados`);
    for (const item of items) {
      catalog[account].set(item.id, item.status);
      const arts = new Set();
      for (const code of itemBarcodes(item)) {
        const art = lookupArt(code);
        if (art) arts.add(art);
      }
      for (const art of arts) addPub(art, item.id, item.status, account);
    }
  }

  // Complemento: tablas Producteca (Código = artprove + "-COLOR" → MLA).
  // Solo se suman MLAs vivos (presentes en el catálogo recién bajado).
  const artSet = new Set(barras.recordset.map(r => r.artprove));
  for (const [table, account] of [['TBL_STOCK_MELI_SPT', 'sportotal'], ['TBL_STOCK_MELI_VALLEJO', 'vallejo']]) {
    const rows = await db.request().query(`
      SELECT DISTINCT [Código] codigo, [Id Publicación MercadoLibre] mla
      FROM [${table}] WHERE [Id Publicación MercadoLibre] LIKE 'MLA%' AND [Código] IS NOT NULL`);
    for (const { codigo, mla } of rows.recordset) {
      const status = catalog[account].get(mla);
      if (!status) continue;
      const base = codigo.slice(0, codigo.lastIndexOf('-'));
      const art = artSet.has(codigo) ? codigo : artSet.has(base) ? base : null;
      if (art) addPub(art, mla, status, account);
    }
  }
  return byArt;
}

app.get('/api/ml/publicaciones', async (req, res) => {
  if (pubCache.data && Date.now() - pubCache.ts < 30 * 60 * 1000) return res.json(pubCache.data);
  try {
    if (!pubCache.building) {
      pubCache.building = buildPublicaciones()
        .then(data => { pubCache = { ts: Date.now(), data, building: null }; return data; })
        .catch(e => { pubCache.building = null; throw e; });
    }
    res.json(await pubCache.building);
  } catch (e) {
    // Si falló pero hay un cache viejo, mejor eso que nada
    if (pubCache.data) return res.json(pubCache.data);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Renueva los tokens de las cuentas que tengan refresh_token (los access token duran 6 h)
function refreshAllMlTokens() {
  const cfg = loadMlConfig();
  for (const account of ['sportotal', 'vallejo']) {
    if (cfg[account]?.refresh_token && cfg._app) {
      refreshMlToken(account).catch(e => console.error(`[ML] ${e.message}`));
    }
  }
}

// Solo loopback: los usuarios entran por el proxy del portal (puerto 80)
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, async () => {
  console.log(`Dashboard corriendo en http://${HOST}:${PORT}`);
  refreshAllMlTokens();
  setInterval(refreshAllMlTokens, 5 * 60 * 60 * 1000);
  // Precalentar el cruce artículo↔publicación ML (tarda ~1 min la primera vez)
  setTimeout(() => {
    pubCache.building = buildPublicaciones()
      .then(data => { pubCache = { ts: Date.now(), data, building: null }; return data; })
      .catch(e => { pubCache.building = null; console.error(`[ML] warmup publicaciones: ${e.message}`); });
  }, 15000);
  try {
    await getPool();
    console.log(`Conectado a SQL Server ${dbConfig.server}/${dbConfig.database}`);
  } catch (e) {
    console.error('Error de conexión:', e.message);
  }
});
