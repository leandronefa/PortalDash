# CLAUDE.md — APCWeb

Versión **web** de la aplicación de escritorio `C:\apps\ActualizarPreciosCostos` (VB.NET WinForms).
Ambas conviven en paralelo: **PROHIBIDO modificar la app Desktop o cualquier objeto SQL existente**.
Todo objeto SQL nuevo lleva prefijo `APCWeb_`.

## Estructura

- `src/APCWeb/` — ASP.NET Core 9, escucha en `127.0.0.1:3013` (proxy portal `/d/apcweb/`).
- `sql/01_crear_objetos_APCWeb.sql` — clona SPs/tablas de estado compartido como `APCWeb_*` (vía `OBJECT_DEFINITION` + `REPLACE`; solo CREATE, idempotente).
- `docs/` — `ANALISIS-DESKTOP.md` (flujo completo de la Desktop), `DISENO-WEB.md`, `VALIDACION.md`.
- `deploy/instalar-servicio.ps1` — publica e instala el servicio `dashapcweb`.

## Build

```powershell
dotnet build C:\apps\dashboards\APCWeb\src\APCWeb\APCWeb.csproj
```

## Reglas de fidelidad (NO tocar sin releer docs/ANALISIS-DESKTOP.md)

- `Domain/CsvExporter.cs` es réplica byte a byte de `dtTableToCSV` (UTF-16LE BOM, `;`, sin CRLF final, sufijo `_H-m-s`, primera columna autonombrada `Column1`). Verificado con arnés (docs/VALIDACION.md).
- Cultura fija **es-AR** en `Program.cs` (coma decimal en los CSV). No cambiar.
- `ValidacionService`/`LiquiService` portan la lógica EXACTA de frmMain, **incluidos bugs deliberadamente preservados** (ValidarDatosEditados evalúa reglas 7→1 sin cortar, fórmula distinta de la regla 6, lectura de columna "ZMELI" vs "DIFERENCIAL", contadores Liqui acumulativos). No "corregir" nada sin comparar con la Desktop.
- SPs de solo lectura se reutilizan tal cual; el estado compartido (staging Liqui, TBL_OK, MARCAS, LOG) usa las copias `APCWeb_*` (`Domain/Sp.cs`).
- Los CSV van a `\\vmapp.sportotal.com.ar\importar\PRECIOS` y `\\10.0.0.115\Actualizar Precios y Costos` → la cuenta del servicio necesita acceso a esos shares (LocalSystem no sirve).

## Configuración

`appsettings.Production.json` (no commiteado) con `ConnectionStrings:db_cegid` → 10.0.0.115/db_cegid. Plantilla en `.example`.
