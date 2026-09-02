/* PortalDash — registro de consumo de la ApiKey compartida (OpenRouter por
   ahora, potencialmente Anthropic directo el día de mañana) en la tabla
   central db_Cegid.dbo.PortalDash_ConsumoApiKey (10.0.0.115).
   Ver C:\apps\dashboards\_compartido\CLAUDE.md para el convenio de uso —
   este archivo se COPIA a cada dashboard que llame a la ApiKey, no se
   importa cross-carpeta (cada dashboard es un servicio independiente).

   Uso típico (dentro de un endpoint que ya llamó a la API):
     const { registrarConsumoApiKey } = require('./registrar-consumo-apikey');
     registrarConsumoApiKey({
       pool: await getPoolTableros(),  // cualquier pool YA conectado a 10.0.0.115
       aplicacion: 'VentaObjetivo',
       usuario: usuarioDe(req),
       modelo: OPENROUTER_MODEL,
       tokensEntrada: data.usage?.prompt_tokens || 0,
       tokensSalida: data.usage?.completion_tokens || 0,
     }); // fire-and-forget: no lleva await, un fallo acá nunca debe romper el chat

   La tabla se referencia SIEMPRE calificada (db_Cegid.dbo....), así que
   sirve un pool conectado a CUALQUIER base de 10.0.0.115 (TABLEROS,
   dw_vallejo, db_Cegid) — no hace falta el pool especial que sí necesita
   EXEC_SP_DASHBOARD para el tipo TVP. */

const sql = require('mssql');

/* USD por 1.000.000 de tokens. Valores de referencia de la API de Anthropic
   — VERIFICAR contra console.anthropic.com/settings/billing si se necesita
   precisión real, esto es una estimación para tener orden de magnitud del
   gasto, no una factura. Modelo no listado → CostoEstimadoUSD queda NULL
   (mejor no inventar un número) en vez de asumir un precio. Se dejan
   también las claves con prefijo "anthropic/" por si algún dashboard sigue
   pegando vía OpenRouter en vez de directo. */
const PRECIOS_USD_POR_1M = {
  'claude-opus-5': { entrada: 15, salida: 75 }, // NO VERIFICADO — chequear precio real, es varias veces Sonnet
  'claude-sonnet-5': { entrada: 3, salida: 15 },
  'claude-haiku-4-5-20251001': { entrada: 0.8, salida: 4 },
  'anthropic/claude-sonnet-4.5': { entrada: 3, salida: 15 },
  'anthropic/claude-sonnet-5': { entrada: 3, salida: 15 },
  'anthropic/claude-haiku-4.5': { entrada: 0.8, salida: 4 },
};

function costoEstimado(modelo, tokensEntrada, tokensSalida) {
  const precio = PRECIOS_USD_POR_1M[modelo];
  if (!precio) return null;
  return (tokensEntrada / 1e6) * precio.entrada + (tokensSalida / 1e6) * precio.salida;
}

/* Nunca tira: un problema acá (tabla no creada todavía, red, etc.) no debe
   romper la respuesta del chat al usuario — sólo se loguea. */
async function registrarConsumoApiKey({ pool, aplicacion, usuario, proveedor = 'OpenRouter', modelo, tokensEntrada = 0, tokensSalida = 0, detalle = null, log = console.log }) {
  try {
    const req = pool.request();
    req.input('aplicacion', sql.NVarChar(50), aplicacion);
    req.input('usuario', sql.NVarChar(100), usuario || null);
    req.input('proveedor', sql.NVarChar(30), proveedor);
    req.input('modelo', sql.NVarChar(100), modelo);
    req.input('tokensEntrada', sql.Int, tokensEntrada);
    req.input('tokensSalida', sql.Int, tokensSalida);
    req.input('tokensTotal', sql.Int, tokensEntrada + tokensSalida);
    req.input('costo', sql.Decimal(10, 6), costoEstimado(modelo, tokensEntrada, tokensSalida));
    req.input('detalle', sql.NVarChar(200), detalle);
    await req.query(`
      INSERT INTO db_Cegid.dbo.PortalDash_ConsumoApiKey
        (Aplicacion, Usuario, Proveedor, Modelo, TokensEntrada, TokensSalida, TokensTotal, CostoEstimadoUSD, Detalle)
      VALUES
        (@aplicacion, @usuario, @proveedor, @modelo, @tokensEntrada, @tokensSalida, @tokensTotal, @costo, @detalle)
    `);
  } catch (e) {
    log(`[WARN] registrarConsumoApiKey: no se pudo registrar (${aplicacion}): ${e.message}`);
  }
}

module.exports = { registrarConsumoApiKey, costoEstimado, PRECIOS_USD_POR_1M };
