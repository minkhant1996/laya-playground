@echo off
REM Docker helper (Windows): docker.bat install ^| build ^| up ^| down ^| restart ^| logs ^| status ^| clean
setlocal
cd /d "%~dp0"
set CMD=%1
if "%CMD%"=="" set CMD=help

if "%CMD%"=="install" goto install
where docker >nul 2>&1 || (echo Docker not found. Run: docker.bat install & exit /b 1)
docker info >nul 2>&1 || (echo Docker Desktop is not running. Start it from the Start menu and retry. & exit /b 1)

if "%CMD%"=="build"   (docker compose build & goto end)
if "%CMD%"=="up"      (docker compose up -d --build & echo. & echo Frontend: http://localhost:5173   Backend API: http://127.0.0.1:8765/docs & echo Logs: docker.bat logs   Stop: docker.bat down & goto end)
if "%CMD%"=="down"    (docker compose down & goto end)
if "%CMD%"=="stop"    (docker compose down & goto end)
if "%CMD%"=="restart" (docker compose restart & goto end)
if "%CMD%"=="logs"    (docker compose logs -f --tail=200 & goto end)
if "%CMD%"=="status"  (docker compose ps & goto end)
if "%CMD%"=="clean"   (docker compose down -v --rmi local & goto end)
echo Usage: docker.bat {install^|build^|up^|down^|restart^|logs^|status^|clean}
goto end

:install
where docker >nul 2>&1 && (docker --version & echo Docker is already installed. & goto end)
where winget >nul 2>&1 || (echo winget not found. Download Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/ & start https://docs.docker.com/desktop/setup/install/windows-install/ & goto end)
echo ==^> Installing Docker Desktop with winget (WSL2 is enabled automatically; a reboot may be required)
winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
echo Start Docker Desktop from the Start menu once, then run: docker.bat up

:end
endlocal
