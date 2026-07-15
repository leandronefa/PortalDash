# VALIDACIÓN — Etapa 6: CSVs idénticos a la Desktop

## ✅ RESULTADO FINAL (2026-07-15): prueba espejo SUPERADA

Comparación SHA256 de CSVs generados por Desktop y Web con los mismos datos, en
`\\vmapp.sportotal.com.ar\importar\PRECIOS`:

| Desktop | Web | Resultado |
|---|---|---|
| `15.7. - LIQUI.csv` | `15.7. - LIQUI_14-51-20.csv` | **IDÉNTICOS** |
| `15.7. - MELI LIQUI.csv` | `15.7. - MELI LIQUI_14-51-20.csv` | **IDÉNTICOS** |
| `15.7.ADIDAS ... - PRECIOS.csv` | `..._10-7-32.csv` | **IDÉNTICOS** |
| `15.7.ADIDAS ... - COSTOS.csv` | `..._10-7-32.csv` | **IDÉNTICOS** |

Cubre el flujo normal (PRECIOS/COSTOS) y el flujo Liquidación (LIQUI/MELI LIQUI),
byte a byte, escritos por el servicio en el share real.

## 1. Validado en esta etapa (offline, sin acceso a la base)

**Arnés de comparación byte a byte del exportador** (2026-07-15): se transcribió literalmente el
`dtTableToCSV` de frmMain.vb como referencia y se comparó contra `Domain/CsvExporter.cs` con
datos representativos (doubles redondeados, DBNull, códigos con guiones).

Resultado: **IDÉNTICOS (374/374 bytes)** ✔

Cubre:
- BOM UTF-16LE (`FF FE`) para los CSVs de PRECIOS y BOM UTF-8 para los auxiliares.
- Separador `;`, encabezado presente, primera columna autonombrada **`Column1`**
  (igual que la Desktop: `Columns.Add("")` la autonombra .NET).
- Números con **coma decimal** (cultura es-AR) y sin separador de miles.
- Redondeo banker's (`0,125 → 0,12`) idéntico a VB `Round`.
- CRLF entre filas y **sin CRLF final**.
- Sufijo `_H-m-s` cuando el archivo ya existe.

## 1b. Validado 2026-07-15 (con acceso a la base)

- `sql/01_crear_objetos_APCWeb.sql` ejecutado: 12 SPs + tablas `APCWeb_` creados.
- `sql/02_ajustes_APCWeb.sql` ejecutado (hallazgos del reporte de dependencias):
  - `APCWeb_SP_..._ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS` escribía en la staging compartida
    `TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR` (typo "ACTUALIZADOR" fuera de patrón)
    → clonada como `APCWeb_TBL_ACTUALIZADOR..._SIN_INFORMAR` y SP repuntado.
  - `APCWeb_SP_..._VALIDAR_LIQUI` repuntado a la tabla ORIGINAL
    `TBL_ACTUALIZARPRECIOSCOSTOS_VALIDACIONES_LIQUIDACION` (las reglas son configuración de
    única verdad, solo lectura); la copia vacía se eliminó.
  - Barrido de INSERT/UPDATE/DELETE/TRUNCATE en los 12 SPs clonados: todas las demás
    escrituras van a tablas `APCWeb_` o temporales. Sin más estado compartido.
- `appsettings.Production.json` configurado; smoke test end-to-end OK: la app en 127.0.0.1:3013
  ejecuta `SP_VALIDAR_INICIO_SESION_APPS` contra el 115 y devuelve la respuesta real del SP.

## 2. Pendiente

Plan de validación funcional, en orden:

3. **Prueba espejo**: con el MISMO Excel de proveedor:
   - Correr la Desktop y exportar a una carpeta de prueba (cambiar temporalmente el destino NO se
     puede — usar la carpeta real y renombrar) o usar un proveedor de prueba coordinado.
   - Correr la Web apuntando `Rutas:Precios` a una carpeta local de staging.
   - Comparar: `fc /b desktop.csv web.csv` para cada archivo (PRECIOS, COSTOS, PVP Vigente,
     ZMELI, ZMELI LIQUI). Deben ser idénticos salvo el timestamp del sufijo si colisionan nombres.
4. Repetir con: proveedor con marca, sin marca, Multimarca, con No Informados activado,
   flujo Liquidación (Grupo/Empresa/Sucursal) y Rebaja (no debe exportar nada).
5. Verificar el log: filas en `APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_LOG` equivalentes a las que la
   Desktop escribe en `TBL_ACTUALIZARPRECIOSCOSTOS_LOG`.
6. Confirmar que la Desktop sigue operando normal durante y después de las pruebas Web
   (staging separado ⇒ sin interferencia).

## 3. Notas de diferencias conocidas y aceptadas

- El log de la Web va a `APCWeb_TBL_..._LOG` (tabla propia) para no escribir en la de la Desktop.
- La edición de reglas desde la Web está deshabilitada en v1 (las reglas se LEEN de las tablas
  existentes: misma verdad ⇒ misma salida). Ver DISENO-WEB.md §3.
- El campo `Fecha` del log usa fecha/hora del servidor (en la Desktop, la de la PC del usuario).
