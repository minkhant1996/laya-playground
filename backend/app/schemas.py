from typing import Any, Literal
from pydantic import BaseModel, Field

State = str | dict[str, Any]


class Question(BaseModel):
    type: Literal["choice", "score", "noul"]
    instructions: str
    criteria: dict[str, str] | list[str] | None = None


class Engine(BaseModel):
    kind: Literal["laya", "jev"] = "laya"
    model: str | None = None


class PredictRequest(BaseModel):
    state: State
    questions: dict[str, Question]
    engine: Engine | None = None


class PrepareRequest(BaseModel):
    """Free-text description of what the user wants to decide -> Laya JSON."""
    description: str
    sample_text: str | None = None


class PrepareResponse(BaseModel):
    state: State | None = None
    questions: dict[str, Question]
    model: str


class DatasetInfo(BaseModel):
    id: str
    name: str
    path: str
    config: str | None = None
    text_column: str
    label_column: str
    description: str


class DatasetSource(BaseModel):
    """Where the evaluation rows come from."""
    kind: Literal["preset", "hf", "upload", "kaggle"] = "preset"
    dataset_id: str | None = None      # preset
    path: str | None = None            # hf repo id or URL
    config: str | None = None          # hf config name
    upload_id: str | None = None       # upload
    file: str | None = None            # kaggle: file inside the dataset
    header: bool = True                # kaggle: first row is a header
    text_column: str | None = None     # hf / upload override
    label_column: str | None = None


class EvalPlan(BaseModel):
    """Agent-prepared (and user-edited) evaluation setup: any question type + label mapping."""
    state_columns: list[str] | str | None = None   # list, single column, or "__all__"
    label_column: str | None = None
    question: Question
    label_map: dict[str, Any] = {}                  # dataset label value -> option | level index | bool


class PlanRequest(BaseModel):
    source: DatasetSource
    split: str = "test"


class EvaluateRequest(BaseModel):
    plan: EvalPlan | None = None
    dataset_id: str | None = None      # legacy shortcut for a preset
    source: DatasetSource | None = None
    shortlist_k: int | None = Field(default=None, ge=2, le=64)
    engine: Engine | None = None
    split: str = "test"
    limit: int = Field(default=50, ge=1, le=1000)
    offset: int = 0
    question_instructions: str | None = None
    # optional user-edited criteria (label -> description). If missing, generated.
    criteria: dict[str, str] | None = None
    use_ai_criteria: bool = True


class EvaluateRow(BaseModel):
    text: str
    gold: str
    pred: str
    confidence: float | None = None
    correct: bool
    raw: float | None = None      # score value or yes-probability
    ms: float | None = None       # decision latency for this sample (excludes model load)


class EvaluateResponse(BaseModel):
    dataset_id: str
    question_type: str = "choice"
    extra_metrics: dict[str, float] = {}
    shortlist_k: int | None = None
    n: int
    accuracy: float
    labels: list[str]
    criteria: dict[str, str]
    routing: dict[str, Any] | None = None
    rows: list[EvaluateRow]
    per_label: dict[str, dict[str, float]]
