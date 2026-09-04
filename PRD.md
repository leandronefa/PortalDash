# PRD.md — PortalDash

> Panorama de producto reconstruido (brownfield). Documentación profunda de arquitectura y de cada
> dashboard vive en los `CLAUDE.md`/`CONTEXT.md`/`ARCHITECTURE.md` ya existentes — este documento no
> los duplica, los referencia.

## Qué es

PortalDash es la plataforma interna de dashboards operativos y comerciales de la empresa, servida
desde el servidor 10.0.0.118. Un **portal** (.NET 9 + YARP) actúa de puerta de entrada única
(`http://10.0.0.118/`): maneja login, sesión y permisos por usuario/dashboard, y proxya cada
dashboard como `http://10.0.0.118/d/{id}/`. Los dashboards nunca se exponen directo al usuario final
(salvo diagnóstico local en el propio server).

## Para quién

Personal interno de la empresa (encargados de sucursal, supervisores, administración, IT) que
necesita ver comisiones, objetivos de venta, stock, movimientos de caja, conciliaciones contables,
etc., sin depender de Qlik ni de exports manuales.

## Capacidades principales

- **Portal** (`portal-src/` → desplegado en `portal/`): login, administración de usuarios y permisos
  por dashboard, proxy inverso YARP hacia cada dashboard interno.
- **Dashboards** (`dashboards/*`, un servicio Windows por carpeta — ver tabla completa en
  `CLAUDE.md` raíz y en `dashboards/CLAUDE.md`):
  - Comisiones (INDO, general)
  - Objetivos de venta (por red y por sucursal única)
  - Stock (proveedor/marca, MercadoLibre)
  - Movimientos de caja / diferencias de caja
  - Conciliación de punitorios, validación de cobranzas
  - Estado de resultado (P&L mensual)
  - Reposición/quiebre de stock (MotorReposicion)
  - Reset de contraseñas de Windows (PassReset)
  - Actualización de precios/costos (APCWeb)

## No-objetivos

- No reemplaza Qlik como herramienta de análisis exploratorio ad-hoc; cada dashboard resuelve un caso
  de uso puntual y acotado.
- No expone ningún dashboard fuera del proxy del portal.

## Documentación de referencia (no duplicar acá)

- `CLAUDE.md` (raíz) — árbol, servicios, puertos, reglas de oro.
- `portal-src/CONTEXT.md`, `portal-src/ARCHITECTURE.md`, `portal-src/CLAUDE.md` — portal en detalle.
- `portal-src/deploy/OPERATIONS-10.0.0.118.md` — estado real de la instalación.
- `dashboards/CLAUDE.md` — mapa completo de dashboards, puertos, proxy IDs.
- Cada `dashboards/{Nombre}/CLAUDE.md` — particularidades de ese dashboard puntual.
- `NUEVO-TABLERO.md` — guía para agregar un dashboard nuevo.

## Documentación profunda diferida

La profundidad de documentación elegida en la inicialización de fmway fue **solo estructural**: no se
generó `docs/architecture/` desde cero porque ya existe documentación equivalente y viva (arriba). Si
hace falta una pasada formal de `fmway-docs` sobre algún subproyecto puntual, se puede pedir después.
