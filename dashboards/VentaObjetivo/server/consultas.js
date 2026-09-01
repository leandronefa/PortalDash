/**
 * consultas.js — mapeo contra el esquema real de SQL Server (servidor 10.0.0.115).
 *
 *   TABLEROS.dbo.GrillaVentasComparativas → venta real + año anterior + objetivo,
 *     ya agregada por sucursal/mes. Sólo tiene meses CERRADOS (el ETL no genera
 *     fila del mes en curso todavía).
 *   dw_vallejo.dbo.f_objetivos (id_vendedor=0) → objetivo de sucursal por mes.
 *     Se usa SOLO para el mes en curso (mientras no está en GrillaVentasComparativas).
 *   dw_vallejo.dbo.l_sucursal → puente id_sucursal (clave de f_objetivos) ↔
 *     cod_sucursal (clave de GrillaVentasComparativas, códigos '02','03',...).
 *
 * Los canales web/MeLi (E1/E2/WE1/WE2/FK1 en GrillaVentasComparativas) no tienen
 * fila propia en l_sucursal con ese código — el mismo mapeo fijo que usa
 * tablero-objetivos-web (CANAL_A_ID) resuelve su id_sucursal real.
 */

const CANAL_A_COD = {
  37: 'E1',   // Mercado Libre Tesi
  38: 'E2',   // Mercado Libre Pueblo
  63: 'WE1',  // WEB Tesi
  64: 'WE2',  // WEB Pueblo
  74: 'FK1'   // WEB Freekick
};
const CANAL_IDS = Object.keys(CANAL_A_COD).join(',');
const CANAL_CASE = Object.entries(CANAL_A_COD)
  .map(([id, cod]) => `WHEN ${id} THEN '${cod}'`).join('\n      ');

const T = {
  grilla: process.env.TBL_GRILLA || 'TABLEROS.dbo.GrillaVentasComparativas',
  objetivos: process.env.TBL_OBJETIVOS || 'dw_vallejo.dbo.f_objetivos',
  puenteId: process.env.TBL_PUENTE_ID || 'dw_vallejo.dbo.l_sucursal'
};

/* ── Universo real de sucursales que vende (excluye INDO/liquidación/adheridos,
   que facturan por otro sistema y nunca tienen fila en esta grilla) ──────── */
const COD_SUCURSAL_CON_VENTAS = `
  SELECT DISTINCT cod_sucursal FROM ${T.grilla};
`;

/* ── Sucursales activas (venta en alguno de los últimos 12 AñoMes cerrados) ──
   Dinámico a propósito: una sucursal cerrada (ej. sin venta desde 2018) no
   debe pedir carga de objetivo, sin necesidad de mantener una lista a mano.
   Sólo se usa para el universo de OBJETIVOS — Comparativas sigue mostrando
   todo el historial igual, esto no le pega. */
const SUCURSALES_ACTIVAS_RECIENTES = `
  WITH ultimos AS (
    SELECT DISTINCT TOP 12 CAST(AñoMes AS INT) AS am FROM ${T.grilla} ORDER BY am DESC
  )
  SELECT DISTINCT cod_sucursal FROM ${T.grilla}
  WHERE CAST(AñoMes AS INT) IN (SELECT am FROM ultimos);
`;

/* ── Grilla real (meses cerrados) ─────────────────────────────────────────── */
const GRILLA = `
  SELECT
      AñoMes,
      Empresa,
      cod_sucursal,
      desc_sucursal2,
      desc_grupo_sucursal AS supervisor,
      id_anio             AS anio,
      id_mes_anio         AS mes,
      nombre_mes          AS nombreMes,
      vta_neta,
      unidades_vta,
      margen_pesos,
      ventas_sin_iva,
      cant_operaciones,
      ticketPromIVA,
      unidadCliente,
      ventas_ano_anterior,
      unidades_vta_anterior,
      margen_pesos_anterior,
      cant_operaciones_anterior,
      ticketPromIVA_anterior,
      unidadCliente_anterior,
      cumplimiento2,
      obj_vtas_sin_iva,
      obj_operaciones,
      obj_unidades_vtas,
      obj_unidades_clientes,
      obj_ticket_promedio
  FROM ${T.grilla}
  WHERE CAST(AñoMes AS INT) >= @anioMesDesde
  ORDER BY cod_sucursal, AñoMes;
`;

/* ── Objetivo del mes en curso, bridgeado a cod_sucursal ──────────────────── */
const OBJETIVO_MES = `
  SELECT
      COALESCE(ls.cod_sucursal, CASE fo.id_sucursal ${CANAL_CASE} END) AS cod_sucursal,
      fo.obj_vtas_sin_iva,
      fo.obj_vtas_con_iva,
      fo.obj_operaciones,
      fo.obj_unidades_vtas,
      fo.obj_unidades_clientes,
      fo.obj_ticket_promedio
  FROM ${T.objetivos} fo
  LEFT JOIN ${T.puenteId} ls
    ON ls.id_sucursal = fo.id_sucursal AND fo.id_sucursal NOT IN (${CANAL_IDS})
  WHERE fo.id_vendedor = 0
    AND fo.id_mes = @anioMes
    AND (ls.cod_sucursal IS NOT NULL OR fo.id_sucursal IN (${CANAL_IDS}));
`;

/* ── Universo de sucursales, con nombre real ──────────────────────────────
   Mismo criterio que usa el dashboard "tablero-objetivos-web" (Objetivos
   Sucursal): nombre real desde db_Cegid.Sucursales cuando hay fila (bocas
   físicas), o desde l_sucursal cuando no la hay. Los 5 canales web/MeLi no
   están en l_sucursal con su código de 2-3 letras — se agregan a mano con el
   mismo id_sucursal que usa CANAL_A_COD arriba. */
const CANAL_VALUES = Object.entries(CANAL_A_COD)
  .map(([id, cod]) => {
    const nombre = { E1: 'MELI Tesi', E2: 'MELI Pueblo', WE1: 'WEB Tesi', WE2: 'WEB Pueblo', FK1: 'WEB Freekick' }[cod];
    const empresa = cod === 'E2' || cod === 'WE2' ? 'PUEBLO' : 'TESI';
    return `('${cod}', ${id}, '${nombre}', '${empresa}')`;
  }).join(',\n    ');

const SUCURSALES = `
  SELECT
      ls.cod_sucursal                                                             AS cod_sucursal,
      ls.id_sucursal                                                              AS id_sucursal,
      COALESCE(cg.nomSucursal, ls.desc_sucursal2) COLLATE DATABASE_DEFAULT        AS nombre,
      em.desc_empresa                              COLLATE DATABASE_DEFAULT        AS empresa
  FROM ${T.puenteId} ls
  LEFT JOIN dw_vallejo.dbo.l_empresa em ON em.id_empresa = ls.id_empresa
  LEFT JOIN db_Cegid.dbo.Sucursales cg
    ON  ls.cod_sucursal NOT LIKE '%[^0-9]%'
    AND cg.Sucursal     NOT LIKE '%[^0-9]%'
    AND CASE WHEN ls.cod_sucursal NOT LIKE '%[^0-9]%' THEN CAST(ls.cod_sucursal AS INT) END
      = CASE WHEN cg.Sucursal     NOT LIKE '%[^0-9]%' THEN CAST(cg.Sucursal     AS INT) END
  WHERE ls.es_sucursal = 'S'
    AND em.desc_empresa IN ('PUEBLO','TESI')

  UNION ALL

  SELECT cod_sucursal, id_sucursal, nombre, empresa
  FROM (VALUES
    ${CANAL_VALUES}
  ) AS canal(cod_sucursal, id_sucursal, nombre, empresa)

  ORDER BY empresa, nombre;
`;

/* ── Objetivos ya cargados del mes que viene (por si alguien los cargó
   directo por SQL, sin pasar por esta pantalla) ──────────────────────────── */
const OBJETIVOS_DEL_MES = `
  SELECT id_sucursal, obj_unidades_clientes, obj_ticket_promedio, obj_operaciones,
         obj_unidades_vtas, obj_vtas_con_iva, obj_vtas_sin_iva
  FROM ${T.objetivos}
  WHERE id_vendedor = 0 AND id_mes = @mes;
`;

/* Lista de meses con objetivo cargado — para poblar el selector de Totales
   (30/08/2026: Totales siempre muestra objetivo, nunca venta real, así que
   ya no depende de qué meses cerró GrillaVentasComparativas). */
const MESES_CON_OBJETIVO = `
  SELECT DISTINCT id_mes
  FROM ${T.objetivos}
  WHERE id_vendedor = 0
  ORDER BY id_mes DESC;
`;

/* Días Venta y Margen % ya guardados de verdad (GUARDAR OBJETIVOS ya corrió
   para esa sucursal) — sin esto, la pestaña Totales quedaba en blanco para
   Días/Margen apenas se guardaba, porque el borrador local (única fuente que
   leía antes) se borra al guardar. obj_margen_por ya viene con el ajuste
   sumado — se le resta obj_margen_ope_por (el ajuste real usado, desde el
   28/08/2026) para recuperar el Margen % "crudo" que el dashboard edita. */
const DIAS_MARGEN_DEL_MES = `
  SELECT o.id_sucursal,
         d.dias_habiles                          AS dias_venta,
         o.obj_margen_por - o.obj_margen_ope_por  AS margen_pct,
         o.obj_margen_ope_por                     AS ajuste_usado
  FROM dw_vallejo.dbo.f_objetivos o
  LEFT JOIN dw_vallejo.dbo.f_dias_habiles d
    ON d.id_mes = o.id_mes AND d.id_sucursal = o.id_sucursal
  WHERE o.id_vendedor = 0 AND o.id_mes = @mes;
`;

/* Ajuste puntual del mes en curso (30/08/2026) — escritura directa, sin
   borrador ni SP: el mes en curso ya se guardó de verdad con GUARDAR
   OBJETIVOS, esto es corregir un valor puntual después. obj_margen_por va
   con el ajuste ya sumado (mismo criterio que el resto del dashboard). */
const UPDATE_DIAS_MES = `
  UPDATE dw_vallejo.dbo.f_dias_habiles
  SET dias_habiles = @dias
  WHERE id_mes = @mes AND id_sucursal = @idSucursal;
`;
const UPDATE_MARGEN_MES = `
  UPDATE ${T.objetivos}
  SET obj_margen_por = @margenPor,
      obj_margen_ope_por = @ajuste,
      obj_margen_pesos = @margenPesos
  WHERE id_mes = @mes AND id_sucursal = @idSucursal AND id_vendedor = 0;
`;

const INSERT_OBJETIVO = `
  INSERT INTO ${T.objetivos}
    (id_mes, id_sucursal, id_vendedor, obj_unidades_clientes, obj_ticket_promedio,
     obj_operaciones, obj_unidades_vtas, obj_vtas_con_iva, obj_vtas_sin_iva, obj_vtas_pesos)
  VALUES
    (@mes, @idSucursal, 0, @uniXCli, @tktProm, @operaciones, @unidades, @ventaConIva, @ventaSinIva, @ventaSinIva);
`;

const UPDATE_OBJETIVO = `
  UPDATE ${T.objetivos}
  SET obj_unidades_clientes = @uniXCli,
      obj_ticket_promedio   = @tktProm,
      obj_operaciones       = @operaciones,
      obj_unidades_vtas     = @unidades,
      obj_vtas_con_iva      = @ventaConIva,
      obj_vtas_sin_iva      = @ventaSinIva,
      obj_vtas_pesos        = @ventaSinIva
  WHERE id_mes = @mes AND id_sucursal = @idSucursal AND id_vendedor = 0;
`;

const DELETE_OBJETIVO = `
  DELETE FROM ${T.objetivos}
  WHERE id_mes = @mes AND id_sucursal = @idSucursal AND id_vendedor = 0;
`;

/* ── Carga vía TEMP_BI_APP + SP (no escribe f_objetivos directo) ──────────
   db_Cegid.dbo.TEMP_BI_APP es la staging table que ya usa el proceso manual
   real (BI exporta ahí, alguien corre el SP original). Nuestra copia del SP
   (creada aparte, ver sql/crear-sp-dashboard.sql) hace lo mismo que el
   original pero con las líneas finales activadas y parametrizadas por mes. */
const DELETE_TEMP_BI_APP_FILA = `
  DELETE FROM db_Cegid.dbo.TEMP_BI_APP
  WHERE anomes = @mes AND SUCURSAL = @cod;
`;

const INSERT_TEMP_BI_APP_FILA = `
  INSERT INTO db_Cegid.dbo.TEMP_BI_APP
    (anomes, SUCURSAL, [Obj sin IVA], [Obj con IVA], DIAS, [Diario sin IVA], [Diario con IVA],
     Margen, Unidades, Operaciones, UnidadesOperacion, [Mg $])
  VALUES
    (@mes, @cod, @objSinIva, @objConIva, @dias, @diarioSinIva, @diarioConIva,
     @margen, @unidades, @operaciones, @uniXOper, @mgPesos);
`;

/* @ajustes es un TVP (tipo db_Cegid.dbo.VentaObjetivo_AjusteMargenType) — el
   ajuste de margen real por sucursal (28/08/2026, ver crear-sp-dashboard.sql).
   Este EXEC tiene que correr con la conexión ya posicionada en db_Cegid
   (getPoolCegid en server.js), si no SQL Server no resuelve el tipo del TVP. */
const EXEC_SP_DASHBOARD = `
  EXEC dbo.SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI_DASHBOARD @anomes = @mes, @ajustes = @ajustes;
`;

/* ── Supervisor por sucursal, para la pestaña "Por Empresa" ────────────────
   Mismo filtro y misma tabla que usa tablero-objetivos-web (QENCARGADOS del
   .qvw original): NombreApellido con más de 2 filas, sin "Administrador".
   Esa tabla usa DOS formatos de "Sucursal": el código numérico de las bocas
   físicas (bridgeado a cod_sucursal vía l_sucursal, igual que en SUCURSALES)
   y una sigla de canal (ML1/ML2/WEB/WEB2/FK) que NO coincide con la nuestra
   (E1/E2/WE1/WE2/FK1) — se traduce a mano. */
const SUPERVISORES = `
  WITH raw AS (
    SELECT NombreApellido AS Encargado, Sucursal AS Codsuc
    FROM TABLEROS.dbo.EncargadosSucursalObjetivos
    WHERE NombreApellido IN (
      SELECT X.NombreApellido FROM TABLEROS.dbo.EncargadosSucursalObjetivos X
      GROUP BY X.NombreApellido HAVING COUNT(*) > 2
    )
    AND NombreApellido <> 'Administrador'
  ),
  fisicas AS (
    SELECT ls.cod_sucursal, r.Encargado
    FROM raw r
    JOIN ${T.puenteId} ls
      ON  r.Codsuc NOT LIKE '%[^0-9]%'
      AND ls.cod_sucursal NOT LIKE '%[^0-9]%'
      AND CASE WHEN r.Codsuc NOT LIKE '%[^0-9]%' THEN CAST(r.Codsuc AS INT) END
        = CASE WHEN ls.cod_sucursal NOT LIKE '%[^0-9]%' THEN CAST(ls.cod_sucursal AS INT) END
  ),
  canales AS (
    SELECT
      CASE Codsuc WHEN 'ML1' THEN 'E1' WHEN 'ML2' THEN 'E2' WHEN 'WEB' THEN 'WE1' WHEN 'WEB2' THEN 'WE2' WHEN 'FK' THEN 'FK1' END AS cod_sucursal,
      Encargado
    FROM raw
    WHERE Codsuc IN ('ML1','ML2','WEB','WEB2','FK')
  ),
  todos AS (
    SELECT * FROM fisicas
    UNION ALL
    SELECT * FROM canales
  )
  SELECT
    cod_sucursal,
    STUFF((
      SELECT ' / ' + t2.Encargado
      FROM todos t2
      WHERE t2.cod_sucursal = t1.cod_sucursal
      ORDER BY t2.Encargado
      FOR XML PATH('')
    ), 1, 3, '') AS supervisor
  FROM todos t1
  WHERE cod_sucursal IS NOT NULL
  GROUP BY cod_sucursal;
`;

/* Sucursales de UN encargado puntual (28/08/2026) — para el modo
   "supervisor" que sólo ve sus propias sucursales. Mismo bridge físicas +
   canales que SUPERVISORES, pero filtrado por @nombre en vez de agrupar
   todos los encargados de >2 sucursales. */
const SUCURSALES_DE_ENCARGADO = `
  WITH raw AS (
    SELECT NombreApellido AS Encargado, Sucursal AS Codsuc
    FROM TABLEROS.dbo.EncargadosSucursalObjetivos
    WHERE NombreApellido = @nombre
  ),
  fisicas AS (
    SELECT ls.cod_sucursal
    FROM raw r
    JOIN ${T.puenteId} ls
      ON  r.Codsuc NOT LIKE '%[^0-9]%'
      AND ls.cod_sucursal NOT LIKE '%[^0-9]%'
      AND CASE WHEN r.Codsuc NOT LIKE '%[^0-9]%' THEN CAST(r.Codsuc AS INT) END
        = CASE WHEN ls.cod_sucursal NOT LIKE '%[^0-9]%' THEN CAST(ls.cod_sucursal AS INT) END
  ),
  canales AS (
    SELECT
      CASE Codsuc WHEN 'ML1' THEN 'E1' WHEN 'ML2' THEN 'E2' WHEN 'WEB' THEN 'WE1' WHEN 'WEB2' THEN 'WE2' WHEN 'FK' THEN 'FK1' END AS cod_sucursal
    FROM raw
    WHERE Codsuc IN ('ML1','ML2','WEB','WEB2','FK')
  )
  SELECT cod_sucursal FROM fisicas WHERE cod_sucursal IS NOT NULL
  UNION
  SELECT cod_sucursal FROM canales WHERE cod_sucursal IS NOT NULL;
`;

module.exports = {
  T, GRILLA, OBJETIVO_MES, CANAL_A_COD,
  SUCURSALES, COD_SUCURSAL_CON_VENTAS, SUCURSALES_ACTIVAS_RECIENTES,
  OBJETIVOS_DEL_MES, DIAS_MARGEN_DEL_MES, MESES_CON_OBJETIVO, INSERT_OBJETIVO, UPDATE_OBJETIVO, DELETE_OBJETIVO,
  UPDATE_DIAS_MES, UPDATE_MARGEN_MES,
  SUPERVISORES, SUCURSALES_DE_ENCARGADO, DELETE_TEMP_BI_APP_FILA, INSERT_TEMP_BI_APP_FILA, EXEC_SP_DASHBOARD
};
