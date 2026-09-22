# System One Playground

Frontend (Vite + React + TypeScript) and backend (FastAPI) for **System One** decision models:
[Laya](https://huggingface.co/convaiinnovations/laya) (local, open weights) and
[Jev](https://openrouter.ai/typesafe/jev-1.13) (TypeSafe, via OpenRouter). Both take a state plus typed
questions and return calibrated answers instead of text.

- **Playground (chat)** – talk to a text model of your choice from OpenRouter. It asks what you
  want to decide, turns it into typed questions (`choice`, `score`, `noul`), runs the decision
  model, and explains the answers. An *Advanced* panel exposes the raw state/questions JSON.
- **Decision model** – Laya (local) or TypeSafe's **Jev** (through OpenRouter's `/systemone` endpoint with your OpenRouter key, or directly with a TypeSafe key). Chosen in Settings, overridable per chat / per eval.
- **TypeSafe / Jev agent skill** – `backend/skills/` holds the skill (`SKILL.md`) and primitive docs
  fetched from docs.typesafe.ai. Laya and Jev share the same question schema, so the distilled
  question-writing guidance is injected into the text model's prompt. `GET /api/skill` shows it.
- **Multilingual** – state, instructions, option names and rubrics can all be in any language (Burmese,
  Thai, Hindi…). Laya is routed to its multilingual checkpoint whenever the state *or the questions* use a
  non-Latin script; Jev accepts them directly. Chat and Learn reply in the user's language, or a chosen one.
- **Chat sessions** – every chat is saved on the backend (`backend/data/chats/`), listed in a sidebar,
  reopenable, and deletable one by one or all at once.
- **Learn tab** – ask questions about System One, Jev, Laya, the question types, confidence and the
  design patterns. The text model works as a small agent over `backend/knowledge-hub/` only: it first
  picks up to three relevant files from the index, then reads just those and answers with citations.
  The hub holds Markdown copies of the TypeSafe docs, the launch blog post and the Laya model card,
  with source links in `index.json` / `README.md`. The agent cannot read anything outside the hub.
- **Usage tab** – every model call (chat, prepare, criteria, decide, explain) is logged with tokens,
  latency and estimated OpenRouter cost, with breakdowns by model, purpose and day.
- **Dataset eval** – run Laya as a zero-shot classifier and see accuracy, from three sources:
  - presets (Banking77, DAIR Emotion, AG News, TweetEval sentiment, SST-2, CLINC150),
  - any Kaggle dataset link or `owner/name` (public ones need no account; add credentials in Settings
    for private ones), with file picker and header toggle,
  - any Hugging Face dataset link or id (`https://huggingface.co/datasets/owner/name`, `owner/name`, `owner/name:config`),
    downloaded on demand with text/label columns auto-guessed and editable,
  - your own JSON / JSONL / CSV file (list of `{text, label}` records or a HF rows export).
  Optional *shortlist k* embeds labels and asks Laya only over the top-k for many-label sets.
  Evaluation streams live progress (sample count, running accuracy, ETA, latest rows) and can be stopped.
- **Settings** – save the OpenRouter key from the UI (see Security below).

## Docker (easiest)

```bash
./docker.sh install   # installs Docker if missing (Linux: get.docker.com; macOS: brew cask; Windows: use docker.bat)
./docker.sh up        # build images and start backend + frontend in the background
./docker.sh logs      # follow logs        ./docker.sh status
./docker.sh down      # stop               ./docker.sh clean   # also remove images + volumes
```
On Windows use `docker.bat` with the same commands (`docker.bat install` uses winget to install
Docker Desktop). Then open http://localhost:5173. The frontend container (nginx) serves the built
app and proxies `/api` to the backend container, so no CORS or port juggling.

- `backend/data/` (uploads, runs, keys) is bind-mounted, so it survives rebuilds.
- The Laya checkpoints (~2.3 GB) download on first use into the `hf-cache` Docker volume, so they
  are downloaded once, not per rebuild. The image uses CPU-only PyTorch (~1.5 GB image).
- `backend/.env` is loaded if present; keys saved from the Settings tab go to `backend/data/`.

## Quick setup (without Docker)

```bash
./setup.sh          # Linux / macOS: venv + pip deps, npm install, creates backend/.env
./start.sh          # runs backend + frontend, Ctrl+C stops both
```
```bat
setup.bat           :: Windows
start.bat
```
Add `--download-model` to `setup.sh` / `setup.bat` to pre-download the Laya checkpoints (~2.3 GB, three
checkpoints, cached in `~/.cache/huggingface`). Otherwise they download automatically on the first prediction.

## Run manually

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
| POST | `/api/chat` | `{messages, engine?}` → `{reply, spec, result, explanation}` |
| POST | `/api/datasets/evaluate/stream` | same body as evaluate; NDJSON events `status/start/row/done/error` |
| GET | `/api/openrouter/models` | every OpenRouter model with context and prices (cached 10 min) |
| GET | `/api/usage?days=7` · DELETE | usage totals, breakdowns, recent calls |
| GET | `/api/learn/docs` · `/api/learn/docs/{file}` | knowledge-hub index and a file's content |
| POST | `/api/learn/ask` | `{question, history}` → NDJSON `selecting/reading/answering` then `{answer, sources}` |
| GET | `/api/skill` | sources + distilled guidance from the TypeSafe/Jev skill |
| PUT | `/api/settings/prefs` | `{openrouter_model?, decision_engine?}` |
| PUT/DELETE | `/api/settings/typesafe` | TypeSafe (Jev) API key, verified then stored encrypted |
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

## License

MIT © 2026 Min Khant Soe. See [LICENSE](LICENSE).
