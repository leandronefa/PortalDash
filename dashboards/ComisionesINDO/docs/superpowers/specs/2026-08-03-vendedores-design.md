# Módulo Vendedores — diseño

**Fecha**: 2026-08-03
**Dashboard**: ComisionesINDO (puerto 3011, `/d/8/`)
**Tipo**: módulo nuevo — visor de lectura + ABM de importes de escalones

---

## 1. Problema

Las comisiones de vendedores de INDO ya se calculan íntegramente en SQL Server (`db_Cegid`, 10.0.0.115) mediante un job batch, y el resultado se distribuye por mail como un `.xls`. Hoy no hay forma de consultarlas desde el dashboard, y **cambiar los importes de escalones obliga a entrar a la base de datos a mano**.

El módulo resuelve las dos cosas: mostrar el resultado del período en el dashboard, y permitir editar los importes desde la web sin perder el histórico.

## 2. Lo que ya existe en SQL (no se toca)

### Cadena de cálculo

`SP_ComisionesINDO` es el orquestador. **No es invocable desde la UI**: no toma parámetros, elige por sí mismo la próxima fecha pendiente de `tbl_CoVenApp_FechaCalculoINDO` (`enviado = 0`), genera `C:\CoVenApp\Reportes\ComisionesIndo.xls` con `bcp` vía `xp_cmdshell`, **manda un mail real** (`SP_ENVIO_MAIL` a nelida.rojo@valenet.com.ar) y marca `enviado = 1`. Llama en orden a:

```
sp_CoVenApp_CargarGrillaVendedoresDetallesINDO   detalle diario
sp_CoVenApp_CargarGrillaVendedoresINDO           consolida por sucursal
sp_CoVenApp_CargarGrillaVendedoresPROPORCIONALINDO  ajuste por licencias
sp_CoVenApp_ComisionarINDO                       marca si comisiona
sp_CoVenApp_LlenarEscalonesINDO                  umbrales + importes por sucursal
sp_CoVenApp_CalcularComisionesINDO               comisión por vendedor
```

### Reglas de negocio implementadas en esos SPs

- **Umbrales por sucursal** (`sp_CoVenApp_LlenarEscalonesINDO`): parte de `METRIX.dbo.OBJETIVOS_MILLON.OBJETIVO_VENTAS` del período (solo `> 1000`) y calcula `1er = objetivo × 0,97`, `2do = 1er × 1,10`, `3er = 2do × 1,15`. Después divide los tres por `CantidadVendedores` de la sucursal, donde cada vendedor con **más de 5 días de venta** pesa 1 si es full time y 0,5 si es part time (los de ≤ 5 días pesan 0).
- **Importe por escalón**: resuelto con `TOP 1 ... WHERE (Año*100 + Mes) <= (período) ORDER BY Año DESC, Mes DESC` sobre `tbl_CoVenApp_ImportesEscalonesINDO`, y **congelado** en las columnas `ImportePrimerEscalon` / `ImporteSegundoEcalon` / `ImporteTercerEscalon` de `tbl_CoVenApp_EscalonesINDO` (una fila por sucursal/período).
- **Comisión por vendedor** (`sp_CoVenApp_CalcularComisionesINDO`): compara `ventacalculada + vtaproporcional` contra los umbrales congelados, de mayor a menor (`>= 3er` → `>= 2do` → `>= 1er` → 0), y paga el importe congelado correspondiente. **Part time cobra la mitad** (`/ 2`). Nótese que el `AND gv.comisiona = 1` está comentado en el SP: la marca `comisiona` no filtra el pago.

### Tablas involucradas

| Tabla | Granularidad | Campos que usa el módulo |
|---|---|---|
| `tbl_CoVenApp_GrillaVendedoresINDO` | vendedor/período | `idVendedor, idSucursal, mes, año, ventareal, DiasVenta, ventacalculada, vtaproporcional, diaslicencia, comisiona, parcial` |
| `tbl_CoVenApp_GrillaComisionesINDO` | vendedor/período | `comision` (**la comisión real**) |
| `tbl_CoVenApp_EscalonesINDO` | sucursal/período | `CantidadVendedores`, 3 umbrales, 3 importes congelados |
| `tbl_CoVenApp_ImportesEscalonesINDO` | vigencia (`Descripcion`, `Mes`, `Año`) | `FullTime` — **única tabla que el módulo escribe** |
| `tbl_CoVenApp_Vendedores` | vendedor | `NRO_VENDEDOR, NOMBRE, APELLIDO, GCL_TEMPSPARTIEL` |
| `tbl_CoVenAppINDO_Sucursales` | sucursal | `nombre` (para mostrar) |

### Estado de los datos (relevado 2026-08-03)

- Períodos con datos: **2024-12 a 2026-07**, ~156 vendedores en 32 sucursales por mes.
- `tbl_CoVenApp_GrillaVendedoresINDO.comision` está **siempre en 0** — la comisión vive solo en `GrillaComisionesINDO`.
- `ImportesEscalonesINDO` tiene 9 filas = 3 vigencias: 2025-01 (80.000/10.000/18.000), 2025-05 (10.000/13.000/26.000) y **2025-09 (12.000/15.000/30.000, la vigente)**.
- `idImportesEscalones` es IDENTITY; la tabla **no tiene PK ni índice único** → la unicidad de vigencia se valida en la app.
- Cruce de sucursales verificado para 2026-06: las 32 de la grilla existen con nombre en `tbl_CoVenAppINDO_Sucursales`; 0 vendedores sin nombre; 0 vendedores sin fila de escalón. Hay **1 sucursal con escalón y sin vendedores** (33 escalones vs 32 sucursales en la grilla).
- El motor SQL es **SQL Server 2008 R2**, no 2012: `TRY_CONVERT` no existe (`DATEFROMPARTS` tampoco). Corregir esta afirmación en `CLAUDE.md`.

## 3. Alcance

**Incluye**: un router nuevo, un servicio puro con sus tests, una página nueva y una entrada de sidebar. El único write nuevo va a `tbl_CoVenApp_ImportesEscalonesINDO`.

**Excluye explícitamente**:
- Ningún SP se crea ni se modifica.
- No hay botón de "recalcular": disparar la cadena mandaría mails reales y movería las banderas de `FechaCalculoINDO`. El recálculo sigue siendo del job SQL.
- No se toca `calcEngine.js` ni ningún módulo blindado (Cajeros, Operadores, Encargados, Supervisores, Total, Dashboard, visores DATOS).

## 4. Preservación del histórico de importes

Se adopta la semántica que **ya tiene el SQL**: `ImportesEscalonesINDO` es una tabla de vigencias y el SP resuelve la última vigencia `<=` período.

**Regla del ABM**: para cambiar los montos se **crea una vigencia nueva** (ej. 2026-08). Los períodos anteriores siguen resolviendo su vigencia vieja, así que recalcular 2026-06 devuelve lo mismo que hoy. No hace falta ninguna tabla nueva: el congelamiento por período ya lo hace `EscalonesINDO`.

Editar o borrar una vigencia existente **sí está permitido** (para corregir una carga equivocada), pero la UI advierte qué períodos quedarían alcanzados si se los recalcula: todos los `>=` esa vigencia y `<` la vigencia siguiente.

## 5. Backend — `server/routes/vendedores.js`

Montado en `/api/vendedores` con `authMiddleware` + `attachScope` + `blockWriteIfSupervisor`, igual que los otros 10 routers: el perfil 8 (supervisor) ve solo sus sucursales asignadas y recibe 403 en cualquier método no-GET.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/?periodo=YYYY-MM` | Resultado del período agrupado por sucursal, con los vendedores anidados. |
| `GET` | `/importes?periodo=YYYY-MM` | Todas las vigencias, marcando la vigente para ese período. |
| `POST` | `/importes` | Nueva vigencia: inserta las 3 filas en una transacción. |
| `PUT` | `/importes/:anio/:mes` | Reemplaza los 3 montos de una vigencia existente. |
| `DELETE` | `/importes/:anio/:mes` | Borra la vigencia completa (3 filas). |

### `GET /` — forma de la respuesta

```json
{
  "ok": true,
  "periodo": "2026-06",
  "vigencia": { "anio": 2025, "mes": 9, "primer": 12000, "segundo": 15000, "tercer": 30000 },
  "sucursales": [
    {
      "sucursal_id": 2, "sucursal_nombre": "VALLEJO CALZADOS 02",
      "cant_vendedores": 3, "primer_escalon": 20149098.67,
      "segundo_escalon": 22164008.53, "tercer_escalon": 25488609.81,
      "importe_primer": 12000, "importe_segundo": 15000, "importe_tercer": 30000,
      "total_comision": 60000,
      "vendedores": [
        { "legajo": "1621", "nombre": "PEREZ JUAN", "jornada": "full",
          "venta_real": 22687902, "dias_venta": 25, "venta_calculada": 22687902,
          "vta_proporcional": 0, "dias_licencia": 0, "comisiona": true,
          "escalon": 2, "comision": 15000, "desfasado": false }
      ]
    }
  ],
  "totales": { "sucursales": 32, "vendedores": 158, "comision": 1234500 }
}
```

Una sola query: `INNER JOIN` a `EscalonesINDO` (sin umbrales no hay nada que mostrar) y `LEFT JOIN` a `GrillaComisionesINDO`, `tbl_CoVenApp_Vendedores` y `tbl_CoVenAppINDO_Sucursales` — un vendedor sin fila de comisión o sin ficha aparece igual, con comisión 0 y marcado `desfasado`, en vez de desaparecer de la vista. `CAST(g.idSucursal AS INT)` para cruzar el varchar con el int (no usar `TRY_CONVERT`: SQL 2008 R2). El armado por sucursal se hace en JS, no en SQL.

Sucursales con escalón pero **sin vendedores en el período no se listan** (el join es sobre la grilla).

Filtrado de scope con `filtrarPorSucursal(rows, permitidas, 'sucursal_id')` de `server/utils/scopeFiltro.js`, aplicado antes de agrupar.

### Escalón alcanzado y detección de desfasaje

El campo `escalon` se **deriva** comparando `venta_calculada + vta_proporcional` contra los umbrales congelados, con el mismo criterio del SP. La `comision` que se muestra es **siempre la persistida** en `GrillaComisionesINDO`, nunca recalculada.

Si el importe que correspondería al escalón derivado (a la mitad si es part time) **no coincide** con la comisión persistida, la fila se marca `desfasado: true` y la UI le pone un ⚠️. Eso pasa cuando se editaron importes de una vigencia y el período no se re-procesó — es justamente el riesgo que introduce el ABM, y queda visible.

### Validaciones del ABM

- `anio` entero entre 2020 y 2100; `mes` entero 1-12.
- Los 3 montos: enteros `>= 0`.
- `POST`: rechaza (409) si la vigencia ya existe.
- `PUT`/`DELETE`: rechaza (404) si la vigencia no existe.
- `POST` inserta exactamente las 3 descripciones `PRIMER ESCALON` / `SEGUNDO ESCALON` / `TERCER ESCALON` (los strings que el SP busca, en mayúsculas, sin acento) dentro de una transacción; si falla una, no queda una vigencia a medias.
- `DELETE` rechaza (409) si es la única vigencia que queda — sin ninguna vigencia el SP resolvería importe 0 para todos los períodos.

### Jornada: se usa la congelada, no la actual

`GrillaVendedoresINDO.parcial` (`'X'` = part time, `'-'` = full) es la jornada **congelada en el momento del cálculo**, mientras que `tbl_CoVenApp_Vendedores.GCL_TEMPSPARTIEL` es la actual. El módulo muestra y usa la **congelada** (`parcial`), porque es la que el SP aplicó al dividir por 2 — así el chequeo de `desfasado` no da falsos positivos cuando alguien pasó de full a part después del cálculo. Si la actual difiere de la congelada, el detalle del vendedor lo indica con un texto discreto (no es un error).

## 6. Lógica pura — `server/services/vendedoresView.js`

El router queda fino; toda la lógica derivable vive acá y se testea sin DB (`node --test`, patrón ya usado por `calcEngine.supervisores.test.js` y `manualDoc.test.js`).

| Función | Contrato |
|---|---|
| `agruparVigencias(rows)` | Las 3 filas por vigencia de `ImportesEscalonesINDO` colapsadas en una fila por vigencia, de la más nueva a la más vieja. |
| `armarVista(filas)` | Filas planas del JOIN → array de sucursales con vendedores anidados, `escalon` derivado, `desfasado`, totales por sucursal y globales. |
| `escalonAlcanzado(venta, umbrales)` | Réplica exacta del criterio del SP: `>= 3er` → 3, `>= 2do` → 2, `>= 1er` → 1, si no 0. |
| `vigenciaParaPeriodo(vigencias, periodo)` | Réplica del `TOP 1 (Año*100+Mes) <= período ORDER BY Año DESC, Mes DESC`. Sin vigencia aplicable → `null`. |
| `validarVigencia(body, existentes, modo)` | Devuelve `{ ok, error, status }` según las reglas de §5. |
| `periodosAlcanzados(vigencias, vigencia)` | Rango de períodos que una vigencia gobierna, para el aviso de la UI. |

**Tests mínimos** (todos sin DB):
1. `escalonAlcanzado` en los 4 tramos y en los bordes exactos (venta == umbral → alcanza ese escalón).
2. Part time: importe esperado = mitad → `desfasado: false`; full time con la mitad → `desfasado: true`.
3. `vigenciaParaPeriodo` elige 2025-09 para 2026-06, 2025-05 para 2025-07, y `null` para 2024-12.
4. `armarVista` agrupa 2 sucursales con 3 vendedores, ordena por sucursal y suma los totales.
5. `validarVigencia`: duplicado → 409, mes 13 → 400, monto negativo → 400, monto no entero → 400.
6. `periodosAlcanzados` de una vigencia intermedia termina en el mes anterior a la siguiente.

## 7. Frontend — `src/pages/vendedores.js`

Ruta `vendedores`. **Sidebar: sección Cálculos, debajo de `🧮 Total` y arriba de `🧾 Cajeros`** (segunda entrada de la sección). Icono `🛍️`, label `Vendedores`.

Patrón visual de `operadores.js`: sticky header, filtro de texto, CSV es-AR (`;`, coma decimal, BOM UTF-8), modo oscuro, `container.innerHTML` desde `renderVendedores(container, periodo)`.

**Card superior "Importes de escalones"**: los 3 montos vigentes para el período, de qué vigencia salen, la aclaración "part time cobra la mitad", y un botón `Vigencias` que abre el ABM. El botón se oculta si `isSupervisorReadonly()`.

**Tabla por sucursal**, una fila por sucursal, clickeable para expandir:

```
Suc  Sucursal        Vend.  1er esc.     2do esc.     3er esc.     Total $
02   VALLEJO 02      3,0    20.149.099   22.164.009   25.488.610   60.000  ▾
     └ 1621 Perez Juan     FT  22.687.902   esc.2   15.000
     └ 1680 Gomez Ana      FT  25.875.560   esc.3   30.000
03   VALLEJO 03      2,5    25.507.412   28.058.153   32.266.876    7.500  ▸
```

Detalle expandido por vendedor: Legajo, Nombre, Jornada (FT/PT), Venta real, Días, Venta calculada, Proporcional, Lic., ¿Comisiona?, Esc., Comisión (con ⚠️ si `desfasado`).

**Modal de vigencias**: lista de vigencias con la vigente marcada (`●`), alta, edición y borrado. Antes de guardar o borrar, muestra los períodos alcanzados y pide confirmación. El texto aclara que el recálculo lo corre el job SQL, no la web.

**Estado vacío**: si el período no tiene filas, cartel explicando que el cálculo lo corre el job SQL de INDO y listando los períodos que sí tienen datos.

## 8. Manejo de errores

- Período sin datos → `200` con arrays vacíos (no 404); la página muestra el estado vacío.
- Sin vigencia aplicable al período → `vigencia: null`; la card avisa "sin importes cargados para este período".
- Sucursal sin nombre en `tbl_CoVenAppINDO_Sucursales` → se muestra `Sucursal {id}` (el `LEFT JOIN` no descarta la fila).
- Error de DB → `500` con `{ ok: false, error }`, como el resto de los routers.
- Escritura con perfil 8 → `403` del middleware, sin llegar al handler.

## 9. Documentación y cierre

- `docs/MANUAL.md`: sección nueva de Vendedores — de dónde salen los datos, que el cálculo es batch SQL, cómo se leen los escalones y cómo se cargan las vigencias de importes.
- `CONTEXT.md`: módulo nuevo, tablas, endpoints y la regla de vigencias.
- `CLAUDE.md`: corregir dos afirmaciones desactualizadas — "No hay tests automatizados" (hay 31 pasando) y "SQL Server 2012" (es 2008 R2, sin `TRY_CONVERT`).
- `RETOMAR.md`: sesión 2026-08-03.
- `npm run build` + `Restart-Service dashcomisionesindo.exe` (el server sirve `dist/`, no `src/`).
- Al cerrar, agregar Vendedores a la lista de módulos blindados.
