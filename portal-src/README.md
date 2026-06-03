# Portal de Dashboards

Portal web centralizado para acceder a múltiples dashboards (publicados en distintos puertos del mismo servidor) desde un único punto: **http://servidor/**. Inspirado conceptualmente en QlikView AccessPoint, Power BI Service y Grafana.

- Inicio de sesión corporativo validado **exclusivamente** por el procedimiento almacenado `SP_VALIDAR_INICIO_SESION_APPS` (SQL Server).
- Usuario **Master** local (`admin` / `admin`) independiente de SQL Server.
- Cada usuario ve **solo** los dashboards autorizados.
- Los dashboards se abren **dentro del portal** mediante `iframe` (no en pestañas nuevas).
- Administración completa de dashboards y permisos por usuario.

---

## 🧱 Tecnología

| Componente | Elección | Motivo |
|---|---|---|
| Backend + Frontend | **ASP.NET Core 9 (Razor Pages)** | Máxima robustez en Windows, integración nativa con SQL Server, seguridad (antiforgery/CSRF, cookies, data protection) incorporada. |
| BD propia de la app | **SQLite** (por defecto) · SQL Server (opcional) | SQLite = cero configuración, un solo archivo. Conmutable por configuración. |
| Acceso corporativo | `Microsoft.Data.SqlClient` + Stored Procedure | Nunca consulta tablas; solo invoca el SP con parámetros. |
| UI | Razor + CSS propio + SVG embebidos | Responsive, moderno y **sin dependencias de Internet** (ideal para red local). |

> **Nota:** El proyecto fija `net9.0` porque es el SDK disponible en el servidor. Para usar `net8.0` (LTS), cambie `<TargetFramework>` en `DashboardPortal.csproj` e instale el SDK correspondiente.

---

## 🚀 Inicio rápido (desarrollo)

Requisitos: **.NET SDK 9** ([descarga](https://dotnet.microsoft.com/download)).

```powershell
cd C:\Users\Usuario\source\repos\DashboardPortal
dotnet run
```

Abra **http://localhost:5080** e ingrese con el usuario Master:

- Usuario: `admin`
- Contraseña: `admin`

La base de datos SQLite (`App_Data/portal.db`) y tres dashboards de ejemplo (Ventas 8501, RRHH 8502, Finanzas 8503) se crean automáticamente al primer arranque.

> Para probar el **login corporativo** sin acceso al SQL Server real, ejecute el script
> [`sql/02_SP_VALIDAR_INICIO_SESION_APPS_reference.sql`](sql/02_SP_VALIDAR_INICIO_SESION_APPS_reference.sql)
> en un SQL Server de prueba (crea un SP mock y usuarios demo como `jperez/1234`).

---

## 🔐 Credenciales y autenticación

### Usuario Master (local)
Definido en `appsettings.json` → `Master`. Por defecto `admin` / `admin`. **Cámbielo en producción.**
Acceso total: administra dashboards, usuarios, permisos y configuración. No depende de SQL Server.

### Usuarios corporativos (SQL Server)
Se validan llamando a:

```sql
EXEC db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS @USUARIO = '', @PSW = ''
```

No se almacenan contraseñas localmente. El portal interpreta la respuesta del SP de forma configurable (ver [`CONTEXT.md`](CONTEXT.md) → *Interpretación del SP*).

---

## 📁 Estructura del proyecto

```
DashboardPortal/
├── DashboardPortal.csproj         # Proyecto ASP.NET Core 9
├── Program.cs                     # Arranque, DI, seguridad, pipeline
├── appsettings.json               # Configuración (conexiones, SP, Master, puerto)
├── appsettings.Development.json
├── Properties/launchSettings.json
│
├── Data/
│   ├── AppDbContext.cs            # EF Core (dashboards, usuarios, permisos, config, logs)
│   └── DbSeeder.cs               # Datos iniciales (config + dashboards de ejemplo)
│
├── Models/                        # Entidades y constantes
│   ├── Dashboard.cs  AppUser.cs  DashboardPermission.cs
│   ├── AppSetting.cs  AccessLog.cs  AuthResult.cs  AppConstants.cs
│
├── Services/                      # Lógica de negocio
│   ├── CorporateAuthService.cs    # Invoca el Stored Procedure
│   ├── AuthService.cs             # Orquesta login (Master + corporativo) + auditoría
│   ├── DashboardService.cs  UserService.cs  PermissionService.cs
│   ├── SettingsService.cs  UrlBuilder.cs  IconLibrary.cs
│
├── Pages/                         # Razor Pages (UI)
│   ├── Login  Logout  Index(catálogo)  View(iframe)  AccessDenied  Error
│   └── Admin/                     # Solo Master
│       ├── Index (panel)
│       ├── Dashboards/ (Index, Create, Edit, Delete)
│       ├── Users/ (Index, Permissions)
│       ├── Permissions/ (matriz)
│       └── Settings/
│
├── wwwroot/                       # css/site.css · js/site.js · img/ (svg)
├── App_Data/                      # SQLite (portal.db) — generado en runtime
├── sql/                           # Scripts SQL (esquema + SP de referencia)
└── *.md                           # README, INSTALL, DEPLOY, ARCHITECTURE, CONTEXT
```

---

## ⚙️ Configuración esencial (`appsettings.json`)

| Clave | Descripción |
|---|---|
| `ConnectionStrings:CorporateSqlServer` | SQL Server corporativo (10.0.0.115) donde vive el SP. |
| `ConnectionStrings:AppDatabase` | BD propia. Vacío = SQLite. Con `Database:Provider=SqlServer`, cadena de la BD local. |
| `Database:Provider` | `Sqlite` (default) o `SqlServer`. |
| `Master:Username` / `Master:Password` | Credenciales del administrador local. |
| `CorporateAuth:StoredProcedure` | Nombre del SP. Default `db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS`. |
| `CorporateAuth:SuccessColumn` / `SuccessValues` | Cómo interpretar el resultado del SP (ver CONTEXT.md). |
| `Portal:ServerHost` | Host base para las URLs de dashboards. Vacío = host del portal. |
| `Kestrel:Endpoints:Http:Url` | Puerto de escucha en producción (default `http://0.0.0.0:80`). |

> Cualquier valor puede sobrescribirse por **variable de entorno** (p. ej. `ConnectionStrings__CorporateSqlServer`), ideal para no exponer la contraseña en el archivo.

---

## ✨ Funcionalidades

- **Catálogo** con buscador en vivo, tarjetas modernas con icono, nombre y descripción.
- **Visor** con `iframe` a pantalla completa y botón *Volver al catálogo*.
- **CRUD de dashboards** (crear, editar, eliminar, activar/desactivar). URL autogenerada.
- **Gestión de usuarios** corporativos y **asignación de permisos** (modelo simple: puede / no puede).
- **Matriz de permisos** (vista general usuarios × dashboards).
- **Configuración** del portal (título, host, esquema).
- **Seguridad**: sesiones por cookie, autorización por rol/política, CSRF (antiforgery), validación de permisos antes de abrir un dashboard, *Acceso denegado*, logout seguro, cabeceras de seguridad, auditoría de accesos y manejo de errores.

---

## 📚 Documentación

- [INSTALL.md](INSTALL.md) — Instalación paso a paso.
- [DEPLOY.md](DEPLOY.md) — Despliegue en producción (Windows, puerto 80, IIS, servicio).
- [ARCHITECTURE.md](ARCHITECTURE.md) — Arquitectura, modelo de datos y flujos.
- [CONTEXT.md](CONTEXT.md) — Contexto completo para otro motor de IA.
