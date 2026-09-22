#!/usr/bin/env bash
# Starts backend (port 8765) and frontend (port 5173); Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")"
[ -d backend/.venv ] && [ -d frontend/node_modules ] || { echo "Run ./setup.sh first."; exit 1; }
trap 'kill 0' EXIT INT TERM
( cd backend && USE_TF=0 .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload ) &
( cd frontend && npm run dev -- --port 5173 --strictPort ) &
echo "Backend: http://127.0.0.1:8765/docs   Frontend: http://localhost:5173"
wait
