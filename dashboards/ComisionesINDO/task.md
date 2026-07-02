# Comisiones INDO - Task Tracker

## 1. Setup del Proyecto
- [x] Inicializar Vite + estructura de carpetas
- [x] Configurar .env y dependencias
- [x] Configurar vite.config.js con proxy al backend

## 2. Base de Datos
- [x] Crear script SQL de tablas
- [x] Seed data desde Excel (montos, ranking, sucursales, objetivos)
- [ ] Ejecutar scripts en SQL Server

## 3. Backend (Node.js + Express)
- [x] Config DB connection
- [x] Auth middleware (JWT + TBL_USUARIOS_APPS)
- [x] Rutas CRUD: Montos
- [x] Rutas CRUD: Ranking
- [x] Rutas CRUD: Objetivos
- [x] Rutas CRUD: Sucursales
- [x] Rutas: Datos de origen (consumo, efectivo, reporte)
- [x] Rutas: MILLON
- [x] Motor de cálculo (calcEngine)
- [x] Ruta: Ejecutar cálculo → TOTAL

## 4. Frontend
- [x] Design system (CSS)
- [x] Layout + Sidebar + Router
- [x] Página Login
- [x] Página Dashboard
- [x] Página ABM Montos
- [x] Página ABM Ranking
- [x] Página ABM Objetivos
- [x] Página ABM Sucursales
- [x] Página Datos de Origen
- [x] Página Vista TOTAL
- [x] Página Vista MILLON
- [x] Componentes: DataTable, Modal, Toast, ExportExcel

## 5. Verificación
- [x] Ejecutar sql/001_create_tables.sql en SQL Server
- [x] Ejecutar sql/002_seed_data.sql en SQL Server
- [ ] Cargar datos reales desde Excel
- [ ] Comparar cálculos vs Excel
- [ ] Test login
- [ ] Test ABMs
