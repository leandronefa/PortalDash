# Arquitectura — PortalDash (puntero)

Este monorepo ya tiene documentación de arquitectura viva y detallada fuera de `docs/architecture/`;
este archivo es solo un índice para no duplicarla. Profundidad de documentación elegida en la
inicialización de fmway: **solo estructural**.

## Dónde está la arquitectura real

- **Portal** (.NET 9 + YARP, login, permisos, proxy inverso):
  - `portal-src/ARCHITECTURE.md`
  - `portal-src/CONTEXT.md`
  - `portal-src/CLAUDE.md`
  - `portal-src/deploy/OPERATIONS-10.0.0.118.md` (estado real de la instalación en el servidor)
- **Dashboards** (Node.js/Express + Vite/React, un servicio Windows por dashboard):
  - `dashboards/CLAUDE.md` (mapa completo: carpeta, servicio, puerto, proxy `/d/{id}/`)
  - `dashboards/{Nombre}/CLAUDE.md` (particularidades de cada dashboard)
- **Cómo agregar un dashboard nuevo:** `NUEVO-TABLERO.md`
- **Panorama de producto:** `PRD.md` (raíz)

## Si hace falta una pasada formal

Invocar la skill `fmway-docs` apuntada a un subproyecto puntual (por ejemplo, un dashboard sin
`CLAUDE.md` completo, o para generar diagramas Mermaid formales) en vez de regenerar todo el monorepo
de una vez.
