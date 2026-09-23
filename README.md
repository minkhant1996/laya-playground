# System One Playground

A local web app for **System One decision models**: [Laya](https://huggingface.co/convaiinnovations/laya)
(open weights, runs on your machine), TypeSafe's [Jev](https://openrouter.ai/typesafe/jev-1.13)
(via OpenRouter), and two community open-weight Jev-style models, [openjev](https://huggingface.co/AlexWortega/openjev)
(Qwen3.5 NLI cross-encoder, MIT, CPU-friendly 0.8B up to 35B) and [Jev-Omni](https://huggingface.co/akhilaaa3/Jev-Omni)
(Gemma 4 12B multimodal, Apache-2.0, NVIDIA GPU with ~24 GB VRAM). Both take a *state* plus typed *questions* and return calibrated answers instead of
text. FastAPI + scikit backend, Vite + React + TypeScript frontend, Docker ready. MIT licensed.

## What you can do

**Playground**
- **Chat** with a text model of your choice from OpenRouter (searchable picker, 400+ models). It asks what
  you want to decide, writes the typed questions, runs the decision model, and explains the answers.
  Stages stream live: *preparing → deciding → explaining*.
- **Manual JSON**: edit the state and questions directly; templates for each query type; latency shown.
- Answers render per type: full probability distribution for `choice`, a scale with marker for `score`,
  yes/no bars for `noul`, all with calibrated confidence.
- Sessions are saved, listed in a sidebar, reopenable and deletable (with confirmation).
- Works in any language: state, instructions and option names can be in Burmese, Thai, Hindi… Laya is
  routed to its multilingual checkpoint whenever the state *or the questions* use a non-Latin script; Jev
  reads them directly. A "reply in" picker (85+ languages with flags) forces the answer language.

**Dataset eval** – benchmark zero-shot classification
- Sources: 6 presets (Banking77, DAIR Emotion, AG News, TweetEval sentiment, SST-2, CLINC150), any
  **Kaggle** link (public sets need no account), any **Hugging Face** dataset link, or your own CSV / JSON /
  JSONL upload. Downloads are cached; a **Saved** tab reuses any source with its columns and plan.
- Split picker with row counts (train / test / validation / all mixed); samples bounded by the split size.
- **Prepare with AI**: an agent reads the columns and sample rows and proposes the state columns, label
  column, question type (`choice`, `score` or `noul`), instructions, criteria and the label mapping. You
  edit it in a form. Plans are saved per dataset; the presets ship with ready-made plans.
- Live progress: model-loading status, `i / n` counter, running accuracy, ETA, average request latency and
  effective time per sample (Jev requests run 6 in parallel), live RAM / VRAM while Laya runs, latest rows,
  Stop button. Results table with actual / predicted / confidence / time and a green–red correct badge;
  per-label accuracy; MAE for score questions; peak RAM / VRAM of the run.
- **Compare Laya vs Jev** on the same samples: accuracy, speed, agreement, both-right / only-one-right,
  per-row and per-label tables.
- Every run and comparison is kept in a **History** column (left, minimizable) and can be reopened or deleted.

**Learn** – a documentation agent restricted to `backend/knowledge-hub/`
- 20 Markdown pages (TypeSafe docs, launch blog post, Laya model card) with source links. The text model first
  picks up to three files from the index, then reads only those and answers with citations. It cannot read
  anything else on disk. Documents open in a popup viewer (MDX cleaned to plain Markdown).
- Answers in the question's language or a chosen one; intro and starter questions are localized (built-in
  for several languages, translated once and cached for the rest; a background job can pre-translate all).
- Learn sessions are saved and deletable like chats.

**Decision engines** (Settings default, overridable per chat / eval; `GET /api/engines` reports availability)

| Engine | Runs | Needs | Notes |
|---|---|---|---|
| Laya | local CPU/GPU | ~3 GB RAM | 3 checkpoints, multilingual routing |
| Jev jev-1.13 / jev-latest | TypeSafe cloud via OpenRouter | OpenRouter key | $0.042 / 1M input tokens; 6 requests in parallel during eval |
| openjev 0.8B / 4B v2 / 35B-A3B | local CPU/GPU | ~2.5 / ~10 / ~75 GB | typed questions mapped onto NLI entailment ("The correct answer is: …"); ~1.8 s per call for 0.8B on CPU |
| Jev-Omni | local NVIDIA GPU | ~24 GB VRAM, ~24 GB download | one call per question; multimodal in the model, text used here |

The **Compare with…** button runs any two engines on the same samples.

**Settings**
- OpenRouter key (verified, then stored encrypted; never returned to the browser), optional TypeSafe key
  (Jev direct) and Kaggle credentials (private datasets).
- Text model for preparing / chat / Learn (searchable OpenRouter picker); decision model default
  (Laya local or Jev jev-1.13 / jev-latest); UI language pre-translation.
- The TypeSafe / Jev **agent skill** (`backend/skills/`) is baked into the prompts; the distilled guidance is shown here.

**Usage** – every model call logged with tokens, latency and estimated OpenRouter cost; breakdowns by
model, purpose and day; live **RAM / VRAM / CPU** meters (NVIDIA, Apple Metal, or CPU-only).

## Hardware & memory safety

- Laya runs fine on **CPU** (~80 ms per query on a desktop CPU once loaded); a GPU is optional. NVIDIA
  (CUDA), Apple Silicon (Metal) and CPU-only machines are all supported; the Usage tab says which is in use.
- Checkpoints load **lazily, one at a time**: English ≈ 1.7 GB, multilingual ≈ 1.3 GB (only if a non-Latin
  request arrives). The backend sits at ~2.5 GB RAM after the first English request.
- **Guards**: Laya refuses to load when less than ~2.6 GB of RAM is free (clear error, suggests Jev); a running
  evaluation stops itself if free RAM drops below ~400 MB; the Usage tab warns when memory is short. Running
  out of RAM cannot damage hardware, but these guards keep the machine from swapping or the process being killed.
- Jev runs in TypeSafe's cloud via OpenRouter and needs no local memory, so it is the fallback for small machines.

## Requirements

- Python 3.10+, Node 18+ (or just Docker). ~3 GB free RAM for Laya (see *Hardware & memory safety*), ~2.3 GB
  disk for its checkpoints. No GPU required.
- An OpenRouter API key for anything involving a text model (chat, Prepare with AI, Learn, Jev).
  Manual JSON and dataset eval with Laya work without one.

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

- `backend/data/` (keys, sessions, history, saved datasets, caches) is bind-mounted, so it survives rebuilds. It is git-ignored: nothing in it is ever committed.
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

All endpoints are under `/api` (interactive docs at http://127.0.0.1:8765/docs).

| Area | Endpoints |
|---|---|
| Health / system | `GET /health`, `GET /system` (RAM, VRAM, CPU, Laya device) |
| Decisions | `POST /predict` `{state, questions, engine?}` |
| Chat | `POST /chat/stream` (NDJSON stages), `POST /chat`; sessions: `GET/POST /chat/sessions`, `GET/DELETE /chat/sessions/{id}`, `DELETE /chat/sessions` |
| Learn | `POST /learn/ask` (NDJSON: selecting/reading/answering), `GET /learn/docs`, `GET /learn/docs/{file}`, sessions under `/learn/sessions…`, `GET /learn/i18n?lang=&scope=`, `POST /learn/i18n/warm`, `GET /learn/i18n/status` |
| Datasets | `GET /datasets`, `POST /datasets/splits`, `POST /datasets/inspect` (HF), `POST /datasets/kaggle/inspect`, `POST /datasets/upload`, `POST /datasets/plan` (AI preparer) |
| Evaluation | `POST /datasets/evaluate/stream` (NDJSON: status/start/row/done), `POST /datasets/evaluate` |
| Saved datasets | `GET /datasets/library`, `POST /datasets/library/plan`, `DELETE /datasets/library/{id}`, `DELETE /datasets/library/{id}/plan` |
| History | `GET/POST /evals`, `GET/DELETE /evals/{id}`, `DELETE /evals` |
| Models & skill | `GET /openrouter/models`, `GET /skill` |
| Settings | `GET /settings`, `PUT /settings/prefs`, `PUT/DELETE /settings/openrouter`, `PUT/DELETE /settings/typesafe`, `PUT/DELETE /settings/kaggle` |
| Usage | `GET /usage?days=`, `DELETE /usage` |

## Data & privacy

Everything the app stores lives in `backend/data/` and stays on your machine: encrypted keys, chat and Learn
sessions, evaluation history, saved dataset shortcuts and plans, uploads, the Kaggle cache, usage log and UI
translations. The folder is git-ignored. Only `backend/preset_plans.json` (plans for the built-in presets) and
`backend/knowledge-hub/` (public docs) are committed.

## Security of the API keys

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
