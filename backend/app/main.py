from collections import defaultdict
from typing import Any

import asyncio
import json
import time

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import datasets_service as dsvc
from . import library
from . import usage
from . import laya_service, openrouter
from .config import get_decision_engine, get_openrouter_key, get_openrouter_model, settings
from . import secrets_store
from typing import Literal

from pydantic import BaseModel, Field as PField
from .schemas import (
    DatasetInfo, DatasetSource, Engine, EvalPlan, EvaluateRequest, PlanRequest, EvaluateResponse, EvaluateRow,
    PredictRequest, PrepareRequest, PrepareResponse,
)

app = FastAPI(title="System One Playground API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "openrouter_configured": bool(get_openrouter_key()),
        "openrouter_model": get_openrouter_model(),
        "decision_engine": get_decision_engine(),
    }


@app.post("/api/predict")
async def predict(req: PredictRequest) -> dict[str, Any]:
    questions = {k: v.model_dump(exclude_none=True) for k, v in req.questions.items()}
    try:
        return await laya_service.decide(req.state, questions, req.engine.model_dump() if req.engine else None)
    except Exception as e:  # surface model errors to the UI
        raise HTTPException(500, f"decision error: {e}")


@app.post("/api/ai/prepare", response_model=PrepareResponse)
async def prepare(req: PrepareRequest):
    try:
        spec = await openrouter.prepare_spec(req.description, req.sample_text)
        return PrepareResponse(
            state=spec.get("state") or req.sample_text,
            questions=spec["questions"],
            model=get_openrouter_model(),
        )
    except Exception as e:
        raise HTTPException(502, f"OpenRouter error: {e}")


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = PField(max_length=20000)


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str = PField(min_length=1, max_length=20000)
    engine: Engine | None = None
    language: str | None = PField(default=None, max_length=40, pattern=r"^[A-Za-z \-()']*$")


async def _chat_events(req: ChatRequest):
    """Yields status events, then a final {"type": "done", session_id, title, message, ...}."""
    from . import chat, sessions

    engine = req.engine.model_dump() if req.engine else None
    try:
        sess = sessions.get(req.session_id) if req.session_id else sessions.create(engine)
    except (FileNotFoundError, ValueError):
        sess = sessions.create(engine)
    history = [{"role": m["role"], "content": m["content"]} for m in sess["messages"]] + [{"role": "user", "content": req.message}]
    t: dict[str, Any] = {}
    async for ev in chat.turn_events(history[-40:], engine, req.language):
        if ev["type"] == "done":
            t = {k: v for k, v in ev.items() if k != "type"}
        else:
            yield ev
    reply = f"{t['reply']}\n\n{t['explanation']}" if t.get("explanation") else t["reply"]
    sess = sessions.append(sess["id"], [
        {"role": "user", "content": req.message, "ts": time.time()},
        {"role": "assistant", "content": reply, "spec": t.get("spec"), "result": t.get("result"), "ts": time.time()},
    ], engine)
    yield {"type": "done", "session_id": sess["id"], "title": sess["title"], "message": sess["messages"][-1], **t}


@app.post("/api/chat")
async def chat_turn(req: ChatRequest):
    """One conversational turn inside a persisted session (non-streaming)."""
    try:
        last = {}
        async for ev in _chat_events(req):
            if ev["type"] == "done":
                last = {k: v for k, v in ev.items() if k != "type"}
        return last
    except Exception as e:
        raise HTTPException(502, f"chat failed: {e}")


@app.post("/api/chat/stream")
async def chat_turn_stream(req: ChatRequest):
    """Same as /api/chat but streams NDJSON status events (preparing / deciding / explaining) first."""
    async def gen():
        try:
            async for ev in _chat_events(req):
                yield json.dumps(ev, ensure_ascii=False, default=str) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": f"chat failed: {e}"}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/chat/sessions")
async def chat_sessions():
    from . import sessions

    return sessions.list_all()


@app.post("/api/chat/sessions")
async def chat_session_create(body: dict | None = None):
    from . import sessions

    return sessions.create((body or {}).get("engine"))


@app.get("/api/chat/sessions/{sid}")
async def chat_session_get(sid: str):
    from . import sessions

    try:
        return sessions.get(sid)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(404, str(e))


@app.delete("/api/chat/sessions/{sid}")
async def chat_session_delete(sid: str):
    from . import sessions

    try:
        return {"ok": sessions.delete(sid)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/chat/sessions")
async def chat_sessions_delete_all():
    from . import sessions

    return {"ok": True, "deleted": sessions.delete_all()}


@app.get("/api/datasets", response_model=list[DatasetInfo])
async def list_datasets():
    return list(dsvc.DATASETS.values())


# ---------------------------------------------------------------- evaluation history
class EvalSaveRequest(BaseModel):
    kind: Literal["eval", "compare"]
    title: str = PField(max_length=200)
    dataset: str = ""
    engine: str = ""
    result: dict[str, Any]
    result_b: dict[str, Any] | None = None
    label_a: str | None = None
    label_b: str | None = None


@app.post("/api/evals")
async def eval_save(req: EvalSaveRequest):
    from . import evals

    r, rb = req.result, req.result_b or {}
    return evals.save({
        "kind": req.kind, "title": req.title, "dataset": req.dataset, "engine": req.engine,
        "n": r.get("n"), "accuracy": r.get("accuracy"), "avg_ms": (r.get("extra_metrics") or {}).get("avg_query_ms"),
        "accuracy_b": rb.get("accuracy"), "avg_ms_b": (rb.get("extra_metrics") or {}).get("avg_query_ms"),
        "question_type": r.get("question_type"), "result": r, "result_b": req.result_b, "label_a": req.label_a, "label_b": req.label_b,
    })


@app.get("/api/evals")
async def eval_list():
    from . import evals

    return evals.list_all()


@app.get("/api/evals/{eid}")
async def eval_get(eid: str):
    from . import evals

    try:
        return evals.get(eid)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(404, str(e))


@app.delete("/api/evals/{eid}")
async def eval_delete(eid: str):
    from . import evals

    try:
        return {"ok": evals.delete(eid)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/evals")
async def eval_delete_all():
    from . import evals

    return {"ok": True, "deleted": evals.delete_all()}


@app.get("/api/datasets/library")
async def dataset_library():
    """Previously loaded Kaggle / Hugging Face / uploaded sources, ready to reuse (data is cached locally)."""
    return library.list_all()


class SavePlanRequest(BaseModel):
    source: DatasetSource
    split: str = "test"
    plan: dict[str, Any]           # the full PlanResult from the UI (editable), stored verbatim


@app.post("/api/datasets/library/plan")
async def save_plan(req: SavePlanRequest):
    """Remember the evaluation plan for a source so it is restored next time."""
    src = {**req.source.model_dump(), "split": req.split if req.source.kind == "hf" else None}
    e = library.remember(src, plan=req.plan)
    return {"ok": True, "id": e["id"]}


@app.delete("/api/datasets/library/{entry_id}/plan")
async def clear_plan(entry_id: str):
    return {"ok": library.clear_plan(entry_id)}


@app.delete("/api/datasets/library/{entry_id}")
async def dataset_library_delete(entry_id: str):
    return {"ok": library.delete(entry_id)}


class SplitsRequest(BaseModel):
    source: DatasetSource


@app.post("/api/datasets/splits")
async def dataset_splits(req: SplitsRequest):
    """Available splits with row counts for a preset or Hugging Face source ("all" = every split mixed)."""
    src = req.source
    if src.kind == "preset":
        info = dsvc.DATASETS.get(src.dataset_id or "")
        if not info:
            raise HTTPException(404, "unknown dataset")
    elif src.kind == "hf" and src.path:
        path, cfg = dsvc.parse_hf_ref(src.path)
        info = DatasetInfo(id=path, name=path, path=path, config=src.config or cfg, text_column="", label_column="", description="")
    else:
        return {"splits": {}}
    try:
        return {"splits": await dsvc.split_sizes(info)}
    except Exception as e:
        raise HTTPException(502, f"could not read splits: {e}")


@app.get("/api/datasets/{dataset_id}/labels")
async def dataset_labels(dataset_id: str, split: str = "test"):
    info = dsvc.DATASETS.get(dataset_id)
    if not info:
        raise HTTPException(404, "unknown dataset")
    ds = await dsvc.load_split(info, split)
    names = dsvc.label_names(ds, info.label_column)
    return {"labels": names, "size": len(ds)}


class InspectRequest(BaseModel):
    ref: str = PField(min_length=3, max_length=300)


@app.post("/api/datasets/inspect")
async def inspect_dataset(req: InspectRequest):
    """Resolve a Hugging Face dataset link/id, download it, and guess text/label columns."""
    try:
        return await dsvc.inspect_hf(req.ref)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"could not load dataset: {e}")


class KaggleInspectRequest(BaseModel):
    ref: str = PField(min_length=3, max_length=300)
    file: str | None = PField(default=None, max_length=300)
    header: bool = True


@app.post("/api/datasets/kaggle/inspect")
async def inspect_kaggle_dataset(req: KaggleInspectRequest):
    """Download a Kaggle dataset (owner/name or kaggle.com URL), list its tabular files, guess columns."""
    try:
        return await dsvc.inspect_kaggle(req.ref, req.file, req.header)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        msg = str(e)
        if "401" in msg or "403" in msg or "credential" in msg.lower():
            msg += " — this dataset needs Kaggle credentials: add them in Settings"
        raise HTTPException(502, f"could not load Kaggle dataset: {msg}")


MAX_UPLOAD = 25 * 1024 * 1024


@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile):
    """Upload a JSON / JSONL / CSV classification file (list of {text, label} style records)."""
    if not file.filename or not file.filename.lower().endswith((".json", ".jsonl", ".ndjson", ".csv", ".tsv")):
        raise HTTPException(400, "only .json, .jsonl, .csv or .tsv files are accepted")
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "file larger than 25 MB")
    try:
        return await asyncio.to_thread(dsvc.save_upload, file.filename, raw)
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(400, f"could not parse file: {e}")


@app.post("/api/datasets/plan")
async def plan_dataset(req: PlanRequest):
    """Agent layer: inspect columns + sample rows and propose state columns, label column,
    question type / instructions / criteria, and the label mapping."""
    if not get_openrouter_key():
        raise HTTPException(400, "OpenRouter key needed for the planner (Settings)")
    try:
        name, ds, text_col, label_col = await _resolve_source(EvaluateRequest(source=req.source, split=req.split), lenient=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"dataset load failed: {e}")
    cols = list(ds.column_names)
    sample = [{k: (v if isinstance(v, (int, float, bool)) or v is None else str(v)[:300]) for k, v in ds[i].items()} for i in range(min(8, len(ds)))]
    label_values = dsvc.label_names(ds, label_col) if label_col else []
    try:
        plan = await openrouter.plan_dataset(name, cols, sample, label_col, [str(v) for v in label_values])
    except Exception as e:
        raise HTTPException(502, f"planner failed: {e}")
    if text_col and text_col != "__all__" and not plan.get("state_columns"):
        plan["state_columns"] = text_col
    return {"dataset": name, "columns": cols, "size": len(ds), "label_values": [str(v) for v in label_values][:200], **plan}


async def _resolve_source(req: EvaluateRequest, lenient: bool = False):
    """Return (name, dataset, text_column, label_column)."""
    src = req.source or DatasetSource(kind="preset", dataset_id=req.dataset_id)
    if src.kind == "preset":
        info = dsvc.DATASETS.get(src.dataset_id or "")
        if not info:
            raise HTTPException(404, "unknown dataset")
        ds = await dsvc.load_split(info, req.split)
        return info.name, ds, info.text_column, info.label_column
    if src.kind == "hf":
        if not src.path:
            raise HTTPException(400, "path required")
        path, cfg = dsvc.parse_hf_ref(src.path)
        cfg = src.config or cfg
        info = DatasetInfo(id=path, name=path, path=path, config=cfg, text_column="", label_column="", description="")
        ds = await dsvc.load_split(info, req.split)
    elif src.kind == "upload":
        if not src.upload_id:
            raise HTTPException(400, "upload_id required")
        ds = await asyncio.to_thread(dsvc.load_upload, src.upload_id)
        path = f"upload:{src.upload_id}"
    elif src.kind == "kaggle":
        if not src.path or not src.file:
            raise HTTPException(400, "path and file required")
        ds = await asyncio.to_thread(dsvc.load_kaggle, src.path, src.file, src.header)
        path = f"kaggle:{dsvc.parse_kaggle_ref(src.path)}/{src.file}"
    else:
        raise HTTPException(400, "bad source kind")
    text_col, label_col = src.text_column, src.label_column
    if not text_col or not label_col:
        gt, gl = dsvc.guess_columns(ds.column_names)
        text_col, label_col = text_col or gt, label_col or gl
    if lenient:
        return path, ds, text_col, label_col
    if text_col == "__all__":
        text_col = "__all__"   # state = every other column as a JSON object
    elif not text_col or text_col not in ds.column_names:
        raise HTTPException(400, f"set text_column (or use 'all other columns as JSON') and label_column (columns: {ds.column_names})")
    if not label_col or label_col not in ds.column_names:
        raise HTTPException(400, f"set label_column (columns: {ds.column_names})")
    return path, ds, text_col, label_col


async def _evaluate_events(req: EvaluateRequest):
    """Async generator of progress events; the last one is {"type": "done", "result": ...}."""
    yield {"type": "status", "message": "loading dataset"}
    name, ds, text_col, label_col = await _resolve_source(req, lenient=bool(req.plan))
    if req.plan and not (req.plan.label_column or label_col):
        raise HTTPException(400, "plan needs a label_column")

    plan = req.plan
    if plan and plan.label_column:
        label_col = plan.label_column
    names = dsvc.label_names(ds, label_col)
    feat = ds.features[label_col]
    is_int_label = getattr(feat, "names", None) is not None or str(getattr(feat, "dtype", "")).startswith("int")

    def gold_value(raw: Any) -> str:
        """Dataset label as its human string (class name for ClassLabel / *_text columns)."""
        if is_int_label and str(raw).lstrip("-").isdigit() and int(raw) < len(names):
            return names[int(raw)]
        return str(raw)

    generated_criteria = None
    if plan:
        qtype = plan.question.type
        question = {"q": plan.question.model_dump(exclude_none=True)}
        label_map = {str(k): v for k, v in plan.label_map.items()}
        state_cols = plan.state_columns or text_col
        ids = list(question["q"].get("criteria", {}).keys()) if qtype == "choice" else (
            [str(i) for i in range(len(question["q"].get("criteria") or []))] if qtype == "score" else ["yes", "no"])
        criteria = question["q"].get("criteria") if isinstance(question["q"].get("criteria"), dict) else {i: str(c) for i, c in enumerate(question["q"].get("criteria") or [])}
        criteria = {str(k): str(v) for k, v in (criteria or {}).items()}
        shortlist_k = None
    else:
        qtype = "choice"
        ids = [dsvc.to_label_id(n) for n in names]
        label_map = {n: dsvc.to_label_id(n) for n in names}
        state_cols = text_col
        criteria = {lid: lid.replace("_", " ") for lid in ids}
        src0 = req.source or DatasetSource(kind="preset", dataset_id=req.dataset_id)
        cached = (library.get(src0.model_dump()) or {}).get("criteria")
        generated_criteria = None
        if req.criteria:
            criteria.update({dsvc.to_label_id(k): v for k, v in req.criteria.items() if dsvc.to_label_id(k) in criteria})
        elif req.use_ai_criteria and cached and not req.refresh_criteria and set(cached) >= set(ids):
            criteria = {k: cached[k] for k in ids}
            yield {"type": "status", "message": "using saved AI criteria (tick refresh to regenerate)"}
        elif req.use_ai_criteria and get_openrouter_key():
            yield {"type": "status", "message": f"writing criteria for {len(ids)} labels with {get_openrouter_model()}"}
            try:
                criteria = await openrouter.describe_labels(name, ids)
                generated_criteria = criteria
            except Exception as e:
                yield {"type": "status", "message": f"AI criteria failed ({e}); using label names"}
        question = {"q": {"type": "choice", "instructions": req.question_instructions or "Which category does this text belong to?", "criteria": criteria}}
        shortlist_k = req.shortlist_k if req.shortlist_k and req.shortlist_k < len(ids) else None

    engine = req.engine.model_dump() if req.engine else get_decision_engine()
    if engine.get("kind") != "laya":
        shortlist_k = None

    if req.offset >= len(ds):
        raise HTTPException(400, f"offset beyond dataset size ({len(ds)})")
    end = min(req.offset + req.limit, len(ds))
    subset = ds.select(range(req.offset, end))
    n_total = len(subset)
    src = req.source or DatasetSource(kind="preset", dataset_id=req.dataset_id)
    library.remember({**src.model_dump(), "text_column": (text_col if isinstance(state_cols, str) else "__all__"), "label_column": label_col,
                      "split": req.split if src.kind == "hf" else None}, name=name, size=len(ds), labels=len(names),
                     criteria=generated_criteria)
    yield {"type": "start", "n": n_total, "labels": ids, "criteria": criteria, "engine": engine, "question_type": qtype}

    load_s = 0.0
    if engine.get("kind") == "laya" and not laya_service.is_loaded():
        yield {"type": "status", "stage": "loading", "message": "loading Laya checkpoints into memory (first use, ~2.3 GB)…"}
        load_s = await laya_service.ensure_loaded()
        yield {"type": "status", "stage": "loaded", "message": f"Laya ready in {load_s:.1f}s", "load_seconds": round(load_s, 1)}

    def make_state(ex: dict[str, Any]) -> tuple[Any, str]:
        if isinstance(state_cols, list):
            st = {k: ex[k] for k in state_cols if k in ex}
            return st, json.dumps(st, ensure_ascii=False, default=str)
        if state_cols == "__all__":
            st = {k: v for k, v in ex.items() if k != label_col}
            return st, json.dumps(st, ensure_ascii=False, default=str)
        t = str(ex[state_cols])
        return t, t

    rows: list[EvaluateRow] = []
    routing = None
    per = defaultdict(lambda: {"n": 0, "correct": 0})
    correct = 0
    abs_err = 0.0
    t0 = time.perf_counter()
    query_ms_total = 0.0

    # Laya (local, CPU/GPU bound) runs sequentially; hosted Jev is API bound, so run several in flight.
    concurrency = 1 if engine.get("kind") == "laya" else 6
    sem = asyncio.Semaphore(concurrency)

    async def one(i: int, ex: dict[str, Any]):
        state, text = make_state(ex)
        async with sem:
            tq = time.perf_counter()
            try:
                res = await laya_service.decide(state, question, engine, shortlist_k)
            except Exception as e:
                raise HTTPException(500, f"decision error on sample {i + 1}: {e}")
            return ex, text, res, (time.perf_counter() - tq) * 1000

    examples = list(subset)
    tasks = [asyncio.create_task(one(i, ex)) for i, ex in enumerate(examples)] if concurrency > 1 else None
    if concurrency > 1:
        yield {"type": "status", "message": f"running {n_total} samples with {concurrency} parallel requests"}

    try:
        for i, ex0 in enumerate(examples):
            if tasks:
                ex, text, res, query_ms = await tasks[i]
            else:
                ex, text, res, query_ms = await one(i, ex0)
            query_ms_total += query_ms
            gv = gold_value(ex[label_col])
            mapped = label_map.get(gv, label_map.get(dsvc.to_label_id(gv), gv))
            routing = routing or res.get("routing")
            ans = (res.get("answers") or {}).get("q", {})
            raw: float | None = None
            if qtype == "choice":
                pred, conf = laya_service.extract_choice(res, "q")
                gold = str(mapped)
                ok = pred == gold
            elif qtype == "score":
                raw = float(ans.get("score") or 0)
                pred = str(int(round(raw)))
                gold = str(int(mapped)) if str(mapped).lstrip("-").isdigit() else str(mapped)
                conf = ans.get("confidence")
                ok = pred == gold
                if gold.lstrip("-").isdigit():
                    abs_err += abs(raw - int(gold))
            else:
                raw = float(ans.get("noul") or 0)
                pred = "yes" if raw >= 0.5 else "no"
                gold = "yes" if (mapped is True or str(mapped).lower() in ("true", "yes", "1")) else "no"
                conf = max(raw, 1 - raw)
                ok = pred == gold
            correct += int(ok)
            per[gold]["n"] += 1
            per[gold]["correct"] += int(ok)
            row = EvaluateRow(text=text, gold=gold, pred=pred, confidence=conf, correct=ok, raw=raw, ms=round(query_ms, 1))
            rows.append(row)
            elapsed = time.perf_counter() - t0
            avg_ms = query_ms_total / (i + 1)                      # mean per-request latency
            throughput_s = elapsed / (i + 1)                       # wall-clock per completed sample (parallelism included)
            yield {"type": "row", "i": i + 1, "n": n_total, "row": row.model_dump(), "accuracy": correct / (i + 1),
                   "elapsed": round(elapsed, 1), "eta": round(throughput_s * (n_total - i - 1), 1), "avg_ms": round(avg_ms, 1),
                   "query_ms": round(query_ms, 1), "concurrency": concurrency}
    finally:
        if tasks:
            for t in tasks:
                t.cancel()

    n = len(rows)
    extra = {"mae": abs_err / n} if qtype == "score" and n else {}
    extra.update({"avg_query_ms": query_ms_total / n if n else 0.0, "total_query_s": query_ms_total / 1000, "model_load_s": load_s})
    result = EvaluateResponse(
        dataset_id=name, question_type=qtype, extra_metrics=extra, shortlist_k=shortlist_k, n=n, accuracy=(correct / n if n else 0.0), labels=ids, criteria=criteria,
        routing=routing, rows=rows, per_label={k: {"n": v["n"], "accuracy": v["correct"] / v["n"]} for k, v in per.items()},
    )
    yield {"type": "done", "result": result.model_dump()}


@app.post("/api/datasets/evaluate", response_model=EvaluateResponse)
async def evaluate(req: EvaluateRequest):
    result = None
    try:
        async for ev in _evaluate_events(req):
            if ev["type"] == "done":
                result = ev["result"]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"evaluation failed: {e}")
    return result


@app.post("/api/datasets/evaluate/stream")
async def evaluate_stream(req: EvaluateRequest):
    """Newline-delimited JSON progress events for a live UI."""
    async def gen():
        try:
            async for ev in _evaluate_events(req):
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except HTTPException as e:
            yield json.dumps({"type": "error", "message": e.detail}) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/openrouter/models")
async def openrouter_models(refresh: bool = False):
    try:
        return await openrouter.list_models(force=refresh)
    except Exception as e:
        raise HTTPException(502, f"could not list OpenRouter models: {e}")


# ---------------------------------------------------------------- settings / API key
class KeyUpdate(BaseModel):
    api_key: str = PField(min_length=20, max_length=300, pattern=r"^[A-Za-z0-9_\-\.]+$")
    model: str | None = PField(default=None, max_length=120)


@app.get("/api/settings")
async def get_settings():
    key = get_openrouter_key()
    return {
        "openrouter_key_set": bool(key),
        "openrouter_key_masked": secrets_store.mask(key) if key else None,
        "openrouter_key_source": "ui" if secrets_store.get_secret("openrouter_api_key") else ("env" if key else None),
        "openrouter_model": get_openrouter_model(),
        "decision_engine": get_decision_engine(),
        "typesafe_key_set": bool(openrouter.get_typesafe_key()),
        "kaggle_username": secrets_store.get_secret("kaggle_username") or settings.kaggle_username or None,
        "typesafe_key_masked": secrets_store.mask(openrouter.get_typesafe_key()) if openrouter.get_typesafe_key() else None,
    }


class TypesafeKeyUpdate(BaseModel):
    api_key: str = PField(min_length=10, max_length=300, pattern=r"^[A-Za-z0-9_\-\.]+$")


@app.put("/api/settings/typesafe")
async def set_typesafe_key(body: TypesafeKeyUpdate):
    """Verify a TypeSafe (Jev) key with a one-question call, then store it encrypted."""
    try:
        await openrouter.jev_decide("ping", {"ok": {"type": "noul", "instructions": "Is this a greeting?"}}, api_key=body.api_key, via="typesafe")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"could not reach TypeSafe: {e}")
    secrets_store.set_secret("typesafe_api_key", body.api_key)
    return {"ok": True, "masked": secrets_store.mask(body.api_key)}


@app.delete("/api/settings/typesafe")
async def delete_typesafe_key():
    secrets_store.delete_secret("typesafe_api_key")
    return {"ok": True}


class KaggleCreds(BaseModel):
    username: str = PField(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_\-\.]+$")
    key: str = PField(min_length=10, max_length=200, pattern=r"^[A-Za-z0-9_\-\.]+$")


@app.put("/api/settings/kaggle")
async def set_kaggle(body: KaggleCreds):
    """Kaggle API credentials (kaggle.com > Settings > Create new token). Stored encrypted."""
    secrets_store.set_secret("kaggle_username", body.username)
    secrets_store.set_secret("kaggle_key", body.key)
    return {"ok": True, "username": body.username}


@app.delete("/api/settings/kaggle")
async def delete_kaggle():
    secrets_store.delete_secret("kaggle_username")
    secrets_store.delete_secret("kaggle_key")
    return {"ok": True}


# ---------------------------------------------------------------- Learn (knowledge hub agent)
class LearnRequest(BaseModel):
    question: str = PField(min_length=1, max_length=4000)
    history: list[ChatMessage] = []          # used only when no session_id is given
    session_id: str | None = None
    language: str | None = PField(default=None, max_length=40, pattern=r"^[A-Za-z \-()']*$")


@app.get("/api/learn/docs")
async def learn_docs():
    from . import knowledge

    return knowledge.index()


@app.get("/api/learn/docs/{file}")
async def learn_doc(file: str):
    from . import knowledge

    try:
        return {"file": file, "content": knowledge.read(file)}
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/learn/ask")
async def learn_ask(req: LearnRequest):
    """Streams selecting / reading / answering events, then the answer with sources."""
    from . import knowledge

    if not get_openrouter_key():
        raise HTTPException(400, "OpenRouter key needed (Settings)")

    from . import sessions

    sess = None
    if req.session_id:
        try:
            sess = sessions.get(req.session_id)
        except (FileNotFoundError, ValueError):
            sess = None
    if sess is None:
        sess = sessions.create(None, kind="learn")
    history = [{"role": m["role"], "content": m["content"]} for m in sess["messages"]] or [m.model_dump() for m in req.history]

    async def gen():
        try:
            async for ev in knowledge.ask(req.question, history, req.language):
                if ev["type"] == "done":
                    s2 = sessions.append(sess["id"], [
                        {"role": "user", "content": req.question, "ts": time.time()},
                        {"role": "assistant", "content": ev["answer"], "sources": ev.get("sources"), "ts": time.time()},
                    ])
                    ev = {**ev, "session_id": s2["id"], "title": s2["title"]}
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/learn/i18n")
async def learn_i18n(lang: str = "Auto", scope: str = "learn"):
    """Intro text, placeholder and starter prompts in the chosen language (translated once, cached).
    scope = learn | chat"""
    from . import i18n

    return await i18n.strings(lang, "chat" if scope == "chat" else "learn")


@app.post("/api/learn/i18n/warm")
async def learn_i18n_warm():
    """Start pre-translating the UI strings for every language in the picker (background)."""
    from . import i18n

    if not get_openrouter_key():
        raise HTTPException(400, "OpenRouter key needed (Settings)")
    asyncio.create_task(i18n.warm_all())
    return i18n.warm_status()


@app.get("/api/learn/i18n/status")
async def learn_i18n_status():
    from . import i18n

    return i18n.warm_status()


@app.get("/api/learn/sessions")
async def learn_sessions():
    from . import sessions

    return sessions.list_all(kind="learn")


@app.get("/api/learn/sessions/{sid}")
async def learn_session_get(sid: str):
    from . import sessions

    try:
        s = sessions.get(sid)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(404, str(e))
    if s.get("kind") != "learn":
        raise HTTPException(404, "not a learn session")
    return s


@app.delete("/api/learn/sessions/{sid}")
async def learn_session_delete(sid: str):
    from . import sessions

    try:
        return {"ok": sessions.delete(sid)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/learn/sessions")
async def learn_sessions_delete_all():
    from . import sessions

    return {"ok": True, "deleted": sessions.delete_all(kind="learn")}


@app.get("/api/system")
async def system_info():
    """RAM / VRAM / CPU usage of the backend process and the machine."""
    from . import sysinfo

    return await asyncio.to_thread(sysinfo.snapshot)


@app.get("/api/usage")
async def get_usage(limit: int = 200, days: int | None = None):
    since = time.time() - days * 86400 if days else None
    return usage.summary(limit=min(limit, 1000), since=since)


@app.delete("/api/usage")
async def clear_usage():
    usage.clear()
    return {"ok": True}


@app.get("/api/skill")
async def skill_info():
    """What the JSON preparer was taught (from the TypeSafe/Jev agent skill)."""
    from . import question_guide

    return {"sources": question_guide.sources(), "guide": question_guide.guide()}


class PrefsUpdate(BaseModel):
    openrouter_model: str | None = PField(default=None, max_length=120)
    decision_engine: dict | None = None


@app.put("/api/settings/prefs")
async def set_prefs(body: PrefsUpdate):
    """Non-secret preferences: JSON-preparer model and decision engine."""
    eng = body.decision_engine
    if eng is not None:
        if eng.get("kind") not in ("laya", "jev"):
            raise HTTPException(400, "decision_engine.kind must be laya or jev")
        eng = {"kind": eng["kind"], "model": (eng.get("model") or None)}
    secrets_store.set_prefs(openrouter_model=body.openrouter_model, decision_engine=eng)
    return {"ok": True, "openrouter_model": get_openrouter_model(), "decision_engine": get_decision_engine()}


@app.put("/api/settings/openrouter")
async def set_openrouter_key(body: KeyUpdate):
    """Validate the key against OpenRouter, then store it encrypted. Never echoed back."""
    try:
        info = await openrouter.validate_key(body.api_key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"could not reach OpenRouter: {e}")
    secrets_store.set_secret("openrouter_api_key", body.api_key)
    if body.model:
        secrets_store.set_prefs(openrouter_model=body.model.strip())
    return {"ok": True, "masked": secrets_store.mask(body.api_key), "label": info.get("label"), "model": get_openrouter_model()}


@app.delete("/api/settings/openrouter")
async def delete_openrouter_key():
    secrets_store.delete_secret("openrouter_api_key")
    return {"ok": True}
