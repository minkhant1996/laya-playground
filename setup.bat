@echo off
REM One-shot setup for backend + frontend (Windows). Safe to re-run.
setlocal
cd /d "%~dp0"

where python >nul 2>&1 || (echo Missing: python - install Python 3.10+ from https://python.org & exit /b 1)
where node >nul 2>&1 || (echo Missing: node - install Node 18+ from https://nodejs.org & exit /b 1)

echo ==^> Backend: virtual environment + dependencies
cd backend
if not exist .venv (python -m venv .venv || exit /b 1)
set PY=.venv\Scripts\python.exe
"%PY%" -m pip install --upgrade pip >nul
"%PY%" -m pip install -r requirements.txt || exit /b 1
if exist .env.example if not exist .env (copy .env.example .env >nul & echo     created backend\.env from .env.example)
if not exist data mkdir data
cd ..


echo ==^> Frontend: npm dependencies
cd frontend
call npm install || exit /b 1
cd ..

echo.
echo Setup complete. Start everything with:  start.bat
echo Note: the first prediction downloads the Laya model (~2.3 GB) automatically; run setup.bat --download-model to do it now.
endlocal
