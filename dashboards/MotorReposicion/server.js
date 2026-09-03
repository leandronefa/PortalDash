require('dotenv').config();
const path = require('path');
const express = require('express');
const sql = require('mssql');

const app = express();
const PORT = process.env.PORT || 3050;
const HOST = process.env.HOST || '127.0.0.1';
const USE_MOCK = process.env.USE_MOCK === 'true';
const PEDIDOS_ANTIGUEDAD_MESES = Number(process.env.PEDIDOS_ANTIGUEDAD_MESES) || 6;
// "Vigencia" de una transferencia en transito (dis_transf_emitidas.cantpend) -- 2026-09-05, a
// pedido explicito, tras confirmar con datos reales que de 2.670.648 filas con cantpend>0 desde
// 2021, solo 7.469 caian dentro de los ultimos 30 dias (el resto es historico sin cerrar en el
// sistema, no una transferencia realmente en camino).
const TRANSITO_VIGENCIA_DIAS = Number(process.env.TRANSITO_VIGENCIA_DIAS) || 30;

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  requestTimeout: 120000,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let poolPromise;
if (!USE_MOCK) {
  poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then((pool) => {
      console.log('Pool de conexion a SQL Server listo.');
      return pool;
    })
    .catch((err) => {
      console.error('Error al conectar el pool a SQL Server:', err);
      process.exit(1);
    });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tablero_motor_quiebre.html'));
});

// ── Solapa Quiebre con datos reales ──────────────────────────────────────────────────────────
// Reemplaza build() (simulado) del HTML. Devuelve, para el "Periodo de ventas" pedido:
//  - resumen: conteos QUIEBRE/RIESGO/OK por empresa (para las 3 tarjetas).
//  - detalle: SOLO filas QUIEBRE/RIESGO (igual que filtered() en el frontend -- los OK nunca se
//    listan, solo se cuentan). Evita mandar al navegador las ~220K filas del universo completo.
//
// "Dias con stock"/"dias de quiebre" del periodo se aproximan con la foto SEMANAL real
// (dbo.MotorReposicion_StockSemanal) -- no hay stock diario historico real, ver conversacion.
// El universo de sucursal x SKU se arma con UNION de stock de HOY + ventas del periodo, porque
// en FOTOSTOCK_Diaria un articulo sin stock simplemente NO TIENE FILA (nunca hay stock=0
// explicito) -- omitir esa union dejaria fuera los quiebres reales.
const QUERY_QUIEBRE_DETALLE = `
IF OBJECT_ID('tempdb..#Universo') IS NOT NULL DROP TABLE #Universo;
IF OBJECT_ID('tempdb..#PendientesOC') IS NOT NULL DROP TABLE #PendientesOC;
IF OBJECT_ID('tempdb..#TransitoRango') IS NOT NULL DROP TABLE #TransitoRango;
IF OBJECT_ID('tempdb..#VentasRango') IS NOT NULL DROP TABLE #VentasRango;
IF OBJECT_ID('tempdb..#PromoRango') IS NOT NULL DROP TABLE #PromoRango;
IF OBJECT_ID('tempdb..#DiasConStockRango') IS NOT NULL DROP TABLE #DiasConStockRango;
IF OBJECT_ID('tempdb..#Resultado') IS NOT NULL DROP TABLE #Resultado;
IF OBJECT_ID('tempdb..#EstadoFinal') IS NOT NULL DROP TABLE #EstadoFinal;

-- Catalogo deduplicado y stock de depositos HOY: se leen de tablas reales precalculadas de noche
-- (dbo.MotorReposicion_CatalogoValido / _DepositoHoy, Etapa 5 del mismo job que precalcula
-- StockSemanal) en vez de recalcularse en CADA request.
-- UNIVERSO (2026-09-05, corregido tras un pedido explicito de Claudia -- ver el intento anterior en
-- backups/2026-09-05_universo-solo-venta-en-periodo/): el intento anterior (universo = SOLO lo que
-- vendio en el Periodo de ventas elegido) resolvia el caso de un articulo estacional, pero
-- introducia un problema peor: la grilla de Stock de un mismo articulo mostraba sucursales
-- DISTINTAS segun que Periodo de ventas se eligiera -- inestable e inconsistente, porque el
-- universo (que filas EXISTEN) dependia de un filtro que en realidad solo deberia afectar la
-- DEMANDA (velocidad/GAP), no que sucursales aparecen.
-- Ahora el universo vuelve a ser ESTABLE e independiente del Periodo de ventas -- se arma con TRES
-- fuentes, todas hechos permanentes (no dependen de ninguna fecha elegida por el usuario):
--   1) Stock HOY (MotorReposicion_UniversoHoy, precalculada de noche).
--   2) Alguna vez recibio esa talla por transferencia real (dis_transf_recibidas) -- mismo criterio
--      de evidencia real ya usado para corregir el caso KJ1736-1074 (2026-09-04, ver el commit de
--      ese dia). Reemplaza a la vieja fuente 2 ("vendio en el periodo elegido"), que era justamente
--      la que causaba la inestabilidad.
--   3) Alguna vez tuvo una venta real ahi (Vta_detalle, SIN acotar fecha -- 2026-09-08, a pedido
--      explicito, caso real DINK-6128/NEGRO: 3 de 8 sucursales que vendieron en julio quedaban
--      invisibles porque nunca tuvieron una recepcion real registrada en dis_transf_recibidas ni
--      stock hoy -- la venta era real pero la sucursal nunca habia entrado al universo). Un
--      articulo puede haber llegado a una sucursal por una via que el sistema no rastrea como
--      "transferencia" (ej. stock viejo, carga manual, etc.) -- la venta en si ya es evidencia
--      real de que estuvo ahi, sin depender de que tambien haya quedado un registro de recepcion.
-- El Periodo de ventas elegido sigue afectando la velocidad/GAP/sugerido de compra de cada fila
-- (eso no cambia), pero ya NO decide que filas existen.
--
-- PRECALCULADO de noche (2026-08-31, a pedido explicito: "reducir los tiempos al cambiar los
-- filtros de fecha") -- dbo.MotorReposicion_UniversoCompleto, Etapa 7 del SP de precalculo, es
-- EXACTAMENTE esta misma union (stock hoy + alguna vez recibio + alguna vez vendio, mismos 3
-- criterios documentados arriba) resuelta una vez por noche en vez de en cada request. Medido que
-- armar esto en vivo tardaba ~10s de los ~31s de calculo total en CADA cambio de filtro, sin
-- ninguna razon (el resultado no depende de Periodo de ventas ni de Fecha de ultima compra).
-- Verificado con datos reales tras desplegar: 1.162.012 filas exactas, 0 faltantes/sobrantes/con
-- StockTienda distinto contra la reconstruccion en vivo de esta misma union.
SELECT Sucursal, CodArticulo, COLOR, TALLE, StockTienda
INTO #Universo
FROM dbo.MotorReposicion_UniversoCompleto;

-- "Vigente" (2026-09-02, a pedido explicito, tras confirmar con datos reales que SIN este filtro
-- el 70% de lo contado como pendiente -- 235.852 de 336.147 unidades -- correspondia a pedidos con
-- F_HASTA vencido hace mas de 15 dias, es decir pedidos viejos/probablemente ya resueltos o
-- abandonados que segian inflando el numero): el pedido cuenta solo si HOY <= F_HASTA + tolerancia.
-- Tolerancia ampliada de 15 dias a 1 MES (2026-09-05, a pedido explicito, tras revisar casos reales
-- donde un pedido vigente por poco menos de 1 mes ya no contaba). F_DESDE NO se exige (un pedido
-- cuya ventana todavia no arranco sigue siendo legitimamente "pendiente", a pedido explicito) --
-- F_DESDE se ignora a proposito, no es un descuido. ISDATE(...)=1 es la misma guarda defensiva que
-- ISNUMERIC en pend_recep: si F_HASTA no es una fecha valida, el pedido NO se cuenta (mismo
-- criterio conservador que el resto del archivo). Medido antes de implementar: 4.222 pedidos
-- vigentes con la tolerancia de 1 mes (antes 3.907 con 15 dias, +8%), 107.251 unidades (antes
-- 100.291, +7%) -- cambio chico.
SELECT CODEARTICLE AS CodArticulo, COLOR, TALLE,
       SUM(CASE WHEN DEPOT='000098' AND ISNUMERIC(pend_recep)=1 THEN CAST(pend_recep AS DECIMAL(18,4)) ELSE 0 END) AS PendienteTESI,
       SUM(CASE WHEN DEPOT='000099' AND ISNUMERIC(pend_recep)=1 THEN CAST(pend_recep AS DECIMAL(18,4)) ELSE 0 END) AS PendientePUEBLO
INTO #PendientesOC
FROM TBL_INFO_PEDIDOS
WHERE DEPOT IN ('000098','000099') AND CAST(FECHA AS DATE) >= @fechaDesdePedidos
  AND ISDATE(F_HASTA)=1 AND CAST(F_HASTA AS DATE) >= DATEADD(month, -1, CAST(GETDATE() AS DATE))
GROUP BY CODEARTICLE, COLOR, TALLE;

-- Transferencias EN TRANSITO (2026-09-05, a pedido explicito): dis_transf_emitidas registra cada
-- transferencia YA despachada hacia una sucursal, con cantpend = lo que todavia no llego a destino.
-- A diferencia de OC pendiente (pedido al proveedor, no se resta -- ver arriba), esto SI se resta
-- directo de "unidades a comprar": es stock real que ya salio hacia ESA sucursal puntual, no una
-- promesa externa. Es POR SUCURSAL (no por empresa, a diferencia de deposito/OC), asi que no
-- necesita reparto/pool -- se resta directo en calcularNecesidadPorBarra (frontend).
-- 2026-09-02 (ver spec docs/superpowers/specs/2026-09-02-preagregado-ventas-diarias-design.md):
-- #TransitoRango/#VentasRango/#PromoRango dejaron de escanear dis_transf_emitidas/Vta_detalle en
-- vivo -- ahora leen de dbo.MotorReposicion_TransitoHoy/_VentasPorDia, precalculadas de noche
-- (Etapa 8 del mismo job que precalcula StockSemanal). Mismas columnas de salida que antes, para
-- no tener que tocar nada del resto de esta consulta ni del pipeline de Node. TransitoHoy ya no
-- necesita filtro de fecha en vivo (la vigencia de 30 dias se resuelve en la Etapa 8, siempre
-- respecto de "hoy" -- por eso @fechaDesdeTransito ya no se usa en esta consulta).
SELECT Sucursal, CodArticulo, COLOR, TALLE, TransitoPendiente
INTO #TransitoRango
FROM dbo.MotorReposicion_TransitoHoy;

SELECT Sucursal, CodArticulo, COLOR, TALLE,
       SUM(CantidadVendida) AS VentasRango,
       COUNT(*) AS DiasConVenta,
       MAX(Fecha) AS UltimaVenta
INTO #VentasRango
FROM dbo.MotorReposicion_VentasPorDia
WHERE Fecha >= @fechaDesde AND Fecha <= @fechaHasta
GROUP BY Sucursal, CodArticulo, COLOR, TALLE;

-- "Estuvo en promo" durante el Periodo de ventas elegido -- CantidadVentasPromo/NombrePromoDia/
-- DescuentoPromoDia ya vienen resueltos por dia en MotorReposicion_VentasPorDia (misma logica de
-- join/filtro contra CGD_CONDCOM_VTA_DET que antes, calculada de noche en vez de en vivo). SUM de
-- los conteos diarios = COUNT(*) directo sobre el crudo; MAX de los MAX diarios = MAX directo
-- sobre todo el rango (matematicamente exacto, no una aproximacion -- verificado con datos reales
-- antes de desplegar esto).
SELECT Sucursal, CodArticulo, COLOR, TALLE,
       SUM(CantidadVentasPromo) AS CantidadVentasPromo,
       MAX(NombrePromoDia) AS NombrePromo,
       MAX(DescuentoPromoDia) AS DescuentoPromo
INTO #PromoRango
FROM dbo.MotorReposicion_VentasPorDia
WHERE Fecha >= @fechaDesde AND Fecha <= @fechaHasta AND CantidadVentasPromo > 0
GROUP BY Sucursal, CodArticulo, COLOR, TALLE;

-- "Dias con stock" del periodo elegido: antes esto corria en vivo (Numerado/ConAnterior/Base/
-- Correccion sobre #StockSemanalRango, ~24s de los ~42s de respuesta total) para CADA request.
-- Ahora se lee de dbo.MotorReposicion_DiasConStockPorSemana, precalculada de noche por el mismo
-- job (Etapa 4 de MotorReposicion_sp_PreCalcularStockSemanal) sobre TODO el historial de una sola
-- vez -- el request en vivo solo suma las semanas que caen dentro de [@fechaDesde,@fechaHasta].
-- El precalculo ya no necesita el piso ">=@fechaDesde" que el calculo en vivo usaba para no
-- interpolar con una "semana margen" artificial (ver el bug historico que motivo ese piso): al
-- usar siempre la semana REAL inmediatamente anterior (nunca una ventana de margen inventada),
-- la interpolacion es correcta por construccion en cualquier punto de la serie.
SELECT dc.Sucursal, dc.CodArticulo, dc.COLOR, dc.TALLE,
       SUM(dc.DiasConStockContribucion) AS DiasConStockEstimado,
       SUM(dc.DiasQuiebreContribucion) AS DiasQuiebreEstimado
INTO #DiasConStockRango
FROM dbo.MotorReposicion_DiasConStockPorSemana dc
INNER JOIN #Universo u ON u.Sucursal=dc.Sucursal AND u.CodArticulo=dc.CodArticulo AND u.COLOR=dc.COLOR AND u.TALLE=dc.TALLE
WHERE dc.FechaSemana >= @fechaDesde AND dc.FechaSemana <= @fechaHasta
GROUP BY dc.Sucursal, dc.CodArticulo, dc.COLOR, dc.TALLE;

-- Ajuste "evidencia historica" (2026-09-11, a pedido explicito, caso real DINK-6128/NEGRO/Calzados
-- 35): el periodo elegido (30/05-26/08) mostraba 3 ventas / 3 dias con stock, ambos acotados al
-- periodo -> Vd=0,428571 -> Objetivo=7 unidades, pero la unica recepcion trackeada de este articulo
-- fue el 23/10/2025, MUY anterior al periodo -- la "evidencia chica" no es porque el articulo sea
-- nuevo, es porque tuvo stock esporadico (quiebre largo con blips de 1 dia) mucho antes de la
-- ventana elegida. Cuando el articulo YA EXISTIA antes del periodo (aceptacion real desde deposito,
-- o stock detectado en el precalculo semanal -- lo que sea mas viejo) pero casi no hay evidencia
-- DENTRO del periodo (mismo umbral que el piso de 7 dias, el UNICO otro lugar que ya trata "pocos
-- dias" como caso especial), se usa la velocidad de TODO el historial disponible (ventas de siempre
-- / dias con stock de siempre) en vez de la del periodo acotado -- evita que 2-3 ventas aisladas en
-- semanas de quiebre se lean como una velocidad sostenida (con DINK-6128: 5 ventas / 42 dias con
-- stock en 9 meses = Vd=0,119 -> Objetivo=2, contra el 7 de hoy).
-- Medido antes de implementar (real, contra 480.172 filas Quiebre/Riesgo de toda la red): 770 filas
-- (0,16%) caen en este patron, 3,4% del impacto total ($) -- acotado, MUY lejos del 86-97% que
-- justifico sacar la vieja "velocidad amplia" el 2026-08-18 (esa aplicaba a CUALQUIER vendedor
-- esporadico, sin distinguir articulo nuevo de viejo; esta solo dispara si YA EXISTIA antes del
-- periodo elegido, asi que un lanzamiento nuevo vendiendo rapido -- el grueso real de "evidencia
-- chica", 2.697 de 3.533 filas -- queda sin tocar).
-- PRECALCULADO (2026-09-12, a pedido explicito tras medir que calcular esto en vivo -- aunque
-- restringido a un preseleccionado de candidatos -- seguia agregando ~10-30s a la consulta):
-- VentasHistoricoTotal/DiasConStockHistorico/PrimeraStockSemana/PrimeraAceptacionDeposito ya NO se
-- calculan en cada request -- salen de dbo.MotorReposicion_EvidenciaHistorica, poblada de noche por
-- la Etapa 6 del mismo job que precalcula StockSemanal (ver
-- sql/MotorReposicion_sp_PreCalcularStockSemanal.sql). El request en vivo solo hace un LEFT JOIN
-- chico (por clave primaria) contra esa tabla, sin tocar Vta_detalle ni
-- MotorReposicion_DiasConStockPorSemana en el camino en vivo -- mismo patron que el resto de este
-- archivo (StockSemanal, DiasConStockPorSemana, CatalogoValido, UniversoHoy, DepositoHoy,
-- UltimaRecepcion ya funcionan asi).
-- Se probo indexar #Universo/#StockHoy/#VentasRango/#DiasConStockRango antes del cruce pesado de
-- mas abajo. Un primer micro-benchmark (construyendo el resultado SIN indice y luego CON indice,
-- en la misma sesion) mostro una mejora de ~3s -- pero era un espejismo: la segunda corrida se
-- beneficiaba de paginas ya calentadas en el buffer pool por la primera, no del indice en si.
-- Medido correctamente (una sola corrida limpia, como pasa en produccion real) el indice agrega
-- ~2.6s de creacion y el cruce se achica solo ~1.8s -- PEOR en neto. Revertido. Coincide con el
-- hallazgo anterior de esta misma sesion (indexar #temp para otra consulta tambien salio mas
-- lento) -- confirma que en este proyecto, con estos tamaños de tabla, SQL Server ya elige buenos
-- planes de hash join sobre los heaps sin ayuda de indices.

-- Velocidad AMPLIA de respaldo para vendedores esporadicos: con muy pocas VENTAS dentro del
-- periodo elegido, una venta aislada se proyectaba como si fuera una velocidad diaria sostenida
-- (confirmado con datos reales: el 86% del "margen perdido por dia" salia de articulos con 1-2
-- dias de venta en 30 dias, dando un total mayor al margen REAL que gana toda la empresa por dia
-- -- imposible). En vez de recalcular esto en vivo (medido: agregaba ~90-100s por request, sin
-- importar el umbral -- por el muestreo semanal de FotoStockSEMANA, en 30 dias la ENORME mayoria
-- de TODO el universo tiene DiasConStockEstimado bajo aunque este sano, asi que acotar a "pocos
-- dias con stock" no filtraba casi nada), esto ahora se lee de dbo.MotorReposicion_VelocidadAmplia,
-- precalculada de noche por el mismo job que precalcula StockSemanal (ver
-- MotorReposicion_sp_PreCalcularStockSemanal, Etapa 3) con una ventana FIJA de 6 meses hasta
-- anoche. Se pierde precision si el usuario elige un "hasta" bien distinto de hoy (rarisimo en
-- este tablero), a cambio de que el request ya no recalcula nada pesado -- solo un JOIN contra
-- una tabla chica.
SELECT
    u.Sucursal, s.nomSucursal AS NomSucursal, UPPER(s.Empresa) AS Empresa,
    u.CodArticulo, u.COLOR, u.TALLE,
    -- ISNULL en cada parte: en SQL Server, concatenar con '+' donde CUALQUIER operando es NULL
    -- da NULL para toda la expresion (a diferencia de JS). Sin esto, un articulo generico/mal
    -- cargado con COLOR o TALLE en NULL (ej. codigos catch-all de POS) deja Sku=NULL para todas
    -- sus filas, y varias filas distintas terminan colisionando bajo la misma clave "null".
    -- Color COMPLETO, no solo las primeras 2 letras -- con 2 letras, dos colores distintos que
    -- arrancan igual (confirmado con datos reales: "BLANCO" y "BLANCO-BLANCO OFF-DORADO", 513
    -- articulos del catalogo con al menos un choque asi) calculaban el MISMO Sku para el mismo
    -- talle -- las filas de ambos colores se mezclaban bajo un solo Sku (una se perdia en
    -- catalogo[], y el pool de deposito/OC de calcularNecesidadPorBarra las trataba como si
    -- fueran el mismo producto). Con el color completo la colision deja de ser posible.
    ISNULL(u.CodArticulo,'') + '-' + UPPER(ISNULL(u.COLOR,'')) + '-' + ISNULL(u.TALLE,'') AS Sku,
    cv.NOMBREART, cv.NOMPROV, cv.NOMLINEA, cv.NOMFLIA,
    -- Temporada/Material para la ficha del articulo (2026-08-20) -- vienen de cgd_ARTICULOS, no
    -- de MotorReposicion_CatalogoValido (esa tabla precalculada no los tiene). Se dedupean con
    -- MAX() ANTES del LEFT JOIN (ver catm mas abajo) para no arriesgar multiplicar filas si
    -- cgd_ARTICULOS tuviera mas de una fila para el mismo CodArticulo+COLOR+TALLE.
    -- Iva (2026-08-31, a pedido explicito, para "Margen %"): mismo origen/mismo criterio de
    -- dedupe que Temporada/Material -- confirmado con datos reales que solo toma 2 valores (21 o
    -- 10.5), nunca NULL en articulos reales del catalogo.
    -- Genero/Marca (2026-08-31, a pedido explicito, para el filtro "Solo mis lineas" por
    -- comprador): mismo origen/mismo dedupe -- necesarios para cruzar contra
    -- dbo.TBL_COMPRADOR_LINEA_MARCA (seccion+genero+familia+linea+proveedor+marca -> comprador),
    -- que la app ya tenia armada pero sin Genero/Marca disponibles del lado del catalogo.
    catm.Temporada, catm.Material, catm.Seccion, catm.Iva, catm.Genero, catm.Marca,
    ISNULL(cv.PVP_VIGENTE,0) AS Pvp, ISNULL(cv.COSTO_UNI,0) AS Costo,
    ISNULL(u.StockTienda, 0) AS StockTienda,
    -- Real (dbo.MotorReposicion_UltimaRecepcion, precalculada de noche desde dis_recepciones --
    -- compra real recibida en el deposito de la empresa, NO aceptacion de transferencia en la
    -- sucursal -- confirmado que es la fuente correcta). Antes el frontend usaba un placeholder
    -- fijo que dejaba este filtro sin ningun efecto real. NULL cuando nunca hubo una recepcion
    -- real para ese combo -- el frontend no filtra por eso (dato no disponible, no "nunca comprado").
    ur.FechaUltimaCompra,
    -- Los depositos NO estan compartimentados por empresa: cualquier sucursal (TESI o PUEBLO)
    -- puede recibir stock transferido desde CUALQUIERA de los dos depositos (confirmado). Antes
    -- se tomaba solo el deposito de la misma empresa de la sucursal, lo que generaba falsos
    -- QUIEBRE cuando el stock disponible estaba en el deposito de la otra empresa (confirmado
    -- con datos reales: 134 combos en TESI/PUEBLO marcados QUIEBRE que en realidad tenian stock
    -- en el otro deposito).
    ISNULL(dh.DepositoTESI,0) + ISNULL(dh.DepositoPUEBLO,0) AS StockDeposito,
    -- Depositos por separado (no solo el total): el frontend los necesita para mostrar el
    -- desglose real "Deposito TESI (98)" / "Deposito PUEBLO (99)" en la grilla de cobertura --
    -- antes esa grilla mostraba un numero SIMULADO (hash de modelo/color/talle, sin relacion con
    -- la base) porque el backend solo mandaba el total combinado.
    ISNULL(dh.DepositoTESI,0) AS DepositoTESI,
    ISNULL(dh.DepositoPUEBLO,0) AS DepositoPUEBLO,
    ISNULL(p.PendienteTESI,0) + ISNULL(p.PendientePUEBLO,0) AS PendienteOC,
    -- Igual que el deposito: por separado, no solo el total -- Reposicion necesita saber cuanto
    -- de lo pendiente de recibir es de CADA empresa (antes usaba stockEnOC(), un hash simulado sin
    -- relacion con TBL_INFO_PEDIDOS, para restar esto del "cuanto comprar").
    ISNULL(p.PendienteTESI,0) AS PendienteTESI,
    ISNULL(p.PendientePUEBLO,0) AS PendientePUEBLO,
    -- Transferencia en transito hacia ESTA sucursal puntual (ver #TransitoRango arriba) --
    -- 2026-09-05, a pedido explicito. A diferencia de deposito/OC, es POR SUCURSAL, no por
    -- empresa -- se resta directo del GAP de esta fila en calcularNecesidadPorBarra (frontend),
    -- sin reparto/pool.
    ISNULL(tr.TransitoPendiente,0) AS TransitoPendiente,
    ISNULL(v.VentasRango, 0) AS VentasRango,
    ISNULL(v.DiasConVenta, 0) AS DiasConVenta,
    v.UltimaVenta,
    -- "Estuvo en promo" (ver #PromoRango arriba) -- 2026-09-02, a pedido explicito.
    ISNULL(pr.CantidadVentasPromo, 0) AS CantidadVentasPromo,
    pr.NombrePromo,
    pr.DescuentoPromo,
    ISNULL(dcs.DiasConStockEstimado,0) AS DiasConStockEstimado,
    dcs.DiasQuiebreEstimado,
    -- Velocidad = ventas reales del periodo elegido / dias con stock reales del mismo periodo,
    -- SIEMPRE -- sin excepcion ni respaldo por "venta esporadica". Antes, si el SKU-sucursal
    -- vendio en pocos dias dentro del periodo, se caia a una ventana fija de 6 meses
    -- (dbo.MotorReposicion_VelocidadAmplia) para estimar una tasa mas estable. Se saco a pedido
    -- explicito de Claudia (2026-08-18): al revisar un caso real (KC1575-1074, talle S, TESI) la
    -- nota de "se considera esporadica" comparaba mal una suma de sucursales contra un umbral
    -- pensado por sucursal, lo cual generaba confusion sobre el criterio -- y ella decidio que
    -- prefiere ver siempre la venta real del periodo elegido, sin ninguna sustitucion por otra
    -- ventana, aunque eso implique que un articulo con muy pocos dias de venta en el periodo
    -- pueda mostrar una velocidad menos estable. Backup de la version anterior (con el respaldo)
    -- en backups/2026-08-18_quitar-velocidad-esporadica/.
    -- Piso de 7 dias (una semana, la menor unidad de evidencia real que existe en todo este
    -- calculo) en el denominador: sin este piso, una unica venta (ej. 3 unidades en 1 dia) se
    -- proyectaba igual como vd=3/dia. SQL Server 2008 R2 no tiene GREATEST() (recien en 2022) --
    -- se replica con CASE. NULL se preserva tal cual SOLO si tampoco hay venta real (sin evidencia
    -- real de ningun tipo, no se inventa un piso) para que el ISNULL/NULLIF de Calc mas abajo siga
    -- resolviendo Vd=0 igual que siempre.
    -- CORREGIDO (2026-09-04, a pedido explicito de Claudia con un caso real: KJ1736-1074/CORE
    -- BLACK-CLOUD WHITE-SILVER METAL/talle 6/Calzados 02 -- recibio 1 unidad el 12/06 y la vendio
    -- el 13/06, pero la foto semanal de stock nunca llego a capturarla, asi que
    -- DiasConStockEstimado quedaba NULL y la venta real desaparecia de la velocidad, Vd=0). Si HUBO
    -- venta en el periodo, la venta misma es evidencia de que hubo stock en algun momento aunque el
    -- precalculo semanal no lo haya visto -- se le aplica el mismo piso de 7 dias que ya se usa
    -- para "pocos dias detectados", en vez de tratarlo como "sin evidencia real".
    -- Vd: historial completo si dispara "evidencia historica" (ver ueh.UsaEvidenciaHistorica, y el
    -- comentario completo junto a la Etapa 6/precalculo mas arriba), sino la formula de siempre
    -- (periodo elegido, con el piso de 7 dias). eh = dbo.MotorReposicion_EvidenciaHistorica
    -- (precalculada de noche, ver el LEFT JOIN mas abajo).
    CASE WHEN ueh.UsaEvidenciaHistorica = 1
         THEN eh.VentasHistoricoTotal / CAST(eh.DiasConStockHistorico AS DECIMAL(18,4))
         ELSE ISNULL(v.VentasRango,0) / CAST(
           CASE WHEN dcs.DiasConStockEstimado IS NULL AND ISNULL(v.VentasRango,0) = 0 THEN NULL
                WHEN dcs.DiasConStockEstimado IS NULL THEN 7
                WHEN dcs.DiasConStockEstimado < 7 THEN 7
                ELSE dcs.DiasConStockEstimado END
         AS DECIMAL(18,4))
    END AS VdRaw,
    -- UsoVelocidadAmplia queda siempre en 0 (ya no existe el respaldo) -- se mantiene la columna
    -- para no tener que tocar el frontend, que ya sabe no mostrar la nota cuando es 0/false.
    0 AS UsoVelocidadAmplia,
    -- Marca si esta fila uso el ajuste de "evidencia historica" -- el frontend la usa para saber
    -- que la Vd mostrada YA es la de todo el historial, y arma el bloque "Conservador/Real" del
    -- popover de necesidad de compra en consecuencia (ver AJUSTES_FORMULA en el HTML).
    ueh.UsaEvidenciaHistorica AS UsoEvidenciaHistorica,
    ISNULL(v.VentasRango,0) AS VentasVd,
    CASE WHEN dcs.DiasConStockEstimado IS NULL AND ISNULL(v.VentasRango,0) = 0 THEN NULL
         WHEN dcs.DiasConStockEstimado IS NULL THEN 7
         WHEN dcs.DiasConStockEstimado < 7 THEN 7
         ELSE dcs.DiasConStockEstimado END AS DiasStockVd,
    -- Dias con stock SIN el piso de 7 -- para el "escenario real" del desglose de velocidad en el
    -- frontend (comparar contra DiasStockVd, que si tiene el piso aplicado). Misma preservacion de
    -- NULL que DiasStockVd (sin evidencia real no es lo mismo que 0 dias).
    dcs.DiasConStockEstimado AS DiasStockVdReal,
    -- Numerador/denominador que el popover de necesidad de compra debe MOSTRAR junto a Vd (arriba)
    -- para que la cuenta "ventas ÷ dias = velocidad" siempre cierre -- VentasVd/DiasStockVd (arriba)
    -- son SIEMPRE los del periodo elegido (los sigue necesitando el ajuste piso7dias para su propio
    -- "escenario real"), pero si UsoEvidenciaHistorica=1 la Vd de arriba ya es la del historial
    -- completo -- mostrar "3 ventas ÷ 7 dias" al lado de una Vd que en realidad sale de "5 ventas ÷
    -- 42 dias" no cerraria. Mismos valores que armaron VdRaw arriba.
    CASE WHEN ueh.UsaEvidenciaHistorica = 1 THEN eh.VentasHistoricoTotal ELSE ISNULL(v.VentasRango,0) END AS VentasVdMostrado,
    CASE WHEN ueh.UsaEvidenciaHistorica = 1 THEN eh.DiasConStockHistorico
         WHEN dcs.DiasConStockEstimado IS NULL AND ISNULL(v.VentasRango,0) = 0 THEN NULL
         WHEN dcs.DiasConStockEstimado IS NULL THEN 7
         WHEN dcs.DiasConStockEstimado < 7 THEN 7
         ELSE dcs.DiasConStockEstimado END AS DiasStockVdMostrado,
    -- Alerta "sin evidencia real de stock" (2026-09-13, a pedido explicito, caso real
    -- DINK-6128/NEGRO/Calzados 02): viene precalculada de noche (Etapa 6, ver el comentario
    -- completo en el SP) -- marca combos que nunca tuvieron una foto de stock >0 NI una aceptacion
    -- real de deposito, en toda su vida. El frontend decide cuando mostrarla (solo si ademas hay
    -- algo real para comprar en esta fila) -- aca solo se expone el dato crudo.
    ISNULL(eh.SinEvidenciaRealStock, 0) AS SinEvidenciaRealStock
INTO #Resultado
FROM #Universo u
INNER JOIN Sucursales s ON s.Sucursal = u.Sucursal
-- INNER JOIN (no LEFT): #Universo ya se construyo exigiendo match en dbo.MotorReposicion_
-- CatalogoValido (via #Universo-Hoy y via el filtro de la parte de ventas), asi que esta union
-- siempre encuentra exactamente una fila (dedupeada) -- no puede faltar ni duplicar.
INNER JOIN dbo.MotorReposicion_CatalogoValido cv ON cv.CodArticulo = u.CodArticulo AND cv.COLOR = u.COLOR AND cv.TALLE = u.TALLE
LEFT JOIN (
  SELECT GA_CODEARTICLE AS CodArticulo, COLOR, TALLE, MAX(TEMPORADA) AS Temporada, MAX(MATERIAL) AS Material, MAX(NOMSECCION) AS Seccion, MAX(IVA) AS Iva, MAX(NOMGENERO) AS Genero, MAX(NOMMARCA) AS Marca
  FROM cgd_ARTICULOS
  GROUP BY GA_CODEARTICLE, COLOR, TALLE
) catm ON catm.CodArticulo = u.CodArticulo AND catm.COLOR = u.COLOR AND catm.TALLE = u.TALLE
LEFT JOIN dbo.MotorReposicion_DepositoHoy dh ON dh.CodArticulo = u.CodArticulo AND dh.COLOR = u.COLOR AND dh.TALLE = u.TALLE
LEFT JOIN #PendientesOC p ON p.CodArticulo = u.CodArticulo AND p.COLOR = u.COLOR AND p.TALLE = u.TALLE
LEFT JOIN #TransitoRango tr ON tr.Sucursal = u.Sucursal AND tr.CodArticulo = u.CodArticulo AND tr.COLOR = u.COLOR AND tr.TALLE = u.TALLE
LEFT JOIN #VentasRango v ON v.Sucursal = u.Sucursal AND v.CodArticulo = u.CodArticulo AND v.COLOR = u.COLOR AND v.TALLE = u.TALLE
LEFT JOIN #PromoRango pr ON pr.Sucursal = u.Sucursal AND pr.CodArticulo = u.CodArticulo AND pr.COLOR = u.COLOR AND pr.TALLE = u.TALLE
LEFT JOIN #DiasConStockRango dcs ON dcs.Sucursal = u.Sucursal AND dcs.CodArticulo = u.CodArticulo AND dcs.COLOR = u.COLOR AND dcs.TALLE = u.TALLE
LEFT JOIN dbo.MotorReposicion_UltimaRecepcion ur ON ur.Sucursal = u.Sucursal AND ur.CodArticulo = u.CodArticulo AND ur.COLOR = u.COLOR AND ur.TALLE = u.TALLE
-- Evidencia historica (ver el comentario completo junto a la Etapa 6/precalculo, mas arriba en
-- este archivo): eh = dbo.MotorReposicion_EvidenciaHistorica, precalculada de noche -- un solo
-- LEFT JOIN chico (por clave primaria), sin tocar Vta_detalle ni MotorReposicion_
-- DiasConStockPorSemana en el camino en vivo. pe calcula la antiguedad real (la mas vieja entre
-- aceptacion de deposito y stock detectado), ueh decide si dispara el ajuste -- una sola vez, para
-- no repetir la misma condicion larga en VdRaw y en UsoEvidenciaHistorica por separado.
LEFT JOIN dbo.MotorReposicion_EvidenciaHistorica eh ON eh.Sucursal = u.Sucursal AND eh.CodArticulo = u.CodArticulo AND eh.COLOR = u.COLOR AND eh.TALLE = u.TALLE
CROSS APPLY (
  SELECT CASE WHEN eh.PrimeraAceptacionDeposito IS NULL THEN eh.PrimeraStockSemana
              WHEN eh.PrimeraStockSemana IS NULL THEN eh.PrimeraAceptacionDeposito
              WHEN eh.PrimeraAceptacionDeposito < eh.PrimeraStockSemana THEN eh.PrimeraAceptacionDeposito
              ELSE eh.PrimeraStockSemana END AS PrimeraEvidencia
) pe
CROSS APPLY (
  SELECT CASE WHEN pe.PrimeraEvidencia IS NOT NULL AND pe.PrimeraEvidencia < @fechaDesde
                AND ISNULL(v.VentasRango,0) > 0
                AND (dcs.DiasConStockEstimado IS NULL OR dcs.DiasConStockEstimado < 7)
                AND ISNULL(eh.DiasConStockHistorico,0) > 0
              THEN 1 ELSE 0 END AS UsaEvidenciaHistorica
) ueh
-- "Fecha de ultima compra" ahora restringe el universo ENTERO (quiebres/riesgos/ok, no solo que
-- barras se listan) -- a pedido explicito. NULL (2.8% del universo, sin ninguna recepcion real
-- registrada) nunca se excluye -- falta de dato no es lo mismo que "nunca comprado".
WHERE ur.FechaUltimaCompra IS NULL
   OR (ur.FechaUltimaCompra >= @ucFechaDesde AND ur.FechaUltimaCompra <= @ucFechaHasta)
-- OPTION (FORCE ORDER) (2026-09-02, ver spec docs/superpowers/specs/2026-09-02-preagregado-ventas-diarias-design.md):
-- al pasar #VentasRango/#PromoRango/#TransitoRango a leer de tablas precalculadas mucho mas chicas
-- (en vez de escanear Vta_detalle/dis_transf_emitidas en vivo), el optimizador reordenaba este JOIN
-- de forma distinta -- y peor -- basandose en una estimacion de cardinalidad inflada contra
-- MotorReposicion_UltimaRecepcion (estimaba 18.2M filas, la realidad son 1.16M -- 15.6x de mas).
-- Medido: sin esto, este SELECT solo (una vez arregladas las estadisticas de las tablas nuevas)
-- pasaba de ~8-9s a 22-39s. Con FORCE ORDER, vuelve a un costo en linea con el original (~32s
-- totales de la consulta completa, igual que antes de este cambio). MotorReposicion_UltimaRecepcion
-- y MotorReposicion_EvidenciaHistorica YA tienen el indice correcto (Sucursal, CodArticulo, COLOR,
-- TALLE) -- el costo real esta en que el otro lado del join (#Universo) es una tabla temporal sin
-- indice (heap); indexar temp tables para esta consulta ya se probo antes (ver comentario sobre
-- "evidencia historica" mas arriba) y empeoro el resultado neto -- no se repite ese intento.
OPTION (FORCE ORDER);

;WITH Calc AS (
    SELECT *,
        ISNULL(VdRaw, 0) AS Vd,
        (Pvp - Costo) AS MargenU,
        CASE WHEN ISNULL(VdRaw,0) > 0 THEN ROUND(StockTienda / VdRaw, 0) ELSE 999 END AS Cob,
        CASE WHEN ISNULL(VdRaw,0) > 0 THEN ROUND((StockTienda + StockDeposito) / VdRaw, 0) ELSE 999 END AS CobConDeposito,
        -- Cobertura SIN redondear, usada solo para decidir el Estado: redondear ANTES de comparar
        -- contra @riesgoDias empujaba casos limite al lado "sano" (confirmado con datos reales:
        -- articulo FFPFEI001WTO5-1312, sucursal 000039, cobertura real 2.8 dias -- ROUND(2.8,0)=3,
        -- y 3 no es < 3, asi que quedaba OK aunque tuviera menos de 3 dias reales de cobertura).
        -- Cob/CobConDeposito (redondeados) se siguen mandando al frontend para mostrar, esta version
        -- exacta solo se usa aca abajo para el CASE de Estado.
        CASE WHEN ISNULL(VdRaw,0) > 0 THEN StockTienda / VdRaw ELSE 999 END AS CobExacto,
        CASE WHEN ISNULL(VdRaw,0) > 0 THEN (StockTienda + StockDeposito) / VdRaw ELSE 999 END AS CobConDepositoExacto
    FROM #Resultado
),
Estado AS (
    SELECT *,
        CASE
          WHEN StockTienda = 0 AND StockDeposito > 0 AND CobConDepositoExacto < @riesgoDias THEN 'RIESGO'
          WHEN StockTienda = 0 AND StockDeposito > 0 THEN 'OK'
          WHEN StockTienda = 0 THEN 'QUIEBRE'
          WHEN CobExacto < @riesgoDias THEN 'RIESGO'
          ELSE 'OK'
        END AS Estado
    FROM Calc
)
SELECT *, CASE WHEN Estado <> 'OK' THEN Vd * MargenU ELSE 0 END AS Impacto
INTO #EstadoFinal
FROM Estado;

-- Resumen de red completa (SIN restringir por favoritos) -- lo que antes se mandaba como
-- "resumen". Sigue existiendo para cuando no hay ningun favorito marcado.
-- Quiebres/Riesgos/Ok cuentan ARTICULO+COLOR (no filas sueltas de talle x sucursal, 2026-08-24,
-- a pedido explicito de Claudia -- "para ser congruentes con el resto" del tablero, que ya bajo
-- todos sus listados a ese mismo nivel). Prioridad si un articulo+color tiene tallas en mas de
-- un estado a la vez: QUIEBRE > RIESGO > OK -- asi los 3 numeros nunca se superponen y siempre
-- suman el 100% de los articulos+color de esa empresa (misma propiedad que tenian antes las
-- filas sueltas, solo que ahora a nivel articulo+color en vez de talle x sucursal).
;WITH PorArticuloColor AS (
    SELECT
        Empresa, CodArticulo, COLOR,
        CASE
          WHEN SUM(CASE WHEN Estado='QUIEBRE' THEN 1 ELSE 0 END) > 0 THEN 'QUIEBRE'
          WHEN SUM(CASE WHEN Estado='RIESGO' THEN 1 ELSE 0 END) > 0 THEN 'RIESGO'
          ELSE 'OK'
        END AS EstadoAC
    FROM #EstadoFinal
    GROUP BY Empresa, CodArticulo, COLOR
),
ResumenAC AS (
    SELECT Empresa,
        SUM(CASE WHEN EstadoAC='QUIEBRE' THEN 1 ELSE 0 END) AS Quiebres,
        SUM(CASE WHEN EstadoAC='RIESGO' THEN 1 ELSE 0 END) AS Riesgos,
        SUM(CASE WHEN EstadoAC='OK' THEN 1 ELSE 0 END) AS Ok
    FROM PorArticuloColor
    GROUP BY Empresa
),
ResumenFilas AS (
    SELECT Empresa,
        SUM(CASE WHEN Estado='QUIEBRE' THEN Impacto ELSE 0 END) AS ImpactoQuiebre,
        COUNT(DISTINCT Sucursal) AS NroSucursales
    FROM #EstadoFinal
    GROUP BY Empresa
)
SELECT ac.Empresa, ac.Quiebres, ac.Riesgos, ac.Ok, rf.ImpactoQuiebre, rf.NroSucursales
FROM ResumenAC ac
JOIN ResumenFilas rf ON rf.Empresa = ac.Empresa;

-- El detalle (listas de todas las solapas, incluida Atencion Prioritaria): universo completo,
-- SIN restringir por favoritos -- el navegador decide que mostrar segun sus propios filtros.
--
-- Columnas EXPLICITAS, ya NO "SELECT *" (2026-08-28, a pedido explicito: "por que tarda tanto al
-- entrar" -- medido con datos reales que devolver este recordset completo, con TODAS las columnas
-- de #EstadoFinal repetidas por cada fila Sucursal x Sku, tardaba 150s de los ~180s totales en un
-- caso real de 477.387 filas -- el JOIN/calculo en si (todo lo de arriba) tarda ~31s, el problema
-- es transferir texto de catalogo (nombre/marca/linea/familia) repetido en las ~34 sucursales de
-- cada SKU. Se saca ese texto de ESTE recordset -- viaja UNA sola vez por SKU en el recordset
-- "catalogo" de mas abajo -- y server.js arma el objeto catalogo[] directo desde ahi (ya no
-- necesita deduplicar en Node la primera vez que ve cada Sku, SQL ya lo entrega deduplicado).
-- Sin AceptacionesRango/VentasHistorico/AceptacionesHistorico/PrimeraVenta/PrimeraAceptacion/
-- FechaUltimaAceptacion/CantidadUltimaAceptacion: esas columnas nunca existieron en el
-- #EstadoFinal de ESTA consulta (son exclusivas de QUERY_ARTICULO_COMPLETO, ver DETALLE_COLUMNAS
-- en server.js) -- "SELECT *" tampoco las traía antes, así que el frontend ya sabe tratarlas como
-- undefined/0 para esta consulta. Incluirlas acá rompería con "Invalid column name".
SELECT Sucursal, NomSucursal, Empresa, Sku, Vd, StockTienda, StockDeposito, DepositoTESI, DepositoPUEBLO,
    PendienteOC, PendienteTESI, PendientePUEBLO, TransitoPendiente,
    Cob, Estado, Impacto, DiasConVenta, VentasRango, DiasQuiebreEstimado, UltimaVenta, FechaUltimaCompra,
    VentasVd, DiasStockVd, UsoVelocidadAmplia, DiasStockVdReal, UsoEvidenciaHistorica,
    VentasVdMostrado, DiasStockVdMostrado, SinEvidenciaRealStock,
    CantidadVentasPromo, NombrePromo, DescuentoPromo
FROM #EstadoFinal WHERE Estado <> 'OK';

-- Desglose por articulo (Empresa+CodArticulo+Sku, TODOS los estados incluido OK) -- esto es lo que
-- permite calcular un resumen restringido a favoritos SIN volver a pegarle a SQL Server en cada
-- marca/desmarca de una estrella: server.js lo cachea junto con el detalle (clave de cache SIN
-- favoritos) y filtra+suma esto en Node cuando hay favoritos activos. Antes, marcar un favorito
-- agregaba favModelos/favSkus a la clave de cache -> cache MISS garantizado -> recalculo completo
-- (~7-17s) en CADA click de estrella. Muchas menos filas que el detalle (agrupado, sin Sucursal).
-- COLOR va ademas de Sku (que ya lo incluye) para que Node pueda re-fusionar por articulo+color
-- con la misma prioridad QUIEBRE > RIESGO > OK que usa el resumen sin favoritos de arriba.
SELECT Empresa, CodArticulo, COLOR, Sku,
    SUM(CASE WHEN Estado='QUIEBRE' THEN 1 ELSE 0 END) AS Quiebres,
    SUM(CASE WHEN Estado='RIESGO' THEN 1 ELSE 0 END) AS Riesgos,
    SUM(CASE WHEN Estado='OK' THEN 1 ELSE 0 END) AS Ok,
    SUM(CASE WHEN Estado='QUIEBRE' THEN Impacto ELSE 0 END) AS ImpactoQuiebre
FROM #EstadoFinal
GROUP BY Empresa, CodArticulo, COLOR, Sku;

-- Catalogo (2026-08-28, ver el comentario completo junto al recordset de detalle, arriba): texto
-- descriptivo UNA vez por Sku (DISTINCT), no una vez por Sucursal x Sku -- esto es lo que antes
-- viajaba repetido ~34 veces (una por sucursal) dentro de cada fila de detalle. Barato: es un
-- DISTINCT sobre columnas ya calculadas en #EstadoFinal, sin volver a tocar Vta_detalle ni ninguna
-- tabla pesada (mismo tipo de operacion que el COUNT(*) ya medido en <1s sobre esta misma tabla).
-- Genero/Marca (2026-09-03, fix: faltaban en este SELECT desde que se agrego el filtro "Solo mis
-- lineas" el 2026-08-31 -- #EstadoFinal ya los tenia calculados, pero nunca se agregaron aca, asi
-- que el navegador siempre recibia null y el filtro quedaba sin efecto para TODO articulo/usuario).
SELECT DISTINCT Sku, CodArticulo, COLOR, TALLE, NOMBREART, NOMPROV, NOMLINEA, NOMFLIA, Seccion, Genero, Marca, Pvp, Costo, MargenU, Temporada, Material, Iva
FROM #EstadoFinal WHERE Estado <> 'OK';

DROP TABLE #Universo;
DROP TABLE #PendientesOC;
DROP TABLE #TransitoRango;
DROP TABLE #VentasRango;
DROP TABLE #PromoRango;
DROP TABLE #DiasConStockRango;
DROP TABLE #Resultado;
DROP TABLE #EstadoFinal;
`;

// ── Cobertura completa de UN articulo (para el detalle que se abre al hacer clic) ───────────────
// Misma logica que QUERY_QUIEBRE_DETALLE pero (1) filtrada por @modelo desde el vamos en cada
// fuente (Vta_detalle, TBL_INFO_PEDIDOS, UniversoHoy) -- rapido sin importar el tamaño del
// catalogo, igual idea que el desglose por favoritos -- y (2) SIN el "WHERE Estado <> 'OK'" final:
// devuelve TODOS los estados (QUIEBRE/RIESGO/OK) de las combinaciones que SI entraron al universo
// (ver el comentario de #Universo mas abajo, 2026-09-05: universo = stock hoy o recepcion real
// alguna vez, ESTABLE, independiente del Periodo de ventas elegido -- a proposito, para que la
// grilla de Stock/A comprar de un mismo articulo no cambie de sucursales solo por mover las fechas).
const QUERY_ARTICULO_COMPLETO = `
IF OBJECT_ID('tempdb..#Universo') IS NOT NULL DROP TABLE #Universo;
IF OBJECT_ID('tempdb..#PendientesOC') IS NOT NULL DROP TABLE #PendientesOC;
IF OBJECT_ID('tempdb..#TransitoRango') IS NOT NULL DROP TABLE #TransitoRango;
IF OBJECT_ID('tempdb..#VentasRango') IS NOT NULL DROP TABLE #VentasRango;
IF OBJECT_ID('tempdb..#AceptacionesRango') IS NOT NULL DROP TABLE #AceptacionesRango;
IF OBJECT_ID('tempdb..#VentasHistorico') IS NOT NULL DROP TABLE #VentasHistorico;
IF OBJECT_ID('tempdb..#AceptacionesHistorico') IS NOT NULL DROP TABLE #AceptacionesHistorico;
IF OBJECT_ID('tempdb..#PrimeraVenta') IS NOT NULL DROP TABLE #PrimeraVenta;
IF OBJECT_ID('tempdb..#PrimeraAceptacion') IS NOT NULL DROP TABLE #PrimeraAceptacion;
IF OBJECT_ID('tempdb..#UltimaAceptacionFecha') IS NOT NULL DROP TABLE #UltimaAceptacionFecha;
IF OBJECT_ID('tempdb..#UltimaAceptacion') IS NOT NULL DROP TABLE #UltimaAceptacion;
IF OBJECT_ID('tempdb..#PromoRango') IS NOT NULL DROP TABLE #PromoRango;
IF OBJECT_ID('tempdb..#DiasConStockRango') IS NOT NULL DROP TABLE #DiasConStockRango;
IF OBJECT_ID('tempdb..#Resultado') IS NOT NULL DROP TABLE #Resultado;
IF OBJECT_ID('tempdb..#EstadoFinal') IS NOT NULL DROP TABLE #EstadoFinal;

-- UNIVERSO (2026-09-08, agregado el 3er criterio -- ver el comentario completo junto a #Universo
-- en QUERY_QUIEBRE_DETALLE, mas arriba en este archivo): ESTABLE, independiente del Periodo de
-- ventas elegido -- stock HOY, alguna vez recibio esa talla por transferencia real
-- (dis_transf_recibidas), o alguna vez tuvo una venta real ahi (Vta_detalle, sin acotar fecha --
-- caso real DINK-6128/NEGRO). Antes esta consulta usaba "vendio en el periodo elegido" como
-- fuente, lo que hacia que la grilla de Stock/A comprar de un mismo articulo mostrara sucursales
-- DISTINTAS segun que fechas se eligieran arriba -- inestable. El Periodo de ventas elegido sigue
-- afectando la velocidad/GAP/sugerido de cada fila (eso no cambia), pero ya no decide que filas
-- existen. Acotado por @modelo (a diferencia de QUERY_QUIEBRE_DETALLE, que no tiene ese filtro) --
-- barato, un solo articulo en vez de escanear todo Vta_detalle.
SELECT Sucursal, CodArticulo, COLOR, TALLE, StockTienda
INTO #Universo
FROM dbo.MotorReposicion_UniversoHoy
WHERE CodArticulo = @modelo;

-- estab IN ('000098','000099'): ver el comentario completo junto al mismo INSERT en
-- QUERY_QUIEBRE_DETALLE, mas arriba en este archivo.
INSERT INTO #Universo (Sucursal, CodArticulo, COLOR, TALLE, StockTienda)
SELECT DISTINCT dt.destino, dt.arprove, dt.color, dt.talle, 0
FROM dis_transf_recibidas dt
INNER JOIN Sucursales s ON s.Sucursal = dt.destino AND (s.viewSuc='S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
INNER JOIN dbo.MotorReposicion_CatalogoValido cv ON cv.CodArticulo = dt.arprove AND cv.COLOR = dt.color AND cv.TALLE = dt.talle
WHERE dt.destino IS NOT NULL AND dt.arprove = @modelo AND dt.estab IN ('000098','000099')
  AND NOT EXISTS (SELECT 1 FROM #Universo u WHERE u.Sucursal = dt.destino AND u.CodArticulo = dt.arprove AND u.COLOR = dt.color AND u.TALLE = dt.talle);

INSERT INTO #Universo (Sucursal, CodArticulo, COLOR, TALLE, StockTienda)
SELECT DISTINCT vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE, 0
FROM Vta_detalle vd
INNER JOIN Sucursales s ON s.Sucursal = vd.ESTAB AND (s.viewSuc='S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
INNER JOIN dbo.MotorReposicion_CatalogoValido cv ON cv.CodArticulo = vd.ARTCEGID AND cv.COLOR = vd.COLOR AND cv.TALLE = vd.TALLE
WHERE vd.ESTAB IS NOT NULL AND vd.ARTCEGID = @modelo
  AND NOT EXISTS (SELECT 1 FROM #Universo u WHERE u.Sucursal = vd.ESTAB AND u.CodArticulo = vd.ARTCEGID AND u.COLOR = vd.COLOR AND u.TALLE = vd.TALLE);

-- "Vigente" (ver el comentario completo junto a #PendientesOC en QUERY_QUIEBRE_DETALLE, mas
-- arriba en este archivo): HOY <= F_HASTA + 1 mes de tolerancia, F_DESDE no se exige.
SELECT CODEARTICLE AS CodArticulo, COLOR, TALLE,
       SUM(CASE WHEN DEPOT='000098' AND ISNUMERIC(pend_recep)=1 THEN CAST(pend_recep AS DECIMAL(18,4)) ELSE 0 END) AS PendienteTESI,
       SUM(CASE WHEN DEPOT='000099' AND ISNUMERIC(pend_recep)=1 THEN CAST(pend_recep AS DECIMAL(18,4)) ELSE 0 END) AS PendientePUEBLO
INTO #PendientesOC
FROM TBL_INFO_PEDIDOS
WHERE DEPOT IN ('000098','000099') AND CODEARTICLE = @modelo AND CAST(FECHA AS DATE) >= @fechaDesdePedidos
  AND ISDATE(F_HASTA)=1 AND CAST(F_HASTA AS DATE) >= DATEADD(month, -1, CAST(GETDATE() AS DATE))
GROUP BY CODEARTICLE, COLOR, TALLE;

-- Transferencias en transito (ver el comentario completo junto a #TransitoRango en
-- QUERY_QUIEBRE_DETALLE, mas arriba en este archivo) -- acotado a @modelo.
SELECT te.destino AS Sucursal, te.arprove AS CodArticulo, te.color AS COLOR, te.talle AS TALLE,
       SUM(te.cantpend) AS TransitoPendiente
INTO #TransitoRango
FROM dis_transf_emitidas te
INNER JOIN Sucursales s ON s.Sucursal = te.destino AND (s.viewSuc='S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
WHERE te.arprove = @modelo AND te.fecha >= @fechaDesdeTransito AND te.cantpend > 0
GROUP BY te.destino, te.arprove, te.color, te.talle;

SELECT ESTAB AS Sucursal, ARTCEGID AS CodArticulo, COLOR, TALLE,
       SUM(CASE WHEN ISNUMERIC(CANTIDAD)=1 THEN CAST(CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS VentasRango,
       COUNT(DISTINCT FECHA) AS DiasConVenta,
       MAX(FECHA) AS UltimaVenta
INTO #VentasRango
FROM Vta_detalle
WHERE ESTAB IS NOT NULL AND ARTCEGID = @modelo AND FECHA >= @fechaDesde AND FECHA <= @fechaHasta
GROUP BY ESTAB, ARTCEGID, COLOR, TALLE;

-- Aceptaciones de transferencia recibidas en la sucursal (2026-08-24, a pedido explicito, solo en
-- esta consulta de UN articulo puntual -- NO en QUERY_QUIEBRE_DETALLE). "destino" es la sucursal
-- que RECIBE (confirmado contra el esquema real: "estab" es la sucursal de ORIGEN, no la que nos
-- interesa aca). Mismo rango de fechas que #VentasRango (el "Periodo de ventas" elegido).
-- estab IN ('000098','000099') (2026-09-11, a pedido explicito): solo cuenta como "aceptacion" lo
-- que vino de un deposito real -- un traspaso sucursal-a-sucursal no es reposicion. Ver el
-- comentario completo junto al INSERT de #Universo criterio 2 en QUERY_QUIEBRE_DETALLE.
SELECT destino AS Sucursal, arprove AS CodArticulo, color AS COLOR, talle AS TALLE,
       SUM(CASE WHEN ISNUMERIC(cantidad)=1 THEN CAST(cantidad AS DECIMAL(18,4)) ELSE 0 END) AS AceptacionesRango
INTO #AceptacionesRango
FROM dis_transf_recibidas
WHERE destino IS NOT NULL AND arprove = @modelo AND estab IN ('000098','000099') AND fecha >= @fechaDesde AND fecha <= @fechaHasta
GROUP BY destino, arprove, color, talle;

-- Aceptaciones/Venta "de siempre" para la ventana de stock/a comprar (2026-08-28, a pedido
-- explicito: "no en base al filtro de ventas general de la app"). @avDesde/@avHasta son
-- parametros APARTE de @fechaDesde/@fechaHasta -- el backend los default a todo el historico
-- (ver /api/tablero/articulo) salvo que el usuario elija un mes/año puntual con el selector nuevo
-- del frontend. #VentasRango/#AceptacionesRango de arriba NO se tocan -- las sigue usando el
-- popover de detalle de SKU con su propio "Periodo de ventas" elegido arriba de la pantalla.
SELECT ESTAB AS Sucursal, ARTCEGID AS CodArticulo, COLOR, TALLE,
       SUM(CASE WHEN ISNUMERIC(CANTIDAD)=1 THEN CAST(CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS VentasHistorico
INTO #VentasHistorico
FROM Vta_detalle
WHERE ESTAB IS NOT NULL AND ARTCEGID = @modelo AND FECHA >= @avDesde AND FECHA <= @avHasta
GROUP BY ESTAB, ARTCEGID, COLOR, TALLE;

-- estab IN ('000098','000099'): ver el comentario completo junto a #AceptacionesRango, mas arriba.
SELECT destino AS Sucursal, arprove AS CodArticulo, color AS COLOR, talle AS TALLE,
       SUM(CASE WHEN ISNUMERIC(cantidad)=1 THEN CAST(cantidad AS DECIMAL(18,4)) ELSE 0 END) AS AceptacionesHistorico
INTO #AceptacionesHistorico
FROM dis_transf_recibidas
WHERE destino IS NOT NULL AND arprove = @modelo AND estab IN ('000098','000099') AND fecha >= @avDesde AND fecha <= @avHasta
GROUP BY destino, arprove, color, talle;

-- Fecha real del PRIMER movimiento (venta o aceptacion) de este articulo -- SIN filtro de rango
-- (es la fecha mas vieja que exista, no la del periodo elegido) -- para que el selector de
-- Aceptaciones/Venta del frontend arranque la linea de tiempo en la fecha real de este articulo
-- puntual en vez de una fecha fija igual para todos (2026-08-29, a pedido explicito).
SELECT ESTAB AS Sucursal, ARTCEGID AS CodArticulo, COLOR, TALLE, MIN(FECHA) AS PrimeraVenta
INTO #PrimeraVenta
FROM Vta_detalle
WHERE ESTAB IS NOT NULL AND ARTCEGID = @modelo
GROUP BY ESTAB, ARTCEGID, COLOR, TALLE;

-- estab IN ('000098','000099'): ver el comentario completo junto a #AceptacionesRango, mas arriba.
SELECT destino AS Sucursal, arprove AS CodArticulo, color AS COLOR, talle AS TALLE, MIN(fecha) AS PrimeraAceptacion
INTO #PrimeraAceptacion
FROM dis_transf_recibidas
WHERE destino IS NOT NULL AND arprove = @modelo AND estab IN ('000098','000099')
GROUP BY destino, arprove, color, talle;

-- Fecha y cantidad de la ULTIMA aceptacion (transferencia recibida) de cada Sucursal+talle, para
-- la ficha de SKU (openDetalle) -- a pedido explicito (2026-09-01). Cantidad = suma de todo lo
-- aceptado en esa fecha (puede haber mas de una transferencia el mismo dia), no una fila
-- arbitraria -- por eso primero se saca la fecha maxima y despues se suma sobre esa fecha, en vez
-- de un solo ROW_NUMBER() que se quedaria con una sola fila si hubiera mas de una ese dia.
-- estab IN ('000098','000099'): ver el comentario completo junto a #AceptacionesRango, mas arriba.
SELECT destino AS Sucursal, arprove AS CodArticulo, color AS COLOR, talle AS TALLE, MAX(fecha) AS FechaUltimaAceptacion
INTO #UltimaAceptacionFecha
FROM dis_transf_recibidas
WHERE destino IS NOT NULL AND arprove = @modelo AND estab IN ('000098','000099')
GROUP BY destino, arprove, color, talle;

SELECT f.Sucursal, f.CodArticulo, f.COLOR, f.TALLE, f.FechaUltimaAceptacion,
       SUM(CASE WHEN ISNUMERIC(d.cantidad)=1 THEN CAST(d.cantidad AS DECIMAL(18,4)) ELSE 0 END) AS CantidadUltimaAceptacion
INTO #UltimaAceptacion
FROM #UltimaAceptacionFecha f
INNER JOIN dis_transf_recibidas d ON d.destino=f.Sucursal AND d.arprove=f.CodArticulo AND d.color=f.COLOR AND d.talle=f.TALLE AND d.fecha=f.FechaUltimaAceptacion AND d.estab IN ('000098','000099')
GROUP BY f.Sucursal, f.CodArticulo, f.COLOR, f.TALLE, f.FechaUltimaAceptacion;

DROP TABLE #UltimaAceptacionFecha;

-- "Estuvo en promo" durante el Periodo de ventas elegido (ver el comentario completo junto a
-- #PromoRango en QUERY_QUIEBRE_DETALLE, mas arriba en este archivo) -- acotado a @modelo, mismo
-- criterio que el resto de las subconsultas de esta query.
SELECT vd.ESTAB AS Sucursal, vd.ARTCEGID AS CodArticulo, vd.COLOR, vd.TALLE,
       COUNT(*) AS CantidadVentasPromo,
       MAX(c.NOMBRE_COND) AS NombrePromo,
       MAX(c.DESCUENTO) AS DescuentoPromo
INTO #PromoRango
FROM Vta_detalle vd
INNER JOIN CGD_CONDCOM_VTA_DET c
  ON c.ESTAB = vd.ESTAB AND c.NUMERO = vd.NUMERO AND c.FECHA = vd.FECHA AND c.CODBARRA_prin = vd.CODBARRA_prin
  -- PVP_REBAJADO < PRECIOLLENO y exclusion de "MES DE TU CUMPLEAÑOS": ver el comentario completo
  -- junto a #PromoRango en QUERY_QUIEBRE_DETALLE, mas arriba en este archivo.
  AND c.PVP_REBAJADO < c.PRECIOLLENO
  AND c.NOMBRE_COND NOT LIKE '%MES DE TU CUMPLEA%'
WHERE vd.ARTCEGID = @modelo AND vd.ESTAB IS NOT NULL AND vd.FECHA >= @fechaDesde AND vd.FECHA <= @fechaHasta
GROUP BY vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE;

SELECT dc.Sucursal, dc.CodArticulo, dc.COLOR, dc.TALLE,
       SUM(dc.DiasConStockContribucion) AS DiasConStockEstimado,
       SUM(dc.DiasQuiebreContribucion) AS DiasQuiebreEstimado
INTO #DiasConStockRango
FROM dbo.MotorReposicion_DiasConStockPorSemana dc
INNER JOIN #Universo u ON u.Sucursal=dc.Sucursal AND u.CodArticulo=dc.CodArticulo AND u.COLOR=dc.COLOR AND u.TALLE=dc.TALLE
WHERE dc.CodArticulo = @modelo AND dc.FechaSemana >= @fechaDesde AND dc.FechaSemana <= @fechaHasta
GROUP BY dc.Sucursal, dc.CodArticulo, dc.COLOR, dc.TALLE;

-- Ajuste "evidencia historica" (ver el comentario completo junto a la Etapa 6/precalculo en
-- QUERY_QUIEBRE_DETALLE, mas arriba en este archivo): sale de dbo.MotorReposicion_EvidenciaHistorica
-- (precalculada de noche), no de un calculo en vivo -- un solo LEFT JOIN en el SELECT final,
-- ver mas abajo.

SELECT
    u.Sucursal, s.nomSucursal AS NomSucursal, UPPER(s.Empresa) AS Empresa,
    u.CodArticulo, u.COLOR, u.TALLE,
    -- Mismo criterio que QUERY_QUIEBRE_DETALLE: color COMPLETO en el Sku, no solo 2 letras (evita
    -- la colision entre colores que arrancan igual, ej. "BLANCO" / "BLANCO-BLANCO OFF-DORADO").
    ISNULL(u.CodArticulo,'') + '-' + UPPER(ISNULL(u.COLOR,'')) + '-' + ISNULL(u.TALLE,'') AS Sku,
    cv.NOMBREART, cv.NOMPROV, cv.NOMLINEA, cv.NOMFLIA,
    -- Temporada/Material para la ficha del articulo (2026-08-20) -- vienen de cgd_ARTICULOS, no
    -- de MotorReposicion_CatalogoValido (esa tabla precalculada no los tiene). Se dedupean con
    -- MAX() ANTES del LEFT JOIN (ver catm mas abajo) para no arriesgar multiplicar filas si
    -- cgd_ARTICULOS tuviera mas de una fila para el mismo CodArticulo+COLOR+TALLE.
    -- Iva (2026-08-31, a pedido explicito, para "Margen %"): mismo origen/mismo criterio de
    -- dedupe que Temporada/Material -- confirmado con datos reales que solo toma 2 valores (21 o
    -- 10.5), nunca NULL en articulos reales del catalogo.
    -- Genero/Marca (2026-08-31, a pedido explicito, para el filtro "Solo mis lineas" por
    -- comprador): ver el comentario completo junto a este mismo campo en QUERY_QUIEBRE_DETALLE.
    catm.Temporada, catm.Material, catm.Seccion, catm.Iva, catm.Genero, catm.Marca,
    -- Período de tarifa VIGENTE del artículo (2026-08-28, a pedido explicito -- "en pertarifa, el
    -- periodo actual") -- MAX() la deja consistente con Temporada/Material (mismo dedupe, mismo
    -- subquery catm), no es un rango de fechas: PERTARIFA en cgd_ARTICULOS es una etiqueta de
    -- lista de precios (ej. "PERMAN - PERIODO PERMANENTE", "LIQUI - LIQUIDACION").
    catm.PeriodoTarifa,
    ISNULL(cv.PVP_VIGENTE,0) AS Pvp, ISNULL(cv.COSTO_UNI,0) AS Costo,
    ISNULL(u.StockTienda, 0) AS StockTienda,
    ur.FechaUltimaCompra,
    ISNULL(dh.DepositoTESI,0) + ISNULL(dh.DepositoPUEBLO,0) AS StockDeposito,
    ISNULL(dh.DepositoTESI,0) AS DepositoTESI,
    ISNULL(dh.DepositoPUEBLO,0) AS DepositoPUEBLO,
    ISNULL(p.PendienteTESI,0) + ISNULL(p.PendientePUEBLO,0) AS PendienteOC,
    ISNULL(p.PendienteTESI,0) AS PendienteTESI,
    ISNULL(p.PendientePUEBLO,0) AS PendientePUEBLO,
    -- Transito en camino a esta sucursal (ver #TransitoRango arriba) -- 2026-09-05, a pedido explicito.
    ISNULL(tr.TransitoPendiente,0) AS TransitoPendiente,
    ISNULL(v.VentasRango, 0) AS VentasRango,
    ISNULL(v.DiasConVenta, 0) AS DiasConVenta,
    v.UltimaVenta,
    -- Aceptaciones de transferencia recibidas en esta sucursal, mismo periodo elegido (ver
    -- #AceptacionesRango arriba) -- para la ventana de stock/a comprar de UN articulo puntual.
    ISNULL(ac.AceptacionesRango, 0) AS AceptacionesRango,
    -- Historico "de siempre" (ver #VentasHistorico/#AceptacionesHistorico arriba) -- lo que
    -- realmente pintan la ventana de stock y la de a comprar para Aceptaciones/Venta, aparte del
    -- "Periodo de ventas" global.
    ISNULL(vh.VentasHistorico, 0) AS VentasHistorico,
    ISNULL(ah.AceptacionesHistorico, 0) AS AceptacionesHistorico,
    -- Fecha real del primer movimiento (ver #PrimeraVenta/#PrimeraAceptacion arriba) -- el
    -- frontend calcula el mínimo entre las dos (y entre sucursales/talles del mismo color) para
    -- saber desde dónde arrancar la línea de tiempo de Aceptaciones/Venta de este color puntual.
    pv.PrimeraVenta,
    pa.PrimeraAceptacion,
    -- Fecha y cantidad de la ULTIMA aceptacion (ver #UltimaAceptacion arriba) -- para la ficha de
    -- SKU (openDetalle), a pedido explicito (2026-09-01).
    ua.FechaUltimaAceptacion,
    ISNULL(ua.CantidadUltimaAceptacion, 0) AS CantidadUltimaAceptacion,
    -- "Estuvo en promo" (ver #PromoRango arriba) -- 2026-09-02, a pedido explicito.
    ISNULL(pr.CantidadVentasPromo, 0) AS CantidadVentasPromo,
    pr.NombrePromo,
    pr.DescuentoPromo,
    ISNULL(dcs.DiasConStockEstimado,0) AS DiasConStockEstimado,
    dcs.DiasQuiebreEstimado,
    -- Mismo criterio que QUERY_QUIEBRE_DETALLE: velocidad = ventas reales del periodo ÷ dias con
    -- stock reales del periodo, siempre, sin respaldo de "venta esporadica" (sacado a pedido
    -- explicito el 2026-08-18 -- ver el comentario largo en QUERY_QUIEBRE_DETALLE). Piso de 7 dias
    -- aplicado tambien cuando DiasConStockEstimado es NULL pero hubo venta real (ver el comentario
    -- completo junto al mismo CASE en QUERY_QUIEBRE_DETALLE, mas arriba en este archivo) -- 2026-09-04.
    -- Vd: historial completo si dispara "evidencia historica" -- ver el comentario completo junto
    -- a la Etapa 6/precalculo en QUERY_QUIEBRE_DETALLE, mas arriba en este archivo.
    CASE WHEN ueh.UsaEvidenciaHistorica = 1
         THEN eh.VentasHistoricoTotal / CAST(eh.DiasConStockHistorico AS DECIMAL(18,4))
         ELSE ISNULL(v.VentasRango,0) / CAST(
           CASE WHEN dcs.DiasConStockEstimado IS NULL AND ISNULL(v.VentasRango,0) = 0 THEN NULL
                WHEN dcs.DiasConStockEstimado IS NULL THEN 7
                WHEN dcs.DiasConStockEstimado < 7 THEN 7
                ELSE dcs.DiasConStockEstimado END
         AS DECIMAL(18,4))
    END AS VdRaw,
    0 AS UsoVelocidadAmplia,
    ueh.UsaEvidenciaHistorica AS UsoEvidenciaHistorica,
    ISNULL(v.VentasRango,0) AS VentasVd,
    CASE WHEN dcs.DiasConStockEstimado IS NULL AND ISNULL(v.VentasRango,0) = 0 THEN NULL
         WHEN dcs.DiasConStockEstimado IS NULL THEN 7
         WHEN dcs.DiasConStockEstimado < 7 THEN 7
         ELSE dcs.DiasConStockEstimado END AS DiasStockVd,
    -- Dias con stock SIN el piso de 7 -- para el "escenario real" del desglose de velocidad en el
    -- frontend (comparar contra DiasStockVd, que si tiene el piso aplicado). Misma preservacion de
    -- NULL que DiasStockVd (sin evidencia real no es lo mismo que 0 dias).
    dcs.DiasConStockEstimado AS DiasStockVdReal,
    -- VentasVdMostrado/DiasStockVdMostrado: ver el comentario completo junto a las mismas columnas
    -- en QUERY_QUIEBRE_DETALLE, mas arriba en este archivo.
    CASE WHEN ueh.UsaEvidenciaHistorica = 1 THEN eh.VentasHistoricoTotal ELSE ISNULL(v.VentasRango,0) END AS VentasVdMostrado,
    CASE WHEN ueh.UsaEvidenciaHistorica = 1 THEN eh.DiasConStockHistorico
         WHEN dcs.DiasConStockEstimado IS NULL AND ISNULL(v.VentasRango,0) = 0 THEN NULL
         WHEN dcs.DiasConStockEstimado IS NULL THEN 7
         WHEN dcs.DiasConStockEstimado < 7 THEN 7
         ELSE dcs.DiasConStockEstimado END AS DiasStockVdMostrado,
    -- Alerta "sin evidencia real de stock" (2026-09-13, a pedido explicito, caso real
    -- DINK-6128/NEGRO/Calzados 02): viene precalculada de noche (Etapa 6, ver el comentario
    -- completo en el SP) -- marca combos que nunca tuvieron una foto de stock >0 NI una aceptacion
    -- real de deposito, en toda su vida. El frontend decide cuando mostrarla (solo si ademas hay
    -- algo real para comprar en esta fila) -- aca solo se expone el dato crudo.
    ISNULL(eh.SinEvidenciaRealStock, 0) AS SinEvidenciaRealStock
INTO #Resultado
FROM #Universo u
INNER JOIN Sucursales s ON s.Sucursal = u.Sucursal
INNER JOIN dbo.MotorReposicion_CatalogoValido cv ON cv.CodArticulo = u.CodArticulo AND cv.COLOR = u.COLOR AND cv.TALLE = u.TALLE
LEFT JOIN (
  SELECT GA_CODEARTICLE AS CodArticulo, COLOR, TALLE, MAX(TEMPORADA) AS Temporada, MAX(MATERIAL) AS Material, MAX(NOMSECCION) AS Seccion, MAX(PERTARIFA) AS PeriodoTarifa, MAX(IVA) AS Iva, MAX(NOMGENERO) AS Genero, MAX(NOMMARCA) AS Marca
  FROM cgd_ARTICULOS
  GROUP BY GA_CODEARTICLE, COLOR, TALLE
) catm ON catm.CodArticulo = u.CodArticulo AND catm.COLOR = u.COLOR AND catm.TALLE = u.TALLE
LEFT JOIN dbo.MotorReposicion_DepositoHoy dh ON dh.CodArticulo = u.CodArticulo AND dh.COLOR = u.COLOR AND dh.TALLE = u.TALLE
LEFT JOIN #PendientesOC p ON p.CodArticulo = u.CodArticulo AND p.COLOR = u.COLOR AND p.TALLE = u.TALLE
LEFT JOIN #TransitoRango tr ON tr.Sucursal = u.Sucursal AND tr.CodArticulo = u.CodArticulo AND tr.COLOR = u.COLOR AND tr.TALLE = u.TALLE
LEFT JOIN #VentasRango v ON v.Sucursal = u.Sucursal AND v.CodArticulo = u.CodArticulo AND v.COLOR = u.COLOR AND v.TALLE = u.TALLE
LEFT JOIN #AceptacionesRango ac ON ac.Sucursal = u.Sucursal AND ac.CodArticulo = u.CodArticulo AND ac.COLOR = u.COLOR AND ac.TALLE = u.TALLE
LEFT JOIN #VentasHistorico vh ON vh.Sucursal = u.Sucursal AND vh.CodArticulo = u.CodArticulo AND vh.COLOR = u.COLOR AND vh.TALLE = u.TALLE
LEFT JOIN #AceptacionesHistorico ah ON ah.Sucursal = u.Sucursal AND ah.CodArticulo = u.CodArticulo AND ah.COLOR = u.COLOR AND ah.TALLE = u.TALLE
LEFT JOIN #PrimeraVenta pv ON pv.Sucursal = u.Sucursal AND pv.CodArticulo = u.CodArticulo AND pv.COLOR = u.COLOR AND pv.TALLE = u.TALLE
LEFT JOIN #PrimeraAceptacion pa ON pa.Sucursal = u.Sucursal AND pa.CodArticulo = u.CodArticulo AND pa.COLOR = u.COLOR AND pa.TALLE = u.TALLE
LEFT JOIN #UltimaAceptacion ua ON ua.Sucursal = u.Sucursal AND ua.CodArticulo = u.CodArticulo AND ua.COLOR = u.COLOR AND ua.TALLE = u.TALLE
LEFT JOIN #PromoRango pr ON pr.Sucursal = u.Sucursal AND pr.CodArticulo = u.CodArticulo AND pr.COLOR = u.COLOR AND pr.TALLE = u.TALLE
LEFT JOIN #DiasConStockRango dcs ON dcs.Sucursal = u.Sucursal AND dcs.CodArticulo = u.CodArticulo AND dcs.COLOR = u.COLOR AND dcs.TALLE = u.TALLE
LEFT JOIN dbo.MotorReposicion_UltimaRecepcion ur ON ur.Sucursal = u.Sucursal AND ur.CodArticulo = u.CodArticulo AND ur.COLOR = u.COLOR AND ur.TALLE = u.TALLE
-- Evidencia historica: ver el comentario completo junto al mismo bloque CROSS APPLY en
-- QUERY_QUIEBRE_DETALLE, mas arriba en este archivo.
LEFT JOIN dbo.MotorReposicion_EvidenciaHistorica eh ON eh.Sucursal = u.Sucursal AND eh.CodArticulo = u.CodArticulo AND eh.COLOR = u.COLOR AND eh.TALLE = u.TALLE
CROSS APPLY (
  SELECT CASE WHEN eh.PrimeraAceptacionDeposito IS NULL THEN eh.PrimeraStockSemana
              WHEN eh.PrimeraStockSemana IS NULL THEN eh.PrimeraAceptacionDeposito
              WHEN eh.PrimeraAceptacionDeposito < eh.PrimeraStockSemana THEN eh.PrimeraAceptacionDeposito
              ELSE eh.PrimeraStockSemana END AS PrimeraEvidencia
) pe
CROSS APPLY (
  SELECT CASE WHEN pe.PrimeraEvidencia IS NOT NULL AND pe.PrimeraEvidencia < @fechaDesde
                AND ISNULL(v.VentasRango,0) > 0
                AND (dcs.DiasConStockEstimado IS NULL OR dcs.DiasConStockEstimado < 7)
                AND ISNULL(eh.DiasConStockHistorico,0) > 0
              THEN 1 ELSE 0 END AS UsaEvidenciaHistorica
) ueh;
-- SIN el filtro de "Fecha de ultima compra" que si tiene QUERY_QUIEBRE_DETALLE: esta consulta es
-- especificamente para ver el estado REAL completo de un articulo puntual (a eso se abrio el
-- detalle) -- acotarla ademas por ese filtro volveria a hacer desaparecer filas reales (con stock
-- 0 real, no falta de dato) si la ventana elegida no cubre su ultima recepcion. La Etapa 3 nueva
-- de #Universo (ver arriba, MotorReposicion_UltimaRecepcion) ya se encarga de traer esas filas.

;WITH Calc AS (
    SELECT *,
        ISNULL(VdRaw, 0) AS Vd,
        (Pvp - Costo) AS MargenU,
        CASE WHEN ISNULL(VdRaw,0) > 0 THEN ROUND(StockTienda / VdRaw, 0) ELSE 999 END AS Cob,
        CASE WHEN ISNULL(VdRaw,0) > 0 THEN ROUND((StockTienda + StockDeposito) / VdRaw, 0) ELSE 999 END AS CobConDeposito,
        CASE WHEN ISNULL(VdRaw,0) > 0 THEN StockTienda / VdRaw ELSE 999 END AS CobExacto,
        CASE WHEN ISNULL(VdRaw,0) > 0 THEN (StockTienda + StockDeposito) / VdRaw ELSE 999 END AS CobConDepositoExacto
    FROM #Resultado
),
Estado AS (
    SELECT *,
        CASE
          WHEN StockTienda = 0 AND StockDeposito > 0 AND CobConDepositoExacto < @riesgoDias THEN 'RIESGO'
          WHEN StockTienda = 0 AND StockDeposito > 0 THEN 'OK'
          WHEN StockTienda = 0 THEN 'QUIEBRE'
          WHEN CobExacto < @riesgoDias THEN 'RIESGO'
          ELSE 'OK'
        END AS Estado
    FROM Calc
)
SELECT *, CASE WHEN Estado <> 'OK' THEN Vd * MargenU ELSE 0 END AS Impacto
INTO #EstadoFinal
FROM Estado;

-- SIN "WHERE Estado <> 'OK'": esta consulta es especificamente para traer TODOS los estados de UN
-- articulo, no para la lista general.
SELECT * FROM #EstadoFinal;

DROP TABLE #Universo;
DROP TABLE #PendientesOC;
DROP TABLE #TransitoRango;
DROP TABLE #VentasRango;
DROP TABLE #AceptacionesRango;
DROP TABLE #VentasHistorico;
DROP TABLE #AceptacionesHistorico;
DROP TABLE #PrimeraVenta;
DROP TABLE #PrimeraAceptacion;
DROP TABLE #UltimaAceptacion;
DROP TABLE #PromoRango;
DROP TABLE #DiasConStockRango;
DROP TABLE #Resultado;
DROP TABLE #EstadoFinal;
`;

// "Compras y ventas por empresa y mes" (2026-09-13, a pedido explicito), para el resumen +
// popover de la ventana Stock/A comprar de UN articulo+color puntual. Query APARTE de
// QUERY_ARTICULO_COMPLETO (no metida ahi adentro): probado primero integrada, y el JOIN de
// #VentasPorMes contra Vta_detalle agregaba ~2.8s a CADA apertura de la ventana en articulos con
// mucho volumen de ventas (medido con datos reales: 7.8s -> 10.6s en un articulo con 472.000 filas
// en Vta_detalle) -- carisimo para pagarlo siempre, cuando la mayoria de las veces nadie va a abrir
// el detalle de compras/ventas. Como query propia, el frontend la pide aparte y en el momento
// (cargarComprasVentas), sin frenar la apertura normal del articulo.
// Mismo rango @avDesde/@avHasta que "Aceptaciones/Venta" de esa ventana (avRango en el frontend --
// por defecto todo el historico), y ahora tambien acotada por @color (esta query es por UN
// articulo+color, no por todos los colores del articulo como QUERY_ARTICULO_COMPLETO).
const QUERY_COMPRAS_VENTAS_POR_MES = `
-- Compras: dis_recepciones es la recepcion real de mercaderia comprada al proveedor en el deposito
-- de la empresa (misma fuente que dbo.MotorReposicion_UltimaRecepcion -- ver el comentario
-- completo junto a la Etapa 5 del SP de precalculo). Se agrupa por nomemp normalizado, NO por el
-- campo "deposito": esa misma Etapa 5 confirmo que el deposito tiene alias (96/198, ademas de
-- 98/99) para el mismo par Tesi/Pueblo, asi que filtrar por deposito dejaria compras afuera. La
-- clave de catalogo es "articulo" (no "artprove", que en esta tabla es el codigo del proveedor) --
-- mismo motivo documentado en esa Etapa 5. cantidad ya es numerico (float) en esta tabla, a
-- diferencia de Vta_detalle/dis_transf_recibidas (varchar) -- no hace falta ISNUMERIC.
SELECT UPPER(LTRIM(RTRIM(nomemp))) AS Empresa,
       CAST(YEAR(fecha) AS varchar(4)) + '-' + RIGHT('0' + CAST(MONTH(fecha) AS varchar(2)), 2) AS Mes,
       SUM(cantidad) AS Unidades
FROM dis_recepciones
WHERE articulo = @modelo AND color = @color AND fecha >= @avDesde AND fecha <= @avHasta
GROUP BY UPPER(LTRIM(RTRIM(nomemp))), CAST(YEAR(fecha) AS varchar(4)) + '-' + RIGHT('0' + CAST(MONTH(fecha) AS varchar(2)), 2)
ORDER BY Mes, Empresa;

-- Ventas: mismo criterio que #VentasHistorico (QUERY_ARTICULO_COMPLETO), agrupado por empresa (via
-- Sucursales) y mes en vez de por sucursal/talle -- una fila cuyo ESTAB no matchee ningun
-- Sucursales.Sucursal (caso raro) queda afuera de este desglose puntual.
SELECT UPPER(LTRIM(RTRIM(s.Empresa))) AS Empresa,
       CAST(YEAR(vd.FECHA) AS varchar(4)) + '-' + RIGHT('0' + CAST(MONTH(vd.FECHA) AS varchar(2)), 2) AS Mes,
       SUM(CASE WHEN ISNUMERIC(vd.CANTIDAD)=1 THEN CAST(vd.CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS Unidades
FROM Vta_detalle vd
INNER JOIN Sucursales s ON s.Sucursal = vd.ESTAB
WHERE vd.ESTAB IS NOT NULL AND vd.ARTCEGID = @modelo AND vd.COLOR = @color AND vd.FECHA >= @avDesde AND vd.FECHA <= @avHasta
GROUP BY UPPER(LTRIM(RTRIM(s.Empresa))), CAST(YEAR(vd.FECHA) AS varchar(4)) + '-' + RIGHT('0' + CAST(MONTH(vd.FECHA) AS varchar(2)), 2)
ORDER BY Mes, Empresa;
`;

function parseFechaQuery(v, fallback) {
  if (!v) return fallback;
  const d = new Date(v + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? fallback : d;
}

// 62K filas como array de objetos pesa ~37MB en JSON, sobre todo por repetir los nombres de
// campo en cada fila y por repetir texto (nombre/prov/linea/familia) una vez por sucursal
// donde el mismo SKU esta roto. Se separa en:
//  - catalogo: texto descriptivo por SKU, UNA sola vez (deduplicado).
//  - detalle: filas posicionales (array, no objeto) solo con los datos que varian por sucursal.
// El HTML reconstruye los objetos {sku,modelo,...} al vuelo con DETALLE_COLUMNAS. Compartido entre
// /api/tablero/quiebre y /api/tablero/articulo -- mismo shape de respuesta para poder reusar
// itemDesdeFilaReal() tal cual del lado del frontend.
const DETALLE_COLUMNAS = [
  'sku', 'suc', 'empresa', 'vd', 'stock', 'stockDeposito', 'depositoTESI', 'depositoPUEBLO',
  'pendienteOC', 'pendienteTESI', 'pendientePUEBLO',
  // Transferencia en transito hacia ESTA sucursal (dis_transf_emitidas.cantpend, vigente <= 30 dias
  // -- ver TRANSITO_VIGENCIA_DIAS) -- 2026-09-05, a pedido explicito. A diferencia de pendienteOC
  // (por empresa, informativo, no se resta), esto es POR SUCURSAL y SI se resta directo del GAP en
  // calcularNecesidadPorBarra (frontend) -- viene de las DOS consultas.
  'transitoPendiente',
  'cob', 'estado', 'impacto', 'diasConVenta', 'udsVendidasPeriodo', 'diasQuiebrePeriodo',
  // Fecha de la ULTIMA venta dentro del "Periodo de ventas" elegido (2026-09-04, a pedido explicito,
  // para la ficha de SKU) -- viene de #VentasRango (MAX(FECHA)) en las DOS consultas, igual que
  // diasConVenta/udsVendidasPeriodo. null si no hubo ninguna venta en el periodo.
  'ultimaVenta', 'fechaUltimaCompra',
  // Para el desglose "de donde sale la velocidad de venta" en el frontend (ver abrirDesgloseSugerido):
  // el numerador/denominador REALES usados (ya con el piso de 7 dias aplicado si corresponde), y si
  // se uso el respaldo de velocidad amplia (vendedor esporadico) en vez del periodo elegido.
  'ventasVd', 'diasStockVd', 'usoVelocidadAmplia', 'diasStockVdReal',
  // Ajuste "evidencia historica" (2026-09-11): 1 si esta fila reemplazo la Vd del periodo elegido
  // por la de todo el historial (articulo viejo con evidencia esporadica dentro del periodo) -- ver
  // el comentario completo junto a la Etapa 6/precalculo en QUERY_QUIEBRE_DETALLE. El frontend lo
  // usa en AJUSTES_FORMULA para armar el bloque "Conservador/Real" del popover de necesidad de compra,
  // igual que ya hace con el piso de 7 dias.
  'usoEvidenciaHistorica',
  // Numerador/denominador que hay que MOSTRAR junto a la Vd de arriba (ver el comentario completo
  // junto a VentasVdMostrado/DiasStockVdMostrado en QUERY_QUIEBRE_DETALLE) -- iguales a
  // ventasVd/diasStockVd salvo cuando usoEvidenciaHistorica=1, ahi son los totales del historial
  // completo (los mismos que arman la Vd de esta fila).
  'ventasVdMostrado', 'diasStockVdMostrado',
  // Alerta "sin evidencia real de stock" (2026-09-13): 1 si este combo nunca tuvo una foto de
  // stock >0 (FotoStock) ni una aceptacion real de deposito, en toda su vida -- ver el comentario
  // completo junto a SinEvidenciaRealStock en QUERY_QUIEBRE_DETALLE. El frontend solo la muestra
  // cuando ademas la fila tiene algo real para comprar (comprar>0), no en cualquier fila.
  'sinEvidenciaRealStock',
  // Aceptaciones de transferencia recibidas en la sucursal en el periodo elegido (2026-08-24) --
  // SOLO viene poblado desde QUERY_ARTICULO_COMPLETO (ventana de stock/a comprar de UN articulo);
  // en /api/tablero/quiebre (lista general) esta columna no se calcula y llega undefined -- el
  // frontend ya sabe tratar eso como 0 donde la usa.
  'aceptacionesPeriodo',
  // Venta/Aceptaciones "de siempre" (2026-08-28) -- todo el historico por defecto, o el mes/año
  // puntual que el usuario haya elegido con el selector nuevo, SIEMPRE independiente del "Periodo
  // de ventas" global (a diferencia de udsVendidasPeriodo/aceptacionesPeriodo de arriba, que sí
  // siguen ese filtro). Mismo alcance que aceptacionesPeriodo: solo QUERY_ARTICULO_COMPLETO.
  'ventasHistorico', 'aceptacionesHistorico',
  // Fecha real del primer movimiento (venta o aceptación) de este SKU puntual (2026-08-29) -- el
  // frontend saca el mínimo entre las dos y entre todas las filas del mismo color para saber
  // desde dónde arranca la línea de tiempo del selector de Aceptaciones/Venta. Mismo alcance que
  // aceptacionesPeriodo: solo QUERY_ARTICULO_COMPLETO, null si nunca hubo ese movimiento.
  'primeraVenta', 'primeraAceptacion',
  // Fecha y cantidad de la ULTIMA aceptacion (2026-09-01, a pedido explicito, para la ficha de
  // SKU) -- mismo alcance que primeraVenta/primeraAceptacion: solo QUERY_ARTICULO_COMPLETO, null
  // si esa sucursal+talle nunca acepto una transferencia de este articulo.
  'fechaUltimaAceptacion', 'cantidadUltimaAceptacion',
  // "Estuvo en promo" durante el Período de ventas elegido (2026-09-02, a pedido explícito) --
  // a diferencia de los campos de arriba, ESTE viene de las DOS consultas (QUERY_QUIEBRE_DETALLE
  // Y QUERY_ARTICULO_COMPLETO) -- lo necesita también "Ver en detalle"/Atención Prioritaria, que
  // se alimentan de ALL (QUERY_QUIEBRE_DETALLE), no solo la ventana de artículo. cantidadVentasPromo
  // en 0 = no estuvo en promo en el período; si es mayor a 0, nombrePromo/descuentoPromo traen un
  // ejemplo (puede haber habido más de una promoción distinta, se guarda una sola de referencia).
  'cantidadVentasPromo', 'nombrePromo', 'descuentoPromo',
];
function construirCatalogoYDetalle(detalleRows) {
  const catalogo = {};
  const detalle = detalleRows.map((r) => {
    if (!catalogo[r.Sku]) {
      catalogo[r.Sku] = {
        modelo: r.CodArticulo,
        // Cadena de respaldo: nunca debe quedar en null/undefined -- el frontend hace
        // nombre.replace(...) sin verificar null, y un articulo sin catalogar (real, existe
        // en produccion) rompia el render entero de varias solapas.
        nombre: r.NOMBREART || r.Sku || r.CodArticulo || 'Artículo sin catalogar',
        prov: r.NOMPROV || '',
        linea: r.NOMLINEA || 'Otros',
        familia: r.NOMFLIA || 'Otros',
        // Filtro "Sección" (2026-08-20), pedido junto con Familia/Línea/Proveedor en todas las
        // pantallas que listan artículos -- viene de cgd_ARTICULOS via el mismo JOIN que ya
        // trae Temporada/Material (ver catm arriba), no de MotorReposicion_CatalogoValido.
        seccion: r.Seccion || 'Otros',
        color: r.COLOR || '—',
        talle: r.TALLE || 'U',
        pvp: r.Pvp,
        costo: r.Costo,
        margenU: r.MargenU,
        // % de IVA del artículo (2026-08-31, a pedido explícito, para "Margen %") -- mismo origen/
        // mismo respaldo que temporada/material (cgd_ARTICULOS via catm, sin dato real conocido
        // que venga NULL, pero por las dudas no se fuerza un valor por defecto -- el frontend no
        // calcula Margen % si iva es null, en vez de mostrar un % incorrecto).
        iva: r.Iva ?? null,
        // Genero/Marca (2026-08-31, para el filtro "Solo mis líneas" por comprador) -- cruzan
        // contra dbo.TBL_COMPRADOR_LINEA_MARCA (ver /api/comprador-lineas). null si cgd_ARTICULOS
        // no tiene el dato -- ese combo queda "sin línea de comprador" (huérfano), visible para
        // todos con el filtro activo, igual que cualquier otro combo que no matchee a nadie.
        genero: r.Genero || null,
        marca: r.Marca || null,
        // Ficha del articulo (2026-08-20): sin respaldo forzado -- si cgd_ARTICULOS no tiene el
        // dato (ej. MATERIAL suele venir NULL), el frontend ya sabe mostrar "—" para campos vacios.
        temporada: r.Temporada || null,
        material: r.Material || null,
        // Período de tarifa vigente (2026-08-28) -- ver comentario junto a catm.PeriodoTarifa en
        // QUERY_ARTICULO_COMPLETO. Solo viene poblado desde esa consulta (undefined en
        // /api/tablero/quiebre, igual que temporada/material).
        periodoTarifa: r.PeriodoTarifa || null,
      };
    }
    return [
      r.Sku, r.NomSucursal, r.Empresa, r.Vd, r.StockTienda, r.StockDeposito, r.DepositoTESI, r.DepositoPUEBLO,
      r.PendienteOC, r.PendienteTESI, r.PendientePUEBLO,
      r.TransitoPendiente,
      r.Cob, r.Estado, r.Impacto, r.DiasConVenta, r.VentasRango, r.DiasQuiebreEstimado,
      r.UltimaVenta ? r.UltimaVenta.toISOString().slice(0, 10) : null,
      r.FechaUltimaCompra ? r.FechaUltimaCompra.toISOString().slice(0, 10) : null,
      r.VentasVd, r.DiasStockVd, r.UsoVelocidadAmplia, r.DiasStockVdReal, r.UsoEvidenciaHistorica,
      r.VentasVdMostrado, r.DiasStockVdMostrado, r.SinEvidenciaRealStock,
      r.AceptacionesRango, r.VentasHistorico, r.AceptacionesHistorico,
      r.PrimeraVenta ? r.PrimeraVenta.toISOString().slice(0, 10) : null,
      r.PrimeraAceptacion ? r.PrimeraAceptacion.toISOString().slice(0, 10) : null,
      r.FechaUltimaAceptacion ? r.FechaUltimaAceptacion.toISOString().slice(0, 10) : null,
      r.CantidadUltimaAceptacion,
      r.CantidadVentasPromo, r.NombrePromo || null, r.DescuentoPromo || null,
    ];
  });
  return { catalogo, detalle };
}

// Version para /api/tablero/quiebre (2026-08-28, a pedido explicito: "por que tarda tanto al
// entrar") -- ver el comentario completo junto al recordset de detalle en QUERY_QUIEBRE_DETALLE.
// SQL ya manda el catalogo deduplicado por Sku (DISTINCT) y el detalle SIN esas columnas de
// catalogo repetidas -- construirCatalogoYDetalle (arriba) NO se toca, la sigue usando
// /api/tablero/articulo tal cual (esa consulta no tiene este problema: un solo articulo, pocas
// filas). Mismo shape de "catalogo"/"detalle" que ya esperaba el frontend -- itemDesdeFilaReal no
// necesita cambios.
function construirCatalogoDesdeFilas(catalogoRows) {
  const catalogo = {};
  catalogoRows.forEach((r) => {
    catalogo[r.Sku] = {
      modelo: r.CodArticulo,
      nombre: r.NOMBREART || r.Sku || r.CodArticulo || 'Artículo sin catalogar',
      prov: r.NOMPROV || '',
      linea: r.NOMLINEA || 'Otros',
      familia: r.NOMFLIA || 'Otros',
      seccion: r.Seccion || 'Otros',
      color: r.COLOR || '—',
      talle: r.TALLE || 'U',
      pvp: r.Pvp,
      costo: r.Costo,
      margenU: r.MargenU,
      // % de IVA (2026-08-31, para "Margen %") -- ver el comentario completo junto a este mismo
      // campo en construirCatalogoYDetalle.
      iva: r.Iva ?? null,
      // Genero/Marca (2026-08-31, para el filtro "Solo mis líneas") -- ver el comentario completo
      // junto a estos mismos campos en construirCatalogoYDetalle.
      genero: r.Genero || null,
      marca: r.Marca || null,
      temporada: r.Temporada || null,
      material: r.Material || null,
      // QUERY_QUIEBRE_DETALLE no selecciona PeriodoTarifa (solo QUERY_ARTICULO_COMPLETO) -- mismo
      // comportamiento que ya tenía construirCatalogoYDetalle para esta misma consulta.
      periodoTarifa: null,
    };
  });
  return catalogo;
}
function construirDetalleDesdeFilas(detalleRows) {
  return detalleRows.map((r) => [
    r.Sku, r.NomSucursal, r.Empresa, r.Vd, r.StockTienda, r.StockDeposito, r.DepositoTESI, r.DepositoPUEBLO,
    r.PendienteOC, r.PendienteTESI, r.PendientePUEBLO,
    r.TransitoPendiente,
    r.Cob, r.Estado, r.Impacto, r.DiasConVenta, r.VentasRango, r.DiasQuiebreEstimado,
    r.UltimaVenta ? r.UltimaVenta.toISOString().slice(0, 10) : null,
    r.FechaUltimaCompra ? r.FechaUltimaCompra.toISOString().slice(0, 10) : null,
    r.VentasVd, r.DiasStockVd, r.UsoVelocidadAmplia, r.DiasStockVdReal, r.UsoEvidenciaHistorica,
    r.VentasVdMostrado, r.DiasStockVdMostrado, r.SinEvidenciaRealStock,
    r.AceptacionesRango, r.VentasHistorico, r.AceptacionesHistorico,
    r.PrimeraVenta ? r.PrimeraVenta.toISOString().slice(0, 10) : null,
    r.PrimeraAceptacion ? r.PrimeraAceptacion.toISOString().slice(0, 10) : null,
    r.FechaUltimaAceptacion ? r.FechaUltimaAceptacion.toISOString().slice(0, 10) : null,
    r.CantidadUltimaAceptacion,
    r.CantidadVentasPromo, r.NombrePromo || null, r.DescuentoPromo || null,
  ]);
}

// Cache en memoria de /api/tablero/quiebre, por combinacion exacta de filtros (desde+hasta+
// riesgoDias). El dato de fondo solo cambia una vez por dia (job 06:30) -- si dos requests piden
// la misma combinacion el mismo dia (recargar la pagina, o cambiar un filtro que despues se
// vuelve a su valor anterior), la segunda se sirve de memoria en vez de correr de nuevo la
// consulta pesada (~20s). Se invalida con el mismo criterio que cacheTablero (ver mas abajo).
const cacheQuiebre = new Map();

// Extraido del handler de /api/tablero/quiebre (2026-09-01, ver spec
// docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md) para poder reusarlo desde el
// precalentado del combo default (ver precalentarComboDefaultSiHaceFalta, mas abajo) sin duplicar
// la logica de cache/consulta pesada. Comportamiento IDENTICO al que tenia inline: mismo cache,
// misma clave, misma consulta.
// claveCache -> Promise<dataPesada> mientras esa consulta esta en curso -- evita que dos llamadas
// concurrentes con la misma clave (ej. el precalentado y un usuario real pidiendo lo mismo al
// mismo tiempo, o dos usuarios en simultaneo) disparen la consulta pesada dos veces.
const enVueloQuiebre = new Map();

async function obtenerDataPesadaQuiebre({ fechaDesde, fechaHasta, riesgoDias, ucFechaDesde, ucFechaHasta }) {
  const claveCache = `${fechaDesde.toISOString().slice(0, 10)}|${fechaHasta.toISOString().slice(0, 10)}|${riesgoDias}|${ucFechaDesde.toISOString().slice(0, 10)}|${ucFechaHasta.toISOString().slice(0, 10)}`;
  const refrescoQ = ultimoRefrescoEsperado();
  const cacheado = cacheQuiebre.get(claveCache);
  if (cacheado && cacheado.computedAt >= refrescoQ) return cacheado.data;

  if (enVueloQuiebre.has(claveCache)) return enVueloQuiebre.get(claveCache);

  const promesa = (async () => {
    const pool = await poolPromise;
    const fechaDesdePedidos = new Date();
    fechaDesdePedidos.setMonth(fechaDesdePedidos.getMonth() - PEDIDOS_ANTIGUEDAD_MESES);

    const result = await pool
      .request()
      .input('fechaDesde', sql.Date, fechaDesde)
      .input('fechaHasta', sql.Date, fechaHasta)
      .input('fechaDesdePedidos', sql.Date, fechaDesdePedidos)
      .input('riesgoDias', sql.Int, riesgoDias)
      .input('ucFechaDesde', sql.Date, ucFechaDesde)
      .input('ucFechaHasta', sql.Date, ucFechaHasta)
      .query(QUERY_QUIEBRE_DETALLE);

    const resumenRows = result.recordsets[0] || [];
    const detalleRows = result.recordsets[1] || [];
    const porArticuloRows = result.recordsets[2] || [];
    const catalogoRows = result.recordsets[3] || [];

    const resumenTotal = {};
    resumenRows.forEach((r) => {
      resumenTotal[r.Empresa] = {
        quiebres: r.Quiebres,
        riesgos: r.Riesgos,
        ok: r.Ok,
        impactoQuiebre: r.ImpactoQuiebre,
        nroSucursales: r.NroSucursales,
      };
    });

    const catalogo = construirCatalogoDesdeFilas(catalogoRows);
    const detalle = construirDetalleDesdeFilas(detalleRows);
    const porArticulo = porArticuloRows.map((r) => ({
      empresa: r.Empresa,
      codArticulo: r.CodArticulo,
      color: r.COLOR,
      sku: r.Sku,
      quiebres: r.Quiebres,
      riesgos: r.Riesgos,
      ok: r.Ok,
      impactoQuiebre: r.ImpactoQuiebre,
    }));

    const dataPesada = { resumenTotal, catalogo, detalleColumnas: DETALLE_COLUMNAS, detalle, porArticulo, fechaDesde, fechaHasta, riesgoDias, ucFechaDesde, ucFechaHasta };

    for (const [clave, valor] of cacheQuiebre) {
      if (valor.computedAt < refrescoQ) cacheQuiebre.delete(clave);
    }
    cacheQuiebre.set(claveCache, { data: dataPesada, computedAt: new Date() });
    return dataPesada;
  })();

  enVueloQuiebre.set(claveCache, promesa);
  try {
    return await promesa;
  } finally {
    enVueloQuiebre.delete(claveCache);
  }
}

app.get('/api/tablero/quiebre', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ resumen: {}, detalle: [] });
  }

  try {
    const hastaDefault = new Date();
    const desdeDefault = new Date();
    desdeDefault.setDate(desdeDefault.getDate() - 89); // ultimos 90 dias, mismo default que el simulador

    const fechaDesde = parseFechaQuery(req.query.desde, desdeDefault);
    const fechaHasta = parseFechaQuery(req.query.hasta, hastaDefault);
    const riesgoDias = Number(req.query.riesgoDias) || 3;

    // "Fecha de ultima compra": ahora restringe el universo entero (no solo que barras se listan)
    // -- afecta tambien quiebres/riesgos/ok/impacto del resumen, a pedido explicito (antes era
    // puramente del navegador y no podia mover esos numeros). Default = mismo calendario de 365
    // dias que ya usa el frontend para este filtro (HIST_DIAS), no los 90 dias de Periodo de ventas.
    const ucHastaDefault = new Date();
    const ucDesdeDefault = new Date();
    ucDesdeDefault.setDate(ucDesdeDefault.getDate() - 364);
    const ucFechaDesde = parseFechaQuery(req.query.ucDesde, ucDesdeDefault);
    const ucFechaHasta = parseFechaQuery(req.query.ucHasta, ucHastaDefault);

    // Favoritos: lista separada por comas de modelos/SKU marcados en ESTE navegador (localStorage,
    // no hay cuenta de usuario real). NO entran a la clave de cache ni a la consulta SQL -- se
    // aplican en Node sobre el desglose por articulo ya cacheado (ver mas abajo). Antes
    // favModelos/favSkus SI eran parte de la clave de cache, asi que marcar/desmarcar una estrella
    // era swiempre un cache MISS -> recalculo completo (~7-17s) en cada click. Saneo defensivo:
    // solo saca caracteres de control -- el Sku ahora incluye el color COMPLETO (no solo 2 letras,
    // ver el cambio en QUERY_QUIEBRE_DETALLE/QUERY_ARTICULO_COMPLETO), y los nombres reales de
    // color tienen espacios, barras ("NUT/YELLOW") y hasta tildes ("DESTEÑIDO") -- una lista
    // estricta de solo alfanumerico+guion cortaba esos caracteres y el Sku saneado ya no matcheaba
    // contra el real. Esto nunca llega a SQL (se compara en Node contra el array ya cacheado), asi
    // que no hay riesgo de inyeccion por ampliar el charset permitido.
    const sanearListaCodigos = (v) => String(v || '').split(',').map((s) => s.trim().replace(/[\x00-\x1F\x7F]/g, '')).filter(Boolean);
    const favModelos = new Set(sanearListaCodigos(req.query.favModelos));
    const favSkus = new Set(sanearListaCodigos(req.query.favSkus));
    const hayFavoritos = favModelos.size > 0 || favSkus.size > 0;

    const dataPesada = await obtenerDataPesadaQuiebre({ fechaDesde, fechaHasta, riesgoDias, ucFechaDesde, ucFechaHasta });

    // Resumen final de esta respuesta: si hay favoritos, se recalcula en Node a partir del
    // desglose por articulo ya cacheado (instantaneo, cero trabajo en SQL Server) -- si no hay
    // favoritos, es directamente el resumen de toda la red que ya viene cacheado.
    let resumen = dataPesada.resumenTotal;
    if (hayFavoritos) {
      const esFavorito = (p) => favModelos.has(p.codArticulo) || favSkus.has(p.sku);
      // Mismo criterio que el resumen sin favoritos (recordset 0 de QUERY_QUIEBRE_DETALLE):
      // quiebres/riesgos/ok cuentan ARTICULO+COLOR, con prioridad QUIEBRE > RIESGO > OK cuando
      // un articulo+color tiene tallas en mas de un estado. porArticulo viene a nivel Sku (talle
      // incluido), asi que primero se fusiona por combinacion articulo+color antes de clasificar.
      const porCombo = {};
      dataPesada.porArticulo.filter(esFavorito).forEach((p) => {
        const clave = `${p.empresa}|${p.codArticulo}|${p.color}`;
        if (!porCombo[clave]) porCombo[clave] = { empresa: p.empresa, quiebres: 0, riesgos: 0, impactoQuiebre: 0 };
        const c = porCombo[clave];
        c.quiebres += p.quiebres; c.riesgos += p.riesgos; c.impactoQuiebre += p.impactoQuiebre;
      });
      const acumulado = {};
      Object.values(porCombo).forEach((c) => {
        if (!acumulado[c.empresa]) acumulado[c.empresa] = { quiebres: 0, riesgos: 0, ok: 0, impactoQuiebre: 0, sucursales: new Set() };
        const a = acumulado[c.empresa];
        a.impactoQuiebre += c.impactoQuiebre;
        if (c.quiebres > 0) a.quiebres += 1;
        else if (c.riesgos > 0) a.riesgos += 1;
        else a.ok += 1;
      });
      // nroSucursales para favoritos: distinct Sucursal entre las filas de detalle (QUIEBRE/RIESGO)
      // de esos articulos -- subestima si un favorito esta OK en TODAS sus sucursales (no tiene
      // fila en detalle en ninguna), caso raro y de bajo impacto para un simple contador de badge.
      const idxSku = dataPesada.detalleColumnas.indexOf('sku');
      const idxSuc = dataPesada.detalleColumnas.indexOf('suc');
      const idxEmp = dataPesada.detalleColumnas.indexOf('empresa');
      dataPesada.detalle.forEach((fila) => {
        const sku = fila[idxSku];
        const cod = dataPesada.catalogo[sku] && dataPesada.catalogo[sku].modelo;
        if (favModelos.has(cod) || favSkus.has(sku)) {
          const emp = fila[idxEmp];
          if (acumulado[emp]) acumulado[emp].sucursales.add(fila[idxSuc]);
        }
      });
      resumen = {};
      Object.keys(acumulado).forEach((emp) => {
        const a = acumulado[emp];
        resumen[emp] = { quiebres: a.quiebres, riesgos: a.riesgos, ok: a.ok, impactoQuiebre: a.impactoQuiebre, nroSucursales: a.sucursales.size };
      });
    }

    const dataQuiebre = {
      resumen,
      catalogo: dataPesada.catalogo,
      detalleColumnas: dataPesada.detalleColumnas,
      detalle: dataPesada.detalle,
      fechaDesde,
      fechaHasta,
      riesgoDias,
      ucFechaDesde,
      ucFechaHasta,
    };

    res.json(dataQuiebre);
  } catch (err) {
    console.error('Error al ejecutar la consulta de Quiebre:', err);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
});

// Cobertura completa (TODOS los estados, incluido OK) de UN articulo puntual -- se pide bajo
// demanda cuando el usuario abre el detalle de ese articulo (ver QUERY_ARTICULO_COMPLETO mas
// arriba). Sin cache propio: al estar filtrada por @modelo desde el primer paso, corre rapido sin
// importar el tamaño del catalogo -- el frontend igual cachea la respuesta mientras dure la
// sesion de filtros actual, asi que expandir/colapsar la grilla no vuelve a pegarle al servidor.
app.get('/api/tablero/articulo', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ catalogo: {}, detalleColumnas: DETALLE_COLUMNAS, detalle: [] });
  }

  const modelo = String(req.query.modelo || '').trim();
  if (!modelo) {
    return res.status(400).json({ error: 'Falta el parametro modelo.' });
  }

  try {
    const pool = await poolPromise;

    const hastaDefault = new Date();
    const desdeDefault = new Date();
    desdeDefault.setDate(desdeDefault.getDate() - 89);
    const fechaDesde = parseFechaQuery(req.query.desde, desdeDefault);
    const fechaHasta = parseFechaQuery(req.query.hasta, hastaDefault);
    const riesgoDias = Number(req.query.riesgoDias) || 3;

    // Nota: a diferencia de /api/tablero/quiebre, esta consulta NO acota por "Fecha de ultima
    // compra" -- ver el comentario junto al JOIN de MotorReposicion_UltimaRecepcion en
    // QUERY_ARTICULO_COMPLETO -- asi que no hace falta leer/pasar ucDesde/ucHasta aca.
    const fechaDesdePedidos = new Date();
    fechaDesdePedidos.setMonth(fechaDesdePedidos.getMonth() - PEDIDOS_ANTIGUEDAD_MESES);
    const fechaDesdeTransito = new Date();
    fechaDesdeTransito.setDate(fechaDesdeTransito.getDate() - TRANSITO_VIGENCIA_DIAS);

    // Aceptaciones/Venta de la ventana de stock/a comprar (2026-08-28, a pedido explicito): "todo
    // el historico" por defecto, INDEPENDIENTE del "Periodo de ventas" global (fechaDesde/
    // fechaHasta de arriba) -- unico caso donde el frontend manda un rango puntual es cuando el
    // usuario elige un mes/año con el selector nuevo (ver abrirSelectorAceptVenta). "2000-01-01"
    // es de sobra anterior a cualquier dato real (Vta_detalle/dis_transf_recibidas no tienen
    // historia previa a eso).
    const avDesde = parseFechaQuery(req.query.avDesde, new Date('2000-01-01'));
    const avHasta = parseFechaQuery(req.query.avHasta, new Date());

    const result = await pool
      .request()
      .input('modelo', sql.VarChar(50), modelo)
      .input('fechaDesde', sql.Date, fechaDesde)
      .input('fechaHasta', sql.Date, fechaHasta)
      .input('fechaDesdePedidos', sql.Date, fechaDesdePedidos)
      .input('fechaDesdeTransito', sql.Date, fechaDesdeTransito)
      .input('avDesde', sql.Date, avDesde)
      .input('avHasta', sql.Date, avHasta)
      .input('riesgoDias', sql.Int, riesgoDias)
      .query(QUERY_ARTICULO_COMPLETO);

    const filas = result.recordsets[0] || [];
    const { catalogo, detalle } = construirCatalogoYDetalle(filas);
    res.json({ catalogo, detalleColumnas: DETALLE_COLUMNAS, detalle });
  } catch (err) {
    console.error('Error al ejecutar la consulta de articulo completo:', err);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
});

// Compras y ventas por empresa y mes de UN articulo+color puntual (2026-09-13, a pedido explicito)
// -- ver QUERY_COMPRAS_VENTAS_POR_MES sobre por que es una query/endpoint aparte de
// /api/tablero/articulo en vez de ir metida ahi (costaba ~2.8s extra en CADA apertura de la
// ventana, en articulos con mucho volumen de ventas). Se pide bajo demanda desde el frontend
// (cargarComprasVentas) apenas se abre "Stock"/"A comprar" de un articulo, en paralelo, sin
// bloquear esa apertura.
app.get('/api/tablero/compras-ventas', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ compras: [], ventas: [] });
  }

  const modelo = String(req.query.modelo || '').trim();
  const color = String(req.query.color || '').trim();
  if (!modelo) {
    return res.status(400).json({ error: 'Falta el parametro modelo.' });
  }

  try {
    const pool = await poolPromise;
    // Mismo default ("todo el historico") que /api/tablero/articulo -- ver el comentario junto a
    // avDesde/avHasta ahi arriba.
    const avDesde = parseFechaQuery(req.query.avDesde, new Date('2000-01-01'));
    const avHasta = parseFechaQuery(req.query.avHasta, new Date());

    const result = await pool
      .request()
      .input('modelo', sql.VarChar(50), modelo)
      .input('color', sql.VarChar(100), color)
      .input('avDesde', sql.Date, avDesde)
      .input('avHasta', sql.Date, avHasta)
      .query(QUERY_COMPRAS_VENTAS_POR_MES);

    res.json({ compras: result.recordsets[0] || [], ventas: result.recordsets[1] || [] });
  } catch (err) {
    console.error('Error al ejecutar la consulta de compras/ventas por mes:', err);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
});

// Ordenes de compra pendientes REALES (fecha, numero de pedido, cantidad pendiente) de un
// articulo+color+talle+empresa puntual (2026-09-05, a pedido explicito) -- reemplaza la
// "asignacion por sucursal" del pendiente de OC que mostraba el popover de calculo (un numero
// artificial, fruto del reparto de calcularNecesidadPorBarra entre sucursales -- la OC pendiente
// real es a nivel EMPRESA, no por sucursal, asi que esa asignacion no correspondia a ningun pedido
// real puntual). Mismo criterio de "vigente" ya usado en #PendientesOC (ver QUERY_QUIEBRE_DETALLE):
// antiguedad de PEDIDOS_ANTIGUEDAD_MESES (6 meses) y F_HASTA no vencido hace mas de 1 mes.
// Se pide bajo demanda al abrir el popover -- no agrega peso a ninguna consulta general.
app.get('/api/tablero/ordenes-pendientes', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ ordenes: [] });
  }
  const modelo = String(req.query.modelo || '').trim();
  const color = String(req.query.color || '').trim();
  const talle = String(req.query.talle || '').trim();
  const empresa = String(req.query.empresa || '').trim();
  if (!modelo || !color || !talle || (empresa !== 'TESI' && empresa !== 'PUEBLO')) {
    return res.status(400).json({ error: 'Faltan parametros (modelo, color, talle, empresa=TESI|PUEBLO).' });
  }
  const depot = empresa === 'TESI' ? '000098' : '000099';

  try {
    const pool = await poolPromise;
    const fechaDesdePedidos = new Date();
    fechaDesdePedidos.setMonth(fechaDesdePedidos.getMonth() - PEDIDOS_ANTIGUEDAD_MESES);

    const result = await pool
      .request()
      .input('modelo', sql.VarChar(50), modelo)
      .input('color', sql.VarChar(100), color)
      .input('talle', sql.VarChar(20), talle)
      .input('depot', sql.VarChar(10), depot)
      .input('fechaDesdePedidos', sql.Date, fechaDesdePedidos)
      .query(`
        SELECT FECHA, NROPEDIDO, CAST(pend_recep AS DECIMAL(18,4)) AS Pendiente
        FROM TBL_INFO_PEDIDOS
        WHERE CODEARTICLE = @modelo AND COLOR = @color AND TALLE = @talle AND DEPOT = @depot
          AND ISNUMERIC(pend_recep) = 1 AND CAST(pend_recep AS DECIMAL(18,4)) > 0
          AND CAST(FECHA AS DATE) >= @fechaDesdePedidos
          AND ISDATE(F_HASTA) = 1 AND CAST(F_HASTA AS DATE) >= DATEADD(month, -1, CAST(GETDATE() AS DATE))
        ORDER BY FECHA DESC
      `);

    const ordenes = result.recordset.map((r) => ({
      fecha: r.FECHA,
      nroPedido: r.NROPEDIDO,
      pendiente: r.Pendiente,
    }));
    res.json({ ordenes });
  } catch (err) {
    console.error('Error al consultar ordenes de compra pendientes:', err);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
});

// Usuarios reales de la app (2026-09-08, a pedido explicito -- reemplaza el COMPRADORES
// hardcodeado en el frontend, con PINes de 4 digitos inventados). TBL_USUARIOS_APPS es una tabla
// compartida por varias apps internas (VerKardex es de otra) -- VerAppReposicion=1 es la condicion
// de acceso a ESTA app (primera condicion pedida; "luego agregaremos otra condicion" queda para
// un pedido futuro, no se agrega nada mas todavia). Devuelve solo nombre+apellido -- nunca
// descUsuario ni contraseña, que no tienen por que llegar al navegador. Se usa para poblar el
// selector de "Actividad por comprador" (no para loguearse -- ver /api/login mas abajo).
app.get('/api/usuarios', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ usuarios: ['Usuario de prueba'] });
  }
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT DISTINCT nombre, apellido
      FROM TBL_USUARIOS_APPS
      WHERE VerAppReposicion = 1
      ORDER BY nombre, apellido
    `);
    const usuarios = result.recordset.map((r) => `${r.nombre || ''} ${r.apellido || ''}`.trim());
    res.json({ usuarios });
  } catch (err) {
    console.error('Error al consultar usuarios:', err);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
});

// Login real contra TBL_USUARIOS_APPS (reemplaza el PIN de 4 digitos hardcodeado en el frontend).
// La contraseña NUNCA sale de este endpoint -- se compara server-side y solo se devuelve el
// nombre para mostrar/registrar en la actividad. Misma condicion de acceso que /api/usuarios
// (VerAppReposicion=1): un usuario real de otra app de la empresa, sin este permiso puntual,
// tiene la contraseña correcta pero igual queda denegado.
app.post('/api/login', async (req, res) => {
  const usuario = String((req.body && req.body.usuario) || '').trim();
  const contrasena = String((req.body && req.body.contrasena) || '');
  if (!usuario || !contrasena) {
    return res.status(400).json({ ok: false, error: 'Faltan usuario o contraseña.' });
  }
  if (USE_MOCK) {
    return res.json({ ok: true, nombre: 'Usuario de prueba' });
  }
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('usuario', sql.VarChar(100), usuario)
      .input('contrasena', sql.VarChar(100), contrasena)
      .query(`
        SELECT TOP 1 nombre, apellido
        FROM TBL_USUARIOS_APPS
        WHERE descUsuario = @usuario AND contraseña = @contrasena AND VerAppReposicion = 1
      `);
    if (!result.recordset.length) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
    }
    const r = result.recordset[0];
    res.json({ ok: true, nombre: `${r.nombre || ''} ${r.apellido || ''}`.trim() });
  } catch (err) {
    console.error('Error al validar login:', err);
    res.status(500).json({ ok: false, error: 'Error al consultar la base de datos.' });
  }
});

// Filtro "Solo mis líneas" por comprador (2026-08-31, a pedido explicito -- retomando el tema
// pendiente desde que se armo el login real por usuario/contraseña). dbo.
// TBL_COMPRADOR_LINEA_MARCA mapea seccion+genero+familia+linea+proveedor+marca -> comprador (el
// nombre calza exacto, en mayusculas, contra nombre+apellido de TBL_USUARIOS_APPS -- confirmado
// con datos reales: "CARLOS PARODI" en esta tabla = "Carlos"+"Parodi" en la de usuarios).
// Se manda la tabla COMPLETA (3.434 filas, sin dato sensible) en vez de solo "lo del usuario
// actual" -- el frontend la necesita completa para distinguir 3 casos por combo real de articulo:
// (1) es del usuario logueado -> se ve, (2) es de OTRO comprador -> se oculta con el filtro
// activo, (3) no esta en la tabla para NADIE (huerfano, confirmado con datos reales que es el 55%
// del catalogo real) -> se ve igual, para no esconder articulos reales por un hueco en esta tabla.
app.get('/api/comprador-lineas', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ lineas: [] });
  }
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT seccion, genero, familia, linea, proveedor, marca, comprador
      FROM dbo.TBL_COMPRADOR_LINEA_MARCA
    `);
    res.json({ lineas: result.recordset });
  } catch (err) {
    console.error('Error al consultar comprador-lineas:', err);
    res.status(500).json({ error: 'Error al consultar la base de datos.' });
  }
});

// Hora del job nocturno de precalculo (06:30) -- usada para invalidar cacheQuiebre en el primer
// request del dia posterior a ese refresco (o al reiniciar el servidor).
const HORA_REFRESCO = 6;
const MINUTO_REFRESCO = 30;

function ultimoRefrescoEsperado() {
  const ahora = new Date();
  const hoyRefresco = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), HORA_REFRESCO, MINUTO_REFRESCO, 0, 0);
  if (ahora >= hoyRefresco) return hoyRefresco;
  const ayerRefresco = new Date(hoyRefresco);
  ayerRefresco.setDate(ayerRefresco.getDate() - 1);
  return ayerRefresco;
}

// Precalentado del combo de fechas por defecto (2026-09-01, a pedido explicito -- ver spec
// docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md): el combo que hay que
// precalentar es el que el FRONTEND realmente pide en su primera carga (tablero_motor_quiebre.html),
// no el fallback interno del handler para cuando el query viene sin parametros (ese fallback es
// codigo practicamente muerto desde un navegador real -- solo se pisa con un curl manual sin
// parametros). El frontend SIEMPRE manda desde/hasta/riesgoDias explicitos:
//   - horizIHasta = HIST_DIAS-2 -> Periodo de ventas termina AYER, nunca hoy (el dia en curso tiene
//     ventas todavia sin cerrar -- ver el comentario junto a horizIHasta y a maxFechaVenta).
//   - horizIDesde = HIST_DIAS-91 -> 90 dias terminando ayer (no terminando hoy).
//   - CFG.diasAlertaRiesgo = 15 -> default y minimo de "Alertar RIESGO si cobertura <", a pedido
//     explicito (2026-09-01).
// Fecha de ultima compra (ucDesde/ucHasta) SI coincide con el fallback del handler (365 dias
// terminando hoy), no hace falta tocar esa parte. Sin este precalentado con la clave correcta, la
// PRIMERA carga del dia de cualquier usuario paga la consulta pesada en frio (~15-25s, ver
// comentario junto a QUERY_QUIEBRE_DETALLE) -- obtenerDataPesadaQuiebre ya es idempotente (si ya
// hay cache tibia, no vuelve a pegarle a SQL Server), asi que llamarla de mas aca adentro no tiene
// costo una vez que ya se precalento. El de-dup en vuelo (enVueloQuiebre, mas arriba) cubre el
// caso de que esta funcion y un usuario real pidan la misma clave al mismo tiempo, asi que no hace
// falta un flag propio aca para evitar solapamiento.
const RIESGO_DIAS_DEFAULT_FRONTEND = 15; // CFG.diasAlertaRiesgo en tablero_motor_quiebre.html
async function precalentarComboDefaultSiHaceFalta() {
  if (USE_MOCK) return;
  const ahora = new Date();
  const hoyRefresco = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), HORA_REFRESCO, MINUTO_REFRESCO, 0, 0);
  if (ahora < hoyRefresco) return; // el precalculo nocturno de HOY todavia no corrio -- esperar

  const hastaDefault = new Date();
  hastaDefault.setDate(hastaDefault.getDate() - 1); // ayer -- el frontend nunca pide "hoy" (ventas del dia en curso sin cerrar, ver tablero_motor_quiebre.html)
  const desdeDefault = new Date();
  desdeDefault.setDate(desdeDefault.getDate() - 90); // 90 dias terminando ayer, igual que horizIDesde/horizIHasta del frontend
  const ucHastaDefault = new Date();
  const ucDesdeDefault = new Date();
  ucDesdeDefault.setDate(ucDesdeDefault.getDate() - 364);

  try {
    await obtenerDataPesadaQuiebre({
      fechaDesde: desdeDefault,
      fechaHasta: hastaDefault,
      riesgoDias: RIESGO_DIAS_DEFAULT_FRONTEND,
      ucFechaDesde: ucDesdeDefault,
      ucFechaHasta: ucHastaDefault,
    });
    console.log('Precalentado combo default de /api/tablero/quiebre OK -', new Date().toISOString());
  } catch (err) {
    console.error('Error al precalentar combo default de /api/tablero/quiebre:', err);
  }
}
setInterval(precalentarComboDefaultSiHaceFalta, 5 * 60 * 1000);
precalentarComboDefaultSiHaceFalta(); // tambien al arrancar -- cubre un reinicio del servicio a mitad de mañana

app.listen(PORT, HOST, () => {
  console.log(`Servidor escuchando en http://${HOST}:${PORT} (USE_MOCK=${USE_MOCK})`);
});
