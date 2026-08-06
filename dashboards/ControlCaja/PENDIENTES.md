# PENDIENTES — ControlCaja

> Para retomar el trabajo en otra sesión. El detalle de arquitectura, endpoints y
> gotchas está en `CLAUDE.md`; este archivo es solo la lista de qué falta y por qué.
> Última actualización: 06/08/2026.

## Estado actual

Dashboard funcionando en producción: servicio `dashcontrolcaja.exe`, puerto **3014**,
arranque automático, **registrado en el portal como Dashboard Id 16** (`/d/16/`).
99 tests, `tsc` y build limpios. Backend y frontend completos con matriz sucursal ×
día, filtro por sucursal, vista semanal, detalle en modal.

```powershell
Get-Service dashcontrolcaja.exe
cd C:\apps\dashboards\ControlCaja; node --test "tests/*.test.js"   # 99/99 esperado
```

## Pendientes reales (en orden de impacto)

### 1. Verificación visual en el navegador
Este entorno no tiene browser, así que **nada de lo siguiente se vio en pantalla
todavía**, solo se verificó por lectura de código y contra los endpoints reales:

- [ ] Colores del semáforo (faltante rojo / sobrante azul) y su intensidad.
- [ ] Modo oscuro — el toggle está cableado, nunca se vio funcionando.
- [ ] Scroll horizontal + columna de sucursal fija en la matriz.
- [ ] Buscador de sucursal y la lista de checkboxes (abrir/cerrar, Escape, clic afuera).
- [ ] Vista semanal: flechas ◀ ▶, que el conteo "Semana X/Y" sea correcto.
- [ ] El modal del detalle: que se vea centrado, que bloquee el scroll de fondo,
      que la columna Saldo entre sin cortarse.
- [ ] Responsive en una ventana angosta (el iframe del portal puede ser más
      angosto que un navegador de escritorio completo).

Si algo de esto se ve mal, es la primera cosa para revisar.

### 2. INDO todavía no tiene exportación
El usuario va a generar el archivo `SAP_INDO_REPORTE_Z` (o el nombre que le pongan)
más adelante. Cuando exista, agregarlo es **una línea** en `server/empresas.js`
(ver el comentario ahí — el registro `EMPRESAS` es el único lugar que hace falta
tocar; el resto del código ya es genérico por diseño).

## Decisiones ya tomadas (no volver a discutir sin motivo nuevo)

- **Toda sucursal con actividad entra en la matriz**, incluso sin diferencias
  (fila vacía = confirmación positiva de que cerró bien). Decisión del usuario,
  03/08/2026. Por esto `sucursales.length === 0` significa "el mes no tiene datos",
  no "no hubo diferencias" — son mensajes distintos en la UI.
- **El detalle es un modal, no un sidebar** (decisión del usuario, 05-06/08/2026).
  Contrapartida asumida: no se puede clickear otra celda de la matriz mientras el
  modal está abierto — hay que cerrarlo primero.
- **La vista semanal parte los días por posición, no por fecha de calendario**
  (`src/lib/semanas.ts`) — los días vienen de la actividad real, pueden faltar
  días sin actividad en toda la empresa, y alinear por día-de-semana no tiene
  sentido sobre un dato que no garantiza continuidad.
- **Las ~600 líneas con fecha en el campo de sucursal ya se corrigieron en origen**
  (03/08/2026). El contador de descartadas está en 0; si sube de nuevo o aparece
  un motivo de descarte distinto, es el formato que cambió, no un bug del parser.
- **Sin persistencia, sin uploads, sin manifest** — a propósito, a diferencia de
  EstadoResultado. La fuente de verdad es siempre el archivo de la red.
- **33 de las 37 sucursales tienen nombre** en `data/sucursales.json`, resueltos
  el 06/08/2026 contra `dbo.COMERCIO` (BeClever, 10.0.0.115 — la misma tabla que
  ya usa ComisionesINDO). Las 4 restantes (**080, 081, 102, 111**) no están
  registradas en esa tabla — no es un error de la consulta, esos códigos
  simplemente no existen ahí. Si alguna vez se necesita el nombre, hay que
  preguntarle a alguien de la operación, no reintentar la consulta.

## Deuda técnica conocida, no bloqueante

- `server-context/dashboards-CLAUDE.md` y `apps-CLAUDE.md` (copias en
  `portal-src/deploy/`) ya estaban desincronizadas de los `CLAUDE.md` raíz
  **antes** de este proyecto (les faltan varios dashboards). No se tocó porque
  está fuera de alcance; si se sincronizan alguna vez, sumar ahí la fila de
  ControlCaja también.
- Sin cancelación de requests si se cambia de empresa dos veces muy rápido en el
  selector (carrera de bajo impacto, cosmética, documentada en el historial de
  revisión pero no en el código).
