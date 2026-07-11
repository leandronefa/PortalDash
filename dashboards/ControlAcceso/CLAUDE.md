# CLAUDE.md — ControlAcceso (puerto 3012)

> Contexto anidado: aplica al trabajar dentro de `C:\apps\dashboards\ControlAcceso`.

## Qué es

Tablero de **control de acceso de vehículos en portería** (formulario R RH 08-0): registro de
INGRESO/EGRESO de vehículos propios (tractor + semirremolque, kilometraje, conductor, destino,
N° viaje/remito) y no propios (patente libre + tipo de vehículo). Reemplaza la planilla Excel
`R RH O8-0 INGRESO Y EGRESO DE VEHÍCULOS.xlsx` (queda en esta carpeta como referencia del modelo).

Stack: Express + `mssql` (CommonJS, `server.cjs`) sirviendo un frontend React/Vite/TS desde `dist\`.

## Servicio y acceso

- Servicio de Windows: **`dashcontrolacceso.exe`** (node-windows), puerto **3012**, entrada `server.cjs`, bind `127.0.0.1`.
- Acceso de usuarios: **SOLO vía el portal** → `http://10.0.0.118/d/{id}/` (registrar en Administración → Dashboards con puerto 3012).
- Diagnóstico en primer plano:
  ```powershell
  cd C:\apps\dashboards\ControlAcceso; $env:PORT=3012; node server.cjs
  ```
- Logs: `daemon\dashcontrolacceso.exe.err.log`. Reiniciar: `Restart-Service dashcontrolacceso.exe`.
- Reinstalar: `.\install-service.ps1 -Uninstall` y luego `.\install-service.ps1`.

## Login y roles (propios de la app, además de la sesión del portal)

- Tabla `tbl_CtrlAcceso_Usuarios` (db_Cegid @ 10.0.0.115). Hash scrypt `salt:hash`. Token HMAC firmado con `TOKEN_SECRET` del `.env` (12 h).
- **PORTERO**: pestañas Carga, Dentro/Fuera y Movimientos.
- **ADMIN**: además KPIs y Administración (ABM de vehículos, conductores y usuarios; anular movimientos).
- Seed inicial: si la tabla de usuarios está vacía, el server crea **admin / admin** → cambiar la contraseña (botón 🔑).
- No se puede desactivar/degradar al último ADMIN activo (validación en `PUT /api/usuarios/:id`).

## Anti-errores de carga (requisito del diseño)

- Tipo de movimiento, patentes (tractor/semi) y conductores son **opciones a elegir**, no texto libre (para propios).
- Patentes se normalizan a mayúsculas sin espacios/guiones (`normPatente`) — también para no propios.
- El server valida coherencia y devuelve **409 con `avisos`** (el front muestra modal "Corregir / Guardar igual" que reenvía con `forzar:true`):
  - mismo tipo de movimiento consecutivo para la misma unidad/patente (¿dos ingresos seguidos?);
  - kilometraje menor al último registrado del tractor.
- Al elegir un tractor, el front muestra su estado (DENTRO/FUERA) y sugiere el movimiento contrario.

## Dentro / Fuera

Estado por unidad = **último movimiento no anulado**: INGRESO → dentro, EGRESO → fuera
(`/api/estado`, ROW_NUMBER por vehículo; no propios agrupados por patente). Los movimientos
no se borran: se **anulan** (`Anulado=1`, solo ADMIN) y quedan excluidos de estado y KPIs.

## Base de datos

Tablas `tbl_CtrlAcceso_{Usuarios,Vehiculos,Conductores,Movimientos}` en **db_Cegid @ 10.0.0.115**.
El esquema se crea solo al arrancar (`ensureSchema`, idempotente); `SQL\01_Database.sql` es documentación.

## Gotchas

- **CommonJS estricto** (sin `"type":"module"`).
- El SQL Server destino **no soporta `LEAD`** (versión vieja) → la permanencia de no propios en `/api/kpis` usa `CROSS APPLY`; no reintroducir funciones de ventana de valor (LEAD/LAG/FIRST_VALUE).
- Cambios de frontend → `npm run build` + `Restart-Service dashcontrolacceso.exe`.
- Paleta de gráficos validada por modo (dataviz): claro `#3b82f6`/`#e08a00`, oscuro `#4a90d9`/`#bd8128` (variables `--chart-ingreso`/`--chart-egreso` en `styles.css`).
- `.env` con `SQL_PASSWORD` y `TOKEN_SECRET`: no commitear (ya está en `.gitignore`).
