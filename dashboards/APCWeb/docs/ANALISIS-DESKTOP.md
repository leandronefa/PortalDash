# ANÁLISIS — ActualizarPreciosCostos (Desktop)

> Etapa 1-2 del proyecto APCWeb. Fuente analizada: `C:\apps\ActualizarPreciosCostos` (solo lectura, NO se modificó nada).
> Fecha de análisis: 2026-07-15.

## 1. Qué es

Aplicación de escritorio **VB.NET WinForms (.NET 6.0-windows, DevExpress 22.1)** para actualizar precios y costos de artículos contra SQL Server. Importa listas de proveedores desde Excel, valida contra reglas de negocio (almacenadas en SQL) y exporta CSVs que consume el ERP (Cegid) vía la carpeta `\\vmapp.sportotal.com.ar\importar\PRECIOS`.

## 2. Arquitectura

- **Todo el acceso a datos pasa por stored procedures** vía la librería externa `ConexionBBDD.dll` (no está en el repo; HintPath a Documents del desarrollador):
  - `ConexionSQL.EjecutarSP(nombre, params...)` → `DataTable` (posicional, se lee por índice de columna).
  - `ConexionSQL.exportDataTableToTableSQL(dt, "TBL_...")` → bulk insert (equivalente a `SqlBulkCopy`).
- **Conexión**: la DLL lee `Config.xml` junto al exe. Valores relevados del binario desplegado:
  - Servidor: **10.0.0.115** — Base: **db_cegid** — Timeout: 1600000. (Credencial en campo `Licencia`, no relevada por seguridad.)
- La lógica de negocio pesada (PVP vigente, márgenes ponderados, stock, no informados) vive en los **SPs**; el código VB orquesta DataTables en memoria y arma los CSVs.

## 3. Puntos de entrada y flujo general

### 3.1 Login (`frmLogin.vb`)
1. `SP_CHECK_VERSION_APP(NombreApp)` → compara `NroVersion` con la versión del exe; si difiere lanza `ActualizApp.exe` (auto-update FTP) y termina. **(No aplica a la Web.)**
2. `SP_VALIDAR_INICIO_SESION_APPS(usuario, password)` → devuelve `"ok"` o mensaje de error.
3. `SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_PERFIL(usuario)` → perfil (`"Administrador"` habilita edición de reglas y la pestaña 4).

### 3.2 Pantalla principal (`frmMain.vb`, ~3050 líneas, god-form)
Pestañas (`tabMain`):
- **Por Proveedor** (`cmbProveedoresP` + `cmbMarcaP`): selecciona proveedor y opcionalmente marca.
- **Por Marca** (`cmbMarcaM` → `cmbProveedoresM`): al elegir marca se cargan sus proveedores.
- **Multimarca** (`cmbProveedoresMM`): proveedor sin marca; la marca viene por fila en el Excel (columna 7).
- **Liquidación** y **Rebaja** (`tabLiquidación`, `tabRebaja`): flujo staging en SQL. La pestaña 4 (índice 3) solo para Administrador.

Combos poblados con: `SP_..._OBTENER_NOMBRE_PROVEEDORES` (`NOMPROV`), `SP_..._OBTENER_NOMBRE_MARCAS` (`NOMMARCA`), `SP_..._OBTENER_MARCA_PROVEEDOR(prov)`, `SP_..._OBTENER_PROVEEDOR_MARCA(marca)`, `SP_..._OBTENER_EMPRESAS` (`Empresa`), `SP_..._OBTENER_SUCURSALES` (`nomSucursal`).

## 4. Flujo REBAJA/ORIGINAL (pestañas Proveedor / Marca / Multimarca)

### 4.1 Importación Excel
- `OpenFileDialog` *.xlsx → OleDb ACE 12.0, `HDR=YES`, `SELECT * FROM [ListaPROV$]` (hoja fija **ListaPROV**).
- Se eliminan filas con `CODIGO` nulo/vacío (en Liqui/Rebaja la columna clave es `CODIGO ARTICULO`).
- Columnas esperadas del Excel: `CODIGO`, `DESCRIPCION`, `$ CONF#`, `Costo EV`, `$ PUBL#`, `OBS` (+ `MARCA` en Multimarca, columna índice 6).
  ⚠️ Los nombres `$ CONF#` / `$ PUBL#` los produce el proveedor **ACE de OleDb, que reemplaza `.` y `!` por `#`** en los encabezados: en el Excel físico las columnas son `$ CONF.` y `$ PUBL.`. La Web replica ese reemplazo en `ExcelImporter` (verificado con Excel real, 2026-07-15).
- `CODIGO` se define como PrimaryKey → si hay repetidos: error "Codigo de Articulo Repetido" y aborta.
- Se agregan columnas de trabajo a `dtMain`: `MARCA` (si falta), `PVPAnt`, `CostoAnt`, `PerTarifa`, `Margen`, `Estado`, `Nombre`, `EstadoPVP`, `Usuario`, `Fecha`, `IncCosto`, `IncPVP`, `Regla1..Regla7`, `Seccion`.

### 4.2 Validación por fila (`ValidarDatos`)
Por cada fila del Excel:
1. `SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_PRECIO_COSTO(codigo, NombreProveedor, NombreMarca)` (en Multimarca la marca sale de la fila). Devuelve N filas (una por código de proveedor) con columnas posicionales:
   - `[0]` PVP anterior, `[1]` Costo anterior, `[2]` Tarifa (`"XXX- ..."`, puede ser NULL), `[3]` IVA, `[4]` Nombre/Descripción, `[5]` Código proveedor (CodigoProv), `[6]` Estado PVP, `[7]` Sección.
   - Si devuelve `Nothing` → artículo **"Sin Articulos"** (`PVPAnt=0, CostoAnt=0, PerTarifa="---"`, contador NotFound).
2. Cálculos (redondeo = `Math.Round` default .NET, **banker's rounding**, 2 decimales):
   - `Margen = Round((((PVPNuevo/(1+IVA/100)) - CostoNuevo)) / (PVPNuevo/(1+IVA/100)) * 100, 2)`
   - `IncCosto = Round((CostoNuevo-CostoAnt)*100/CostoAnt, 2)` ; `IncPVP = Round((PVPNuevo-PVPAnt)*100/PVPAnt, 2)`
   - `Periodo`: **siempre "PERMAN"** (cambio 03-07-2025; antes se parseaba el prefijo de la tarifa).
   - `Fecha = Today & " " & TimeOfDay` (formato cultura regional del equipo).
3. **Si `PVPNuevo = PVPAnt` y `CostoNuevo = CostoAnt` → Estado "Sin Cambio"** (no genera CSV).
4. Reglas (de `SP_..._OBTENER_REGLAS`, tabla `TBL_..._VALIDACIONES`, identificadas POR POSICIÓN de fila; col `[1]`=valor, col `[2]`=activa). Cada evaluación guarda log en `ReglaN` como `"True:valor"`/`"False:valor"`. Orden y textos de error EXACTOS:
   1. `CostoNuevo > CostoAnt*(1+v/100)` → `"Costo Nvo. > v%"`
   2. `CostoNuevo < CostoAnt - CostoAnt*(v/100)` → `"Costo Nvo. < v%"`
   3. `CostoNuevo > PVPNuevo` → `"Costo > Precio"`
   4. Periodo PERM/PERMAN y `Margen < v` → `"Margen < v%"`
   5. Periodo ≠ PERM/PERMAN y `Margen < v` → `"Margen < v%"`
   6. `PVPNuevo < PVPAnt - PVPAnt*(v/100)` → `"Mas de v% del Precio Anterior"`
   7. `Margen > v` → `"Margen > v%"`
   - Primera regla violada corta y define `Estado`; si ninguna → `Estado = "OK"`.
5. **Solo si pasa todas las reglas** (llega al final de `ValidarDatos`), por CADA fila devuelta por el SP (cada CodigoProv):
   - `dtCSVCostos.Add("LP1C1_", CodigoProv, CostoNuevo, "VACOM", "PERMAN", "", "Y")`
   - `dtCSVPrecios.Add("LP1C1_", CodigoProv, PVPNuevo, "Z1", "PERMAN", "", "Y")`
   - Si `PeriodoArt` (parseado de la tarifa de ESA fila: texto antes de `"-"`, `Trim`) NO es PERM/PERMAN:
     - `SP_..._OBTENER_PVPVigente(codigo, NombreProveedor, NombreMarca)` → PVPVigente
     - `SP_..._CALCULAR_PVPVigente(PVPVigente, IncPVP/100+1)` → PVPVigenteIncrementado
     - **Solo si incrementa** (`> PVPVigente`): `dtCSVPVPVigente.Add("LP1C1_", CodigoProv, PVPVigenteIncrementado, "Z1", PeriodoArt, "", "N")`
   - `ObtenerPrecioZMELI(CodigoProv)` → si no es Nothing: `SP_..._CALCULAR_PVPVigente(ZMELI, IncPVP/100+1)` y **siempre** (cambio 14-07-2025) `dtCSVPVPZMELI.Add("LP1C1_", CodigoProv, ZMELIIncrementado, "ZMELI", "MELIP", "", "N")`
   - `ObtenerPrecioDiferencialMELI(CodigoProv)` → si no es Nothing: columnas `DIFERENCIAL` y `PERIODO`; `SP_..._CALCULAR_PVPVigente(dif, IncPVP/100+1)` y **siempre** (cambio 23-02-2026) `dtCSVPVPZMELILiqui.Add("LP1C1_", CodigoProv, ZMELIIncrementadoLiqui, "ZMELI", ZMELIPeriodo, "", "N")`
   - (ZWEB / `ObtenerPrecioDiferencial` está COMENTADO — `dtCSVPVPDiferencial` nunca se llena, pero el export lo contempla si tuviera filas.)

Contadores: `Ok`, `Fail`, `NotFound` ("Sin Articulos"), `NoInformado`, `SinCambios`, `Total = Ok+Fail+NoInformado+SinCambios` (NotFound NO suma al total).

### 4.3 No Informados (switch `swtNoInformados`)
Si está activo tras validar:
1. `SP_..._BORRAR_TLBOK` + bulk insert de los códigos del Excel a `TBL_ACTUALIZARPRECIOSCOSTOS_OK`.
2. Multimarca: bulk de marcas de las filas a `TBL_..._MARCAS`, `SP_..._OBTENER_MARCAS_DISTINCT`, y por cada marca `SP_..._ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS(prov, marca)` (merge). Normal: una sola llamada con prov/marca seleccionados.
3. Por cada no informado: `SP_..._OBTENER_PRECIO_COSTO` de nuevo, y se agrega a `dtMain` con `Estado="No Informado"` (Periodo = prefijo tarifa o NULL) y a `dtNoInformados` para exportar.

### 4.4 Edición de filas con error (`ValidarDatosEditados`)
Doble click en fila no-OK → edición en grilla → revalida con `SP_..._OBTENER_PRECIO_COSTO` (o `SP_..._OBTENER_PRECIO_COSTO_MM` si Multimarca). Diferencias vs `ValidarDatos`:
- Las reglas se evalúan TODAS en orden inverso (7→1) sin cortar; la última violada gana (`Estado` se sobreescribe).
- Regla 6 usa fórmula distinta: `PVPNuevo < PVPAnt - PVPAnt*(1-(v/100))` con condición `(Periodo<>"PERM") Or (Periodo<>"PERMAN")` (siempre True — bug preservado tal cual).
- El bloque PVP Vigente además excluye `Periodo="HS24"`.
- El Periodo se parsea de la tarifa (NO fuerza PERMAN) para el CSV de PVP Vigente.
- Si queda OK genera las MISMAS filas de CSV que 4.2 (`Ok+=1`), sino `Estado` y `Fail+=1`.
- Botón "Masivo" (`btnMasivo`): pide CostoNvo y PVPNvo por InputBox y aplica `ValidarDatosEditados` a todas las filas visibles del filtro actual (Error o No Informados), ajustando contadores.

### 4.5 Exportación (btnExportar, pestañas normales)
Destino fijo: `\\vmapp.sportotal.com.ar\importar\PRECIOS`. Con `dd.M.` de hoy (día y mes SIN cero a la izquierda) y proveedor/marca sin `*`:
- `{d}.{M}.{Prov} - {Marca} - PRECIOS.csv` ← dtCSVPrecios
- `{d}.{M}.{Prov} - {Marca} - COSTOS.csv` ← dtCSVCostos
- `{d}.{M}.{Prov} - {Marca} - PVP Vigente.csv` ← dtCSVPVPVigente (solo si tiene filas)
- `{d}.{M}.{Prov} - {Marca} - PVP Diferencial.csv` ← dtCSVPVPDiferencial (solo si tiene filas; hoy nunca)
- `{d}.{M}.{Prov} - {Marca} - ZMELI.csv` ← dtCSVPVPZMELI (solo si tiene filas)
- `{d}.{M}.{Prov} - {Marca} - ZMELI LIQUI.csv` ← dtCSVPVPZMELILiqui (solo si tiene filas)

**Formato CSV (`dtTableToCSV`)** — CRÍTICO para compatibilidad byte a byte:
- Encoding **Unicode (UTF-16 LE con BOM)** para los CSVs de PRECIOS; separador `;`; con encabezados.
- Estructura de columnas (todos los CSV de precios/costos): `("", Codigo, Precio, Tarifa, Periodo, Depot, Maestro)` — la primera columna se llama vacío y su valor es `"LP1C1_"`; `Depot` siempre vacío; `Maestro` = `"Y"` (precios/costos) o `"N"` (PVP vigente/ZMELI).
- Línea de encabezado + `vbCrLf`; filas separadas por `vbCrLf`; **la última fila NO lleva CRLF final**.
- Los valores se escriben con `ToString()` del valor del DataTable (números en cultura regional del equipo — es-AR: coma decimal).
- Si el archivo ya existe: sufija `_H-m-s` (hora actual sin ceros) antes de `.csv`.
- Después de escribir cada CSV el DataTable se **Dispose()** (queda vacío para el resto del flujo).

**Log**: filas `Estado='OK'` de dtMain → se quitan columnas `DESCRIPCION`, `$ CONF#`, `OBS`, `Estado`, `IncCosto`, `IncPVP`, `Seccion` + columnas 100% vacías (`EliminarColumnasVacias`); se agrega `ObtenerNoInformados` (valor del switch); `MARCA` se mueve al ordinal 19; bulk insert a `TBL_ACTUALIZARPRECIOSCOSTOS_LOG`.
(El correo a compras `SP_..._OBTENER_CORREOS` + `SP_ENVIO_MAIL` está comentado.)

### 4.6 Exports auxiliares (a `\\10.0.0.115\Actualizar Precios y Costos\`, Encoding **UTF-8**)
- **btnNoInformados**: agrega columna `Stock` (por fila `SP_..._STOCK(codigo, prov, marca)`), CSV `{Prov} - {Marca} - NO INFORMADOS.csv` (o `- Multimarca -`), luego `SP_..._ENVIAR_CORREO_NO_INFORMADOS(usuario, prov, marca)`.
- **btnLiqui**: filas `PerTarifa <> PERMAN/PERM` de dtMain, quita columnas de trabajo, agrega `Stock`, CSV `{Prov} - {Marca} - LIQUI.csv`, `SP_..._ENVIAR_CORREO_LIQUIS(usuario, prov, marca)`.
- **btnEnviarFail**: filas con Estado error (≠OK/Sin Cambio/No Informado y PerTarifa≠`---`), CSV `{Prov} - {Marca} - ERRORES.csv`, `SP_..._ENVIAR_CORREO_ERRORES(usuario, prov, marca)`.
- **btnEnviarTodo**: dtMain completo → `TODO.csv`, `SP_..._ENVIAR_CORREO_TODO(usuario)`.

## 5. Flujo LIQUIDACIÓN / REBAJA (`tabLiquidación`, `tabRebaja`)

1. Excel hoja **`Z1$`**, clave `CODIGO ARTICULO` (PrimaryKey; filas con clave vacía se descartan). Columnas usadas: `[0]` código, `[1]` precio liquidación, `[2]` fecha/periodo (col índice 2 se usa como "Periodo" del CSV).
2. Se agregan columnas `RECEPCION, PVP, MARGEN, PENDIENTE, PARETO, ESTADO`.
3. `ValidarDatosLiqui()`:
   - Staging: copia de dtMain con solo 2 columnas (elimina 7 columnas desde el índice 2) → `SP_..._BORRAR_ARTICULOS_LIQUI` → bulk a `TBL_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_LIQUIDACION_TEMP` → `SP_..._ACTUALIZAR_ARTICULOS_LIQUI`.
   - Según radio Grupo/Empresa/Sucursal (`rgbLiqui` 0/1/2): `SP_..._VALIDAR_MARGEN_LIQUI[_EMPRESA|_SUCURSAL](texto)` → margen; y `SP_..._VALIDAR_MARGEN_LIQUI[_EMPRESA|_SUCURSAL]_PONDERADO` → pareto.
   - Por fila: `SP_..._VALIDAR_LIQUI(codigo, precio, margen[0][2]*100, Round(pareto[0][0]*100,2))` → 5 filas de resultado (RECEPCION, PVP, MARGEN, PENDIENTE, PARETO); cada una se fuerza a `"OK"` si su regla (de `SP_..._OBTENER_REGLAS_LIQUIDACION`, filas 0-4) está inactiva.
   - Si las 5 = OK → `ESTADO="OK"` y filas CSV:
     - `dtCSVLIQUI.Add("LP1C1_", codigo, precio, "Z1", excelCol2, "", "N")`
     - `dtCSVMELILIQUI.Add("LP1C1_", codigo, precio, "ZMELI", "MELIL", "", "N")`
   - Si no → `ESTADO="ERROR"`, concatena los mensajes no-OK con `"-"` y agrega dos filas a `dtCSVERRORLIQUI` (tarifas Z1 y ZMELI, columna extra `ERROR`).
4. Export (btnExportar, tab Liquidación) a PRECIOS, Encoding Unicode: `{d}.{M}. - LIQUI.csv` y `{d}.{M}. - MELI LIQUI.csv`.
   **La pestaña Rebaja NO exporta nada** (case vacío) — comportamiento a preservar.
5. btnEnviarFail (tab Liquidación): `LIQUI-ERRORES.csv` (UTF-8) a `\\10.0.0.115\Actualizar Precios y Costos\` + `SP_..._ENVIAR_CORREO_LIQUI_ERRORES(usuario)`.

## 6. Reglas (frmReglas / frmReglasLiqui) — solo Administrador

- Cargan `SP_..._OBTENER_REGLAS` / `SP_..._OBTENER_REGLAS_LIQUIDACION` en grilla editable.
- Guardar = **borrar todo + reinsertar**: `SP_..._BORRAR_TBLVALIDACIONES` + bulk a `TBL_..._VALIDACIONES` (y variante LIQUI: `SP_..._BORRAR_TBLVALIDACIONESLIQUI` + `TBL_..._VALIDACIONES_LIQUIDACION`).
- frmReglas además loguea a `TBL_..._VALIDACIONES_LOG` (usuario, fecha, estado activo de las 7 reglas).
- En ReglasLiqui la fila índice 3 (PENDIENTE) no es editable.
- Si alguna regla está inactiva, frmMain muestra advertencia naranja.

## 7. Inventario completo de objetos SQL referenciados

### SPs de solo lectura (no cambian de estado compartido)
| SP | Uso |
|---|---|
| SP_VALIDAR_INICIO_SESION_APPS | login (compartido con otras apps) |
| SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_PERFIL | perfil |
| SP_CHECK_VERSION_APP | versión desktop (no aplica Web) |
| SP_..._OBTENER_NOMBRE_PROVEEDORES / _OBTENER_NOMBRE_MARCAS / _OBTENER_MARCA_PROVEEDOR / _OBTENER_PROVEEDOR_MARCA | combos |
| SP_..._OBTENER_EMPRESAS / _OBTENER_SUCURSALES | combos Liqui |
| SP_..._OBTENER_PRECIO_COSTO / _OBTENER_PRECIO_COSTO_MM | datos del artículo |
| SP_..._OBTENER_PVPVigente / _CALCULAR_PVPVigente | PVP vigente e incremento |
| ObtenerPrecioZMELI / ObtenerPrecioDiferencialMELI / (ObtenerPrecioDiferencial, comentado) | precios ZMELI/diferencial |
| SP_..._OBTENER_REGLAS / _OBTENER_REGLAS_LIQUIDACION | reglas |
| SP_..._STOCK | stock por artículo |
| SP_..._OBTENER_CORREOS + SP_ENVIO_MAIL | (comentados) |

### SPs con efectos (envían correo — reusables sin cambio)
SP_..._ENVIAR_CORREO_NO_INFORMADOS, _ENVIAR_CORREO_LIQUIS, _ENVIAR_CORREO_ERRORES, _ENVIAR_CORREO_TODO, _ENVIAR_CORREO_LIQUI_ERRORES. (Presumiblemente adjuntan los CSVs de `\\10.0.0.115\Actualizar Precios y Costos\` — verificar definición.)

### SPs/tablas con ESTADO COMPARTIDO (conflicto si Desktop y Web corren en paralelo → requieren copia APCWeb_)
| Objeto | Motivo |
|---|---|
| TBL_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_LIQUIDACION_TEMP | staging Liqui (borrar+insertar) |
| SP_..._BORRAR_ARTICULOS_LIQUI / SP_..._ACTUALIZAR_ARTICULOS_LIQUI | operan sobre staging + tabla definitiva interna |
| SP_..._VALIDAR_LIQUI y los 6 SP_..._VALIDAR_MARGEN_LIQUI* | leen las tablas de staging/definitiva de Liqui |
| TBL_ACTUALIZARPRECIOSCOSTOS_OK + SP_..._BORRAR_TLBOK | staging No Informados |
| SP_..._ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS | lee TBL_..._OK |
| TBL_ACTUALIZARPRECIOSCOSTOS_MARCAS + SP_..._OBTENER_MARCAS_DISTINCT | staging marcas Multimarca |
| TBL_ACTUALIZARPRECIOSCOSTOS_LOG | log de actualizaciones (bulk insert por orden de columnas) |
| TBL_..._VALIDACIONES / _VALIDACIONES_LIQUIDACION / _VALIDACIONES_LOG + SP_..._BORRAR_TBLVALIDACIONES[LIQUI] | edición de reglas = delete-all + reinsert |

## 8. Salidas (resumen de archivos)

| Archivo | Destino | Encoding | Cuándo |
|---|---|---|---|
| `{d}.{M}.{Prov} - {Marca} - PRECIOS/COSTOS.csv` | \\vmapp...\importar\PRECIOS | UTF-16LE BOM | siempre al exportar |
| `... - PVP Vigente / PVP Diferencial / ZMELI / ZMELI LIQUI.csv` | idem | UTF-16LE BOM | solo si hay filas |
| `{d}.{M}. - LIQUI.csv` / `{d}.{M}. - MELI LIQUI.csv` | idem | UTF-16LE BOM | export Liquidación |
| `{Prov} - {Marca} - NO INFORMADOS / LIQUI / ERRORES.csv`, `TODO.csv`, `LIQUI-ERRORES.csv` | \\10.0.0.115\Actualizar Precios y Costos | UTF-8 | botones auxiliares |

## 9. Riesgos / detalles a preservar tal cual

1. **Banker's rounding** (`Math.Round` .NET default) en todos los cálculos.
2. **Cultura regional** en `ToString()` de números y fechas dentro de los CSVs (es-AR: coma decimal, fecha `d/M/yyyy`). La Web debe fijar `CultureInfo` es-AR para producir bytes idénticos.
3. Nombres de archivo con día/mes sin cero (`15.7.`), sufijo `_H-m-s` si existe.
4. Sin CRLF final tras la última fila del CSV; header siempre presente; primera columna sin nombre.
5. Diferencias deliberadas entre `ValidarDatos` (corta en la primera regla, PERMAN forzado) y `ValidarDatosEditados` (evalúa 7→1 sin cortar, fórmula regla 6 distinta, exclusión HS24, periodo real) — **incluidos los bugs**; se replican sin corregir.
6. `dtTableToCSV` hace `Dispose()` del DataTable: cada CSV solo puede exportarse una vez por corrida.
7. Los SPs se leen por índice de columna: las copias APCWeb_ deben devolver exactamente las mismas columnas en el mismo orden.
8. Pestaña Rebaja valida pero no exporta (case vacío).
9. `SP_..._VALIDAR_LIQUI` recibe `margen*100` y `Round(pareto*100, 2)`.
