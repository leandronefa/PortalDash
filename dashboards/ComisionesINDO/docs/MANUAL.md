# Manual de uso — Comisiones INDO

## 1. Qué hace esta aplicación (y qué no)

Comisiones INDO calcula y liquida las comisiones del personal de sucursales INDO: **cajeros, operadores, encargados y supervisores**, tanto de sucursales **Retail** como **Millón**.

Lo que hace: trae las ventas y los objetivos del período, aplica las reglas de escalones y categoría por sucursal, y te muestra el resultado por rol, listo para revisar y exportar.

Lo que **no** hace: no paga los sueldos, no emite recibos ni comprobantes, y no manda nada al sistema de sueldos. La aplicación produce el cálculo y sus exportaciones — el pago en sí se gestiona por fuera de acá.

## 2. Período activo

Arriba, en el panel lateral, tenés el selector de **Período activo** con formato `YYYY-MM` (por ejemplo `2026-07`). Es lo primero que tenés que fijar antes de trabajar, porque **todas** las pantallas de la aplicación leen datos según ese período.

El período que elegís se guarda solo: si cerrás la aplicación y volvés a entrar, se acuerda del último que usaste.

## 3. Cómo se liquida un período, paso a paso

Para liquidar un período completo, seguí estos cuatro pasos en orden:

1. Revisá los datos maestros del período en las pantallas de DATOS: Sucursales, Montos, Objetivos y Supervisores (con sus sucursales asignadas). Es el momento de corregir cualquier valor antes de calcular.
2. Andá a **Cálculos → Total** y apretá **▶ Ejecutar cálculo**. Este botón sincroniza los objetivos desde BeClever, recalcula el ranking de categorías A/B/C, y corre todo el motor de una sola vez: Total, Operadores Retail, Operadores Millón, Encargados Retail, Encargados Millón y Supervisores. El resultado queda guardado. Hoy es el **único** disparador del cálculo completo.
3. Andá a **Cálculos → Cajeros** y apretá su botón propio de cálculo. Cajeros queda aparte porque necesita los overrides de jornada (full-time / part-time) que se cargan en esa misma pantalla.
4. Recorré los resultados por rol en las pantallas de Cálculos y exportá los CSV que necesites.

## 4. Pantallas de DATOS

| Pantalla | Qué muestra | Qué se puede editar |
|---|---|---|
| Sucursales Retail | Listado de sucursales con ID, nombre, provincia, categoría del período, si tiene efectivo y su estado | El toggle **Habilitada / Deshabilitada** y el toggle CON/SIN efectivo. Una sucursal deshabilitada desaparece de las pantallas y del cálculo |
| Sucursales Millón | Sucursales Millón con sus operadores, originaciones e importe total | El toggle **¿Es operador?** por persona, y podés actualizar los datos desde BeClever con su botón propio |
| Montos | Los montos de comisión de cada rol, por escalón y categoría: Cajeros, Operadores CON Efectivo, Operadores SIN Efectivo, Encargados, Encargados Millón, Supervisores y Préstamos | El valor de Categoría C de cada concepto — B y A se calculan y graban solos. Excepción: el monto de Cajeros es único y B y A toman el mismo valor que C |
| Ranking | La categoría A/B/C asignada a cada sucursal en el período, y los multiplicadores por categoría | Podés forzar manualmente la categoría de una sucursal y editar el valor de los multiplicadores |
| Objetivos | Los objetivos de consumo y de efectivo cargados por sucursal para el período | Es de solo lectura — los objetivos se traen automáticamente desde BeClever |
| Ventas | Las ventas de consumo, de efectivo y las originaciones de créditos del período | Es de solo lectura. En Originaciones podés filtrar por operador, sucursal y fecha |
| Supervisores | El listado de supervisores, con su usuario de acceso y las sucursales que tiene asignadas | Alta, edición y baja de supervisores, y qué sucursales tiene asignadas cada uno |

## 5. Pantallas de Cálculos

| Pantalla | Qué muestra | ¿Botón de cálculo propio? | Qué se puede editar |
|---|---|---|---|
| Total | El resultado completo del período, en pestañas: Sucursales, Cajeros, Operadores, Encargados, Supervisores. **Ojo**: la pestaña Cajeros de Total se calcula sin los overrides de jornada, así que ahí los part-time pueden aparecer con el monto full — no liquides cajeros desde acá | Sí — **▶ Ejecutar cálculo**, el único que corre el motor completo | Nada — es de solo lectura, además de disparar el cálculo completo |
| Cajeros | El resultado de comisión de cada cajero, agrupado por sucursal, con su jornada y si comisionó | Sí — necesita los overrides de jornada de esta pantalla | El override de jornada (full-time / part-time) de cada cajero, antes de calcular |
| Operadores Retail | El resultado por operador de sucursales Retail, con sus indicadores | Sí | Nada — es de solo lectura |
| Operadores Millón | El resultado por operador de sucursales Millón, con su jornada y el objetivo dividido en full-equivalentes | Sí | La jornada (full-time / part-time) de cada operador. A diferencia de Cajeros, esta jornada **se guarda** y el cálculo desde Total **la respeta**, sin necesidad de recalcular aparte |
| Encargados Retail | El resultado **por sucursal**, sin nombres de personas | No — lee el último cálculo guardado desde Total | Nada — es de solo lectura |
| Encargados Millón | El resultado **por sucursal**, sin nombres de personas | No — lee el último cálculo guardado desde Total | Nada — es de solo lectura |
| Supervisores | El resultado por supervisor, con el detalle de sus plazas y sus sucursales | No — lee el último cálculo guardado desde Total | Nada — es de solo lectura |

## 6. Exportar a CSV

Cada pantalla de resultado tiene un botón **↓ CSV** (o **⬇ CSV**, según la pantalla) que descarga lo que estás viendo.

El archivo sale con separador `;` y con BOM UTF-8, así que **abre directo en Excel en español**, con los acentos correctos y sin que tengas que importar nada a mano.

En **Ventas → Originaciones**, el CSV descarga **solo las filas que tenés filtradas** en ese momento — si querés todo, primero limpiá los filtros.

## 7. Retail y Millón: dos mundos distintos

Las sucursales se dividen en dos tipos, según su ID:

- **Retail**: ID menor a 100.
- **Millón**: ID mayor o igual a 100 — son las sucursales de originación de créditos.

Cada tipo tiene sus propias reglas de cálculo: no son una variante una de la otra, son motores distintos. Además, Retail y Millón forman **plazas separadas** aun cuando compartan la misma provincia — una plaza Retail y una plaza Millón de la misma provincia se evalúan por separado.

## 8. Categorías de sucursal y ranking

Cada sucursal tiene asignada una categoría — **A**, **B** o **C** — para cada período. Esa categoría define, entre otras cosas, qué monto de comisión le corresponde a su gente.

El ranking se recalcula automáticamente cada vez que ejecutás el cálculo desde Total, y también podés recalcularlo aparte con el botón **⟳ Calcular Ranking Automático** de la pantalla Ranking. Si necesitás forzar la categoría de una sucursal en particular, podés hacerlo a mano desde esa misma pantalla.

## 9. Escalones y la tolerancia del 4%

El sistema mide el cumplimiento de ventas o efectivo contra tres umbrales, llamados escalones:

- **E1**: 100% del objetivo.
- **E2**: 110% del objetivo.
- **E3**: 126,5% del objetivo (110% × 1,15).

En todo el sistema se aplica una **tolerancia del 4%**: si te falta menos del 4% del umbral para llegar a un escalón, se considera alcanzado igual. Esta tolerancia es la misma en escalones, en los indicadores de Operadores y en la participación de Encargados y Supervisores.

## 10. Multiplicador de categoría: se aplica una sola vez

Los montos de comisión varían según la categoría de la sucursal, con estos multiplicadores:

- **A**: 1,30
- **B**: 1,15
- **C**: 1,00

Este multiplicador se aplica en un **único** lugar del sistema: cuando editás el monto de **Categoría C** en el ABM de Montos, el sistema calcula y graba **ya multiplicados** los valores de B y A. Por eso el motor de cálculo no vuelve a multiplicar esos montos — ya vienen así guardados. La única excepción es Operadores Retail, que reconstruye el monto desde la fila de categoría C y aplica el multiplicador él mismo — ver la sección 18.

Los **cajeros nunca llevan multiplicador**: su monto es el mismo para cualquier categoría de sucursal.

## 11. Reglas de Cajeros

Un cajero comisiona cuando su participación de ventas (VTA/VTATOT) supera el 96% del objetivo de participación de su sucursal — es decir, el objetivo con la tolerancia del 4% ya aplicada (96% exacto no alcanza). Ambos valores se comparan en porcentaje directo. Si la sucursal no tiene objetivo de participación cargado, el cajero no comisiona.

Si comisiona, cobra el monto de cajeros del período (igual para las categorías A, B y C). Si es **part-time**, cobra el **50%** de ese monto, redondeado a múltiplos de $1.000.

La jornada (full-time o part-time) viene cargada desde el sistema, pero la podés sobreescribir a mano desde la pantalla Cajeros, antes de calcular.

## 12. Reglas de Operadores

### Retail

Los operadores Retail se miden con tres indicadores: **G**, **O** y **R**. Los indicadores G, O y R se miden a nivel de la sucursal, así que valen igual para todos sus operadores. **G es la puerta** de O y R: sin G no se cobran esos dos componentes, aunque el componente por escalón se cobra igual.

### Millón

Los operadores Millón se miden **solo por efectivo**. El objetivo de la sucursal se divide entre sus operadores en full-equivalentes: un full-time pesa 1, un part-time pesa 0,5. El part-time compara su venta **multiplicada por 2** contra ese objetivo individual, y si llega, cobra el **50%** del monto, redondeado a múltiplos de $1.000.

## 13. Reglas de Encargados

### Retail

El encargado Retail cobra por dos componentes **independientes**: el escalón de consumo y la participación (indicador G). Son independientes entre sí — un encargado puede cobrar uno sin cobrar el otro.

### Millón

El encargado Millón cobra **solo** por el escalón de efectivo. No tiene componente de participación.

## 14. Vendedores

Muestra las comisiones de los vendedores del período, una fila por sucursal.

**El cálculo de este módulo NO lo hace el dashboard.** Lo corre un proceso automático
de la base de datos (`SP_ComisionesINDO`), que además genera la planilla de
comisiones y la manda por mail. Esta página solamente muestra el resultado: no hay
botón de recalcular, y si un período no aparece es porque el proceso todavía no lo
procesó.

### Cómo se leen los escalones

Cada sucursal tiene tres umbrales de venta, calculados a partir del objetivo de
ventas del mes:

| Escalón | Umbral |
|---|---|
| Primer escalón | objetivo de ventas × 0,97 |
| Segundo escalón | primer escalón × 1,10 |
| Tercer escalón | segundo escalón × 1,15 |

Los tres se dividen por la **cantidad de vendedores** de la sucursal, que no es un
conteo simple: un vendedor full time cuenta 1 y un part time cuenta 0,5, y solo se
cuentan los que tienen **más de 5 días de venta** en el mes. Por eso la columna
"Vend." puede mostrar valores como 2,5 o 3,5.

Lo que se compara contra los umbrales es la **venta calculada más el ajuste
proporcional** de cada vendedor, de mayor a menor: si llega al tercer escalón cobra
el importe del tercero, si no llega pero alcanza el segundo cobra el del segundo, y
así. Si no llega al primero, no cobra.

**Un vendedor part time cobra la mitad del importe** del escalón que alcanzó.

Al hacer clic en una sucursal se abre el detalle de sus vendedores: venta real, días
de venta, venta calculada, ajuste proporcional, días de licencia, el escalón
alcanzado y la comisión.

### Importes de escalones: vigencias

Los importes que se pagan por cada escalón se cargan desde el botón **Vigencias**.
Funcionan por fecha de vigencia: una vigencia rige **desde su mes en adelante**,
hasta que se carga otra posterior.

Para cambiar los montos, **creá una vigencia nueva** con el mes desde el cual
empiezan a valer. Los períodos anteriores siguen resolviendo la vigencia vieja, así
que los resultados ya calculados no se alteran.

La tarjeta de arriba de la página muestra qué importes rigen para el período que
tenés seleccionado y de qué vigencia salen.

Editar o borrar una vigencia ya cargada también se puede (sirve para corregir una
carga equivocada), pero afecta a todos los períodos que esa vigencia gobierna **si
alguna vez se los vuelve a calcular**. La pantalla te avisa cuáles son antes de
guardar.

### El símbolo ⚠️ al lado de una comisión

Significa que la comisión guardada no coincide con el importe que hoy correspondería
al escalón alcanzado. Pasa cuando se editaron los importes de una vigencia y ese
período todavía no fue reprocesado por el proceso automático. El monto que se
muestra es siempre el que quedó guardado en el cálculo, no uno recalculado.

## 15. Reglas de Supervisores

Estas son las reglas vigentes desde el 16 de julio de 2026.

**Retail** (mira solo consumo, con dos indicadores por sucursal):

- **Pesos**: llega si el escalón de consumo es 1 o más (con la tolerancia del 4%).
- **Participación**: llega si el indicador G es mayor a −4% (el mismo indicador que usa Encargados). Si la sucursal no tiene objetivo de participación cargado, **no llega** a participación.

Según esos dos indicadores, la sucursal paga esto por supervisor:

| Pesos | Participación | Paga |
|---|---|---|
| Sí | Sí | Monto completo de la categoría: A $10.000 · B $9.000 · C $8.000 |
| Sí | No | La mitad, redondeada a miles: A $5.000 · B $5.000 · C $4.000 |
| No | — | $0 — los pesos son condición necesaria |

Además del pago por sucursal, existe un **plus por plaza** (plaza = provincia): si **todas** las sucursales Retail asignadas al supervisor en esa provincia llegan a **participación** (sin importar los pesos), el plus es la suma de lo efectivamente pagado por esas sucursales, multiplicado por **0,5**, redondeado a miles. Si una sola sucursal de la plaza falla en participación, no hay plus para esa plaza.

**Millón** (mira solo efectivo): no paga por sucursal. Si **todas** las sucursales Millón asignadas al supervisor en una provincia llegaron por efectivo, la plaza paga **$23.000 una sola vez**.

## 16. Montos congelados por período

La primera vez que se calcula un período, el sistema guarda una foto de los montos vigentes en ese momento. Si más adelante volvés a calcular ese mismo período, **siempre** se usa esa foto — no importa qué hayas cambiado después en el ABM de Montos.

El ABM sigue funcionando con normalidad: seguís editando el valor "vivo", que es el que se usa para los períodos **nuevos**. Esto existe para que recalcular un mes ya cerrado no te cambie lo que ya se liquidó.

## 17. Usuarios supervisores: acceso de solo lectura

Los usuarios con perfil supervisor ven el tablero completo de la aplicación, pero en **modo de solo lectura**: no tienen controles de edición ni botones de cálculo. Además, solo ven los datos de las sucursales que tienen asignadas.

En el resultado de la pantalla Supervisores, cada usuario supervisor ve **únicamente su propio registro** — no el de los demás supervisores.

## 18. Limitaciones conocidas

- **Cajeros no se recalcula con el botón de Total**: necesita los overrides de jornada que se cargan en su propia pantalla, así que siempre hay que calcularlo aparte. La pestaña Cajeros de Total se calcula sin los overrides de jornada, así que ahí los part-time pueden aparecer con el monto full. El resultado válido de Cajeros es siempre el de la pantalla Cajeros, calculado con su botón propio — no liquides cajeros desde Total.
- **Descongelar un período no tiene botón en la pantalla**, y es a propósito. Si un período se calculó por error antes de terminar de cargar los montos correctos, pedile al **equipo técnico** que borre la foto de ese período para que el próximo cálculo tome los valores nuevos.
- El aviso amarillo **"los datos guardados son del formato anterior"** significa que ese resultado se generó con reglas viejas. Se resuelve re-ejecutando el cálculo del período desde Total (el aviso todavía dice "desde el Dashboard": ignoralo, el botón está en Total).
- El escalón **E1 en ámbar** puede mostrarse en verde en períodos que no se recalcularon con la versión actual del sistema.
- **Operadores Retail** reconstruye su monto desde la fila de categoría C multiplicada, en lugar de leer directamente las filas A/B cargadas en Montos. Es una inconsistencia conocida frente al resto del motor, y puede dar diferencias puntuales en sucursales de categoría A y B.

## 19. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Una pantalla de resultado aparece vacía | No se ejecutó el cálculo de ese período | Andá a Cálculos → Total → ▶ Ejecutar cálculo |
| Cambiaste un monto y no se refleja en el resultado | El período ya tiene sus montos congelados (ver sección 16) | Es esperado — ese período usa la foto que se guardó la primera vez que se calculó |
| A un supervisor no le aparece el plus de plaza | Alguna sucursal de esa provincia no llegó a participación (ver sección 15) | Revisá el detalle de sucursales de esa plaza en el resultado de Supervisores |
| Una sucursal no aparece en ninguna pantalla | Está deshabilitada | Revisá su estado en Sucursales Retail y, si corresponde, volvé a habilitarla |
| Aparece "Sin autorización" o te vuelve al login | La sesión venció | Volvé a iniciar sesión |
