# Arquitectura

## 1. Visión general

Aplicación **ASP.NET Core 9 (Razor Pages)**, server-rendered, con dos fuentes de identidad y una base de datos propia.

```
                          ┌───────────────────────────────────────────┐
   Navegador  ──HTTP──▶   │                 PORTAL                      │
  (LAN)                   │  Razor Pages + Cookie Auth + Antiforgery    │
                          │                                             │
                          │  ┌─────────────┐      ┌──────────────────┐  │
                          │  │  Services    │      │  AppDbContext     │ │
                          │  │  (negocio)   │◀────▶│  (EF Core)        │ │
                          │  └─────┬───────┘      └────────┬─────────┘  │
                          │        │                       │            │
                          └────────┼───────────────────────┼────────────┘
                                   │                        │
              EXEC SP (parámetros) │                        │  SQLite (App_Data/portal.db)
                                   ▼                        ▼  o SQL Server local
                       ┌────────────────────────┐   (Dashboards, Usuarios,
                       │  SQL Server corporativo │    Permisos, Config, Auditoría)
                       │  10.0.0.115             │
                       │  SP_VALIDAR_INICIO_...  │
                       └────────────────────────┘

   Catálogo ──(iframe)──▶  http://host:8501 , :8502 , :8503  (dashboards)
```

- **Identidad corporativa:** se delega 100 % en el Stored Procedure. El portal nunca lee tablas de usuarios.
- **Identidad Master:** local, en configuración, sin tocar SQL Server.
- **Datos propios** (qué dashboards existen y quién los ve): EF Core sobre SQLite/SQL Server.

---

## 2. Capas

| Capa | Carpeta | Responsabilidad |
|---|---|---|
| Presentación | `Pages/` | Razor Pages (UI), validación de entrada, autorización por convención. |
| Servicios | `Services/` | Lógica de negocio; única vía de acceso a datos y a SQL Server. |
| Datos | `Data/` | `AppDbContext` (EF Core) + seeder. |
| Modelos | `Models/` | Entidades, DTOs y constantes. |

**Inyección de dependencias** (todo en `Program.cs`): los servicios son `Scoped`; el `AppDbContext` se registra con el provider elegido.

---

## 3. Modelo de datos (BD propia)

```
Users (1) ────< Permissions >──── (1) Dashboards
  Id                AppUserId           Id
  Username (uniq)   DashboardId         Name
  DisplayName       GrantedAt           Description
  IsActive          (uniq AppUserId,    Port / Host / UrlOverride
  CreatedAt          DashboardId)       Icon
  LastLoginAt                           IsActive
                                        CreatedAt

Settings            AccessLogs
  Key (PK)            Id, Username, Action, DashboardId?,
  Value               Detail, IpAddress, Success, Timestamp
```

- **Permiso = existencia de fila** en `Permissions` (modelo simple: puede / no puede).
- Borrado de un usuario o dashboard → **cascade** sobre `Permissions`.
- `Username` se **normaliza a minúsculas** para coincidencia consistente entre login (SP) y permisos.

---

## 4. Flujo de autenticación

```
POST /Login (usuario, contraseña, token CSRF)
        │
        ▼
AuthService.AuthenticateAsync
        │
        ├─ ¿usuario == Master:Username?
        │      └─ sí → compara contraseña local → AuthResult(IsMaster=true)
        │
        └─ no → CorporateAuthService.ValidateAsync
                     └─ EXEC db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS @USUARIO,@PSW
                         (parámetros tipados → sin inyección SQL)
                     └─ interpreta el resultado → AuthResult
                         └─ si OK: EnsureExists(AppUser) + LastLogin + chequea IsActive
        │
        ▼
HttpContext.SignInAsync(cookie)  con claims: Name, Role(Master|User), DisplayName
        │
        ▼
LocalRedirect(ReturnUrl ?? "/")   + AccessLog(Login/LoginFailed)
```

### Interpretación del resultado del SP
Configurable en `CorporateAuth` (`appsettings.json`). Resumen del algoritmo:

1. Si hay `SuccessColumn` configurada → compara su valor con `SuccessValues`.
2. Si no, **autodetecta** una columna cuyo nombre contenga `result/valid/estado/acceso/login/...` y la compara con `SuccessValues`.
3. Si no hay columna indicadora y `TreatAnyRowAsSuccess=true` → **una fila devuelta = login válido**.
4. Toma el nombre para mostrar de `DisplayNameColumns` si está presente.

Detalle ampliado en [CONTEXT.md](CONTEXT.md).

---

## 5. Flujo de autorización y apertura de dashboard

```
GET /                → lista dashboards permitidos (Master = todos los activos)
GET /View?id=N
   └─ PermissionService.CanAccessAsync(usuario, esMaster, N)
        ├─ dashboard debe existir y estar ACTIVO
        ├─ Master → permitido
        └─ otro   → debe existir Permission(usuario activo, N)
   ├─ permitido → construye URL + AccessLog(OpenDashboard) → render <iframe>
   └─ denegado  → AccessLog(AccessDenied) → /AccessDenied ("Acceso denegado")
```

- `/Admin/**` → política `MasterOnly` (rol Master), aplicada por convención en `Program.cs`.
- Todas las páginas requieren sesión salvo `/Login` y `/Error`.

---

## 6. Generación de URL del dashboard

`UrlBuilder.BuildAsync(dashboard)` con prioridad:

1. `UrlOverride` (si se cargó manualmente).
2. `{scheme}://{Dashboard.Host}:{Port}` si el dashboard tiene host propio.
3. `{scheme}://{Portal.ServerHost}:{Port}` si hay host global configurado.
4. `{scheme}://{host-del-portal}:{Port}` (el host con el que el usuario accede).

`scheme` proviene de la configuración (`http` por defecto).

---

## 7. Seguridad

| Control | Implementación |
|---|---|
| Sesiones autenticadas | Cookie de autenticación (`HttpOnly`, `SameSite=Lax`, expiración 8 h deslizante). |
| Protección de acceso directo | Autorización global por convención; cookie redirige a `/Login`. |
| Validación de permisos | `PermissionService.CanAccessAsync` antes de exponer la URL. |
| CSRF | `AutoValidateAntiforgeryToken` global → token requerido en todo POST. |
| Inyección SQL | Parámetros tipados en el SP y consultas LINQ parametrizadas (EF). |
| XSS | Razor codifica la salida por defecto; los SVG provienen de un catálogo interno. |
| Logout seguro | POST con token → `SignOutAsync`. |
| Cabeceras | `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`. |
| Manejo de errores | `UseExceptionHandler("/Error")` en producción + logging. |
| Auditoría | Tabla `AccessLogs` (login, logout, apertura, accesos denegados). |

---

## 8. Puntos de extensión

- **Nuevo proveedor de identidad:** implementar `ICorporateAuthService`.
- **Otra BD propia:** cambiar `Database:Provider` (ya soporta SQLite y SQL Server).
- **Nuevos iconos:** agregar entradas en `Services/IconLibrary.cs`.
- **Permisos por grupos/roles:** extender `Permissions` y `PermissionService`.
- **Migraciones:** hoy se usa `EnsureCreated()`. Para evolucionar el esquema en producción, migrar a EF Migrations.
