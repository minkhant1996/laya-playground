#!/usr/bin/env bash
cd "$(dirname "$0")"
USE_TF=0 exec .venv/bin/uvicorn app.main:app --reload --port 8765
