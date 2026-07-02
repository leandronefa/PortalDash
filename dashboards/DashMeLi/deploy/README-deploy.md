# Guía de Deploy — Tablero Stock

Instrucciones para instalar el tablero como **servicio Windows** en un servidor distinto al de desarrollo.

---

## Requisitos del servidor destino

| Requisito | Versión mínima | Notas |
|---|---|---|
| Windows Server | 2016 / 2019 / 2022 | También funciona en Windows 10/11 |
| Node.js | 18 LTS | https://nodejs.org → LTS |
| Acceso de red | — | Debe llegar a `10.0.0.115:1433` (SQL Server) |
| PowerShell | 5.1+ | Ya incluido en Windows Server 2016+ |

---

## Pasos de instalación

### 1. Instalar Node.js (si no está)

Descargar e instalar desde https://nodejs.org (versión LTS).  
Verificar con:
```powershell
node --version   # debe mostrar v18.x o superior
npm --version
```

### 2. Copiar los archivos al servidor

Copiar **todo el contenido de este proyecto** (excepto `node_modules/` y `.env`) a una carpeta del servidor. Se recomienda:

```
C:\tablero-stock\
```

Estructura mínima necesaria:
```
C:\tablero-stock\
├── server.js
├── package.json
├── package-lock.json
├── public\
│   └── index.html
├── .env.example
└── deploy\
    ├── instalar-servicio.ps1
    └── desinstalar-servicio.ps1
```

> Tip: comprimir el proyecto en un ZIP (sin `node_modules/` ni `.env`) y descomprimir en el servidor.

### 3. Crear el archivo `.env`

En el servidor, dentro de `C:\tablero-stock\`, crear el archivo `.env`:

```env
PORT=3001
DB_HOST=10.0.0.115
DB_USER=sa
DB_PASS=MicroS123
DB_NAME=db_Cegid
```

Ajustar los valores si la IP o credenciales son distintas en ese servidor.

### 4. Ejecutar el instalador

Abrir **PowerShell como Administrador** y ejecutar:

```powershell
Set-Location C:\tablero-stock
Set-ExecutionPolicy RemoteSigned -Scope Process   # habilita scripts locales
.\deploy\instalar-servicio.ps1
```

El script hace automáticamente:
1. Verifica Node.js
2. Instala dependencias npm
3. Instala `pm2` globalmente (gestor de procesos)
4. Registra la app como proceso persistente con pm2
5. Configura el arranque automático con Windows

### 5. Verificar que funciona

```powershell
pm2 status                    # debe mostrar tablero-stock: online
pm2 logs tablero-stock        # ver logs en tiempo real
```

Abrir en el navegador: **http://localhost:3001**  
O desde otra máquina: **http://<IP_DEL_SERVIDOR>:3001**

---

## Comandos de administración

```powershell
pm2 status                        # estado de todos los procesos
pm2 logs tablero-stock            # logs en tiempo real
pm2 restart tablero-stock         # reiniciar (ej: después de cambiar .env)
pm2 stop tablero-stock            # detener el servicio
pm2 start tablero-stock           # iniciar el servicio
pm2 monit                         # monitor interactivo de CPU y memoria
```

---

## Actualizar la aplicación

1. Copiar los archivos nuevos al servidor (sobreescribir `server.js` y `public/`)
2. Reiniciar el servicio:

```powershell
pm2 restart tablero-stock
```

---

## Desinstalar

```powershell
.\deploy\desinstalar-servicio.ps1
```

---

## Firewall (opcional)

Si se necesita acceso desde otras máquinas de la red, abrir el puerto en el firewall del servidor:

```powershell
# Ejecutar como Administrador
New-NetFirewallRule -DisplayName "Tablero Stock 3001" `
    -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `pm2` no se encuentra | pm2 no instalado | `npm install -g pm2` |
| Error de conexión SQL | IP/puerto/credenciales incorrectas | Revisar `.env` y verificar con `telnet 10.0.0.115 1433` |
| Página no carga | Puerto bloqueado | Verificar firewall o cambiar `PORT` en `.env` |
| `EADDRINUSE` al iniciar | Puerto ya en uso | Cambiar `PORT` en `.env` o detener el proceso que lo ocupa |
| Script bloqueado | Política de ejecución | `Set-ExecutionPolicy RemoteSigned -Scope Process` |
