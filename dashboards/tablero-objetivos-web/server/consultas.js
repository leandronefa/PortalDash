/**
 * consultas.js — mapeo contra el esquema real de SQL Server (servidor 10.0.0.115).
 *
 * Tres bases, cada una con su parte:
 *
 *   dw_vallejo.dbo.f_vta_cabecera            → QVENTAS   (ventas real, por ticket)
 *   TABLEROS.dbo.EncargadosSucursalObjetivos → QENCARGADOS (ver script del .qvw abajo)
 *   db_Cegid.dbo.Sucursales                  → nombre y provincia reales de cada boca
 *   dw_vallejo.dbo.f_objetivos               → QOBJETIVOS (id_vendedor=0 = objetivo de sucursal)
 *   dw_vallejo.dbo.f_dias_habiles            → QDIAS_HABILES (varía por sucursal)
 *   dw_vallejo.dbo.l_sucursal                → sólo como puente: cod_sucursal ↔ id_sucursal
 *
 * ── Por qué ventas sale de f_vta_cabecera y no de TABLEROS.GRILLAQV ──────────
 * El usuario había señalado GRILLAQV (la carga el SP `CALCULA_GRILLAQV`) como
 * la fuente real, y sirvió para entender el modelo: ahí "Sucursal" es siempre
 * la boca física y "Sucursal_WEB" una sigla de canal (ML1/ML2/WEB/WEB2/FK) que
 * sólo se completa en ventas de e-commerce. Pero validando contra QlikView con
 * casos reales (03/08 y 01/08, sucursal WEB Freekick) aparecieron DOS bugs:
 *
 *   1) GRILLAQV guarda IMPORTE/IVA/COSTOVEN en valor absoluto — el signo de
 *      una devolución sólo vive en CANTIDAD. Se corrigió multiplicando por
 *      SIGN(CANTIDAD), y el caso del 03/08 cerró exacto ($555.794).
 *   2) El 01/08 seguía sin cerrar ($705.342 contra $735.341 reales). La causa
 *      es un bug real del SP de carga: para líneas con CANTIDAD>1 (ticket
 *      154877, 2 unidades del mismo artículo), el cálculo de IMPORTE divide
 *      TAX/TAX2 por CANTIDAD de una forma que no reconstruye el importe total
 *      del ticket. No es arreglable desde acá sin tocar el SP de origen.
 *
 * f_vta_cabecera es la MISMA información pero ya agregada por ticket (no por
 * línea de artículo), sin ese bug: sumar `ventas_sin_iva + iva` por ticket
 * reproduce el `vta_bruta` exacto en ambos casos de prueba. Además ya viene
 * con el signo correcto en ventas_sin_iva/iva/costo (no hace falta SIGN()).
 *
 * Ojo con esto — se probó y NO hay que sumarlo: `Recargo_operacion` (el
 * cargo por financiación) es sólo informativo, ya está adentro de
 * `ventas_sin_iva`. Sumarlo aparte (como se hizo en un intento anterior,
 * pensando que era "recargo financiero" a agregar) rompe el total: en el
 * ticket 127365 del 01/08, Recargo_operacion=11.900 pero
 * ventas_sin_iva+iva=vta_bruta exacto, sin ese recargo sumado.
 *
 * ── QENCARGADOS — script real del .qvw (lo pasó el usuario, es la fuente de verdad) ──
 *
 *   LOAD Encargado, Codsuc;
 *   SQL SELECT NombreApellido AS Encargado, Sucursal AS Codsuc
 *   FROM TABLEROS.DBO.ENCARGADOSSUCURSALOBJETIVOS
 *   WHERE NombreApellido IN (
 *     SELECT X.NombreApellido FROM TABLEROS.DBO.ENCARGADOSSUCURSALOBJETIVOS X
 *     GROUP BY X.NombreApellido HAVING COUNT(*)>2)
 *   AND NombreApellido<>'Administrador';
 *
 * Esa tabla usa DOS formatos de "Sucursal": el código de 6 dígitos de las bocas
 * físicas y una sigla propia para los canales — 'ML1'/'ML2'/'WEB'/'WEB2'/'FK' —
 * que coincide con las mismas siglas de db_Cegid.Sucursales (a diferencia del
 * cod_sucursal de l_sucursal, que usa otra sigla: 'E1'/'E2'/'WE1'/'WE2'/'FK1').
 *
 * Dos supervisores (GastonG y TCANET) cubren exactamente los mismos 5 canales
 * — no es un error, están así en el origen. Como el motor del cliente sólo
 * admite un "encargado" por sucursal, esas 5 bocas quedan con el rótulo
 * combinado "GastonG / TCANET" en vez de aparecer duplicadas en dos filas de
 * Supervisores como haría QlikView con su modelo asociativo.
 */

/* Sigla de canal (db_Cegid.Sucursales y EncargadosSucursalObjetivos) →
   id_sucursal del canal en dw_vallejo (f_objetivos/f_vta_cabecera/l_sucursal).
   Única parte hardcodeada de este archivo — si el negocio agrega un canal
   nuevo, hay que sumarlo acá. */
const CANAL_A_ID = {
  ML1: 37,   // Mercado Libre Tesi
  ML2: 38,   // Mercado Libre Pueblo
  WEB: 63,   // WEB Tesi
  WEB2: 64,  // WEB Pueblo
  FK: 74     // WEB Freekick
};
const CANALES_SQL_CASE = Object.entries(CANAL_A_ID)
  .map(([sigla, id]) => `WHEN '${sigla}' THEN ${id}`).join('\n           ');
const CANALES_LISTA = Object.keys(CANAL_A_ID).map(s => `'${s}'`).join(',');

const T = {
  ventas:      process.env.TBL_VENTAS      || 'dw_vallejo.dbo.f_vta_cabecera',
  objetivos:   process.env.TBL_OBJETIVOS   || 'dw_vallejo.dbo.f_objetivos',
  diasHabiles: process.env.TBL_DIAS_HAB    || 'dw_vallejo.dbo.f_dias_habiles',
  sucursales:  process.env.TBL_SUCURSAL    || 'db_Cegid.dbo.Sucursales',
  puenteId:    process.env.TBL_PUENTE_ID   || 'dw_vallejo.dbo.l_sucursal',
  encargados:  process.env.TBL_ENCARGADOS  || 'TABLEROS.dbo.EncargadosSucursalObjetivos'
};

/* Resuelve el id_sucursal (clave de dw_vallejo) de un código de 6 dígitos de
   EncargadosSucursalObjetivos/db_Cegid.Sucursales, vía el puente cod_sucursal
   ↔ id_sucursal. Los CASE evitan que el CAST reviente con basura no numérica
   — 2008 R2 no tiene TRY_CAST y el WHERE no garantiza filtrar antes del CAST
   del SELECT. */
const RESOLVER_ID_FISICO = (alias) => `(
    SELECT TOP 1 ls.id_sucursal FROM ${T.puenteId} ls
    WHERE ${alias} NOT LIKE '%[^0-9]%'
      AND ls.cod_sucursal NOT LIKE '%[^0-9]%'
      AND CASE WHEN ls.cod_sucursal NOT LIKE '%[^0-9]%' THEN CAST(ls.cod_sucursal AS INT) END
        = CASE WHEN ${alias}        NOT LIKE '%[^0-9]%' THEN CAST(${alias}        AS INT) END
  )`;

/* ── Sucursales, con su provincia y su(s) supervisor(es) ──────────────────*/
const SUCURSALES = `
  WITH ventas_cods AS (
    -- sucursales/canales que alguna vez tuvieron una venta real — sin esto
    -- quedan bocas fantasma (las 14 de INDO y afines, que facturan por otro
    -- sistema y nunca aparecen acá) que el usuario no quiere ver.
    SELECT DISTINCT id_sucursal AS cod FROM ${T.ventas}
  ),
  raw AS (
    SELECT NombreApellido AS Encargado, Sucursal AS Codsuc
    FROM ${T.encargados}
    WHERE NombreApellido IN (
      SELECT X.NombreApellido FROM ${T.encargados} X
      GROUP BY X.NombreApellido HAVING COUNT(*) > 2
    )
    AND NombreApellido <> 'Administrador'
  ),
  raw_id AS (
    SELECT ${RESOLVER_ID_FISICO('r.Codsuc')} AS id_sucursal, r.Encargado
    FROM raw r WHERE r.Codsuc NOT LIKE '%[^0-9]%'
    UNION ALL
    SELECT CASE Codsuc ${CANALES_SQL_CASE} END, Encargado
    FROM raw WHERE Codsuc IN (${CANALES_LISTA})
  ),
  sup AS (
    SELECT r1.id_sucursal,
           STUFF((
             SELECT ' / ' + r2.Encargado
             FROM raw_id r2
             WHERE r2.id_sucursal = r1.id_sucursal
             ORDER BY r2.Encargado
             FOR XML PATH('')
           ), 1, 3, '') AS encargado
    FROM raw_id r1
    WHERE r1.id_sucursal IS NOT NULL
    GROUP BY r1.id_sucursal
  )
  -- bocas físicas: universo desde dw_vallejo.l_sucursal.es_sucursal='S' (el
  -- sucvta de db_Cegid.Sucursales no alcanza: incluye depósitos y tránsito,
  -- ej. "Deposito Tesi S.A.", "WEB Pueblo Dpto"). Nombre/provincia reales de
  -- db_Cegid cuando hay fila; si no (bocas INDO, cod_sucursal 100+, sin fila
  -- en db_Cegid.Sucursales) cae a l_sucursal.
  -- COLLATE DATABASE_DEFAULT: TABLEROS/db_Cegid/dw_vallejo no comparten
  -- collation y el ORDER BY de más abajo no arranca sin unificarla.
  SELECT
      ls.id_sucursal                                                              AS cod,
      COALESCE(cg.nomSucursal, ls.desc_sucursal2)      COLLATE DATABASE_DEFAULT    AS nombre,
      COALESCE(cg.Provincia   COLLATE DATABASE_DEFAULT,
               p.desc_sucursal COLLATE DATABASE_DEFAULT, 'Sin provincia')          AS provincia,
      ISNULL(sup.encargado, 'Sin asignar')             COLLATE DATABASE_DEFAULT    AS encargado,
      em.desc_empresa                                  COLLATE DATABASE_DEFAULT    AS empresa
  FROM dw_vallejo.dbo.l_sucursal ls
  LEFT JOIN dw_vallejo.dbo.l_provincia p ON p.id_provincia = ls.id_provincia
  LEFT JOIN dw_vallejo.dbo.l_empresa em ON em.id_empresa = ls.id_empresa
  LEFT JOIN ${T.sucursales} cg
    ON  ls.cod_sucursal NOT LIKE '%[^0-9]%'
    AND cg.Sucursal     NOT LIKE '%[^0-9]%'
    AND CASE WHEN ls.cod_sucursal NOT LIKE '%[^0-9]%' THEN CAST(ls.cod_sucursal AS INT) END
      = CASE WHEN cg.Sucursal     NOT LIKE '%[^0-9]%' THEN CAST(cg.Sucursal     AS INT) END
  LEFT JOIN sup ON sup.id_sucursal = ls.id_sucursal
  WHERE ls.es_sucursal = 'S'
    AND ls.id_sucursal IN (SELECT cod FROM ventas_cods)
    AND em.desc_empresa IN ('PUEBLO','TESI')  -- l_empresa también tiene INDO; no corresponde acá

  UNION ALL

  -- canales web/MeLi: db_Cegid.Sucursales SÍ tiene fila para estos (con las
  -- mismas siglas que EncargadosSucursalObjetivos: FK/ML1/ML2/WEB/WEB2), con
  -- mejor nombre y provincia que l_sucursal — se usa directo, sin puente.
  -- La empresa sigue saliendo de l_sucursal/l_empresa (db_Cegid.Sucursales
  -- también tiene un campo Empresa de texto, pero el usuario pidió l_empresa).
  SELECT
      CASE cg.Sucursal ${CANALES_SQL_CASE} END                                    AS cod,
      cg.nomSucursal                          COLLATE DATABASE_DEFAULT             AS nombre,
      ISNULL(cg.Provincia, 'Sin provincia')   COLLATE DATABASE_DEFAULT             AS provincia,
      ISNULL(sup.encargado, 'Sin asignar')    COLLATE DATABASE_DEFAULT             AS encargado,
      em2.desc_empresa                        COLLATE DATABASE_DEFAULT             AS empresa
  FROM ${T.sucursales} cg
  LEFT JOIN sup ON sup.id_sucursal = CASE cg.Sucursal ${CANALES_SQL_CASE} END
  LEFT JOIN dw_vallejo.dbo.l_sucursal cls ON cls.id_sucursal = CASE cg.Sucursal ${CANALES_SQL_CASE} END
  LEFT JOIN dw_vallejo.dbo.l_empresa em2 ON em2.id_empresa = cls.id_empresa
  WHERE cg.Sucursal IN (${CANALES_LISTA})
    AND CASE cg.Sucursal ${CANALES_SQL_CASE} END IN (SELECT cod FROM ventas_cods)
    AND em2.desc_empresa IN ('PUEBLO','TESI')

  ORDER BY provincia, nombre;
`;

/* ── Objetivos mensuales por sucursal ──────────────────────────────────────
   id_vendedor=0 es el objetivo a nivel sucursal (no de un vendedor puntual).
   obj_margen_por viene como fracción (0.36 = 36%): se multiplica por 100 acá
   para que el resto del tablero trabaje en puntos porcentuales.

   obj_margen_ope_por NO es el objetivo de Mrg Oper% en sí — es cuánto hay que
   RESTARLE al objetivo de Mrg Total% para llegar al de Mrg Oper%/Mrg Real%
   (confirmado por el usuario con un caso real: Mrg Total 36% − 0,01 (1%) =
   Mrg Oper 35%, no 1%). El valor de esa resta es una regla de negocio fija
   por empresa/canal: 0% Tesi, 1,5% Pueblo, 1% los 5 canales web/MeLi — no
   hace falta tratarlo distinto acá, la resta ya lo resuelve.              */
const OBJETIVOS = `
  SELECT
      o.id_sucursal                    AS cod,
      o.id_mes / 100                   AS anio,
      o.id_mes % 100                   AS mes,
      SUM(o.obj_vtas_sin_iva)          AS OBJ_VTAS_SIN_IVA,
      SUM(o.obj_vtas_con_iva)          AS OBJ_VTAS_CON_IVA,
      SUM(o.obj_unidades_vtas)         AS OBJ_UNIDADES_VTAS,
      SUM(o.obj_operaciones)           AS OBJ_OPERACIONES,
      -- estos son ratios, no montos: promedian, no suman
      AVG(o.obj_unidades_clientes)     AS OBJ_UNIDADES_CLIENTES,
      AVG(o.obj_margen_por) * 100      AS OBJ_MARGEN_TOT,
      AVG(o.obj_margen_por) * 100 - AVG(o.obj_margen_ope_por) * 100 AS OBJ_MARGEN_OPE
  FROM ${T.objetivos} o
  WHERE o.id_vendedor = 0
    AND o.id_mes >= @anioDesde * 100
  GROUP BY o.id_sucursal, o.id_mes;
`;

/* ── Días hábiles por sucursal y mes ────────────────────────────────────────
   Varían fuerte por sucursal (se vio hasta 16 vs 31 días en el mismo mes) —
   por eso viaja con clave `cod|AAAAMM`, igual que OBJETIVOS.               */
const DIAS_HABILES = `
  SELECT
      h.id_sucursal      AS cod,
      h.id_mes / 100     AS anio,
      h.id_mes % 100     AS mes,
      MAX(h.dias_habiles) AS dias
  FROM ${T.diasHabiles} h
  WHERE h.id_mes >= @anioDesde * 100
  GROUP BY h.id_sucursal, h.id_mes;
`;

/* ── Fecha de la última venta ─────────────────────────────────────────────
   Equivale a la variable ULTIMOS del .qvw. Fija el tope de los calendarios. */
const ULTIMOS = `
  SELECT MAX(v.id_dia) AS ultimaVenta FROM ${T.ventas} v;
`;

/* ── Ventas agregadas por sucursal/canal × día ─────────────────────────────
 *
 * f_vta_cabecera ya viene por ticket (no por línea de artículo) y con el
 * signo correcto en cada campo — a diferencia de GRILLAQV, no hace falta
 * SIGN(CANTIDAD) ni COUNT(DISTINCT NroDoc): cada fila es una operación.
 *
 * Ventas = ventas_sin_iva + iva, punto. NO sumar Recargo_operacion (ver nota
 * grande arriba del archivo) — ya está adentro de ventas_sin_iva.
 *
 * Recargo_operacion SÍ se manda como `rec_fin` — pero OJO, es sólo para que
 * el motor del cliente lo reste de la BASE del margen (Mrg Oper% excluye
 * recargos, Mrg Total% no — así lo hacía el .qvw original), nunca para
 * sumarlo a Ventas otra vez (el cliente ya no lo suma, ver tablero.html).
 * Recargo_medio_pago se probó (agosto 2026): siempre es 0, no aporta nada —
 * rec_envio queda en 0 sin más.
 */
const VENTAS_AGREGADO = `
  SELECT
      v.id_sucursal                      AS cod,
      CONVERT(char(10), v.id_dia, 23)    AS f,

      SUM(v.ventas_sin_iva)              AS importe,
      SUM(v.iva)                         AS iva_importe,
      SUM(v.descuento)                   AS descuento,

      0                                  AS rec_envio,
      0                                  AS iva_rec_envio,
      SUM(v.Recargo_operacion)           AS rec_fin,
      0                                  AS iva_rec_fin,
      SUM(v.Recargo_operacion)           AS recfin_var,
      0                                  AS iva_recfin_var,

      SUM(v.costo)                       AS costo,
      0                                  AS iva_costo,

      SUM(v.unidades_vta)                AS cantidad,

      SUM(CASE WHEN v.Cant_operaciones > 0 THEN v.Cant_operaciones ELSE 0 END) AS oper_pos,
      SUM(CASE WHEN v.Cant_operaciones < 0 THEN -v.Cant_operaciones ELSE 0 END) AS oper_neg

  FROM ${T.ventas} v
  WHERE v.id_dia >= @desde
    AND v.id_dia <  DATEADD(day, 1, @hasta)
  GROUP BY v.id_sucursal, CONVERT(char(10), v.id_dia, 23)
  ORDER BY v.id_sucursal, CONVERT(char(10), v.id_dia, 23);
`;

module.exports = { T, CANAL_A_ID, SUCURSALES, OBJETIVOS, DIAS_HABILES, ULTIMOS, VENTAS_AGREGADO };
