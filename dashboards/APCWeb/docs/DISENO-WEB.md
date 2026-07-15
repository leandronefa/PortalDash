# DISEÑO — APCWeb (versión Web de ActualizarPreciosCostos)

> Etapa 3. Basado en `ANALISIS-DESKTOP.md`. Regla suprema: NO ROMPER NADA — la Desktop sigue funcionando sin cambios.

## 1. Stack y encaje en el servidor 10.0.0.118

- **ASP.NET Core 9 (Razor Pages + endpoints JSON)**, mismo runtime que el portal (`DashboardPortal`, .NET 9).
- Escucha **solo en `127.0.0.1:3013`** (siguiente puerto libre del mapa de dashboards) y se publica a los usuarios vía el **proxy del portal** `http://10.0.0.118/d/apcweb/`, igual que el resto de los tableros.
- Servicio Windows: `dashapcweb` (sc.exe / `UseWindowsService()`), carpeta `C:\apps\dashboards\APCWeb\publish`.
- **Cuenta del servicio**: NO puede ser LocalSystem — necesita escribir en `\\vmapp.sportotal.com.ar\importar\PRECIOS` y `\\10.0.0.115\Actualizar Precios y Costos\` (lección aprendida de EstadoResultado). Se configura con una cuenta de dominio/local con permisos a esos shares (decisión de deploy, documentada en DEPLOY.md).

## 2. Acceso a datos

- `Microsoft.Data.SqlClient` directo contra **10.0.0.115 / db_cegid** (misma base que la Desktop).
- Cadena de conexión en `appsettings.Production.json` (NO commiteada; plantilla `appsettings.Production.json.example`). Credenciales las carga el usuario al desplegar.
- Réplica fiel de la librería `ConexionBBDD`:
  - `Db.EjecutarSP(nombre, params...)` → `DataTable` (CommandType.StoredProcedure, parámetros posicionales `@p1..@pN`? — **NO**: se relevará el nombre real de los parámetros de cada SP con `sys.parameters` en el script SQL de la Etapa 4; el wrapper asigna por ORDEN los nombres reales, replicando el comportamiento posicional de la DLL).
  - `Db.BulkInsert(dt, "APCWeb_TBL_...")` → `SqlBulkCopy` con mapeo por orden de columnas (igual que `exportDataTableToTableSQL`).
- Timeout de comandos: 1600 s (igual que Config.xml).

## 3. Objetos SQL: reuso vs copia

**Se reusan sin tocar** (solo lectura o solo envío de correo): todos los `SP_..._OBTENER_*`, `SP_..._CALCULAR_PVPVigente`, `ObtenerPrecioZMELI`, `ObtenerPrecioDiferencialMELI`, `SP_..._STOCK`, `SP_VALIDAR_INICIO_SESION_APPS`, `SP_..._OBTENER_PERFIL`, `SP_..._ENVIAR_CORREO_*`.

**Se copian con prefijo `APCWeb_`** (estado compartido mutable → la Web usa su propia copia y la Desktop no nota nada):

| Original | Copia Web |
|---|---|
| TBL_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_LIQUIDACION_TEMP (+ tabla definitiva interna) | APCWeb_TBL_... |
| SP_..._BORRAR_ARTICULOS_LIQUI / _ACTUALIZAR_ARTICULOS_LIQUI | APCWeb_SP_... |
| SP_..._VALIDAR_LIQUI + 6× SP_..._VALIDAR_MARGEN_LIQUI* | APCWeb_SP_... |
| TBL_..._OK + SP_..._BORRAR_TLBOK | APCWeb_... |
| SP_..._ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS | APCWeb_SP_... |
| TBL_..._MARCAS + SP_..._OBTENER_MARCAS_DISTINCT | APCWeb_... |
| TBL_..._LOG | APCWeb_TBL_... (la Web escribe su propio log) |

Las copias se generan **en el servidor** vía `OBJECT_DEFINITION()` + `REPLACE` de prefijos (ver Etapa 4), garantizando fidelidad total del código sin transcripción manual.

**Reglas de validación**: la Web **lee** las reglas de las tablas existentes vía los SPs existentes (`SP_..._OBTENER_REGLAS[_LIQUIDACION]`) — misma fuente de verdad ⇒ misma salida que la Desktop. ⚠️ Decisión abierta: la pantalla de edición de reglas de la Web escribe en las MISMAS tablas (una sola verdad, afecta también a la Desktop — es el mismo dato de negocio que hoy edita el admin) — por defecto la edición de reglas en la Web queda **deshabilitada** en la primera versión; el admin sigue editándolas desde la Desktop. Se habilitará cuando el usuario lo confirme.

## 4. Arquitectura de la aplicación

```
APCWeb/
├── src/APCWeb/                    proyecto ASP.NET Core
│   ├── Program.cs                 host, Kestrel 127.0.0.1:3013, sesión, auth cookie, es-AR
│   ├── Data/Db.cs                 EjecutarSP / BulkInsert (réplica ConexionBBDD)
│   ├── Domain/
│   │   ├── CsvExporter.cs         réplica EXACTA de dtTableToCSV
│   │   ├── ExcelImporter.cs       lectura XLSX (ClosedXML) hoja ListaPROV / Z1
│   │   ├── ValidacionService.cs   ValidarDatos / ValidarDatosEditados (fiel, bugs incluidos)
│   │   ├── LiquiService.cs        ValidarDatosLiqui (staging APCWeb_)
│   │   └── SessionState.cs        WorkSession: dtMain + dtCSV* en memoria por usuario
│   ├── Pages/  (Login, Index)     UI: tabs Proveedor/Marca/Multimarca/Liquidación/Rebaja
│   └── wwwroot/                   JS de grilla, filtros y contadores
├── sql/                           scripts Etapa 4 (solo CREATE APCWeb_*)
├── docs/                          ANALISIS-DESKTOP.md, DISENO-WEB.md, DEPLOY.md
└── deploy/                        instalación del servicio
```

- **Estado por sesión de trabajo en memoria** (`ConcurrentDictionary<userId, WorkSession>`): reproduce el modelo de DataTables del Desktop (dtMain, dtCSVCostos, dtCSVPrecios, dtCSVPVP*, dtNoInformados, contadores). Un solo proceso ⇒ sin problema de afinidad.
- **Flujo de UI = flujo Desktop**: login → elegir pestaña/proveedor/marca → subir XLSX → validación server-side fila a fila (misma secuencia de SPs) → grilla con filtros OK/Error/Sin Artículos/No Informados/Sin Cambio/Total y contadores → edición de filas con error (revalida con la lógica de `ValidarDatosEditados`, incluido Masivo) → Exportar (escribe CSVs en los shares) → log a `APCWeb_TBL_..._LOG`.
- Perfil `Administrador`: habilita pestaña Liquidación/Rebaja y (futuro) reglas — igual que Desktop.
- **Sin auto-update** (`SP_CHECK_VERSION_APP` no se usa).

## 5. Fidelidad de salida (requisitos duros)

1. `CultureInfo` del hilo fijada a **es-AR** (números con coma, `Today & " " & TimeOfDay` con el mismo formato que las PCs de los usuarios). Verificar en Etapa 6 contra un CSV real de la Desktop.
2. `Math.Round` sin especificar redondeo (banker's) igual que VB `Round`.
3. CSV: UTF-16LE con BOM (PRECIOS) / UTF-8 con BOM (auxiliares — `StreamWriter` con `Encoding.UTF8` emite BOM), `;`, header, sin CRLF final, sufijo `_H-m-s` si existe el archivo.
4. Lectura de Excel: primera fila = encabezados, filas con CODIGO vacío eliminadas, tipos como texto/valor igual que OleDb (ClosedXML: usar valor tipado de celda y `ToString` cultural en la exportación).
5. Mismos SPs, mismo orden de llamadas, lectura por índice de columna.

## 6. Riesgos señalados

- **ClosedXML vs OleDb**: OleDb infiere tipos por columna (primeras 8 filas); diferencias posibles en celdas mixtas. Se mitiga leyendo Costo/PVP como numérico y el resto como texto, y se valida en Etapa 6 con archivos reales.
- **Acceso UNC**: depende de la cuenta del servicio (ver §1).
- **Los SPs de correo** podrían leer los CSVs auxiliares del share de 115 — se conserva el mismo path y nombre de archivo, así el correo adjunta lo mismo.
- La tabla definitiva de Liqui (interna a `SP_..._ACTUALIZAR_ARTICULOS_LIQUI`) no es visible desde el código VB; el script de clonado detecta TODAS las dependencias `TBL_ACTUALIZARPRECIOSCOSTOS_%` de los SPs copiados y las clona también; cualquier dependencia fuera de ese patrón se reporta para revisión manual antes de ejecutar.
