"""Hugging Face classification datasets exposed as Laya 'choice' evaluations."""
import asyncio
import csv
import io
import json
import re
import uuid
from pathlib import Path
from typing import Any

from datasets import Dataset, get_dataset_config_names, get_dataset_split_names, load_dataset

from .config import settings
from .schemas import DatasetInfo

DATASETS: dict[str, DatasetInfo] = {
    d.id: d
    for d in [
        DatasetInfo(
            id="banking77", name="Banking77", path="mteb/banking77",
            text_column="text", label_column="label",
            description="77 fine-grained banking customer-support intents.",
        ),
        DatasetInfo(
            id="emotion", name="DAIR Emotion", path="dair-ai/emotion", config="split",
            text_column="text", label_column="label",
            description="6 emotions in English tweets.",
        ),
        DatasetInfo(
            id="ag_news", name="AG News", path="fancyzhx/ag_news",
            text_column="text", label_column="label",
            description="4 news topic classes.",
        ),
        DatasetInfo(
            id="tweet_sentiment", name="TweetEval Sentiment", path="cardiffnlp/tweet_eval",
            config="sentiment", text_column="text", label_column="label",
            description="negative / neutral / positive tweets.",
        ),
        DatasetInfo(
            id="sst2", name="SST-2", path="stanfordnlp/sst2",
            text_column="sentence", label_column="label",
            description="Binary movie-review sentiment (use split=validation).",
        ),
        DatasetInfo(
            id="clinc_oos", name="CLINC150 (plus)", path="DeepPavlov/clinc_oos", config="plus",
            text_column="text", label_column="label",
            description="150 assistant intents + out-of-scope.",
        ),
    ]
}


def _load_sync(info: DatasetInfo, split: str):
    kwargs: dict[str, Any] = {"split": split}
    if info.config:
        kwargs["name"] = info.config
    if settings.hf_token:
        kwargs["token"] = settings.hf_token
    return load_dataset(info.path, **kwargs)


async def load_split(info: DatasetInfo, split: str):
    return await asyncio.to_thread(_load_sync, info, split)


def label_names(ds, label_column: str) -> list[str]:
    """Label names indexed by integer id.

    Handles ClassLabel features, a companion `<label>_text` column (mteb-style parquet
    mirrors), or plain string labels.
    """
    feat = ds.features[label_column]
    names = getattr(feat, "names", None)
    if names:
        return [str(n) for n in names]
    text_col = f"{label_column}_text"
    if text_col in ds.column_names:
        mapping: dict[int, str] = {}
        for lid, name in zip(ds[label_column], ds[text_col]):
            mapping.setdefault(int(lid), str(name))
        return [mapping.get(i, str(i)) for i in range(max(mapping) + 1)]
    return sorted({str(v) for v in ds[label_column]})


def to_label_id(name: str) -> str:
    return name.strip().replace(" ", "_").replace("-", "_")


# ------------------------------------------------------------------ custom sources
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "data" / "uploads"
HF_REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")

TEXT_HINTS = ("text", "sentence", "utterance", "query", "content", "message", "review", "body", "input")
LABEL_HINTS = ("label", "intent", "category", "class", "target", "topic", "sentiment", "emotion")


def parse_hf_ref(ref: str) -> tuple[str, str | None]:
    """Accept 'owner/name', 'owner/name:config', or any huggingface.co/datasets/... URL."""
    ref = ref.strip()
    m = re.match(r"^https?://huggingface\.co/datasets/([^/\s?#]+/[^/\s?#]+)(?:/.*)?$", ref)
    if m:
        ref = m.group(1)
    elif ref.startswith("datasets/"):
        ref = ref[len("datasets/"):]
    config = None
    if ":" in ref:
        ref, config = ref.split(":", 1)
    if not HF_REPO_RE.match(ref):
        raise ValueError("expected a Hugging Face dataset id like 'owner/name' or a huggingface.co/datasets URL")
    return ref, config or None


def guess_columns(columns: list[str]) -> tuple[str | None, str | None]:
    low = {c.lower(): c for c in columns}
    text = next((low[c] for c in low if any(h == c or c.startswith(h) for h in TEXT_HINTS)), None)
    label = next((low[c] for c in low if c != (text or "").lower() and any(h in c for h in LABEL_HINTS) and not c.endswith("_text")), None)
    return text, label


def _inspect_hf_sync(path: str, config: str | None) -> dict[str, Any]:
    token = settings.hf_token or None
    configs: list[str] = []
    try:
        configs = get_dataset_config_names(path, token=token)
    except Exception:
        pass
    if config is None and len(configs) > 1 and "default" not in configs:
        return {"path": path, "configs": configs, "needs_config": True}
    cfg = config or (configs[0] if configs else None)
    splits = get_dataset_split_names(path, cfg, token=token)
    split = "test" if "test" in splits else ("validation" if "validation" in splits else splits[0])
    ds = load_dataset(path, name=cfg, split=split, token=token)
    text, label = guess_columns(ds.column_names)
    return {
        "path": path, "config": cfg, "configs": configs, "needs_config": False,
        "splits": splits, "default_split": split, "columns": ds.column_names,
        "text_column": text, "label_column": label, "size": len(ds),
        "labels": label_names(ds, label)[:200] if label else [],
        "preview": [ds[i] for i in range(min(3, len(ds)))],
    }


async def inspect_hf(ref: str) -> dict[str, Any]:
    path, config = parse_hf_ref(ref)
    return await asyncio.to_thread(_inspect_hf_sync, path, config)


def _rows_from_upload(filename: str, raw: bytes) -> list[dict[str, Any]]:
    name = filename.lower()
    txt = raw.decode("utf-8-sig")
    if name.endswith(".csv") or name.endswith(".tsv"):
        dialect = "excel-tab" if name.endswith(".tsv") else "excel"
        return [dict(r) for r in csv.DictReader(io.StringIO(txt), dialect=dialect)]
    if name.endswith(".jsonl") or name.endswith(".ndjson"):
        return [json.loads(l) for l in txt.splitlines() if l.strip()]
    data = json.loads(txt)
    if isinstance(data, dict):
        # HF-style {"data": [...]}, {"rows": [...]}, {"train": [...]} or {"rows":[{"row":{...}}]}
        for key in ("data", "rows", "train", "test", "validation", "examples"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            raise ValueError("JSON object must contain a list under 'data', 'rows', 'train', 'test' or 'examples'")
    if not isinstance(data, list):
        raise ValueError("JSON must be a list of records")
    return [r["row"] if isinstance(r, dict) and isinstance(r.get("row"), dict) else r for r in data]


def save_upload(filename: str, raw: bytes) -> dict[str, Any]:
    rows = _rows_from_upload(filename, raw)
    if not rows or not isinstance(rows[0], dict):
        raise ValueError("no records found")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex[:12]
    (UPLOAD_DIR / f"{uid}.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
    columns = list(rows[0].keys())
    text, label = guess_columns(columns)
    labels = sorted({str(r.get(label)) for r in rows if r.get(label) is not None}) if label else []
    return {"upload_id": uid, "filename": filename, "size": len(rows), "columns": columns,
            "text_column": text, "label_column": label, "labels": labels[:200], "preview": rows[:3]}


def load_upload(upload_id: str) -> Dataset:
    if not re.fullmatch(r"[0-9a-f]{12}", upload_id):
        raise ValueError("bad upload id")
    f = UPLOAD_DIR / f"{upload_id}.jsonl"
    if not f.exists():
        raise FileNotFoundError("upload not found")
    return Dataset.from_list([json.loads(l) for l in f.read_text().splitlines() if l.strip()])


# ------------------------------------------------------------------ Kaggle
KAGGLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")
KAGGLE_DIR = Path(__file__).resolve().parent.parent / "data" / "kaggle"
TABULAR = (".csv", ".tsv", ".json", ".jsonl", ".parquet", ".xlsx")


def parse_kaggle_ref(ref: str) -> str:
    """Accept 'owner/dataset' or a kaggle.com/datasets/owner/dataset URL."""
    ref = ref.strip()
    m = re.match(r"^https?://(?:www\.)?kaggle\.com/datasets/([^/\s?#]+/[^/\s?#]+)(?:/.*)?$", ref)
    if m:
        ref = m.group(1)
    if not KAGGLE_RE.match(ref):
        raise ValueError("expected a Kaggle dataset like 'owner/dataset' or a kaggle.com/datasets URL")
    return ref


def _kaggle_env() -> None:
    """Export Kaggle credentials (Settings > .env) for kagglehub; public datasets work without them."""
    import os

    from . import secrets_store

    user = secrets_store.get_secret("kaggle_username") or settings.kaggle_username
    key = secrets_store.get_secret("kaggle_key") or settings.kaggle_key
    if user and key:
        os.environ["KAGGLE_USERNAME"] = user
        os.environ["KAGGLE_KEY"] = key
    os.environ.setdefault("KAGGLEHUB_CACHE", str(KAGGLE_DIR))


def _kaggle_files(root: Path) -> list[dict[str, Any]]:
    out = []
    for f in sorted(root.rglob("*")):
        if f.is_file() and f.suffix.lower() in TABULAR:
            out.append({"file": str(f.relative_to(root)), "size_kb": round(f.stat().st_size / 1024, 1)})
    return out


def _read_table(path: Path, max_rows: int | None = None, header: bool = True):
    import pandas as pd

    ext = path.suffix.lower()
    hdr = 0 if header else None
    if ext == ".csv":
        return pd.read_csv(path, nrows=max_rows, low_memory=False, header=hdr)
    if ext == ".tsv":
        return pd.read_csv(path, sep="\t", nrows=max_rows, header=hdr)
    if ext == ".jsonl":
        return pd.read_json(path, lines=True, nrows=max_rows)
    if ext == ".json":
        return pd.read_json(path)
    if ext == ".parquet":
        return pd.read_parquet(path)
    if ext == ".xlsx":
        return pd.read_excel(path, nrows=max_rows, header=hdr)
    raise ValueError(f"unsupported file type {ext}")


def _inspect_kaggle_sync(ref: str, file: str | None, header: bool = True) -> dict[str, Any]:
    import kagglehub

    _kaggle_env()
    root = Path(kagglehub.dataset_download(ref))
    files = _kaggle_files(root)
    if not files:
        raise ValueError("no CSV/JSON/Parquet files in this dataset")
    chosen = file or files[0]["file"]
    if chosen not in {f["file"] for f in files}:
        raise ValueError(f"file '{chosen}' not in dataset")
    df = _read_table(root / chosen, max_rows=50000, header=header)
    df.columns = [str(c) if header else f"col_{c}" for c in df.columns]
    text, label = guess_columns(list(df.columns))
    labels = sorted(df[label].dropna().astype(str).unique().tolist())[:200] if label else []
    return {"path": ref, "files": files, "file": chosen, "header": header, "columns": list(df.columns), "text_column": text, "label_column": label,
            "size": int(len(df)), "labels": labels, "preview": df.head(3).astype(object).where(df.head(3).notna(), None).to_dict("records")}


async def inspect_kaggle(ref: str, file: str | None = None, header: bool = True) -> dict[str, Any]:
    return await asyncio.to_thread(_inspect_kaggle_sync, parse_kaggle_ref(ref), file, header)


def load_kaggle(ref: str, file: str, header: bool = True) -> Dataset:
    import kagglehub

    _kaggle_env()
    root = Path(kagglehub.dataset_download(parse_kaggle_ref(ref)))
    p = (root / file).resolve()
    if not str(p).startswith(str(root.resolve())) or not p.is_file():
        raise ValueError("bad file")
    df = _read_table(p, header=header)
    df.columns = [str(c) if header else f"col_{c}" for c in df.columns]
    return Dataset.from_pandas(df.astype({c: str for c in df.columns if df[c].dtype == object}), preserve_index=False)
