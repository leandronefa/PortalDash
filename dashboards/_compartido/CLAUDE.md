# CLAUDE.md — `_compartido` (código de referencia, no un paquete)

> Cada dashboard en `C:\apps\dashboards` es un servicio Node independiente, sin
> `node_modules` ni código compartido entre carpetas (ver `dashboards\CLAUDE.md`).
> Esta carpeta **no se `require`ea cross-carpeta** — es el origen de archivos que
> se **copian** a cada dashboard que los necesita, para no romper esa independencia.

## Qué hay acá

- **`registrar-consumo-apikey.js`**: registra en `db_Cegid.dbo.PortalDash_ConsumoApiKey`
  (10.0.0.115) el consumo de tokens/costo estimado de cada llamada a la ApiKey
  compartida (OpenRouter por ahora — una sola key para todos los tableros y
  aplicativos del monorepo, ver `VentaObjetivo/CLAUDE.md` → "Chat flotante"). Tabla de
  precios USD/1M tokens hardcodeada arriba del archivo (`PRECIOS_USD_POR_1M`) —
  aproximada, ajustar a mano si cambian tarifas o se agregan modelos nuevos.
- **`sql/crear-tabla-consumo-apikey.sql`**: crea la tabla de arriba (`IF NOT EXISTS`,
  corre seguro más de una vez). Ejecutar UNA vez contra `db_Cegid` en 10.0.0.115.
- **`sesion-chat.js`**: guarda/lee/borra en `db_Cegid.dbo.PortalDash_ChatSesion`
  el historial de conversación de cada usuario, por `(Aplicacion, Usuario)` — así
  la sesión de chat sobrevive un F5 del navegador Y un reinicio del servicio (no
  vive en memoria ni en el cliente). Tope `HISTORIAL_MAX_MENSAJES` (16, ajustable
  arriba del archivo) para no dejar crecer la fila ni el prompt sin límite.
- **`sql/crear-tabla-sesion-chat.sql`**: crea la tabla de arriba (`IF NOT EXISTS`).
  Ejecutar UNA vez contra `db_Cegid` en 10.0.0.115.

## Convenio para un dashboard nuevo que llame a la ApiKey

1. Copiar `registrar-consumo-apikey.js` a `server/` (o la carpeta de entrada) del
   dashboard.
2. Después de cada respuesta de la API (éxito, no en el catch de error), llamar
   `registrarConsumoApiKey({ pool, aplicacion: '<NombreDelDashboard>', usuario, modelo, tokensEntrada, tokensSalida })`
   **sin `await`** (fire-and-forget) — nunca debe demorar ni romper la respuesta al
   usuario. `pool` puede ser cualquier pool ya conectado a 10.0.0.115 (no hace falta
   uno especial a `db_Cegid`, la tabla se referencia calificada).
3. `aplicacion` es el nombre corto del dashboard (el mismo que usa la columna
   "Carpeta" en `dashboards\CLAUDE.md`), consistente entre todos para poder agrupar
   `GROUP BY Aplicacion` después.
4. Si el dashboard usa un modelo nuevo, agregarlo a `PRECIOS_USD_POR_1M` en la
   copia local (no hay forma automática de propagarlo a las demás copias — es
   código duplicado a propósito, no un paquete compartido).
5. Si además querés sesión persistida por usuario, copiar también `sesion-chat.js`
   y en el endpoint de chat: cargar con `cargarHistorialChat` ANTES de armar los
   `messages` de la API, y guardar con `guardarHistorialChat` (fire-and-forget)
   después de responder — guardando el mensaje "limpio" del usuario, no el que
   incluye datos/contexto del turno (si no, se repite contexto viejo en cada
   request siguiente).

## Consultar el consumo acumulado

```sql
USE db_Cegid;
SELECT Aplicacion, COUNT(*) AS Llamadas, SUM(TokensTotal) AS Tokens,
       SUM(CostoEstimadoUSD) AS CostoEstimadoUSD
FROM dbo.PortalDash_ConsumoApiKey
GROUP BY Aplicacion
ORDER BY CostoEstimadoUSD DESC;
```

## Gotchas

- Es **estimado**: los precios de `PRECIOS_USD_POR_1M` son de referencia, no la
  factura real del proveedor — sirve para orden de magnitud y para comparar
  consumo relativo entre tableros, no para conciliar contra una factura.
- Un modelo sin precio cargado guarda `CostoEstimadoUSD = NULL` (nunca inventa un
  número) — se ve igual en la suma de tokens, sólo falta el costo en USD.
- Un fallo al registrar (tabla no creada, red, etc.) sólo loguea un `[WARN]` —
  nunca debe tirar abajo la respuesta del chat al usuario.
