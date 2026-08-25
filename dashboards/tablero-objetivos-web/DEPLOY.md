# Deploy — Objetivos Sucursal

Guía para dejar el tablero corriendo en un servidor, con Node + Express sirviendo
el estático y una API en vivo contra SQL Server.

Portado de `TABLERO OBJETIVO SUCURSALES OLD.qvw`, hoja `Objetivos Sucursal` (`SH23`).

---

## Antes de empezar: dos cosas que hay que resolver

Ninguna de las dos es un detalle de implementación. Conviene decidirlas antes de
tocar el servidor.

### 1 · El tablero original restringe qué ve cada usuario. Esta web no.

El `.qvw` tiene `HasSectionAccess = true` y `DynamicReduceData = true`. Es decir:
QlikView recorta los datos según quién abre el documento — un encargado ve su
sucursal, no toda la red.

**La web no hereda nada de eso.** Cualquiera que llegue a la URL ve las 47 bocas,
los objetivos y los márgenes completos. Si el tablero va a vivir en la red interna
con acceso general, eso puede estar bien. Si hoy hay gente con acceso recortado,
necesitás resolverlo antes de publicar. Opciones, de menor a mayor trabajo:

- **Sólo red interna, sin exponer al exterior** — un firewall que limite el puerto
  a la LAN. Rápido, pero no distingue entre usuarios internos.
- **Reverse proxy con autenticación integrada de Windows** — IIS delante de Node
  con Windows Auth. El usuario ya viene identificado por el dominio.
- **Filtrado por usuario en la API** — el server lee la identidad del proxy y
  filtra `Codsuc` en la consulta. Es la única que reproduce de verdad lo que hace
  el section access.

No hay una opción por defecto correcta: depende de a quién le vas a dar el link.

### 2 · Los nombres de tabla de este repo son los del modelo Qlik, no los de SQL Server

Las consultas usan `QVENTAS`, `QOBJETIVOS`, `QDIAS_HABILES`, `QSUCURSAL`,
`QENCARGADOS`. Esos son los nombres **dentro del documento QlikView**. El renombre
lo hace el script de carga del `.qvw`, y ese script vive en la parte binaria del
archivo: no pude extraerlo.

Para conseguir los nombres reales:

1. Abrí el `.qvw` en QlikView Desktop.
2. `Ctrl+E` (editor de script).
3. Ahí están los `SQL SELECT` originales contra SQL Server.

Copiá de ahí los nombres de tabla y de columna, y ajustá `server/consultas.js` y
las variables `TBL_*` del `.env`. Los alias de salida (lo que va después de `AS`)
no se tocan: son el contrato que espera el tablero.

---

## Arquitectura

```
navegador
   │  GET /                        index.html (autocontenido, sin CDN)
   │  GET /api/modelo              sucursales · objetivos · días hábiles
   │  GET /api/ventas?desde&hasta  QVENTAS agregada por sucursal × día
   ▼
Node + Express  ── caché en memoria, un mes por entrada ──▶ SQL Server
```

Tres decisiones que conviene entender porque explican el resto del documento:

**La API devuelve componentes crudos, no totales.** `importe`, `iva_importe`,
`recfin`, `costo` viajan por separado. Los conmutadores de IVA y recargo financiero
se aplican en el navegador. Una sola consulta por mes cubre las cuatro
combinaciones, y tocar un conmutador no genera tráfico.

**Se pide y se cachea por mes, no por rango.** Un mes cerrado no cambia nunca más,
así que se guarda 12 h; el mes en curso, 5 min. Navegar entre períodos ya visitados
es instantáneo.

**El cálculo vive en el cliente.** Las 91 expresiones portadas corren en el
navegador sobre los datos traídos. El servidor sólo agrega y sirve. Un mes de la red
completa son ~1.200 filas: no hay razón para calcular del lado del servidor.

---

## Requisitos

| | |
|---|---|
| Node | 18.17 o superior (probado en 24.18) |
| SQL Server | 2016 o superior — la consulta no usa nada exótico |
| Cuenta de base | **sólo lectura** sobre las cinco tablas |
| Puerto | 3000 por defecto, configurable |
| RAM | 512 MB alcanzan. Un año de caché son ~30.000 filas |

---

## Paso 1 · Preparar SQL Server

### Crear la cuenta de lectura

```sql
CREATE LOGIN tablero_ro WITH PASSWORD = 'poné-una-fuerte-acá';
GO
USE VALENET;
CREATE USER tablero_ro FOR LOGIN tablero_ro;
GRANT SELECT ON dbo.QVENTAS       TO tablero_ro;
GRANT SELECT ON dbo.QOBJETIVOS    TO tablero_ro;
GRANT SELECT ON dbo.QDIAS_HABILES TO tablero_ro;
GRANT SELECT ON dbo.QSUCURSAL     TO tablero_ro;
GRANT SELECT ON dbo.QENCARGADOS   TO tablero_ro;
GO
```

Sólo `SELECT`, y sólo esas cinco. El tablero no escribe nada.

### Crear los índices

```bash
sqlcmd -S SRVSQL01 -d VALENET -i server/sql/indices.sql
```

Esto importa. `QVENTAS` tiene **5.913.998 filas**: sin el índice de cobertura, cada
mes hace un scan completo y la primera carga puede tardar minutos. Con el índice,
un mes resuelve en pocos segundos.

Corrélo en una ventana de baja actividad: crear el índice bloquea la tabla, salvo
que tengas Enterprise y agregues `WITH (ONLINE = ON)`.

El script termina con una consulta de control que te dice cuánto tarda un mes. La
referencia es **~1.200 filas de salida** para un mes de la red completa. Si tarda
más de 10 segundos con el índice ya creado, mirá el plan de ejecución: lo más común
es que el tipo de la columna `fecha` fuerce una conversión y anule el seek.

---

## Paso 2 · Instalar

```bash
cd server
npm install
cp .env.example .env
```

Editá `.env` con los datos de tu servidor. Como mínimo: `DB_SERVER`,
`DB_DATABASE`, `DB_USER`, `DB_PASSWORD`.

Si usás autenticación integrada de Windows, dejá `DB_USER` vacío y completá
`DB_DOMAIN`, `DB_WIN_USER` y `DB_WIN_PASSWORD`.

`ANIO_DESDE` tiene que incluir el año anterior completo: el tablero lo necesita para
calcular el día equivalente.

### El estático

`server/public/index.html` es el tablero. Ya está ahí.

Si más adelante editás la lógica, la fuente es `tablero.html` (en la raíz del
proyecto) y `index.html` se genera concatenándole un `<!doctype>` mínimo:

```bash
node -e "const fs=require('fs');fs.writeFileSync('server/public/index.html','<!doctype html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<style>*{margin:0}img,svg{display:block;max-width:100%}</style>\n</head>\n<body>\n'+fs.readFileSync('tablero.html','utf8')+'\n</body>\n</html>\n')"
```

---

## Paso 3 · Primer arranque

```bash
npm start
```

Deberías ver:

```
2026-08-20T13:00:00.000Z [info] http: escuchando en http://localhost:3000
2026-08-20T13:00:00.400Z [info] db: conectado a SRVSQL01/VALENET
```

Verificá en este orden, y no pases al siguiente hasta que el anterior dé bien:

```bash
curl http://localhost:3000/api/salud
# {"ok":true,"mesesEnCache":[],"mesAbierto":null}

curl "http://localhost:3000/api/modelo" | head -c 300
# {"sucursales":[{"cod":101,"nombre":"...","provincia":"...","encargado":"..."}], …

curl "http://localhost:3000/api/ventas?desde=2025-12-01&hasta=2025-12-31" | head -c 300
# {"meses":[202512],"filas":[{"cod":101,"f":"2025-12-01","importe":…
```

En el log tendrías que ver el tiempo real de la consulta:

```
[info] ventas: 202512: 1187 filas en 2840 ms
```

Después abrí `http://localhost:3000/` en el navegador. Si el sello del encabezado
dice **"Datos en vivo · SQL Server"**, está tomando de la base. Si dice
**"Recarga del modelo"** y el aviso del pie dice *"Datos de demostración"*, el
`fetch` a `api/modelo` falló y el tablero cayó al juego generado — mirá la consola
del navegador y el log del servidor.

Ese fallback es deliberado: el mismo archivo funciona abierto suelto o publicado sin
backend. Pero significa que **una API caída no se ve como un error obvio**, se ve
como datos plausibles. El sello del encabezado es la forma de distinguirlos.

---

## Paso 4 · Dejarlo corriendo

### Windows — servicio con NSSM

```powershell
choco install nssm

nssm install TableroObjetivos "C:\Program Files\nodejs\node.exe"
nssm set TableroObjetivos AppDirectory "C:\apps\tablero\server"
nssm set TableroObjetivos AppParameters "server.js"
nssm set TableroObjetivos AppStdout "C:\apps\tablero\logs\out.log"
nssm set TableroObjetivos AppStderr "C:\apps\tablero\logs\err.log"
nssm set TableroObjetivos AppRotateFiles 1
nssm set TableroObjetivos AppRotateBytes 10485760
nssm set TableroObjetivos Start SERVICE_AUTO_START
nssm start TableroObjetivos
```

Si usás autenticación integrada de Windows contra SQL Server, el servicio tiene que
correr con una cuenta de dominio que tenga permiso, no con `LocalSystem`:

```powershell
nssm set TableroObjetivos ObjectName "VALENET\svc_tablero" "la-password"
```

### Windows — alternativa con pm2

```powershell
npm install -g pm2 pm2-windows-startup
pm2-startup install
pm2 start server.js --name tablero --cwd C:\apps\tablero\server
pm2 save
```

NSSM es preferible en Windows: pm2 depende de que su servicio de arranque quede bien
registrado, y es la parte que más suele fallar tras un reinicio.

### Linux — systemd

```ini
# /etc/systemd/system/tablero.service
[Unit]
Description=Tablero Objetivos Sucursal
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/tablero/server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=tablero
EnvironmentFile=/opt/tablero/server/.env
StandardOutput=append:/var/log/tablero/out.log
StandardError=append:/var/log/tablero/err.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now tablero
sudo systemctl status tablero
```

El server maneja `SIGTERM`: cierra el listener, libera el pool y sale. `systemctl
restart` y `nssm restart` no dejan conexiones colgadas.

---

## Paso 5 · Exponerlo

No pongas Node directamente de cara a la red. Un reverse proxy te da TLS,
compresión, límite de tasa y —si hace falta— autenticación.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name tablero.valenet.local;

    ssl_certificate     /etc/ssl/certs/tablero.crt;
    ssl_certificate_key /etc/ssl/private/tablero.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 180s;   # la primera consulta de un mes puede tardar
    }
}
```

El `proxy_read_timeout` alto es necesario: el primer pedido de un mes sin caché
puede pasar el default de 60 s en una tabla de casi 6 millones de filas.

### IIS

Instalá **URL Rewrite** y **Application Request Routing**, y en el sitio:

```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="tablero" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3000/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <proxy timeout="00:03:00" />
  </system.webServer>
</configuration>
```

Esta es también la vía si querés autenticación de dominio: activá Windows
Authentication en el sitio de IIS y desactivá el acceso anónimo. IIS resuelve la
identidad y Node sólo ve pedidos ya autenticados.

---

## Validar contra QlikView

**Hacé esto antes de dar el link a alguien.** Un tablero con números casi correctos
es peor que no tener tablero.

```bash
sqlcmd -S SRVSQL01 -d VALENET -i server/sql/validacion.sql
```

Abrí el `.qvw` en QlikView con `F1 = 2025-12-01` y `F2 = 2025-12-29`, y compará:

| Qué | Dónde en la web | Tiene que coincidir con |
|---|---|---|
| Ventas de la red | KPI *Ventas*, valor grande | Total de `Vta. 1 ($)` |
| Unidades | KPI *Unidades* | Total de `Vta. 1 (Un)` |
| Operaciones | KPI *Operaciones* | Total de `Cant Tkt 1` |
| Margen operativo | KPI *Margen operativo* | `Margen Op` |
| Días hábiles | chip *Días con venta* | `D Hab` de la tabla Sucursales |
| Ventas por boca | tabla *Sucursales* | tabla `Sucursales` del `.qvw` |
| Objetivo acumulado | columna *Obj. acum.* | `Obj. Acum` |

Probá las cuatro combinaciones de IVA y recargo financiero, no sólo la de por
defecto: cada una toca una rama distinta de las fórmulas.

### La consulta de control que importa

La número 3 de `validacion.sql` busca si algún `Idventa` aparece en más de una fecha
o más de una sucursal. **Tiene que devolver cero filas.**

El motivo: el tablero pre-agrega por sucursal × día y después suma los días. El
`COUNT(DISTINCT Idventa)` se resuelve dentro de cada jornada. Si una misma venta
estuviera repartida en dos fechas, se contaría dos veces y las operaciones —y por
lo tanto el ticket promedio y las unidades por cliente— quedarían mal.

Si devuelve filas, hay dos salidas:

- **Normalizar en el origen**: asignar cada `Idventa` a una única fecha y boca.
- **Mover el `COUNT(DISTINCT)` al servidor por rango completo** en vez de
  pre-agregar por día. Cuesta una consulta por cada cambio de período y pierde la
  caché por mes, pero es exacto sin tocar los datos.

Anotá el resultado antes de decidir. No lo dejes para después: es la diferencia
entre un número correcto y uno que parece correcto.

---

## Contrato de la API

### `GET /api/modelo`

Cambia poco. El cliente lo pide una vez al cargar.

```json
{
  "sucursales": [
    {"cod": 101, "nombre": "SJU 01", "provincia": "San Juan", "encargado": "C. Castro"}
  ],
  "objetivos": {
    "101|202512": {
      "OBJ_VTAS_SIN_IVA": 8100000, "OBJ_VTAS_CON_IVA": 9801000,
      "OBJ_UNIDADES_VTAS": 640, "OBJ_OPERACIONES": 330,
      "OBJ_UNIDADES_CLIENTES": 1.86,
      "OBJ_MARGEN_TOT": 54.1, "OBJ_MARGEN_OPE": 52.2
    }
  },
  "diasHabiles": {"202512": 27},
  "ultimos": {
    "ultimaVenta": "2025-12-29",
    "ultimoStock": "2025-12-29",
    "recarga": "20/08/2026 13:00"
  }
}
```

La clave de `objetivos` es `` `${cod}|${AAAAMM}` ``. La de `diasHabiles`, `AAAAMM`
numérico. `ultimaVenta` fija el tope de los calendarios y el mes por defecto.

### `GET /api/ventas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`

Devuelve los **meses completos** que toca el rango; el cliente cachea por mes y
filtra el rango exacto en memoria.

```json
{
  "meses": [202512],
  "filas": [
    {
      "cod": 101, "f": "2025-12-01",
      "importe": 201231, "iva_importe": 42259, "descuento": 8049,
      "rec_envio": 0, "iva_rec_envio": 0,
      "rec_fin": 4025, "iva_rec_fin": 845,
      "recfin_var": 4025, "iva_recfin_var": 845,
      "costo": 94579, "iva_costo": 19862,
      "cantidad": 17, "oper_pos": 9, "oper_neg": 1
    }
  ]
}
```

| Campo | Origen en `QVENTAS` |
|---|---|
| `importe`, `iva_importe` | `importe`, `iva_importe` |
| `descuento` | `descuento` |
| `rec_envio`, `iva_rec_envio` | `RECARGO_ENVIO`, `IVA_RECARGO_ENVIO` |
| `rec_fin`, `iva_rec_fin` | `RECARGO_FINANCIERO`, `IVA_RECARGO_FINANCIERO` |
| `recfin_var`, `iva_recfin_var` | `recfin`, `iva_recfin` — el par del conmutador RF |
| `costo`, `iva_costo` | `precio_rep`, `iva_precio_rep` |
| `cantidad` | `cantidad`, excluyendo `Articulo = 'ZZZZZZZZ'` |
| `oper_pos`, `oper_neg` | `COUNT(DISTINCT Idventa)` por signo de `cantidad` |

Los dos pares de recargo financiero conviven porque el `.qvw` los usa distinto:
`RECARGO_FINANCIERO` entra en la base del margen, y `recfin` es el que suma o no a
las ventas según el conmutador `RF`. No los unifiques.

### `GET /api/salud`

```json
{"ok": true, "mesesEnCache": [202512, 202412], "mesAbierto": 202512}
```

Devuelve 503 si la base no responde. Sirve para el monitoreo.

---

## Operación

### Caché

Vive en memoria del proceso: reiniciar el servicio la vacía. Para forzar un
refresco, reiniciá.

| | TTL | Variable |
|---|---|---|
| Mes cerrado | 12 h | `TTL_MES_CERRADO_MIN` |
| Mes en curso | 5 min | `TTL_MES_ABIERTO_MIN` |
| Modelo | 5 min | `TTL_MES_ABIERTO_MIN` |

El "mes en curso" se deriva de `MAX(fecha)` en `QVENTAS`, no del reloj del
servidor. Si la carga de datos se atrasa, el tablero sigue el dato, no el
calendario.

Si el proceso de ETL corre a una hora fija y querés que el tablero lo tome enseguida,
lo más simple es reiniciar el servicio al terminar la carga:

```powershell
nssm restart TableroObjetivos
```

### Qué mirar cuando algo va mal

| Síntoma | Dónde mirar |
|---|---|
| El sello dice "Recarga del modelo" en vez de "Datos en vivo" | `api/modelo` falló. Consola del navegador y log del server. |
| Aviso rojo *"No se pudieron traer los datos"* | El server responde pero la consulta falla. Log del server, línea `[error] ventas`. |
| Primera carga muy lenta, después rápida | Falta el índice de cobertura. Corré `sql/indices.sql`. |
| Todo lento siempre | El caché no retiene: ¿el servicio se está reiniciando? Revisá el log de NSSM. |
| Números que no cierran con QlikView | `sql/validacion.sql`, empezando por la consulta 3. |
| 503 en `/api/salud` | Credenciales, red o la base caída. El campo `error` trae el mensaje. |

El indicador de carga es una barra fina azul arriba de la pantalla mientras se trae
un mes nuevo. Si queda animándose para siempre, el pedido se colgó.

---

## Límites conocidos

Cosas que el tablero hace así a propósito, o que quedaron heredadas del original.

**Rango de más de un mes.** Los objetivos y los días hábiles salen del mes de la
fecha *Hasta* — el `.qvw` los toma de `Month(F2)`. Un rango que cruza meses deja el
bloque de cumplimiento comparando contra un solo mes. El tablero lo avisa con un
chip ámbar y una nota, pero el número sigue siendo el del mes de F2. Las tablas y el
día equivalente sí cubren el rango completo.

**Días hábiles por sucursal.** `QDIAS_HABILES` tiene `Codsuc`, así que en teoría
pueden variar por boca. El tablero toma el máximo del mes, porque el original usa
`max(if(ANIOHAB=…, DIAS_HABILES))`. La consulta 5 de `validacion.sql` te dice si en
tu base varían de verdad. Si varían, hay que devolver `diasHabiles` por sucursal y
cambiar `objetivosDe()` en el cliente para leerlo de ahí.

**El fallback a demo es silencioso.** Ya está dicho arriba, pero vale repetirlo: si
la API cae, el tablero muestra datos generados en vez de un error. La señal está en
el sello del encabezado y en el aviso del pie. Si esto te incomoda para producción,
sacá la llamada a `generarDemo()` del `catch` de `iniciar()` y dejá que falle
visiblemente.

**La geometría del `.qvw` no se pudo recuperar.** Posiciones, tamaños y colores de
cada objeto están en la sección binaria comprimida del archivo. El layout de la web
es un rediseño responsive. Si necesitás fidelidad visual al original, hace falta una
captura de la hoja para acomodarlo a mano.

**Sin histórico propio.** El tablero lee de `QVENTAS` en vivo. Si una carga
retroactiva cambia un mes ya cerrado, el número cambia sin dejar rastro. El `.qvw`
tiene el mismo comportamiento.

---

## Estructura del proyecto

```
tablero-objetivos-web/
├── DEPLOY.md                    este documento
├── README.md                    qué se extrajo del .qvw y cómo
├── tablero.html                 fuente del tablero
├── index.html                   generado: tablero.html + doctype
├── extraido-del-qvw/
│   ├── layout-qlikview.xml      modelo, variables, objetos, expresiones
│   └── expresiones-qlikview.txt las 91 expresiones originales
└── server/
    ├── package.json
    ├── .env.example             copiar a .env
    ├── server.js                Express + caché + pool
    ├── consultas.js             ← el único archivo a adaptar al esquema real
    ├── public/index.html        lo que sirve el server
    └── sql/
        ├── indices.sql          índices y control de performance
        └── validacion.sql       comparación contra QlikView
```

---

## Checklist

- [ ] Decidido quién puede ver el tablero, y el section access resuelto o descartado a conciencia
- [ ] Nombres reales de tabla y columna sacados del editor de script del `.qvw`
- [ ] `consultas.js` y `TBL_*` del `.env` ajustados
- [ ] Cuenta de sólo lectura creada con `GRANT SELECT` sobre las cinco tablas
- [ ] `sql/indices.sql` corrido — un mes resuelve en pocos segundos
- [ ] `.env` completo y fuera del control de versiones
- [ ] `/api/salud` devuelve `ok:true`
- [ ] El tablero abre y el sello dice "Datos en vivo · SQL Server"
- [ ] `sql/validacion.sql` corrido; la consulta 3 devuelve cero filas
- [ ] Totales contrastados contra el `.qvw` en las cuatro combinaciones de IVA y RF
- [ ] Servicio registrado y probado con un reinicio del servidor
- [ ] Reverse proxy con TLS y `proxy_read_timeout` ≥ 180 s
- [ ] Monitoreo apuntando a `/api/salud`
