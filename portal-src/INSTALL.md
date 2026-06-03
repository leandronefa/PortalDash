# Instalación

Guía paso a paso para dejar el portal funcionando.

---

## 1. Requisitos previos

| Requisito | Detalle |
|---|---|
| **.NET SDK 9** | [Descargar](https://dotnet.microsoft.com/download/dotnet/9.0). Verifique con `dotnet --version`. |
| **SQL Server corporativo** | Accesible en `10.0.0.115` con el SP `db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS`. |
| **Conectividad** | El servidor del portal debe poder alcanzar `10.0.0.115:1433` (TCP). |
| **Internet (solo 1.ª compilación)** | Para restaurar paquetes NuGet. Luego funciona offline. |

> La base de datos propia usa **SQLite** por defecto: no requiere instalar nada.

---

## 2. Obtener el proyecto

Copie la carpeta `DashboardPortal` al servidor, por ejemplo en `C:\apps\DashboardPortal`.

---

## 3. Configurar (`appsettings.json`)

Abra `appsettings.json` y revise:

```jsonc
"ConnectionStrings": {
  // SQL Server corporativo donde vive el Stored Procedure
  "CorporateSqlServer": "Server=10.0.0.115;Database=db_Cegid;User Id=sa;Password=MicroS123;TrustServerCertificate=True;Encrypt=False;Connect Timeout=15;"
},
"Master": {
  "Username": "admin",
  "Password": "admin"          // ⚠️ cámbielo en producción
},
"CorporateAuth": {
  "StoredProcedure": "db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS",
  "UserParam": "@USUARIO",
  "PasswordParam": "@PSW"
}
```

### 🔒 Recomendado: no dejar la contraseña en el archivo

Use variables de entorno (sobrescriben el JSON sin tocarlo):

```powershell
setx ConnectionStrings__CorporateSqlServer "Server=10.0.0.115;Database=db_Cegid;User Id=sa;Password=MicroS123;TrustServerCertificate=True;Encrypt=False;"
setx Master__Password "una-clave-fuerte"
```

---

## 4. Compilar y ejecutar (desarrollo)

```powershell
cd C:\apps\DashboardPortal
dotnet run
```

- Abra **http://localhost:5080**.
- Ingrese con `admin` / `admin`.
- Al primer arranque se crea `App_Data\portal.db` y se cargan 3 dashboards de ejemplo.

---

## 5. Probar el login corporativo

### Opción A — Servidor corporativo real
Si el portal alcanza `10.0.0.115` y el SP existe, ingrese con un usuario corporativo válido.
Si el SP devuelve las columnas de forma distinta a la esperada, ajuste `CorporateAuth` (ver [CONTEXT.md](CONTEXT.md) → *Interpretación del SP*).

### Opción B — SQL Server de prueba (sin acceso al corporativo)
Ejecute en un SQL Server de prueba:

```
sql/02_SP_VALIDAR_INICIO_SESION_APPS_reference.sql
```

Crea un SP *mock* y usuarios demo. Apunte `CorporateSqlServer` a ese servidor e ingrese con:

| Usuario | Contraseña |
|---|---|
| `jperez` | `1234` |
| `mgomez` | `abcd` |
| `usuario` | `clave` |

---

## 6. (Opcional) Usar SQL Server para la BD propia

Por defecto se usa SQLite. Para usar SQL Server local:

1. Ejecute `sql/01_app_database_sqlserver.sql` (crea la base `DashboardPortal`).
2. En `appsettings.json`:

```jsonc
"Database": { "Provider": "SqlServer" },
"ConnectionStrings": {
  "AppDatabase": "Server=localhost;Database=DashboardPortal;User Id=sa;Password=...;TrustServerCertificate=True;Encrypt=False;"
}
```

> Con `Provider=SqlServer`, EF también puede crear el esquema solo si no existe; el script es opcional pero recomendado.

---

## 7. Asignar permisos

1. Ingrese como `admin`.
2. **Administración → Usuarios**: agregue el nombre de inicio de sesión corporativo (o deje que se cree solo cuando el usuario ingrese la primera vez).
3. **Permisos** del usuario: marque los dashboards que podrá ver.

Listo. Para producción continúe con [DEPLOY.md](DEPLOY.md).
