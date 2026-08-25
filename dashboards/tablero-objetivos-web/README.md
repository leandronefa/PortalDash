# Objetivos Sucursal — versión web

Reconstrucción web de la hoja **Objetivos Sucursal** (`SH23`) del tablero
`TABLERO OBJETIVO SUCURSALES OLD.qvw` (QlikView, última recarga 04/01/2026 08:27).

> **Para desplegarlo en un servidor con datos reales: [DEPLOY.md](DEPLOY.md).**
> Este documento explica qué se extrajo del `.qvw` y cómo; el otro, cómo ponerlo en
> producción contra SQL Server.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La app. Autocontenida, se abre con doble clic. **No requiere servidor.** |
| `tablero.html` | El mismo contenido sin el envoltorio `<html>/<head>` — es la fuente. |
| `DEPLOY.md` | Puesta en producción: Node + Express + SQL Server. |
| `server/` | Backend: API, consultas, índices y validación. Ver `DEPLOY.md`. |
| `extraido-del-qvw/layout-qlikview.xml` | Bloque XML extraído del `.qvw`: modelo de datos, variables, objetos y expresiones. |
| `extraido-del-qvw/expresiones-qlikview.txt` | Las 91 expresiones originales, con su etiqueta, tal como están en el tablero. |

`index.html` se genera concatenando un `<!doctype>` mínimo + `tablero.html`. Si editás
la lógica, editá `tablero.html` y regenerá `index.html`.

El tablero funciona en dos modos, con el mismo archivo: si `api/modelo` responde, usa
los datos reales; si no hay backend, genera un juego de demostración. El sello del
encabezado dice cuál de los dos está activo.

## Qué se extrajo del `.qvw`

El `.qvw` es binario propietario, pero el bloque XML del final (offset 149.079.043,
337 KB) está en texto plano. De ahí salió todo esto:

- **1 hoja**: `Document\SH23` — "Objetivos Sucursal"
- **29 objetos**: 16 combo charts, 4 straight tables, 2 calendarios (Desde/Hasta),
  1 current selections box, 4 text objects, 2 containers
- **91 expresiones** completas
- **10 dimensiones**: `Prov/Suc` (grupo cíclico), `Sucursal`, `Encargado`, `fecha`
- **14 tablas** del modelo y **80 campos**
- **44 variables** de usuario

Lo que **no** está en ese bloque: posiciones, tamaños y colores de cada objeto. Esa
geometría vive en la sección binaria comprimida y sólo QlikView puede leerla. Por eso
el layout de la web es un rediseño responsive, no una copia píxel a píxel.

## Modelo de datos original

| Tabla | Filas | Campos | Rol |
|---|---:|---:|---|
| `QVENTAS` | 5.913.998 | 30 | hechos: importes, IVA, costo, cantidad, `Idventa` |
| `QCUADRO` | 52.051 | 12 | agregado alternativo (`CUADRO_*`) |
| `QDIAS_HABILES` | 4.441 | 5 | `ANIOHAB`, `MESHAB`, `DIAS_HABILES` |
| `QOBJETIVOS` | 4.278 | 11 | `OBJ_VTAS_*`, `OBJ_UNIDADES_*`, `OBJ_OPERACIONES`, `OBJ_MARGEN_*` |
| `QSUCURSAL` | 47 | 7 | `Sucursal`, `Provincia`, `nomSucursal` |
| `QENCARGADOS` | 42 | 2 | supervisor por sucursal |

## Variables (parámetros del tablero)

| Variable | Valor al momento de la extracción | Control en la web |
|---|---|---|
| `F1` | `01/12/2025` | campo **Desde** |
| `F2` | `46020` → 29/12/2025 | campo **Hasta** |
| `IVA` | `SI` | segmento **Con IVA / Sin IVA** |
| `RF` | `'NO'` | segmento **Recargo financiero** |
| `ULTIMOS` | `Ultima Venta 29/12/2025 - Stock al 29/12/2025` | sello del encabezado |

## Fórmulas portadas

Todas viven en el bloque `2 · MOTOR DE CÁLCULO` de `tablero.html`, cada una citando
la expresión QlikView que reproduce.

```
Ventas       sum(importe + if(IVA='SI', iva_importe, 0)
                          + if(RF='SI', if(IVA='SI', recfin+iva_recfin, recfin), 0))

Unidades     sum(if(Artículo <> 'ZZZZZZZZ', cantidad))

Operaciones  count(DISTINCT if(cantidad>0, Idventa))
           − count(DISTINCT if(cantidad<0, Idventa))

Uni x Cli    Unidades / Operaciones
Tkt Prom     Ventas / Operaciones

Mrg Op%      (Base − Costo) / Base × 100
             Base  = importe + descuento − RECARGO_ENVIO − IVA_RECARGO_ENVIO
                            − RECARGO_FINANCIERO − IVA_RECARGO_FINANCIERO
                            + if(IVA='SI', iva_importe, 0)
             Costo = precio_rep + if(IVA='SI', iva_precio_rep, 0)

D Hab        sum(if(ANIOHAB=Year(F2) and MESHAB=Month(F2), DIAS_HABILES))
D Ven        Count(DISTINCT Sucursal & '_' & fecha)

Obj. Mes     sum(if(ANIOOBJ=Year(F2) and MESOBJ=Month(F2), OBJ_…))
Obj. Acum    sum(aggr( ObjMes / DiasHabiles × Count(DISTINCT fecha), Sucursal ))
Proyectado   si DiasHabiles = días transcurridos → Real
             si no → sum(aggr( Real / díasSucursal × DiasHabiles, Sucursal ))
Alcance      Proyectado / Obj.Mes − 1
Diferencia   Real − Obj. Acum

Real DE      mes completo → AddYears(F1,−1) … AddYears(F2,−1)
             mes abierto  → F1−364 … F2−364   (52 semanas)
```

Dos detalles que se respetaron del original: los ratios (ticket, unidades por
cliente, márgenes) **no se suman ni se promedian** — se recomponen desde los
acumulados; y el `aggr(…, Sucursal)` de las proyecciones se calcula boca por boca
antes de sumar, no sobre el total.

## Los datos

Sin backend, las cifras son generadas localmente: las 5.913.998 filas de `QVENTAS`
están comprimidas en el formato propietario de QlikView y no se pueden leer sin
QlikView Desktop.

Con backend, el tablero consume dos endpoints y el motor de cálculo no cambia:

```
GET api/modelo                        sucursales · objetivos · días hábiles
GET api/ventas?desde=…&hasta=…        QVENTAS agregada por sucursal × día
```

La API devuelve **componentes crudos** — `importe`, `iva_importe`, `recfin`, `costo`
por separado — y los conmutadores de IVA y recargo financiero se aplican en el
navegador. Así una sola consulta por mes cubre las cuatro combinaciones y tocar un
conmutador no genera tráfico.

El contrato completo, el SQL de extracción y la puesta en producción están en
**[DEPLOY.md](DEPLOY.md)**.
