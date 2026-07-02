# Stock MercadoLibre — Depósito 198 / 199

Dashboard web para analizar el stock de los depósitos 198 (Tesi) y 199 (Pueblo), orientado a la operación de venta en MercadoLibre. Calcula EBITDA por artículo, rotación de stock e identifica artículos a retirar.

## Stack

- **Runtime:** Node.js 18+
- **Servidor:** Express 4
- **Base de datos:** SQL Server — `db_Cegid` en `10.0.0.115`
- **Frontend:** HTML/JS vanilla + Chart.js (sin build step)
- **Puerto por defecto:** 3001

## Tablas SQL utilizadas

| Tabla | Base | Descripción |
|---|---|---|
| `FOTOSTOCK_Diaria` | `db_Cegid` | Snapshot diario de stock actual. Fuente de stock, precio y costo. |
| `Vta_detalle` | `db_Cegid` | Detalle de todas las ventas (~8.5M filas). Fuente de ventas 30/60/90/365d. |
| `dis_transf_recibidas` | `db_Cegid` | Recepciones de mercadería por depósito. Fuente de fecha de ingreso al stock. |
| `FotoStock` | `db_Cegid` | Histórico diario desde 2021 (162M filas). **No usado** — demasiado grande. |

**Join stock-ventas:** `FOTOSTOCK_Diaria.artprove = Vta_detalle.ARTCEGID`
**Join fecha ingreso:** `dis_transf_recibidas.arprove = FOTOSTOCK_Diaria.artprove` y `destino = Sucursal`
**Depósitos:** `000198` (Tesi) y `000199` (Pueblo)

## Cálculo de EBITDA

Fórmula por unidad vendida en MercadoLibre:

```
EBITDA = (PVP / 1.21) - Costo - (PVP × 12.7%) - $7.900 - $200 - (PVP × 5.5%)
```

| Componente | Valor |
|---|---|
| Precio sin IVA | PVP / 1.21 |
| Comisión MercadoLibre | 12.7% del PVP |
| Costo de envío | $7.900 fijos |
| Material de empaque | $200 fijos |
| Ingresos Brutos | 5.5% del PVP |

EBITDA positivo → artículo rentable en ML. EBITDA negativo → venderlo genera pérdida.

## Agrupación de productos

Los datos se agrupan por **código de artículo + depósito** (sin separar por color ni talle). El stock, ventas y demás métricas se suman para dar una visión consolidada por producto.

## Clasificación de rotación

| Clase | Criterio |
|---|---|
| 🆕 Ingreso reciente | Menos de 60 días en el depósito — sin base suficiente para evaluar |
| ✅ Alta | ≥ 10% del stock vendido en los últimos 30 días |
| ⚠ Media | Vendió algo en 90 días pero menos del 10% mensual |
| ❌ Sin ventas | Sin ventas en 12 meses con más de 60 días en stock |

## Marcas no permitidas

Los depósitos 198 y 199 **no pueden tener artículos de Adidas ni Nike**. Estos ingresan por devoluciones del canal web y deben retirarse. Se excluyen del análisis de EBITDA y rotación, y aparecen automáticamente en la tab de Retiro Recomendado con motivo "🚫 Marca no permitida".

## Funcionalidades del tablero

### Filtro global de depósito (header)
Selector siempre visible que filtra todo el tablero: KPIs, gráficos y tablas de los tres tabs.

### KPIs superiores (siempre visibles)
- **Stock Total** — unidades por depósito
- **Artículos distintos** — códigos únicos en stock
- **Valor Stock (Costo)** — capital inmovilizado
- **Ventas 30 días** — unidades vendidas
- **Sin ventas — último mes** — SKUs con vta30=0 y ≥30 días en stock
- **Sin ventas — últimos 2 meses** — SKUs con vta60=0 y ≥60 días en stock

### Tab 1 — EBITDA
- Resumen: EBITDA promedio ponderado por stock, SKUs positivos/negativos, capital en artículos negativos
- Gráficos: EBITDA promedio por proveedor, distribución positivos/negativos por sección
- Tabla: código, proveedor, artículo, fecha de ingreso, días en stock, PVP, costo, EBITDA/u, stock, EBITDA total
- Filas verdes = EBITDA positivo, rojas = negativo
- Fila de totales: stock total + EBITDA negativo total del filtro activo

### Tab 2 — Rotación
- Gráficos: top 15 artículos por ventas 30d, stock vs ventas 30d por proveedor
- Tabla: código, proveedor, artículo, fecha ingreso, días en stock, stock, vta 30/90/12m, ratio mensual, meses de cobertura
- Filas verdes = alta rotación, rojas = sin ventas, blancas = ingreso reciente
- Fila de totales: stock + ventas 30/90/12m del filtro activo
- Filtros: depósito, nivel de rotación, búsqueda libre

### Tab 3 — Retiro Recomendado
- Criterios de retiro (se aplican en OR):
  1. **Marca no permitida** — Adidas o Nike (siempre, sin importar antigüedad)
  2. **EBITDA negativo + sin ventas 90d** — artículos con ≥90 días en stock
- Resumen: total SKUs a retirar, capital inmovilizado, desglose por criterio
- Tabla: código, proveedor, artículo, fecha ingreso, días en stock, PVP, costo, EBITDA/u, stock, capital costo, pérdida si se vende, motivo
- Fila de totales: stock total + capital total a retirar
- Filtros: depósito, proveedor, motivo, búsqueda libre

## Estructura del proyecto

```
/
├── server.js                    # API Express (/api/stock y /api/ventas)
├── public/
│   └── index.html               # Dashboard SPA (vanilla JS + Chart.js)
├── package.json
├── .env                         # Variables de entorno (no subir al repo)
├── .env.example
├── .gitignore
├── README.md
├── buscar_tablas.js             # Script de exploración de tablas SQL
├── explorar_columnas.js         # Script de exploración de columnas
├── verificar_depo.js            # Script de verificación de registros por depósito
├── explore_db.js                # Scripts de exploración iniciales
├── explore_depositos.js
├── explore_tables.js
└── deploy/
    ├── instalar-servicio.ps1
    ├── desinstalar-servicio.ps1
    └── README-deploy.md
```

## API

| Endpoint | Descripción | Campos clave devueltos |
|---|---|---|
| `GET /api/stock` | Stock dep. 198+199 con ventas 30/60/90/365d y fechas de ingreso | artprove, pvp, costo, stock, stockPesos, vta30u, vta60u, vta90u, vtaTotu, primera_entrada, ultima_recepcion |
| `GET /api/ventas?dias=N` | Detalle de ventas dep. 198 y 199 | FECHA, ARTCEGID, CANTIDAD, PRECIO, costouni, pvp (default: 90d) |

## Configuración (`.env`)

```env
PORT=3001
DB_HOST=10.0.0.115
DB_USER=sa
DB_PASS=MicroS123
DB_NAME=db_Cegid
```

## Desarrollo local

```powershell
npm install
node server.js
# Abre http://localhost:3001
```

## Deploy en otro servidor

Ver [`deploy/README-deploy.md`](deploy/README-deploy.md) para instrucciones de instalación como servicio Windows con pm2.

## Rendimiento

La query principal cruza `FOTOSTOCK_Diaria` con 4 subqueries sobre `Vta_detalle` (8.5M filas) y un join a `dis_transf_recibidas`. Con índices existentes en SQL Server responde en ~5–20 segundos.
