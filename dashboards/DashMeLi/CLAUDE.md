# CLAUDE.md — DashMeLi (Dashboard Mercado Libre)

## Qué es

Dashboard de stock de los depósitos **198 (Tesi)** y **199 (Pueblo)** cruzado con publicaciones de **MercadoLibre**. Calcula EBITDA por artículo, rotación de stock y retiro recomendado (incluye marcas no permitidas: Adidas/Nike). Node.js + Express + `mssql` contra `db_Cegid` en `10.0.0.115`; frontend vanilla JS + Chart.js servido desde `public/` (sin build step).

## Servicio y acceso

- Servicio de Windows: **`dashmeli.exe`** (node-windows), puerto **3010**, entrada `server.js`.
- Acceso de usuarios: **SOLO vía el portal** → `http://10.0.0.118/d/13/` (proxy inverso con sesión y permisos). El puerto 3010 directo queda solo para diagnóstico local.
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\DashMeLi; $env:PORT=3010; node server.js
  ```
- Logs del servicio: `daemon\dashmeli.err.log`.
- Reiniciar: `Restart-Service dashmeli.exe`.

## Tokens ML

La renovación de tokens OAuth de MercadoLibre es **automática para ambas cuentas** (refresh tokens persistidos; no requiere intervención). Los tokens viven en `ml-config.json` — **NUNCA mostrar, copiar ni commitear su contenido**.

## Estructura

```
server.js          # API Express (/api/stock, /api/ventas) + integración ML
public/index.html  # SPA (vanilla JS + Chart.js)
ml-config.json     # Credenciales/tokens MercadoLibre (SECRETO)
.env               # Variables: PORT, DB_HOST, DB_USER, DB_PASS, DB_NAME (SECRETO)
deploy/            # Scripts de instalación como servicio
daemon/            # Generado por node-windows (logs y wrapper del servicio)
explore_*.js, buscar_tablas.js, verificar_depo.js  # Scripts de exploración SQL, no productivos
```

## Gotchas

- El `PORT` del servicio pisa al del `.env`: en producción corre en 3010 aunque el `.env`/README digan 3001.
- El README menciona pm2: **no se usa**; el servicio real es node-windows (`dashmeli.exe`).
- Query principal cruza `Vta_detalle` (~8.5M filas): tarda ~5–20 s; es normal.
- `FotoStock` (162M filas) NO se usa; la fuente de stock es `FOTOSTOCK_Diaria`.
- No tocar `.env` ni `ml-config.json` sin confirmación explícita.
