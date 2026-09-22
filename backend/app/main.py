from collections import defaultdict
from typing import Any

import asyncio
import json
import time

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import datasets_service as dsvc
from . import usage
from . import laya_service, openrouter
from .config import get_decision_engine, get_openrouter_key, get_openrouter_model, settings
from . import secrets_store
from typing import Literal

from pydantic import BaseModel, Field as PField
from .schemas import (
    DatasetInfo, DatasetSource, Engine, EvaluateRequest, EvaluateResponse, EvaluateRow,
    PredictRequest, PrepareRequest, PrepareResponse,
)

app = FastAPI(title="Laya Playground API")
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


@app.post("/api/chat")
async def chat_turn(req: ChatRequest):
    """One conversational turn inside a persisted session: text model prepares questions,
    decision model answers, text model explains. Creates a session if none is given."""
    from . import chat, sessions

    engine = req.engine.model_dump() if req.engine else None
    try:
        sess = sessions.get(req.session_id) if req.session_id else sessions.create(engine)
    except (FileNotFoundError, ValueError):
        sess = sessions.create(engine)
    history = [{"role": m["role"], "content": m["content"]} for m in sess["messages"]] + [{"role": "user", "content": req.message}]
    try:
        t = await chat.turn(history[-40:], engine)
    except Exception as e:
        raise HTTPException(502, f"chat failed: {e}")
    reply = f"{t['reply']}\n\n{t['explanation']}" if t.get("explanation") else t["reply"]
    sess = sessions.append(sess["id"], [
        {"role": "user", "content": req.message, "ts": time.time()},
        {"role": "assistant", "content": reply, "spec": t.get("spec"), "result": t.get("result"), "ts": time.time()},
    ], engine)
    return {"session_id": sess["id"], "title": sess["title"], "message": sess["messages"][-1], **t}


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


async def _resolve_source(req: EvaluateRequest):
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
    name, ds, text_col, label_col = await _resolve_source(req)

    names = dsvc.label_names(ds, label_col)
    ids = [dsvc.to_label_id(n) for n in names]
    feat = ds.features[label_col]
    is_int_label = getattr(feat, "names", None) is not None or str(getattr(feat, "dtype", "")).startswith("int")

    criteria = {lid: lid.replace("_", " ") for lid in ids}
    if req.criteria:
        criteria.update({dsvc.to_label_id(k): v for k, v in req.criteria.items() if dsvc.to_label_id(k) in criteria})
    elif req.use_ai_criteria and get_openrouter_key():
        yield {"type": "status", "message": f"writing criteria for {len(ids)} labels with {get_openrouter_model()}"}
        try:
            criteria = await openrouter.describe_labels(name, ids)
        except Exception as e:
            yield {"type": "status", "message": f"AI criteria failed ({e}); using label names"}

    question = {"label": {"type": "choice", "instructions": req.question_instructions or "Which category does this text belong to?", "criteria": criteria}}
    engine = req.engine.model_dump() if req.engine else get_decision_engine()
    shortlist_k = req.shortlist_k if engine.get("kind") == "laya" and req.shortlist_k and req.shortlist_k < len(ids) else None

    if req.offset >= len(ds):
        raise HTTPException(400, f"offset beyond dataset size ({len(ds)})")
    end = min(req.offset + req.limit, len(ds))
    subset = ds.select(range(req.offset, end))
    n_total = len(subset)
    yield {"type": "start", "n": n_total, "labels": ids, "criteria": criteria, "engine": engine}

    rows: list[EvaluateRow] = []
    routing = None
    per = defaultdict(lambda: {"n": 0, "correct": 0})
    correct = 0
    t0 = time.perf_counter()
    for i, ex in enumerate(subset):
        if text_col == "__all__":
            state: Any = {k: v for k, v in ex.items() if k != label_col}
            text = json.dumps(state, ensure_ascii=False, default=str)
        else:
            state = text = str(ex[text_col])
        gold_raw = ex[label_col]
        gold = ids[int(gold_raw)] if is_int_label and str(gold_raw).lstrip("-").isdigit() and int(gold_raw) < len(ids) else dsvc.to_label_id(str(gold_raw))
        try:
            res = await laya_service.decide(state, question, engine, shortlist_k)
        except Exception as e:
            raise HTTPException(500, f"decision error on sample {i + 1}: {e}")
        routing = routing or res.get("routing")
        pred, conf = laya_service.extract_choice(res, "label")
        ok = pred == gold
        correct += int(ok)
        per[gold]["n"] += 1
        per[gold]["correct"] += int(ok)
        row = EvaluateRow(text=text, gold=gold, pred=pred, confidence=conf, correct=ok)
        rows.append(row)
        elapsed = time.perf_counter() - t0
        yield {"type": "row", "i": i + 1, "n": n_total, "row": row.model_dump(), "accuracy": correct / (i + 1),
               "elapsed": round(elapsed, 1), "eta": round(elapsed / (i + 1) * (n_total - i - 1), 1)}

    n = len(rows)
    result = EvaluateResponse(
        dataset_id=name, shortlist_k=shortlist_k, n=n, accuracy=(correct / n if n else 0.0), labels=ids, criteria=criteria,
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
