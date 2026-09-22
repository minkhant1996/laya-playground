# Laya Playground

Frontend (Vite + React + TypeScript) and backend (FastAPI) around the
[convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya) decision model.

- **Playground** – give Laya a state (text / JSON) and typed questions (`choice`, `score`, `noul`),
  get calibrated answers in one forward pass.
- **AI layer (OpenRouter)** – describe in plain English what you want to decide; an LLM on OpenRouter
  writes the Laya questions JSON for you. Also used to write label descriptions for datasets.
- **Dataset eval** – run Laya as a zero-shot classifier and see accuracy, from three sources:
  - presets (Banking77, DAIR Emotion, AG News, TweetEval sentiment, SST-2, CLINC150),
  - any Hugging Face dataset link or id (`https://huggingface.co/datasets/owner/name`, `owner/name`, `owner/name:config`),
    downloaded on demand with text/label columns auto-guessed and editable,
  - your own JSON / JSONL / CSV file (list of `{text, label}` records or a HF rows export).
  Optional *shortlist k* embeds labels and asks Laya only over the top-k for many-label sets.
- **Settings** – save the OpenRouter key from the UI (see Security below).

## Run

```bash
# backend
cd backend
cp .env.example .env        # optional: OPENROUTER_API_KEY (or set it in the UI Settings tab)
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
USE_TF=0 .venv/bin/uvicorn app.main:app --reload --port 8765

# frontend
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api -> :8765)
```

First model load downloads ~2 GB of checkpoints. Without a GPU, evaluation is roughly 1 s/sample.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | backend + OpenRouter status |
| POST | `/api/predict` | `{state, questions}` → Laya answers |
| POST | `/api/ai/prepare` | `{description, sample_text?}` → questions JSON via OpenRouter |
| GET | `/api/datasets` | available HF datasets |
| GET | `/api/datasets/{id}/labels?split=test` | label names |
| POST | `/api/datasets/inspect` | `{ref}` HF link/id → configs, splits, columns, label names |
| POST | `/api/datasets/upload` | multipart `.json/.jsonl/.csv` → `upload_id` + columns |
| POST | `/api/datasets/evaluate` | `{source:{kind: preset|hf|upload, …}, split, limit, offset, shortlist_k?, use_ai_criteria}` → accuracy + rows |
| GET | `/api/settings` | masked key status |
| PUT | `/api/settings/openrouter` | `{api_key, model?}` verify with OpenRouter, then store encrypted |
| DELETE | `/api/settings/openrouter` | remove the UI-saved key |

## Security of the API key

- The key entered in Settings is sent once to the local backend and is **never** kept in the
  browser (no localStorage, cookies, or query strings); the input is cleared after saving.
- The backend verifies it against OpenRouter's `/auth/key` before accepting it.
- It is encrypted at rest with Fernet using a per-install secret; both files live in
  `backend/data/` with `0600` permissions and are git-ignored. A UI-saved key overrides `.env`.
- The API never returns the key, only the last 4 characters; it is never logged.
- Uvicorn binds to `127.0.0.1` and CORS only allows the local Vite origin. If you expose the
  backend beyond your machine, put it behind auth first.

Add more datasets in `backend/app/datasets_service.py` (`DATASETS` dict).
