from collections import defaultdict
from typing import Any

import asyncio
import json

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import datasets_service as dsvc
from . import laya_service, openrouter
from .config import get_openrouter_key, get_openrouter_model, settings
from . import secrets_store
from pydantic import BaseModel, Field as PField
from .schemas import (
    DatasetInfo, DatasetSource, EvaluateRequest, EvaluateResponse, EvaluateRow,
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
    }


@app.post("/api/predict")
async def predict(req: PredictRequest) -> dict[str, Any]:
    questions = {k: v.model_dump(exclude_none=True) for k, v in req.questions.items()}
    try:
        return await laya_service.predict(req.state, questions)
    except Exception as e:  # surface model errors to the UI
        raise HTTPException(500, f"laya error: {e}")


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
    else:
        raise HTTPException(400, "bad source kind")
    text_col, label_col = src.text_column, src.label_column
    if not text_col or not label_col:
        gt, gl = dsvc.guess_columns(ds.column_names)
        text_col, label_col = text_col or gt, label_col or gl
    if not text_col or not label_col or text_col not in ds.column_names or label_col not in ds.column_names:
        raise HTTPException(400, f"set text_column and label_column (columns: {ds.column_names})")
    return path, ds, text_col, label_col


@app.post("/api/datasets/evaluate", response_model=EvaluateResponse)
async def evaluate(req: EvaluateRequest):
    try:
        name, ds, text_col, label_col = await _resolve_source(req)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"dataset load failed: {e}")

    names = dsvc.label_names(ds, label_col)
    ids = [dsvc.to_label_id(n) for n in names]
    is_int_label = ds.features[label_col].dtype in ("int64", "int32", "int8", "int16") if hasattr(ds.features[label_col], "dtype") else getattr(ds.features[label_col], "names", None) is not None

    # criteria: user-provided > AI-generated > label name
    criteria = {lid: lid.replace("_", " ") for lid in ids}
    if req.criteria:
        criteria.update({dsvc.to_label_id(k): v for k, v in req.criteria.items() if dsvc.to_label_id(k) in criteria})
    elif req.use_ai_criteria and get_openrouter_key():
        try:
            criteria = await openrouter.describe_labels(name, ids)
        except Exception:
            pass  # fall back silently to plain names

    question = {
        "label": {
            "type": "choice",
            "instructions": req.question_instructions or "Which category does this text belong to?",
            "criteria": criteria,
        }
    }
    shortlist_k = req.shortlist_k if req.shortlist_k and req.shortlist_k < len(ids) else None

    end = min(req.offset + req.limit, len(ds))
    if req.offset >= len(ds):
        raise HTTPException(400, f"offset beyond dataset size ({len(ds)})")
    subset = ds.select(range(req.offset, end))
    rows: list[EvaluateRow] = []
    routing = None
    per = defaultdict(lambda: {"n": 0, "correct": 0})
    for ex in subset:
        text = str(ex[text_col])
        gold_raw = ex[label_col]
        gold = ids[int(gold_raw)] if is_int_label and str(gold_raw).lstrip("-").isdigit() and int(gold_raw) < len(ids) else dsvc.to_label_id(str(gold_raw))
        try:
            res = await laya_service.predict(text, question, shortlist_k)
        except Exception as e:
            raise HTTPException(500, f"laya error: {e}")
        routing = routing or res.get("routing")
        pred, conf = laya_service.extract_choice(res, "label")
        ok = pred == gold
        per[gold]["n"] += 1
        per[gold]["correct"] += int(ok)
        rows.append(EvaluateRow(text=text, gold=gold, pred=pred, confidence=conf, correct=ok))

    n = len(rows)
    acc = sum(r.correct for r in rows) / n if n else 0.0
    per_label = {k: {"n": v["n"], "accuracy": v["correct"] / v["n"]} for k, v in per.items()}
    return EvaluateResponse(
        dataset_id=name, shortlist_k=shortlist_k, n=n, accuracy=acc, labels=ids, criteria=criteria,
        routing=routing, rows=rows, per_label=per_label,
    )


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
    }


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
        secrets_store.set_secret("openrouter_model", body.model.strip())
    return {"ok": True, "masked": secrets_store.mask(body.api_key), "label": info.get("label"), "model": get_openrouter_model()}


@app.delete("/api/settings/openrouter")
async def delete_openrouter_key():
    secrets_store.delete_secret("openrouter_api_key")
    secrets_store.delete_secret("openrouter_model")
    return {"ok": True}
