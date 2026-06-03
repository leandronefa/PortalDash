# CONTEXT.md — Contexto del proyecto para motores de IA

> Documento autocontenido para que otro asistente/modelo de IA entienda, modifique y extienda este proyecto sin información adicional. Escrito en español; identificadores de código en su forma original.

---

## 1. Qué es

**Portal de Dashboards**: aplicación web que centraliza el acceso a múltiples dashboards alojados en distintos puertos del mismo servidor (p. ej. Streamlit en 8501, 8502, 8503). Equivalente conceptual a *QlikView AccessPoint*. El usuario inicia sesión, ve solo los dashboards que tiene permitidos y los abre **dentro del portal** mediante `iframe`. Un usuario **Master** administra dashboards, usuarios y permisos.

Estado: **funcional y verificado de extremo a extremo** (build sin errores ni warnings; login Master, CSRF, catálogo, autorización admin y rechazos probados con la app en ejecución sobre SQLite).

---

## 2. Stack técnico

- **.NET 9** / **ASP.NET Core 9**, **Razor Pages** (server-rendered, sin SPA).
- **EF Core 9** para la BD propia: **SQLite** por defecto (`App_Data/portal.db`), conmutable a **SQL Server** (`Database:Provider`).
- **Microsoft.Data.SqlClient 5.2.2** para invocar el Stored Procedure corporativo.
- Autenticación por **cookies**; autorización por **roles/políticas**; **antiforgery** (CSRF) global.
- Frontend: CSS propio (`wwwroot/css/site.css`) + JS vanilla (`wwwroot/js/site.js`) + **iconos SVG embebidos** (`Services/IconLibrary.cs`). **Sin dependencias de Internet** (apto red local).
- Idioma de UI: **español**.

> El target es `net9.0` porque es el SDK instalado en el servidor (`dotnet --list-sdks` → 6.0 y 9.0). Para LTS, cambiar a `net8.0` requiere su targeting pack.

---

## 3. Cómo construir / ejecutar

```powershell
# Desarrollo (http://localhost:5080, ver Properties/launchSettings.json)
dotnet run

# Producción (lee appsettings.Production.json → puerto 80)
dotnet publish -c Release -o publish
publish\DashboardPortal.exe
```

- Al primer arranque: `EnsureCreated()` crea el esquema y `DbSeeder` carga configuración + 3 dashboards de ejemplo.
- Master por defecto: `admin` / `admin`.

⚠️ **Gotcha de puerto:** `Kestrel:Endpoints` en configuración **tiene prioridad sobre `--urls`/`ASPNETCORE_URLS`**. Por eso el puerto 80 vive en `appsettings.Production.json` (no en el base) y desarrollo usa `launchSettings`. No reintroducir un bloque `Kestrel` en `appsettings.json`.

---

## 4. Mapa de archivos

```
Program.cs                      Arranque: DI, DbContext (provider), cookie auth, política MasterOnly,
                                Razor Pages con AuthorizeFolder + AutoValidateAntiforgeryToken,
                                EnsureCreated + seed, cabeceras de seguridad, pipeline.
appsettings.json                Config base (sin Kestrel). Conexiones, SP, Master, Portal.
appsettings.Production.json     Kestrel puerto 80 + logging de producción.
appsettings.Development.json    Logging detallado.
Properties/launchSettings.json  Perfil dev (puerto 5080) y perfil "Producción (puerto 80)".

Data/AppDbContext.cs            DbSets: Dashboards, Users, Permissions, Settings, AccessLogs. Índices y FKs cascade.
Data/DbSeeder.cs                Siembra Settings (Title/ServerHost/Scheme) y dashboards de ejemplo.

Models/Dashboard.cs             Entidad dashboard (Name, Description, Port, Host?, UrlOverride?, Icon, IsActive, CreatedAt).
Models/AppUser.cs               Usuario corporativo conocido (Username normalizado, DisplayName?, IsActive, fechas).
Models/DashboardPermission.cs   Relación usuario↔dashboard (existencia = acceso).
Models/AppSetting.cs            Clave/valor de configuración.
Models/AccessLog.cs             Auditoría.
Models/AuthResult.cs            Resultado de autenticación (Success, Username, DisplayName, IsMaster, Message).
Models/AppConstants.cs          Roles, Policies, Claims, claves de Settings.

Services/CorporateAuthService.cs  Ejecuta el SP con parámetros e interpreta el resultado.
Services/AuthService.cs           Orquesta login (Master + corporativo), upsert de AppUser, claims, auditoría.
Services/DashboardService.cs      CRUD + GetForUserAsync (filtra por permisos).
Services/UserService.cs           CRUD usuarios + EnsureExistsAsync + UpdateLastLogin (normaliza Username a minúsculas).
Services/PermissionService.cs     CanAccessAsync, GetDashboardIdsForUserAsync, SetPermissionsAsync.
Services/SettingsService.cs       Get/Set settings (BD).
Services/UrlBuilder.cs            Construye {scheme}://{host}:{port} con prioridades.
Services/IconLibrary.cs           Catálogo de iconos SVG (Render(key,size), Options).

Pages/Login.*                   Login (anónimo). Cookie SignIn. ReturnUrl validado con Url.IsLocalUrl.
Pages/Logout.*                  POST → SignOut + AccessLog. GET → redirige a Login.
Pages/Index.*                   Catálogo (tarjetas + buscador en vivo). Muestra dashboards permitidos.
Pages/View.*                    Visor: valida permiso → <iframe> a la URL. ViewData["FullBleed"]=true.
Pages/AccessDenied.*            "Acceso denegado".
Pages/Error.*                   Página de error (anónima).
Pages/Shared/_Layout.cshtml         Layout principal (topbar, menú usuario con <details>, footer).
Pages/Shared/_LoginLayout.cshtml    Layout minimal para login/error.
Pages/Shared/_AdminLayout.cshtml    Layout admin (sidebar) → usa _Layout. Incluye _Flash.
Pages/Shared/_Flash.cshtml          Render de TempData Success/Error/Info.
Pages/Admin/_ViewStart.cshtml       Layout=_AdminLayout para todo /Admin.
Pages/Admin/Index.*                 Panel: estadísticas + actividad reciente.
Pages/Admin/Dashboards/*            CRUD dashboards (Index, Create, Edit, Delete) + toggle activo.
Pages/Admin/Users/Index.*           Alta/búsqueda/activar/eliminar usuarios.
Pages/Admin/Users/Permissions.*     Asignar dashboards (checkboxes) a un usuario.
Pages/Admin/Permissions/Index.*     Matriz usuarios × dashboards (vista general).
Pages/Admin/Settings/Index.*        Título, host base y esquema.

wwwroot/css/site.css            Sistema de diseño (variables, tarjetas, tablas, formularios, visor, responsive).
wwwroot/js/site.js              Buscador en vivo, seleccionar/quitar todos, cierre del menú usuario.
wwwroot/img/favicon.svg|logo.svg

sql/01_app_database_sqlserver.sql                   Esquema BD propia (solo si Provider=SqlServer).
sql/02_SP_VALIDAR_INICIO_SESION_APPS_reference.sql  SP mock + usuarios demo (SOLO pruebas).
sql/03_seed_dashboards_sqlserver.sql                Datos de ejemplo opcionales (SqlServer).
```

---

## 5. Autenticación corporativa (lo más importante de adaptar)

La app **solo** llama al Stored Procedure; **no consulta tablas**:

```sql
EXEC db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS @USUARIO = '<user>', @PSW = '<pass>'
```

Implementado en `Services/CorporateAuthService.cs` con `CommandType.StoredProcedure` y parámetros `SqlParameter` (sin concatenación → sin inyección).

### Interpretación del resultado (configurable en `CorporateAuth`)
El contrato exacto del SP real puede variar; el código es tolerante y **ajustable por configuración** sin recompilar:

1. **`SuccessColumn`** (vacío por defecto): si se indica el nombre de la columna que marca validez, se compara su valor con **`SuccessValues`** (lista, case-insensitive: `1, true, ok, s, si, sí, valido, exito, success, y, yes`).
2. Si `SuccessColumn` está vacío → **autodetección**: busca una columna cuyo nombre contenga `result/valid/estado/acceso/login/ok/success/autoriz/permit` y compara su valor con `SuccessValues`.
3. Si no hay columna indicadora y **`TreatAnyRowAsSuccess=true`** → **devolver una fila = login válido** (patrón común: el SP retorna el registro del usuario solo si es válido).
4. Si no hay filas → fallback al valor de retorno del SP (`RETURN`): `1` = válido (conservador).
5. **Nombre a mostrar**: primera columna presente de **`DisplayNameColumns`** (`NombreCompleto, Nombre, DisplayName, ...`).

**Para adaptarlo al SP real:** ejecute el SP manualmente, observe las columnas devueltas y:
- Si hay una columna clara de resultado (ej. `Resultado`, `Valido`), póngala en `SuccessColumn` y ajuste `SuccessValues`.
- Si el SP devuelve la fila solo cuando es válido, deje `SuccessColumn` vacío y `TreatAnyRowAsSuccess=true`.
- Active `Logging:LogLevel:Default=Debug` para ver en consola las columnas devueltas (`SP {sp} devolvio columnas: ...`).

El SP de referencia (`sql/02_...`) devuelve `Resultado (bit)`, `Mensaje`, `NombreCompleto`, `Usuario` → la autodetección encuentra `Resultado` y `NombreCompleto`.

---

## 6. Usuario Master (local)

- Definido en `Master:Username` / `Master:Password` (`appsettings.json`, default `admin`/`admin`).
- No depende de SQL Server. Comparación de contraseña **case-sensitive** (`Ordinal`); usuario case-insensitive.
- Recibe rol `Master` (claim `ClaimTypes.Role`) → política `MasterOnly` para `/Admin/**`.

---

## 7. Permisos

- Modelo simple: existe fila en `Permissions(AppUserId, DashboardId)` ⇒ el usuario ve el dashboard. No hay niveles intermedios.
- El **Master** ve todos los dashboards **activos**.
- Un usuario corporativo se crea automáticamente (`EnsureExistsAsync`) al primer login válido (activo, sin permisos) para que el Master pueda asignarle dashboards. También puede pre-cargarse en *Usuarios*.
- No se pueden **enumerar** usuarios del SQL Server (solo se valida con el SP); por eso el Master agrega el nombre de login manualmente o el usuario aparece tras su primer ingreso.

---

## 8. Referencia de configuración (`appsettings.json`)

| Clave | Default | Uso |
|---|---|---|
| `Database:Provider` | `Sqlite` | `Sqlite` o `SqlServer` (BD propia). |
| `ConnectionStrings:AppDatabase` | `""` | Vacío = SQLite en `App_Data/portal.db`. |
| `ConnectionStrings:CorporateSqlServer` | (10.0.0.115) | Servidor del SP. |
| `Master:Username` / `Master:Password` | `admin`/`admin` | Admin local. |
| `CorporateAuth:StoredProcedure` | `db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS` | SP de validación. |
| `CorporateAuth:UserParam` / `PasswordParam` | `@USUARIO` / `@PSW` | Nombres de parámetros. |
| `CorporateAuth:SuccessColumn` | `""` | Columna de validez (vacío = autodetección). |
| `CorporateAuth:SuccessValues` | lista | Valores "verdaderos". |
| `CorporateAuth:DisplayNameColumns` | lista | Columnas de nombre a mostrar. |
| `CorporateAuth:TreatAnyRowAsSuccess` | `true` | Una fila = válido (si no hay columna indicadora). |
| `Portal:Title` | `Portal de Dashboards` | Título (también editable en Configuración). |
| `Portal:ServerHost` | `""` | Host base para URLs (vacío = host del portal). |
| `Portal:DefaultScheme` | `http` | Esquema de las URLs. |
| `Kestrel:Endpoints:Http:Url` | *(solo Production)* `http://0.0.0.0:80` | Puerto de escucha en producción. |

Toda clave se puede sobrescribir por variable de entorno con `__` (doble guion bajo): `ConnectionStrings__CorporateSqlServer`, `Master__Password`, etc.

---

## 9. Convenciones y decisiones

- **Namespaces de páginas** siguen la carpeta (`DashboardPortal.Pages.Admin.Dashboards`, etc.) para que `@model` resuelva sin `using` extra (el `@namespace` base está en `Pages/_ViewImports.cshtml`).
- **Username** se almacena en **minúsculas** (`UserService.Normalize`) → coincidencia robusta entre SP, login y permisos. El índice único en `Username` lo refuerza.
- **CSRF**: `AutoValidateAntiforgeryToken` global; los formularios `method="post"` incluyen el token vía tag helper. El logout es POST.
- **Autorización por convención** en `Program.cs`: `AuthorizeFolder("/")` (todo requiere sesión), `AllowAnonymousToPage("/Login","/Error")`, `AuthorizeFolder("/Admin", MasterOnly)`.
- **Iconos**: claves controladas internamente → `@Html.Raw(IconLibrary.Render(key))` es seguro (no es entrada de usuario).
- **Esquema BD**: se usa `EnsureCreated()` (no Migrations). Para evolución de esquema en producción, migrar a EF Migrations.
- **Sin librerías JS externas**: la validación es server-side (`ModelState`) + atributos HTML5; no se usa jQuery unobtrusive.

---

## 10. Comportamientos verificados (smoke test en ejecución)

- `GET /Login` → 200, token antiforgery presente, render correcto.
- `POST /Login` (admin/admin + token) → 302 a `/` (login Master + CSRF OK).
- `GET /` autenticado → 200, lista los 3 dashboards sembrados.
- `GET /Admin` como Master → 200.
- `GET /Admin/Dashboards` sin sesión → 302 a `/Login?ReturnUrl=...`.
- `POST /Login` con contraseña incorrecta → 200 con mensaje de error.
- `EnsureCreated()` crea todas las tablas; `DbSeeder` siembra config + dashboards.

---

## 11. Tareas comunes (cómo hacerlas)

- **Agregar un campo a Dashboard**: editar `Models/Dashboard.cs` → reflejarlo en `DashboardService` (Create/Update), en los formularios `Pages/Admin/Dashboards/Create|Edit.cshtml` y, si usa SqlServer, en `sql/01_...`. Con SQLite borrar `App_Data/portal.db` para regenerar (o migrar).
- **Cambiar la interpretación del SP**: ajustar `CorporateAuth` en `appsettings.json` ( no requiere recompilar). Lógica en `CorporateAuthService.ValidateAsync`.
- **Nueva página admin**: crear en `Pages/Admin/...` (hereda `_AdminLayout` y la política `MasterOnly`); agregar enlace en `Pages/Shared/_AdminLayout.cshtml`.
- **Nuevo icono**: añadir entrada en `IconLibrary.Icons` y en `IconLibrary.Options`.
- **Pasar a HTTPS**: reverse proxy/IIS con certificado; `Portal:DefaultScheme=https` si los dashboards usan TLS; revisar `Cookie.SecurePolicy`.

---

## 12. Restricciones conocidas / mejoras futuras

- No se pueden listar usuarios corporativos (solo validación por SP) — por diseño del requisito.
- Esquema con `EnsureCreated()`; para cambios de esquema sin perder datos, adoptar **EF Migrations**.
- DataProtection keys por perfil de usuario; en granja de servidores configurar repositorio compartido.
- El framing de los dashboards depende de que estos **no** envíen `X-Frame-Options: DENY` (ver DEPLOY.md §5).
- Las contraseñas de conexión están en `appsettings.json` para "listo para ejecutar"; en producción moverlas a variables de entorno / user-secrets.
