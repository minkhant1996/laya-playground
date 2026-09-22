@echo off
REM Starts backend (port 8765) and frontend (port 5173) in two windows.
cd /d "%~dp0"
if not exist backend\.venv (echo Run setup.bat first. & exit /b 1)
if not exist frontend\node_modules (echo Run setup.bat first. & exit /b 1)
start "backend"  cmd /k "cd backend && set USE_TF=0 && .venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload"
start "frontend" cmd /k "cd frontend && npm run dev -- --port 5173 --strictPort"
echo Backend: http://127.0.0.1:8765/docs   Frontend: http://localhost:5173
