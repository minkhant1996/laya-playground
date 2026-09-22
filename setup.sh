#!/usr/bin/env bash
# One-shot setup for backend + frontend. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1 — $2"; exit 1; }; }
need python3 "install Python 3.10+ from https://python.org"
need node "install Node 18+ from https://nodejs.org"
need npm "comes with Node"

echo "==> Backend: virtual environment + dependencies"
cd backend
if command -v uv >/dev/null 2>&1; then
  [ -d .venv ] || uv venv .venv
  uv pip install --python .venv/bin/python -r requirements.txt
else
  [ -d .venv ] || python3 -m venv .venv
  .venv/bin/pip install --upgrade pip >/dev/null
  .venv/bin/pip install -r requirements.txt
fi
PY=.venv/bin/python
if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env; echo "    created backend/.env from .env.example"; fi
mkdir -p data
cd ..

if [ "${1:-}" = "--download-model" ]; then
  echo "==> Pre-downloading the Laya checkpoints (~2.3 GB, cached in ~/.cache/huggingface)"
  USE_TF=0 "$PY" -c "from laya import Router; Router(preload=True); print(\"Laya ready\")"
fi

echo "==> Frontend: npm dependencies"
cd frontend && npm install && cd ..

echo
echo "Setup complete. Start everything with:  ./start.sh"
echo "Note: the first prediction downloads the Laya model (~2.3 GB) automatically; run ./setup.sh --download-model to do it now."
