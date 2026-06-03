@echo off
echo ============================================
echo   INSTALACION - Comisiones App
echo ============================================
echo.

:: Verificar Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo Descargar de: https://nodejs.org/
    echo Instalar version LTS y volver a ejecutar este script.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODEVER=%%i
echo [OK] Node.js encontrado: %NODEVER%

:: Instalar dependencias
echo.
echo Instalando dependencias...
cd /d "%~dp0"
call npm install --production
if %errorlevel% neq 0 (
    echo [ERROR] Fallo npm install
    pause
    exit /b 1
)
echo [OK] Dependencias instaladas

:: Instalar pm2
echo.
echo Instalando pm2...
call npm install -g pm2 pm2-windows-startup
echo [OK] pm2 instalado

:: Detener instancia anterior si existe
pm2 delete comisiones-app >nul 2>nul

:: Iniciar con pm2
echo.
echo Iniciando aplicacion con pm2...
pm2 start ecosystem.config.js
if %errorlevel% neq 0 (
    echo [ERROR] Fallo al iniciar con pm2
    pause
    exit /b 1
)
echo [OK] Aplicacion iniciada

:: Configurar auto-start en reboot
echo.
echo Configurando inicio automatico...
pm2-startup install
pm2 save
echo [OK] Auto-start configurado

echo.
echo ============================================
echo   INSTALACION COMPLETADA
echo ============================================
echo.
echo La app esta corriendo en: http://localhost:3000
echo.
echo Comandos utiles:
echo   pm2 status                    - Ver estado
echo   pm2 logs comisiones-app       - Ver logs
echo   pm2 restart comisiones-app    - Reiniciar
echo   pm2 stop comisiones-app       - Detener
echo.
pause
