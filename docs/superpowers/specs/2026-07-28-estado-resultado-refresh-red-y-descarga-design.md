# EstadoResultado — Refresh desde la red + descarga de archivos SAP

Fecha: 2026-07-28
Dashboard: `C:\apps\dashboards\EstadoResultado` (servicio `dashestadoresultado.exe`, puerto 3008, proxy `/d/11/`)

## Problema

Hoy el botón **Actualizar** dispara `POST /api/refresh`, que lee el inbox local
`C:\apps\dashboards\EstadoResultado\sap-inbox`. Cargar un período nuevo exige que un
administrador copie a mano los `.txt` desde `\\10.0.0.115\Cegid` al inbox. SAP deja los
archivos en la red una vez por mes, así que el botón debería leer siempre de ahí.

Además falta cerrar el circuito operativo completo:

```
SAP deja los .txt en la red
  → el tablero los carga
  → un usuario los descarga
  → los edita a mano (ajustes contables)
  → los vuelve a subir
  → el tablero muestra los datos ajustados
```

Para que ese circuito funcione, la descarga tiene que entregar un archivo **byte a byte
igual** al que genera SAP (el usuario lo edita y lo devuelve por el mismo canal), y los
ajustes manuales **nunca** deben ser pisados por una lectura de red.

## Hechos verificados del formato

Inspección de `SAP_RESULT.txt` del 28/07/2026 (3057 líneas):

- Pipe-delimited, 5 campos: `CUENTA|DESCRIPCION|SUCURSAL|VALOR|PERIODO`.
- **Sin BOM**, **sin encabezado**, fin de línea **CRLF**, con CRLF final al terminar.
- **Todas** las líneas tienen período (0 líneas sin el 5º campo). El campo `SUCURSAL`
  puede venir vacío (`||`).
- **Acumulativo**: un solo archivo trae varios meses (`2026-01` … `2026-06`), en
  **bloques contiguos ordenados** ascendentemente.
- Importes con formato propio de SAP: `.00` (sin cero inicial), `-107029809.47`
  (sin separador de miles).

> Consecuencia crítica: el archivo **no se puede regenerar** desde los datos parseados —
> un `0.00` en lugar de `.00` ya rompe la igualdad byte a byte. Toda reconstrucción debe
> copiar **líneas textuales**, nunca reformatear valores.

Decisión relacionada: **no se cambia el export de SAP**. Que siga siendo acumulativo
conviene, porque el tablero conserva el histórico y permite re-descargar cualquier mes.

## Diseño

### 1. La unidad de datos es el mes, no el archivo

Cada período de cada empresa tiene un origen: `sap` o `manual`.

| Acción | Efecto |
|---|---|
| **Actualizar** (lee la red) | Importa solo los períodos con origen `sap` o inexistentes. Un período `manual` no se toca. |
| **Subir files** | Los períodos contenidos en el archivo subido pasan a `manual` y reemplazan lo que hubiera. |

El chequeo automático diario (01:00) usa la misma regla que Actualizar: nunca pisa `manual`.

Subir un archivo es la **única** forma de sobrescribir un ajuste manual. No se implementa
"restaurar un mes desde SAP" (decisión explícita del usuario). Si alguna vez hace falta,
se resuelve manualmente en el servidor: los archivos originales quedan en
`sap-inbox\SAPResultProcesado\`.

Esto resuelve el circuito sin fricción: al subir junio ajustado, junio queda blindado; el
mes siguiente SAP deja julio y Actualizar trae *solo* julio.

### 2. Dos rutas con roles distintos

| Variable | Valor | Rol |
|---|---|---|
| `SAP_NETWORK_PATH` (nueva) | `\\10.0.0.115\Cegid` | Fuente **read-only**. Nunca se borra ni mueve nada ahí. |
| `SAP_SOURCE_PATH` (existente) | `...\EstadoResultado\sap-inbox` | Inbox local: destino de las copias de red y de los uploads. |

Hoy `moveToProcessed()` **mueve** archivos desde `SAP_SOURCE_PATH`. Apuntar esa variable a
la red borraría los `.txt` de Cegid; de ahí la separación. Multer sigue escribiendo los
uploads en el inbox local, nunca en la red.

### 3. Almacenamiento: una sola fuente de verdad

```
data-store\
  SAP_RESULT.txt       ← archivo vigente TESI    (líneas textuales de su origen)
  SAP_PU_RESULT.txt    ← archivo vigente PUEBLO
  manifest.json        ← { tesi: { "2026-06": { origen, cargadoEn } , ... }, pueblo: {...} }
```

El tablero parsea **siempre** los archivos vigentes de `data-store\`. De ahí la propiedad
que cierra el circuito: **lo que se ve en pantalla es exactamente lo que se descarga.**

`sap-inbox\` sigue siendo la zona de llegada y `sap-inbox\SAPResultProcesado\` el histórico
con timestamp.

**Algoritmo de merge** (por empresa, al leer de red o al recibir un upload):

1. Leer el archivo entrante como texto UTF-8.
2. Partir por CRLF y agrupar en bloques contiguos por período (5º campo).
3. Para cada bloque entrante, según el origen de ese período en el manifest:
   - lectura de red → escribir el bloque solo si el período no existe o es `sap`;
   - upload manual → escribir siempre, y marcar el período como `manual`.
4. Reconstruir el archivo vigente: bloques ordenados por período ascendente, líneas unidas
   con CRLF, CRLF final. Ninguna línea se reformatea.
5. Persistir `manifest.json`, archivar el entrante en `SAPResultProcesado\` con timestamp y
   reparsear el estado en memoria desde el archivo vigente.

### 4. Manejo de errores de red

Al copiar desde la UNC hay que **distinguir los casos**, no tratar todo como "sin archivos":

- `ENOENT` → SAP todavía no dejó el archivo (informativo).
- `EACCES` / `EPERM` → problema de permisos: el servicio corre como **SYSTEM** y se
  presenta en la red como la cuenta de máquina. Loguear el código de error explícito.
- Cualquier fallo de red → fallback a lo que ya está en `data-store\` (el tablero sigue
  sirviendo el último estado válido) y el error se informa en la UI.

> **Riesgo abierto:** no está verificado que SYSTEM alcance `\\10.0.0.115\Cegid`. Las copias
> hechas hasta ahora fueron con el token de Administrador. Si al desplegar aparece
> `EACCES`/`EPERM`, la solución es darle acceso al servicio: cuenta de servicio de dominio
> con permisos en el share, o sesión SMB autenticada. Se decide con el error real a la vista.
> "Subir files" funciona igual y no depende de la red, así que el tablero nunca queda bloqueado.

### 5. API

| Método | Ruta | Cambio |
|---|---|---|
| POST | `/api/refresh` | Ahora `await` del procesamiento y devuelve resultado real: `{ ok, origen: 'red'\|'local', porEmpresa: { traidos: [...periodos], preservados: [...periodos] }, error? }`. Antes respondía `"Chequeo iniciado"` al instante. |
| GET | `/api/download?empresa=TESI\|PUEBLO` | **Nuevo.** Sirve el archivo vigente con su nombre original (`SAP_RESULT.txt` / `SAP_PU_RESULT.txt`), `Content-Type: text/plain`, sin transformar el contenido. |
| GET | `/api/status` | Agrega el manifest resumido (períodos y su origen) para que la UI marque los meses ajustados. |
| GET | `/api/data` | Sin cambios de contrato. |
| POST | `/api/upload` | Mismo contrato; pasa a usar el merge por período y responde qué períodos marcó como `manual`. |

### 6. Frontend (`src/App.tsx`)

- Botón **"Descargar files"** junto a "Subir files": un clic dispara las dos descargas
  (TESI y PUEBLO) con sus nombres originales.
- Punto ámbar en el selector de mes cuando ese período tiene origen `manual`, con tooltip
  indicando la fecha de carga del ajuste.
- El botón **Actualizar** deja de esperar 1500 ms a ciegas: usa la respuesta real de
  `/api/refresh` y muestra el resultado en el banner que ya existe para los uploads —
  p. ej. *"Traídos de SAP: 5 meses. Preservados con ajustes: jun 2026."* o el error de red.

Las vistas (Resumen, Estado de Resultado, Por Sucursal, Gráficos) no se tocan.

### 7. Migración al primer arranque

Si `data-store\` no existe, se puebla con el archivo más reciente de cada empresa en
`sap-inbox\SAPResultProcesado\`, marcando todos sus períodos como `sap`. Sin intervención
manual.

El caché `data-cache\latest.json` **no** sirve para esta migración: contiene registros ya
parseados, así que no permite reconstruir el texto original. Se mantiene solo como respaldo
para mostrar datos si `data-store\` está vacío; en ese estado la descarga responde 404 con
un mensaje claro hasta la primera carga real (desde la red o por upload).

## Criterios de aceptación

1. Con los `.txt` presentes en `\\10.0.0.115\Cegid`, apretar **Actualizar** carga los
   períodos nuevos sin que nadie copie archivos a mano, y los `.txt` de la red **siguen ahí**.
2. Apretar **Actualizar** N veces seguidas deja el mismo estado (idempotente).
3. **Descargar files** baja dos archivos **byte a byte idénticos** a los vigentes
   (verificable con hash contra el archivo de SAP cuando no hay ajustes).
4. Descargar → editar un importe → subir → el tablero refleja el valor editado.
5. Después de (4), apretar **Actualizar** **no** revierte el valor editado, y el banner
   informa que ese mes fue preservado.
6. Un mes nuevo de SAP entra por Actualizar aun cuando meses anteriores estén en `manual`.
7. Si la red no responde, el tablero sigue mostrando el último estado válido y la UI
   informa el error.

## Desviaciones durante la implementación (28/07/2026)

Dos puntos de este spec se implementaron distinto, a propósito:

- **El caché `data-cache\latest.json` como fallback (sección 7) se eliminó.** Mantenerlo permitía que
  el estado en memoria mostrara datos que `data-store\` no tenía, y con eso `GET /api/download`
  respondía 404 sobre un período que la pantalla sí mostraba — rompiendo justamente la propiedad
  central del diseño: *lo que se ve es lo que se descarga*. Ahora el estado se reparsea siempre desde
  los archivos vigentes, que son la única fuente de verdad.
- **La copia intermedia al inbox al leer de la red se salteó.** El refresh lee el texto de la red, lo
  mergea al store y archiva una copia en `SAPResultProcesado\`. El inbox quedó solo como destino de
  los uploads de multer. Mismo resultado observable, un movimiento de archivo menos.

Además, el **riesgo abierto de la sección 4 quedó descartado**: se verificó que el servicio, corriendo
como SYSTEM, lee `\\10.0.0.115\Cegid` sin problemas de permisos. No hizo falta cuenta de servicio.

## Fuera de alcance

- Restaurar un mes `manual` desde SAP (descartado explícitamente).
- Auditoría o diff de los ajustes manuales (el histórico en `SAPResultProcesado\` alcanza).
- Cambiar el export de SAP a un solo mes (innecesario con el merge por período).
- Las columnas *stock $ / Contr-Stock* del Excel de contabilidad (requieren otra fuente).
