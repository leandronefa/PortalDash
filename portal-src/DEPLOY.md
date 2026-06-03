# Despliegue en producción (Windows)

Objetivo: que el portal responda en **http://servidor/** (puerto 80) dentro de la red local.

---

## 1. Publicar la aplicación

En la máquina de desarrollo o en el propio servidor:

```powershell
cd C:\apps\DashboardPortal
dotnet publish -c Release -o C:\apps\DashboardPortal\publish
```

El resultado queda en `publish\` (incluye `DashboardPortal.exe`, las vistas, `wwwroot`, `appsettings*.json`).

> En **Producción** el portal lee `appsettings.Production.json`, que fija el puerto **80**
> (`Kestrel:Endpoints:Http:Url = http://0.0.0.0:80`). Cambie ese valor si necesita otro puerto.

---

## 2. Opción A — Ejecutar como **servicio de Windows** (recomendado)

Permite arranque automático y reinicio. El entorno por defecto al ejecutar el `.exe` ya es *Production*.

```powershell
# Crear el servicio (ajuste la ruta)
sc.exe create DashboardPortal binPath= "C:\apps\DashboardPortal\publish\DashboardPortal.exe" start= auto
sc.exe description DashboardPortal "Portal centralizado de dashboards"

# Variables sensibles a nivel servicio (opcional, recomendado)
# (use el editor de registro o setx con la cuenta del servicio)

# Iniciar
sc.exe start DashboardPortal
```

Para detener / quitar:

```powershell
sc.exe stop DashboardPortal
sc.exe delete DashboardPortal
```

> Alternativa popular: **NSSM** (`nssm install DashboardPortal "...\DashboardPortal.exe"`), que facilita logs y reinicios.

---

## 3. Opción B — Hospedar en **IIS**

1. Instale el **.NET Hosting Bundle** (incluye el módulo ASP.NET Core – ANCM).
2. Cree un sitio en IIS apuntando a `C:\apps\DashboardPortal\publish`, binding `http` puerto `80`.
3. El `web.config` se genera al publicar; IIS arranca el proceso (`hostingModel=inprocess`).
4. Configure el *Application Pool* como **No Managed Code** y, si usa BD/red, una identidad con permisos.

> En IIS el puerto lo define el *binding* del sitio (no `Kestrel:Endpoints`).

---

## 4. Permisos para escuchar en el puerto 80

Si ejecuta como `.exe` (no IIS) con una cuenta sin privilegios, reserve la URL:

```powershell
netsh http add urlacl url=http://+:80/ user="DOMINIO\CuentaServicio"
```

Y abra el firewall:

```powershell
New-NetFirewallRule -DisplayName "DashboardPortal HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

---

## 5. Que los dashboards se vean dentro del `iframe`

El portal **embebe** cada dashboard (`http://host:puerto`) en un `iframe`. Para que el navegador lo permita, **cada dashboard** debe **no** bloquear el *framing*:

- No enviar `X-Frame-Options: DENY`.
- Si usa `Content-Security-Policy`, permitir `frame-ancestors` del portal (o `'self'` si es mismo host).
- **Streamlit** (puertos 8501+): habilitar CORS/!XSRF si corresponde. Ejemplo:
  ```toml
  # .streamlit/config.toml
  [server]
  enableCORS = false
  enableXsrfProtection = false
  ```
- El portal envía `X-Frame-Options: SAMEORIGIN` para **sí mismo** (evita que lo embeban a él); esto **no** afecta su capacidad de embeber a otros.

---

## 6. Datos y persistencia

| Elemento | Ubicación | Nota |
|---|---|---|
| BD SQLite | `App_Data\portal.db` (junto al `.exe`) | Respáldela periódicamente. |
| Claves DataProtection | `%LOCALAPPDATA%\ASP.NET\DataProtection-Keys` de la cuenta | Para que las sesiones sobrevivan reinicios, use una cuenta de servicio estable. |

Si despliega en **varias máquinas con balanceo**, configure un repositorio común de claves DataProtection (carpeta compartida) y `sticky sessions` o claves compartidas.

---

## 7. Checklist de seguridad para producción

- [ ] Cambiar `Master:Password`.
- [ ] Mover la contraseña de SQL Server a variable de entorno o *user-secrets*.
- [ ] Restringir el acceso de red al portal (solo LAN).
- [ ] (Opcional) Poner el portal detrás de **HTTPS** con un reverse proxy/IIS y certificado interno; luego cambiar `Portal:DefaultScheme` a `https` si los dashboards también usan TLS.
- [ ] Respaldo de `App_Data\portal.db`.
- [ ] Revisar la auditoría en **Administración → Inicio** (actividad reciente).

---

## 8. Actualizaciones

1. `dotnet publish -c Release -o publish_nuevo`
2. Detener el servicio.
3. Reemplazar binarios **conservando** `App_Data\` y `appsettings.Production.json`.
4. Reiniciar el servicio.

El esquema de la BD se mantiene; no se borran datos al actualizar.
