# Handoff — Dashboard Stock & MercadoLibre

**Fecha:** 2026-07-02  
**Proyecto:** `C:\Cli` — Dashboard interno para depósitos 198 (Tesi / Sportotal) y 199 (Pueblo / Calzados Vallejo)  
**Estado:** En desarrollo activo. Funcional excepto por tokens ML vencidos.

---

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 18+ |
| Servidor | Express 4 (`server.js`) |
| Base de datos | SQL Server — `db_Cegid` en `10.0.0.115` |
| Frontend | HTML/JS vanilla + Chart.js 4.4.0 (`public/index.html`) |
| Puerto | 3001 |

```powershell
# Arrancar
cd C:\Cli
npm start   # o: node server.js
# Abre: http://localhost:3001
```

---

## Estructura de archivos

```
C:\Cli\
├── server.js              # API Express — 462 líneas
├── public/
│   └── index.html         # SPA — ~2500 líneas, todo en un archivo
├── ml-config.json         # Tokens ML guardados (NO subir a repo)
├── .env                   # Variables de entorno
├── package.json
└── HANDOFF.md             # Este archivo
```

---

## Base de datos

**Servidor:** `10.0.0.115` | **DB:** `db_Cegid` | **Usuario:** `sa`

| Tabla | Descripción |
|---|---|
| `FOTOSTOCK_Diaria` | Snapshot diario de stock actual (fuente principal) |
| `Vta_detalle` | Detalle de ventas (~8.5M filas) |
| `dis_transf_recibidas` | Recepciones por depósito — fecha de ingreso |

**Depósitos:** `000198` (Sportotal/Tesi) y `000199` (Pueblo/Vallejo)  
**Join principal:** `FOTOSTOCK_Diaria.artprove = Vta_detalle.ARTCEGID`

---

## API Endpoints

### SQL / Stock

| Endpoint | Descripción |
|---|---|
| `GET /api/stock` | Stock dep. 198+199 con ventas 30/60/90/365d y fechas de ingreso |
| `GET /api/ventas?dias=N` | Detalle de ventas (default 90d) |

### MercadoLibre

| Endpoint | Descripción |
|---|---|
| `GET /api/ml/config` | Estado de configuración de cuentas (sin tokens) |
| `POST /api/ml/config` | Guardar token — body: `{ account, token }` |
| `DELETE /api/ml/config/:account` | Borrar token |
| `GET /api/ml/dashboard?account=X` | Dashboard ML (ventas, preguntas, reputación, publicaciones) |
| `GET /api/ml/premium-items?account=X` | Lista de publicaciones `gold_pro` activas con detalles |
| `GET /api/ml/logistics?account=X` | Logística — envíos por tipo (Flex/ME), historial semanal |
| `GET /api/ml/proxy?account=X&path=/...&param=val` | Proxy debug a ML API — cualquier endpoint |

**Cuentas ML:**
- `sportotal` → userId `209369664` — Dep. 198
- `vallejo` → userId `257128833` — Dep. 198 + 199

---

## Tabs del dashboard

### Tab 1 — EBITDA
- Fórmula: `(PVP/1.21) - Costo - (PVP×12.7%) - $7.900 - $200 - (PVP×5.5%)`
- Agrupado por artículo + depósito (sin separar color/talle)
- Filas verdes = positivo, rojas = negativo
- Configurable: comisión ML, envío, empaque, PVP mínimo (modal)

### Tab 2 — Rotación
- Clases: Alta (≥10% stock vendido en 30d), Media, Sin ventas, Ingreso reciente (<60d)
- Tabla con vta 30/90/12m, ratio mensual, meses de cobertura

### Tab 3 — Ranking (📊)
- Artículos rankeados por ventas 30d
- **Excluye Adidas y Nike** (marcas no permitidas en dep. 198/199)

### Tab 4 — Retiro Recomendado (⚠)
- Criterio 1: Marca no permitida (Adidas/Nike) — siempre
- Criterio 2: EBITDA negativo + sin ventas 90d + ≥90 días en stock
- Muestra pérdida si se vende, capital inmovilizado

### Tab 5 — MercadoLibre (🛒)
- **Dos paneles lado a lado** — Sportotal (izq.) / Calzados Vallejo (der.)
- Cada panel: ventas hoy, preguntas sin responder, publicaciones Premium vs Clásica, reputación, histórico 30d (chart)
- Debajo del dashboard: **lista de publicaciones Premium activas** (gold_pro) con thumbnail, título, precio, stock, vendidos
- Credenciales se cargan con `POST /api/ml/config` — formulario integrado en el panel

### Tab 6 — Logística (🚚) ← NUEVA, funcional pero sin datos por token vencido
- Dos paneles lado a lado (misma estructura que ML)
- Cada panel: tabs Hoy / 7 días / 30 días
- Envíos por tipo (Flex / Mercado Envíos / Sin envío): %, cantidad, dinero, ticket promedio
- Donut chart por tipo de envío
- Historial semanal 30d: barras apiladas (pagados/otros/cancelados)
- Datos de `o.shipping.logistic_type` de cada orden ML

---

## Configuración MercadoLibre

### Tokens (access tokens)
- Duran **6 horas**. Vencen con error `"invalid access token"`.
- Para cargar un token nuevo: ir a pestaña ML → formulario de credenciales → pegar token → Guardar.
- O via curl/PowerShell:
  ```powershell
  Invoke-RestMethod -Method POST http://localhost:3001/api/ml/config `
    -ContentType "application/json" `
    -Body '{"account":"sportotal","token":"APP_USR-..."}'
  ```
- Se guardan en `ml-config.json` (estructura: `{ sportotal: { token, userId, nickname }, vallejo: {...} }`)

### Mapping de tipos de publicación (Argentina)
| `listing_type_id` | Nombre en ML |
|---|---|
| `gold_pro` | **Premium** ← el que usamos |
| `gold_premium` | También Premium (raro, 0 items en estas cuentas) |
| `gold_special` | **Clásica** |
| `bronze` | Bronce (0 items en estas cuentas) |

**Datos reales Sportotal (verificados vía proxy):**
- `gold_pro` activas: 82, pausadas: 43 → Total Premium: 125 ✅
- `gold_special` activas: 142, pausadas: 4.279
- `gold_premium` y `bronze`: 0

### Renovación automática de tokens (PENDIENTE — prioridad alta)
**No está implementada.** Para implementarla se necesita:

1. Crear una app en [ML Developers](https://developers.mercadolibre.com.ar/) con:
   - Redirect URI: cualquier URL accesible (ver punto deploy)
   - Obtener: `client_id`, `client_secret`
2. Obtener `refresh_token` del flujo OAuth2 (el access token inicial viene junto con él)
3. Implementar en `server.js`:
   ```javascript
   // Guardar en ml-config.json: { token, refresh_token, client_id, client_secret, userId, nickname }
   
   async function refreshMlToken(account) {
     const cfg = loadMlConfig();
     const acc = cfg[account];
     const r = await fetch('https://api.mercadolibre.com/oauth/token', {
       method: 'POST',
       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
       body: new URLSearchParams({
         grant_type: 'refresh_token',
         client_id: acc.client_id,
         client_secret: acc.client_secret,
         refresh_token: acc.refresh_token,
       })
     });
     const data = await r.json();
     cfg[account].token = data.access_token;
     cfg[account].refresh_token = data.refresh_token; // ML rota el refresh_token también
     saveMlConfig(cfg);
     return data.access_token;
   }
   
   // Llamar cada 5.5 horas:
   setInterval(() => {
     refreshMlToken('sportotal').catch(console.error);
     refreshMlToken('vallejo').catch(console.error);
   }, 5.5 * 60 * 60 * 1000);
   ```
4. Agregar manejo de 401: al detectar `"invalid access token"`, hacer refresh y reintentar.
5. Agregar endpoint OAuth callback: `GET /auth/callback?code=...` para el flujo inicial.

### Deploy para redirect URI pública (PENDIENTE)
El dashboard corre en la PC personal del usuario. Para el OAuth necesita URL pública.  
**Opciones discutidas:**
- **Recomendada:** Mover a `10.0.0.115` (servidor SQL Server) + **Cloudflare Tunnel** (gratis, no requiere IP pública)
- Alternativa: ngrok en la PC actual (requiere estar encendida)
- Con el servidor en `10.0.0.115`, el redirect URI sería el tunnel URL de Cloudflare

---

## Marcas no permitidas

Los depósitos 198 y 199 **no pueden tener Adidas ni Nike** (ingresan por devoluciones del canal web).

```javascript
// En index.html — función usada en Tab Retiro y Tab Ranking
function esMarcaNoPermitida(r) {
  const m = (r.nommarca || r.marca || '').toUpperCase();
  return m.includes('ADIDAS') || m.includes('NIKE');
}
```

---

## Cálculo EBITDA

```
EBITDA/u = (PVP / 1.21) - Costo - (PVP × 12.7%) - $7.900 - $200 - (PVP × 5.5%)
```

Configurables vía modal (persisten en `localStorage`):
- Comisión ML: default 12.7%
- Costo envío: default $7.900
- Empaque: default $200
- Ingresos Brutos: default 5.5% (hardcodeado, no en modal actualmente)
- PVP mínimo: filtro visual, no afecta cálculo

---

## Tareas pendientes

### Alta prioridad
1. ~~**Renovación automática de tokens ML**~~ ✅ **RESUELTO (2026-07-02)** — App ML creada (client_id `479257107101624`, guardada en `ml-config.json` bajo `_app`). Ambas cuentas autorizadas vía OAuth con `refresh_token`; el server renueva solo cada 5 h y reintenta ante 401. Flujo de re-autorización si hiciera falta: `/auth/ml/start?account=X` → pegar code en `POST /api/ml/exchange` (el redirect `https://www.valenet.com.ar/ml-callback` no apunta al server, se copia el code de la barra de direcciones).
2. ~~**Deploy a servidor permanente**~~ ✅ **RESUELTO** — corre como servicio `dashmeli.exe` en 10.0.0.118, puerto 3010.

### Media prioridad
3. ~~**Tab Logística — datos reales**~~ ✅ **RESUELTO (2026-07-02)** — Dos bugs corregidos: (a) `/orders/search` acepta `limit` máx 51 (se usaba 200 y ML devolvía error → todo en 0); ahora `mlOrdersAll()` pagina de a 51. (b) `logistic_type` NO viene en la búsqueda de órdenes, solo en `/shipments/{id}`; se enriquece con caché en memoria (`shipmentTypeCache`). Primera carga ~20 s por cuenta, después ~5 s.
4. **Logística — costos de envío** — el campo "Envío a tu cargo" (visible en las imágenes de referencia `envio..png`) no está implementado. Requiere fetchear `GET /shipments/{id}` para cada orden (costoso) o usar la API de billing de ML. Explorar: `GET /users/{uid}/expenses` o `GET /billing/charges/search`.
5. ~~**Logística — desempeño Flex/Colecta**~~ ✅ **RESUELTO (2026-07-02, aproximación)** — Las métricas oficiales de "Exposición" NO están en la API pública (`seller_performance`, `/flex/.../performance`, `/shipments/{id}/delays` → todos 404; `estimated_handling_limit` viene vacío). Se implementó una réplica calculada: % de envíos entregados a tiempo vs `estimated_delivery_limit` (fecha prometida al comprador), por grupo Flex / Colecta-ME, esta semana y 30 días, con etiquetas tipo ML (≥97% Excelente, ≥94% Regular, <94% Muy mala). **Ojo**: incluye demoras del correo (no solo del vendedor), por eso Colecta da más bajo que la métrica oficial. También se reemplazó el historial semanal por el diario de `envio3..png`: barras apiladas Correctos/Demorados/En camino/Cancelados, últimas 4 semanas, con leyenda de totales. El cache de shipments ahora guarda `{lt, status, closed, shipped, delivered, limit}` y re-consulta los envíos no cerrados.

### Baja prioridad
6. **Modo oscuro** — CSS variables ya preparadas (`--bg`, `--surface`, etc.), pero el toggle no hace nada visible actualmente. Verificar función `toggleDark()`.
7. **Paginación** — la tabla de stock completa puede tener miles de filas. Hay un sistema de paginación (`PAGE = 100`) pero revisar que todas las tabs lo usen correctamente.

---

## Imágenes de referencia para Logística

Archivos en `C:\Cli\`:
- `envio..png` — Sección "Envíos": tabla por tipo (Flex/ME), donut chart, totales Hoy/7d/30d
- `envio1..png` — Métricas Sportotal: "Desempeño en envíos" — Exposición actual Regular, prevista Excelente, 100% envíos correctos (Flex)
- `envio2..png` — Métricas Vallejo: "Desempeño en envíos" — Exposición actual Muy mala, prevista Regular, 94% envíos a tiempo
- `envio3..png` — Historial semanal: barras apiladas por semana (correctos/anticipados/incorrectos)

---

## Notas técnicas importantes

### Chart.js
- Se usa `chartInstances[key]` como registro global para destruir charts antes de recrear
- IDs de canvas: `mlPub-${acc}`, `mlHist-${acc}`, `logDonut-${acc}`, `logHist-${acc}`

### Estructura del panel ML / Logística
- Layout: `display:grid; grid-template-columns:1fr 1fr; height:calc(100vh - 160px)`
- Cada panel tiene `overflow-y:auto` → todo scrollea dentro del panel
- Estado guardado en `mlState[acc]` y `logState[acc]` para evitar re-fetch al cambiar tabs

### Lógica de agrupación de stock
- Las filas de `FOTOSTOCK_Diaria` vienen por color+talle
- El frontend agrupa por `artprove + sucursal` sumando stock, ventas y tomando el mayor PVP/costo
- Función: `groupByProduct(rows)` en `index.html`

### Filtro global de depósito
- Selector en el header que filtra KPIs, gráficos y tablas de tabs 1-4
- Valor: `'000198'`, `'000199'`, o `'todos'`

### Variables CSS (dark mode ready)
```css
:root {
  --bg, --surface, --surface2, --border, --border2
  --text1, --text2, --text3, --text4
  --header-bg, --shadow
  --row-green, --row-red, --row-yellow
}
```

---

## Flujo de inicio para retomar

1. `cd C:\Cli && node server.js` — arrancar el servidor
2. Abrir `http://localhost:3001`
3. Ir a pestaña **MercadoLibre** → cargar tokens frescos para Sportotal y Vallejo
4. Verificar que el dashboard ML muestre datos
5. Ir a pestaña **Logística** → debería cargar automáticamente con los tokens frescos
6. Si Logística muestra vacío, verificar en consola del navegador qué devuelve `/api/ml/logistics?account=sportotal`
7. Verificar especialmente que `o.shipping.logistic_type` no sea `null` en las órdenes (algunas cuentas lo tienen)

---

## Historial de decisiones clave

| Decisión | Razón |
|---|---|
| No usar framework frontend (React/Vue) | Sin build step — editar y recargar directamente |
| `ml-config.json` server-side | Tokens nunca expuestos al frontend |
| `Promise.allSettled` para ML API | Si un endpoint falla, el resto del dashboard sigue funcionando |
| `gold_pro` = Premium (no `gold_special`) | Verificado vía `/sites/MLA/listing_types` — error original tenía mapping invertido |
| Excluir Adidas/Nike de Ranking | Solo aparecen en Tab Retiro, que es donde deben estar |
| Split panel 50/50 para ML y Logística | El usuario quiere ver ambas cuentas simultáneamente sin selector |
| Publicaciones agrupadas en `premiumActive = gold_pro + gold_premium` | `gold_premium` devuelve 0 en estas cuentas pero se incluye por si cambia |
