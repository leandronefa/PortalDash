/* PortalDash — sesión de chat persistida en db_Cegid.dbo.PortalDash_ChatSesion
   (10.0.0.115), por (Aplicacion, Usuario). Sobrevive reinicios del servicio
   (a diferencia de guardar el historial en el navegador). Ver
   C:\apps\dashboards\_compartido\CLAUDE.md para el convenio de uso — este
   archivo se COPIA a cada dashboard que lo necesite, no se importa
   cross-carpeta (cada dashboard es un servicio independiente).

   Uso típico (dentro de un endpoint POST /api/chat):
     const { cargarHistorialChat, guardarHistorialChat, borrarHistorialChat } = require('./sesion-chat');
     const historial = await cargarHistorialChat({ pool, aplicacion: 'VentaObjetivo', usuario });
     // ... arma los messages para la API con historial + el mensaje nuevo ...
     await guardarHistorialChat({ pool, aplicacion: 'VentaObjetivo', usuario, historial: [...historial, ...nuevosTurnos] });

   La tabla se referencia SIEMPRE calificada (db_Cegid.dbo....), así que sirve
   un pool conectado a CUALQUIER base de 10.0.0.115. */

const sql = require('mssql');

// Tope de turnos guardados por usuario — suficiente memoria conversacional
// sin que el prompt crezca sin límite ni la fila en SQL se vuelva gigante.
const HISTORIAL_MAX_MENSAJES = 16; // 8 pares pregunta/respuesta

async function cargarHistorialChat({ pool, aplicacion, usuario, log = console.log }) {
  try {
    const req = pool.request();
    req.input('aplicacion', sql.NVarChar(50), aplicacion);
    req.input('usuario', sql.NVarChar(100), usuario);
    const r = await req.query(`
      SELECT HistorialJson FROM db_Cegid.dbo.PortalDash_ChatSesion
      WHERE Aplicacion = @aplicacion AND Usuario = @usuario
    `);
    if (!r.recordset.length) return [];
    const historial = JSON.parse(r.recordset[0].HistorialJson);
    return Array.isArray(historial) ? historial : [];
  } catch (e) {
    log(`[WARN] cargarHistorialChat: no se pudo leer (${aplicacion}/${usuario}): ${e.message}`);
    return []; // ante la duda, arranca una conversación nueva — nunca rompe el chat
  }
}

async function guardarHistorialChat({ pool, aplicacion, usuario, historial, log = console.log }) {
  try {
    const recortado = historial.slice(-HISTORIAL_MAX_MENSAJES);
    const req = pool.request();
    req.input('aplicacion', sql.NVarChar(50), aplicacion);
    req.input('usuario', sql.NVarChar(100), usuario);
    req.input('historial', sql.NVarChar(sql.MAX), JSON.stringify(recortado));
    await req.query(`
      MERGE db_Cegid.dbo.PortalDash_ChatSesion AS destino
      USING (SELECT @aplicacion AS Aplicacion, @usuario AS Usuario) AS origen
        ON destino.Aplicacion = origen.Aplicacion AND destino.Usuario = origen.Usuario
      WHEN MATCHED THEN
        UPDATE SET HistorialJson = @historial, ActualizadoEn = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (Aplicacion, Usuario, HistorialJson, ActualizadoEn)
        VALUES (@aplicacion, @usuario, @historial, SYSDATETIME());
    `);
  } catch (e) {
    log(`[WARN] guardarHistorialChat: no se pudo guardar (${aplicacion}/${usuario}): ${e.message}`);
  }
}

async function borrarHistorialChat({ pool, aplicacion, usuario, log = console.log }) {
  try {
    const req = pool.request();
    req.input('aplicacion', sql.NVarChar(50), aplicacion);
    req.input('usuario', sql.NVarChar(100), usuario);
    await req.query(`
      DELETE FROM db_Cegid.dbo.PortalDash_ChatSesion
      WHERE Aplicacion = @aplicacion AND Usuario = @usuario
    `);
  } catch (e) {
    log(`[WARN] borrarHistorialChat: no se pudo borrar (${aplicacion}/${usuario}): ${e.message}`);
  }
}

module.exports = { cargarHistorialChat, guardarHistorialChat, borrarHistorialChat, HISTORIAL_MAX_MENSAJES };
