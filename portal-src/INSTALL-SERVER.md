# Instalación en el servidor 10.0.0.118 (como Servicio de Windows)

Guía concreta para dejar el portal corriendo en **http://10.0.0.118/**, como **servicio** (arranca solo al reiniciar el server), y unificar los 3 dashboards en el disco `C:`.

---

## 0. Esquema final en disco `C:` (unificación)

Vas a dejar todo ordenado bajo `C:\apps`:

```
C:\apps\
├── portal\                 ← el Portal de Dashboards (lo que copiás)
│   ├── DashboardPortal.exe
│   ├── appsettings.json
│   ├── appsettings.Production.json
│   ├── wwwroot\  ...
│   └── App_Data\           ← se crea solo (BD SQLite + claves de sesión)
│
└── dashboards\             ← acá unificás tus 3 dashboards actuales
    ├── ventas\   →  escucha en el puerto 8501
    ├── rrhh\     →  escucha en el puerto 8502
    └── finanzas\ →  escucha en el puerto 8503
```

> 🔑 **Concepto clave:** el portal **no aloja** los dashboards; solo los **muestra dentro de un iframe** apuntando a `http://10.0.0.118:PUERTO`. Por eso podés mover las carpetas de tus dashboards a donde quieras (ej. `C:\apps\dashboards\...`): **al portal solo le importa el PUERTO**, no la ruta de los archivos. Mientras cada dashboard siga sirviendo en su puerto, el portal lo encuentra.

---

## 1. Generar el paquete (en tu PC de desarrollo)

En la máquina que tiene el **.NET SDK 9** (donde está el proyecto):

```powershell
cd C:\Users\Usuario\source\repos\DashboardPortal
.\deploy\publish.ps1 -Output C:\publish\DashboardPortal
```

Esto genera una carpeta **autocontenida** (incluye el runtime .NET). El servidor **no necesita tener .NET instalado**.

---

## 2. Copiar al servidor

Copiá **toda** la carpeta `C:\publish\DashboardPortal` al servidor **10.0.0.118**, dejándola en:

```
C:\apps\portal
```

(Por carpeta compartida, RDP copy/paste, o `robocopy \\10.0.0.118\...`.)

---

## 3. Revisar la configuración

En el servidor, editá `C:\apps\portal\appsettings.json`:

```jsonc
"ConnectionStrings": {
  // SQL Server corporativo del Stored Procedure (ya viene cargado)
  "CorporateSqlServer": "Server=10.0.0.115;Database=db_Cegid;User Id=sa;Password=MicroS123;TrustServerCertificate=True;Encrypt=False;Connect Timeout=15;"
},
"Master": {
  "Username": "admin",
  "Password": "admin"          // ⚠️ CAMBIALO
},
"Portal": {
  "ServerHost": "10.0.0.118"   // recomendado: fija el host de las URLs de los dashboards
}
```

> Poner `Portal:ServerHost = 10.0.0.118` hace que las URLs de los dashboards sean siempre `http://10.0.0.118:PUERTO`, sin importar cómo se acceda al portal. (También se puede cambiar luego desde **Administración → Configuración**.)

El puerto **80** ya está fijado en `appsettings.Production.json`; no hay que tocar nada.

---

## 4. Instalar el servicio (en el servidor, como Administrador)

Abrí **PowerShell como Administrador** y ejecutá:

```powershell
cd C:\apps\portal\deploy        # (si copiaste también la carpeta deploy)
# o copiá install-service.ps1 a mano y ejecutá desde donde esté
.\install-service.ps1 -InstallPath C:\apps\portal -Port 80
```

El script:
- Crea el servicio **DashboardPortal** (inicio **automático**, cuenta LocalSystem → puede usar el puerto 80).
- Configura **auto-reinicio** ante fallas.
- Abre el **firewall** en el puerto 80.
- **Inicia** el servicio.

Verificá:

```powershell
Get-Service DashboardPortal
```

Debe decir **Running / Automatic**. Probá en un navegador de la red: **http://10.0.0.118/** → entrá con `admin` / `admin`.

> Como es servicio con inicio automático, **al reiniciar el server el portal vuelve a levantar solo**.

---

## 5. Cargar los 3 dashboards en el portal

1. Entrá a **http://10.0.0.118/** como `admin`.
2. **Administración → Dashboards → + Nuevo dashboard**.
3. Por cada dashboard completá:
   - **Nombre**: ej. *Dashboard Ventas*
   - **Descripción**: opcional
   - **Puerto**: ej. `8501`
   - **Icono**: elegí uno
   - **Activo**: tildado
4. Guardá. La URL se arma sola: `http://10.0.0.118:8501`.
5. Repetí para los otros dos (8502, 8503).

Los 3 de ejemplo que vienen cargados podés **editarlos** (cambiar nombre/puerto) o **eliminarlos**.

### Permisos
- El usuario **admin (Master)** ve todos los dashboards activos.
- Para usuarios corporativos: **Administración → Usuarios** (agregalos o dejá que aparezcan tras su primer login) y luego **Permisos** → tildá los dashboards que cada uno puede ver.

---

## 6. ⚠️ IMPORTANTE: que los dashboards se vean dentro del portal

> **OBSOLETO desde jul 2026** — el portal ahora es **proxy inverso** (`/d/{id}/`): el navegador ya NO va directo al puerto del dashboard y el modelo actual es el inverso al descripto abajo: **los dashboards escuchan solo en `127.0.0.1`** y no se abren puertos en el firewall. Ver `deploy/OPERATIONS-10.0.0.118.md` (puntos 6–8). Se conserva esta sección solo como referencia histórica del esquema anterior.

El iframe lo carga **el navegador del usuario**, no el servidor del portal. La petición va **directo** desde la PC del usuario a `10.0.0.118:8501`. Por eso, cada uno de tus 3 dashboards debe cumplir:

1. **Escuchar en `0.0.0.0` (todas las interfaces), no solo en `127.0.0.1`/`localhost`.**
   Si hoy arrancan en `localhost`, funcionan en el server pero **no** desde otras PCs.
   - Streamlit: `streamlit run app.py --server.address 0.0.0.0 --server.port 8501`
2. **Firewall del servidor abierto** en 8501/8502/8503:
   ```powershell
   New-NetFirewallRule -DisplayName "Dashboard 8501" -Direction Inbound -Protocol TCP -LocalPort 8501 -Action Allow
   New-NetFirewallRule -DisplayName "Dashboard 8502" -Direction Inbound -Protocol TCP -LocalPort 8502 -Action Allow
   New-NetFirewallRule -DisplayName "Dashboard 8503" -Direction Inbound -Protocol TCP -LocalPort 8503 -Action Allow
   ```
3. **Permitir ser embebidos en iframe** (no enviar `X-Frame-Options: DENY`).
   - Streamlit suele permitirlo. Si usa protección XSRF y molesta:
     ```toml
     # .streamlit/config.toml
     [server]
     address = "0.0.0.0"
     port = 8501
     enableCORS = false
     enableXsrfProtection = false
     ```

Si un dashboard no se ve dentro del iframe, abrí `http://10.0.0.118:8501` directo en el navegador desde **otra PC**: si tampoco abre, el problema es del dashboard (puntos 1/2), no del portal.

---

## 7. Que los 3 dashboards también arranquen al reiniciar

El portal ya es servicio. Pero si tus dashboards se inician “a mano”, tras un reinicio el portal andará pero los iframes estarán caídos. Conviene que **cada dashboard también arranque solo** (servicio o tarea programada).

> Decime con qué están hechos los 3 dashboards (Streamlit/Python, .NET, Node, etc.) y te dejo los scripts para registrarlos como servicios con auto-arranque, igual que el portal.

---

## 8. Mantenimiento

| Acción | Comando |
|---|---|
| Ver estado | `Get-Service DashboardPortal` |
| Detener / iniciar | `Stop-Service DashboardPortal` · `Start-Service DashboardPortal` |
| Reiniciar | `Restart-Service DashboardPortal` |
| Ver logs | Visor de eventos → *Registros de Windows → Aplicación* (origen DashboardPortal) |
| Actualizar versión | Detener servicio → reemplazar archivos de `C:\apps\portal` **conservando** `App_Data\` → iniciar |
| Desinstalar | `.\deploy\uninstall-service.ps1` (no borra datos) |

- **Backup**: guardá periódicamente `C:\apps\portal\App_Data\portal.db` (contiene dashboards, usuarios y permisos).
