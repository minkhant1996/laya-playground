import { useEffect, useRef, useState } from "react";
import EnginePicker, { engineLabel } from "./EnginePicker";
import EvalTable from "./EvalTable";
import PlanEditor from "./PlanEditor";
import CompareView from "./CompareView";
import { useConfirm } from "./ConfirmDialog";
import { api } from "../api";
import type {
  DatasetInfo,
  DatasetSource,
  Engine,
  EvalResult,
  EvalRow,
  EnginesInfo,
  EvalHistoryEntry,
  EvalPlan,
  InspectResult,
  KaggleInspect,
  LibraryEntry,
  PlanResult,
  UploadResult,
} from "../types";

type Mode = "preset" | "hf" | "upload" | "kaggle" | "saved";

export default function DatasetEval({
  aiEnabled,
  defaultEngine,
  typesafeReady,
}: {
  aiEnabled: boolean;
  defaultEngine: Engine;
  typesafeReady: boolean;
}) {
  const [mode, setMode] = useState<Mode>("preset");
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [datasetId, setDatasetId] = useState("banking77");

  // hf link mode
  const [hfRef, setHfRef] = useState("");
  const [hfConfig, setHfConfig] = useState("");
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);

  // agent plan
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [usePlan, setUsePlan] = useState(true);
  const [planSource, setPlanSource] = useState<"saved" | "new" | null>(null);
  const [refreshCriteria, setRefreshCriteria] = useState(false);
  const [compare, setCompare] = useState<
    { label: string; result: EvalResult }[] | null
  >(null);
  const [history, setHistory] = useState<EvalHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(() => {
    try {
      return localStorage.getItem("eval-history-open") !== "0";
    } catch {
      return true;
    }
  });
  const toggleHistory = () => {
    setHistoryOpen((o) => {
      try {
        localStorage.setItem("eval-history-open", o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  const loadHistory = () =>
    api
      .evals()
      .then(setHistory)
      .catch(() => setHistory([]));
  const [compareStage, setCompareStage] = useState("");

  // saved library
  const [lib, setLib] = useState<LibraryEntry[]>([]);
  const [saved, setSaved] = useState<LibraryEntry | null>(null);
  const loadLib = () =>
    api
      .library()
      .then(setLib)
      .catch(() => setLib([]));

  // kaggle mode
  const [kgRef, setKgRef] = useState("");
  const [kg, setKg] = useState<KaggleInspect | null>(null);
  const [kgBusy, setKgBusy] = useState(false);
  const [kgHeader, setKgHeader] = useState(true);

  // upload mode
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // shared
  const [textCol, setTextCol] = useState("");
  const [labelCol, setLabelCol] = useState("");
  const [split, setSplit] = useState("test");
  const [splits, setSplits] = useState<Record<string, number>>({});
  const [splitsLoading, setSplitsLoading] = useState(false);
  const [limit, setLimit] = useState(30);
  const [offset, setOffset] = useState(0);
  const [useAi, setUseAi] = useState(true);
  const [shortlist, setShortlist] = useState(0);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<Engine>(defaultEngine);
  const [status, setStatus] = useState("");
  const [live, setLive] = useState<{
    i: number;
    n: number;
    accuracy: number;
    elapsed: number;
    eta: number;
    avg_ms?: number;
    concurrency?: number;
    mem?: { ram_mb: number; vram_mb: number | null } | null;
  } | null>(null);
  const [loadInfo, setLoadInfo] = useState<string>("");
  const [liveRows, setLiveRows] = useState<EvalRow[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const { confirm, dialog } = useConfirm();
  useEffect(() => {
    setEngine(defaultEngine);
  }, [defaultEngine]);

  useEffect(() => {
    api
      .datasets()
      .then(setDatasets)
      .catch(() => setDatasets([]));
    loadLib();
    loadHistory();
  }, []);
  const sourceLabel = () =>
    mode === "preset"
      ? (datasets.find((d) => d.id === datasetId)?.name ?? datasetId)
      : mode === "saved"
        ? (saved?.name ?? "")
        : mode === "kaggle"
          ? `${kg?.path ?? ""}/${kg?.file ?? ""}`
          : mode === "hf"
            ? (inspect?.path ?? "")
            : (upload?.filename ?? "");
  async function openHistory(id: string) {
    try {
      const h = await api.evalGet(id);
      if (h.kind === "compare" && (h.entries?.length ?? 0) >= 2) {
        setCompare(h.entries!);
        setResult(null);
      } else if (h.kind === "compare" && h.result_b) {
        setCompare([
          { label: h.label_a ?? "A", result: h.result },
          { label: h.label_b ?? "B", result: h.result_b },
        ]);
        setResult(null);
      } else {
        setCompare(null);
        setResult(h.result);
      }
      setLive(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function pickSaved(e: LibraryEntry) {
    setSaved(e);
    setTextCol(e.text_column ?? "");
    setLabelCol(e.label_column ?? "");
    if (e.split) setSplit(e.split);
  }

  async function doInspect() {
    setError("");
    setInspect(null);
    setInspecting(true);
    try {
      const ref = hfConfig
        ? `${hfRef.trim()}:${hfConfig.trim()}`
        : hfRef.trim();
      const r = await api.inspect(ref);
      setInspect(r);
      if (r.needs_config) {
        setHfConfig(r.configs[0] ?? "");
      } else {
        setTextCol(r.text_column ?? "__all__");
        setLabelCol(r.label_column ?? "");
        if (r.default_split) setSplit(r.default_split);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInspecting(false);
    }
  }

  async function doKaggle(file?: string, header = kgHeader) {
    setError("");
    setKgBusy(true);
    try {
      const r = await api.inspectKaggle(kgRef, file, header);
      setKg(r);
      setTextCol(r.text_column ?? "__all__");
      setLabelCol(r.label_column ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setKgBusy(false);
    }
  }

  async function doUpload(file: File) {
    setError("");
    setUpload(null);
    try {
      const r = await api.upload(file);
      setUpload(r);
      setTextCol(r.text_column ?? "__all__");
      setLabelCol(r.label_column ?? "");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function buildSource(): DatasetSource | null {
    if (mode === "preset") return { kind: "preset", dataset_id: datasetId };
    if (mode === "hf") {
      if (!inspect || inspect.needs_config) return null;
      return {
        kind: "hf",
        path: inspect.path,
        config: inspect.config ?? null,
        text_column: textCol,
        label_column: labelCol,
      };
    }
    if (mode === "saved") {
      if (!saved) return null;
      const {
        id: _id,
        name: _n,
        size: _s,
        labels: _l,
        last_used: _u,
        split: _sp,
        ...src
      } = saved;
      return { ...src, text_column: textCol, label_column: labelCol };
    }
    if (mode === "kaggle") {
      if (!kg) return null;
      return {
        kind: "kaggle",
        path: kg.path,
        file: kg.file,
        header: kg.header,
        text_column: textCol,
        label_column: labelCol,
      };
    }
    if (!upload) return null;
    return {
      kind: "upload",
      upload_id: upload.upload_id,
      text_column: textCol,
      label_column: labelCol,
    };
  }

  async function makePlan() {
    const source = buildSource();
    if (!source) {
      setError("Load or pick a dataset first.");
      return;
    }
    setError("");
    setPlanning(true);
    try {
      const p = await api.plan(source, split);
      setPlan(p);
      setUsePlan(true);
      setPlanSource("new");
      api
        .savePlan(source, split, p)
        .then(loadLib)
        .catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  }
  const updatePlan = (p: EvalPlan) => {
    if (!plan) return;
    const next = { ...plan, ...p };
    setPlan(next);
    const source = buildSource();
    if (source) api.savePlan(source, split, next).catch(() => undefined);
  };

  async function runWith(eng: Engine): Promise<EvalResult | null> {
    const source = buildSource();
    if (!source) {
      setError(
        mode === "saved"
          ? "Pick a saved dataset first."
          : mode === "hf" || mode === "kaggle"
            ? "Load a dataset link first."
            : "Upload a file first.",
      );
      return null;
    }
    setError("");
    setBusy(true);
    setResult(null);
    let out: EvalResult | null = null;
    setLive({ i: 0, n: limit, accuracy: 0, elapsed: 0, eta: 0 });
    setLiveRows([]);
    setLoadInfo("");
    setStatus("starting");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await api.evaluateStream(
        {
          source,
          split,
          limit,
          offset,
          use_ai_criteria: useAi && aiEnabled,
          refresh_criteria: refreshCriteria,
          shortlist_k: shortlist > 1 ? shortlist : null,
          engine: eng,
          plan:
            usePlan && plan
              ? {
                  state_columns: plan.state_columns,
                  label_column: plan.label_column,
                  question: plan.question,
                  label_map: plan.label_map,
                }
              : undefined,
        },
        (ev) => {
          if (ev.type === "status") {
            setStatus(ev.message);
            if (ev.stage === "loaded" && ev.load_seconds)
              setLoadInfo(
                `model load ${ev.load_seconds}s (excluded from timings)`,
              );
          } else if (ev.type === "start") {
            setStatus(
              `running ${ev.n} samples on ${ev.engine.kind === "laya" ? "Laya (local)" : ev.engine.model}`,
            );
            setLive({ i: 0, n: ev.n, accuracy: 0, elapsed: 0, eta: 0 });
          } else if (ev.type === "row") {
            setLive((prev) => ({
              i: ev.i,
              n: ev.n,
              accuracy: ev.accuracy,
              elapsed: ev.elapsed,
              eta: ev.eta,
              avg_ms: ev.avg_ms,
              concurrency: ev.concurrency,
              mem: ev.mem ?? prev?.mem ?? null,
            }));
            setLiveRows((r) => [ev.row, ...r].slice(0, 12));
          } else if (ev.type === "done") {
            out = ev.result;
            setResult(ev.result);
            setStatus("done");
            loadLib();
          } else if (ev.type === "error") setError(ev.message);
        },
        ac.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
      else setStatus("stopped");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
    return out;
  }

  const run = async () => {
    setCompare(null);
    const r = await runWith(engine);
    if (r) {
      api
        .evalSave({
          kind: "eval",
          title: `${sourceLabel()} · ${engineLabel(engine)} · ${(r.accuracy * 100).toFixed(1)}% (${r.n})`,
          dataset: sourceLabel(),
          engine: engineLabel(engine),
          result: r,
        })
        .then(loadHistory)
        .catch(() => undefined);
    }
    return r;
  };

  // ---- multi-model comparison: tick two or more engines
  const COMPARE_OPTIONS: { key: string; label: string; engine: Engine }[] = [
    { key: "laya", label: "Laya (local)", engine: { kind: "laya" } },
    { key: "jev:jev-1.13", label: "Jev jev-1.13 (OpenRouter)", engine: { kind: "jev", model: "jev-1.13" } },
    { key: "openjev:qwen3.5-0.8b-nli-v2s-long", label: "openjev 0.8B (local)", engine: { kind: "openjev", model: "qwen3.5-0.8b-nli-v2s-long" } },
    { key: "openjev:qwen3.5-4b-nli-v2", label: "openjev 4B v2 (local)", engine: { kind: "openjev", model: "qwen3.5-4b-nli-v2" } },
    { key: "jev_omni", label: "Jev-Omni (local GPU)", engine: { kind: "jev_omni" } },
  ];
  const [enginesInfo, setEnginesInfo] = useState<EnginesInfo | null>(null);
  const [comparePick, setComparePick] = useState<string[]>(["laya", "jev:jev-1.13"]);
  const [showUnavailable, setShowUnavailable] = useState(false);
  useEffect(() => {
    api.engines().then(setEnginesInfo).catch(() => undefined);
  }, []);

  function optionAvailable(key: string): { ok: boolean; why: string } {
    if (!enginesInfo) return { ok: true, why: "" };
    if (key === "laya") return { ok: enginesInfo.laya.available, why: enginesInfo.laya.why };
    if (key.startsWith("jev:")) return { ok: enginesInfo.jev.available, why: enginesInfo.jev.why };
    if (key === "jev_omni") return { ok: enginesInfo.jev_omni.available, why: enginesInfo.jev_omni.why };
    const v = enginesInfo.openjev.variants?.[key.split(":")[1]];
    return { ok: v ? v.available : true, why: v && !v.available ? "not enough memory for this variant" : "" };
  }

  const hiddenCount = COMPARE_OPTIONS.filter(
    (o) => !optionAvailable(o.key).ok && !comparePick.includes(o.key),
  ).length;

  async function compareModels() {
    setCompare(null);
    const picked = COMPARE_OPTIONS.filter((o) => comparePick.includes(o.key));
    if (picked.length < 2) {
      setError("Tick at least two models to compare.");
      return;
    }
    const out: { label: string; result: EvalResult }[] = [];
    for (let i = 0; i < picked.length; i++) {
      setCompareStage(`${i + 1}/${picked.length} · ${picked[i].label}`);
      const r = await runWith(picked[i].engine);
      if (!r) {
        setCompareStage("");
        return;
      }
      out.push({ label: picked[i].label, result: r });
    }
    setCompareStage("");
    setCompare(out);
    const best = out.reduce((a, b) => (a.result.accuracy >= b.result.accuracy ? a : b));
    api
      .evalSave({
        kind: "compare",
        title: `${sourceLabel()} · ${out.length} models · best ${best.label} ${(best.result.accuracy * 100).toFixed(1)}% (${out[0].result.n})`,
        dataset: sourceLabel(),
        engine: out.map((o) => o.label).join(" vs "),
        result: out[0].result,
        result_b: out[1]?.result ?? null,
        label_a: out[0].label,
        label_b: out[1]?.label,
        entries: out,
      })
      .then(loadHistory)
      .catch(() => undefined);
  }

  useEffect(() => {
    // restore a remembered plan for the current source, if any
    const src = buildSource();
    const entry = src
      ? lib.find(
          (e) =>
            e.kind === src.kind &&
            (src.kind === "preset"
              ? e.dataset_id === src.dataset_id
              : src.kind === "upload"
                ? e.upload_id === src.upload_id
                : e.path === src.path &&
                  (e.file ?? null) === (src.file ?? null) &&
                  (e.config ?? null) === (src.config ?? null)),
        )
      : undefined;
    if (entry?.plan) {
      setPlan(entry.plan);
      setUsePlan(true);
      setPlanSource("saved");
    } else {
      setPlan(null);
      setPlanSource(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, datasetId, inspect, upload, kg, saved, lib]);

  useEffect(() => {
    const src = buildSource();
    if (!src || (src.kind !== "preset" && src.kind !== "hf")) {
      setSplits({});
      return;
    }
    let alive = true;
    setSplitsLoading(true);
    api
      .splits(src)
      .then((r) => {
        if (!alive) return;
        setSplits(r.splits);
        const names = Object.keys(r.splits);
        if (names.length && !r.splits[split])
          setSplit(r.splits.test ? "test" : names[0]);
      })
      .catch(() => alive && setSplits({}))
      .finally(() => alive && setSplitsLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, datasetId, inspect?.path, inspect?.config, saved?.id]);

  const totalRows =
    mode === "preset" || mode === "hf"
      ? splits[split]
      : mode === "kaggle"
        ? kg?.size
        : mode === "upload"
          ? upload?.size
          : mode === "saved"
            ? (saved?.size ?? undefined)
            : undefined;
  const maxSamples = totalRows ? Math.max(1, totalRows - offset) : 1000;
  useEffect(() => {
    if (totalRows && limit > totalRows) setLimit(totalRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalRows]);

  const current = datasets.find((d) => d.id === datasetId);
  const hasSource =
    mode === "preset"
      ? !!datasetId
      : mode === "saved"
        ? !!saved
        : mode === "kaggle"
          ? !!kg
          : mode === "hf"
            ? !!inspect && !inspect.needs_config
            : !!upload;
  const ready = hasSource && !!plan && usePlan && !planning;
  const notReadyWhy = !hasSource
    ? mode === "hf" || mode === "kaggle"
      ? "Load a dataset link first."
      : mode === "upload"
        ? "Upload a file first."
        : mode === "saved"
          ? "Pick a saved dataset first."
          : "Pick a preset."
    : planning
      ? "Preparing the data with AI…"
      : !plan || !usePlan
        ? "Prepare data with AI first."
        : "";
  const columns =
    mode === "hf"
      ? inspect?.columns
      : mode === "upload"
        ? upload?.columns
        : mode === "kaggle"
          ? kg?.columns
          : mode === "saved" && saved
            ? [
                ...new Set(
                  [saved.text_column, saved.label_column].filter(
                    (c): c is string => !!c && c !== "__all__",
                  ),
                ),
              ]
            : undefined;
  const labelCount =
    mode === "hf"
      ? inspect?.labels?.length
      : mode === "upload"
        ? upload?.labels.length
        : mode === "kaggle"
          ? kg?.labels.length
          : undefined;

  const historyPanel = historyOpen ? (
    <section className="panel">
      <div className="histbar">
        <h2>History ({history.length})</h2>
        <span className="row" style={{ marginTop: 0 }}>
          {history.length > 1 && (
            <button
              className="chip"
              onClick={async () => {
                if (
                  await confirm({
                    title: "Delete all evaluation history?",
                    message: `${history.length} saved runs will be removed.`,
                  })
                )
                  api.evalDeleteAll().then(loadHistory);
              }}
            >
              Delete all
            </button>
          )}
          <button
            className="iconbtn"
            title="Minimize history"
            onClick={toggleHistory}
          >
            ☰
          </button>
        </span>
      </div>
      <div className="sessions" style={{ maxHeight: "70vh", marginTop: 8 }}>
        {history.length === 0 && (
          <div className="small">
            Every evaluation and comparison is saved here automatically.
          </div>
        )}
        {history.map((h) => (
          <div
            key={h.id}
            className="session"
            onClick={() => openHistory(h.id)}
            title={`${h.title} · ${new Date(h.created * 1000).toLocaleString()}`}
          >
            <span>
              <span className="kind">
                {h.kind === "compare" ? "⚖" : (h.question_type ?? "eval")}
              </span>{" "}
              {h.title}
            </span>
            <small>
              {new Date(h.created * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
            <button
              title="Delete"
              onClick={async (e) => {
                e.stopPropagation();
                if (
                  await confirm({
                    title: "Delete this run?",
                    message: <span>“{h.title}” will be removed.</span>,
                  })
                )
                  api.evalDelete(h.id).then(loadHistory);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  ) : (
    <section className="panel hist-min" title="Show history">
      <button className="iconbtn" onClick={toggleHistory} title="Show history">
        ☰
      </button>
      <span className="count">History ({history.length})</span>
    </section>
  );

  return (
    <div className={`evalwrap ${historyOpen ? "" : "min"}`}>
      {dialog}
      {historyPanel}
      <div>
        <section className="panel">
          <h2>Data source</h2>
          <div className="tabs" style={{ marginBottom: 12 }}>
            <button
              className={mode === "preset" ? "active" : ""}
              onClick={() => setMode("preset")}
            >
              Preset
            </button>
            <button
              className={mode === "saved" ? "active" : ""}
              onClick={() => setMode("saved")}
            >
              Saved ({lib.length})
            </button>
            <button
              className={mode === "kaggle" ? "active" : ""}
              onClick={() => setMode("kaggle")}
            >
              Kaggle link
            </button>
            <button
              className={mode === "hf" ? "active" : ""}
              onClick={() => setMode("hf")}
            >
              Hugging Face link
            </button>
            <button
              className={mode === "upload" ? "active" : ""}
              onClick={() => setMode("upload")}
            >
              Upload JSON / CSV
            </button>
          </div>

          {mode === "preset" && (
            <>
              <select
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                style={{ maxWidth: 320 }}
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {current && (
                <div className="small" style={{ marginTop: 8 }}>
                  {current.path}
                  {current.config ? ` (${current.config})` : ""} —{" "}
                  {current.description}
                </div>
              )}
            </>
          )}

          {mode === "hf" && (
            <>
              <div className="row" style={{ marginTop: 0 }}>
                <input
                  placeholder="https://huggingface.co/datasets/owner/name  or  owner/name"
                  value={hfRef}
                  onChange={(e) => setHfRef(e.target.value)}
                  style={{ flex: 1, minWidth: 260 }}
                />
                {inspect?.needs_config && (
                  <select
                    value={hfConfig}
                    onChange={(e) => setHfConfig(e.target.value)}
                    style={{ width: 180 }}
                  >
                    {inspect.configs.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                )}
                <button
                  className="primary"
                  disabled={inspecting || !hfRef.trim()}
                  onClick={doInspect}
                >
                  {inspecting
                    ? "Downloading…"
                    : inspect?.needs_config
                      ? "Load config"
                      : "Load"}
                </button>
              </div>
              {inspect?.needs_config && (
                <div className="small" style={{ marginTop: 6 }}>
                  This dataset has several configs — pick one and load again.
                </div>
              )}
              {inspect && !inspect.needs_config && (
                <div className="small" style={{ marginTop: 8 }}>
                  {inspect.path}
                  {inspect.config ? ` (${inspect.config})` : ""} · splits:{" "}
                  {inspect.splits?.join(", ")} · {inspect.size} rows in{" "}
                  {inspect.default_split} · {inspect.labels?.length} labels
                </div>
              )}
            </>
          )}

          {mode === "saved" && (
            <>
              {lib.length === 0 && (
                <div className="small">
                  Nothing yet. Any Kaggle, Hugging Face or uploaded dataset you
                  evaluate is remembered here with its columns, and its data
                  stays cached locally.
                </div>
              )}
              <div className="sessions" style={{ maxHeight: 260 }}>
                {lib.map((e) => (
                  <div
                    key={e.id}
                    className={`session ${saved?.id === e.id ? "on" : ""}`}
                    onClick={() => pickSaved(e)}
                    title={`${e.kind} · ${e.text_column} → ${e.label_column} · ${new Date(e.last_used * 1000).toLocaleString()}`}
                  >
                    <span>
                      <span className="kind">{e.kind}</span> {e.name}
                      {e.file ? ` / ${e.file}` : ""}
                    </span>
                    <small>
                      {e.size ?? "?"} rows · {e.labels ?? "?"} labels
                    </small>
                    <button
                      title="Forget this dataset"
                      onClick={async (ev) => {
                        ev.stopPropagation();
                        if (
                          !(await confirm({
                            title: "Forget this dataset?",
                            message:
                              "Only the shortcut and its saved plan are removed; downloaded data stays cached.",
                            confirmLabel: "Forget",
                          }))
                        )
                          return;
                        api.deleteLibrary(e.id).then(() => {
                          if (saved?.id === e.id) setSaved(null);
                          loadLib();
                        });
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              {saved && (
                <div className="small" style={{ marginTop: 6 }}>
                  Selected: {saved.name} · text:{" "}
                  <b>
                    {saved.text_column === "__all__"
                      ? "all columns as JSON"
                      : saved.text_column}
                  </b>{" "}
                  · label: <b>{saved.label_column}</b>
                </div>
              )}
            </>
          )}

          {mode === "kaggle" && (
            <>
              <div className="row" style={{ marginTop: 0 }}>
                <input
                  placeholder="https://www.kaggle.com/datasets/owner/name  or  owner/name"
                  value={kgRef}
                  onChange={(e) => setKgRef(e.target.value)}
                  style={{ flex: 1, minWidth: 260 }}
                />
                <button
                  className="primary"
                  disabled={kgBusy || !kgRef.trim()}
                  onClick={() => doKaggle()}
                >
                  {kgBusy ? "Downloading…" : "Load"}
                </button>
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                Public datasets download without an account. For private or
                competition data add Kaggle credentials in Settings.
              </div>
              {kg && (
                <div className="row">
                  <label>file</label>
                  <select
                    value={kg.file}
                    onChange={(e) => doKaggle(e.target.value)}
                    style={{ maxWidth: 360 }}
                  >
                    {kg.files.map((f) => (
                      <option key={f.file} value={f.file}>
                        {f.file} ({f.size_kb} KB)
                      </option>
                    ))}
                  </select>
                  <label>
                    <input
                      type="checkbox"
                      checked={kgHeader}
                      onChange={(e) => {
                        setKgHeader(e.target.checked);
                        doKaggle(kg.file, e.target.checked);
                      }}
                      style={{ width: "auto", marginRight: 6 }}
                    />
                    first row is header
                  </label>
                  <span className="small">
                    {kg.size} rows · {kg.labels.length} labels
                  </span>
                </div>
              )}
            </>
          )}

          {mode === "upload" && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.jsonl,.ndjson,.csv,.tsv"
                onChange={(e) =>
                  e.target.files?.[0] && doUpload(e.target.files[0])
                }
              />
              <div className="small" style={{ marginTop: 6 }}>
                A list of records like{" "}
                <code>{'[{"text": "...", "label": "..."}]'}</code>, JSONL, a
                Hugging Face rows export, or CSV with a header. Max 25 MB.
              </div>
              {upload && (
                <div className="small" style={{ marginTop: 8 }}>
                  {upload.filename} · {upload.size} rows ·{" "}
                  {upload.labels.length} labels
                </div>
              )}
            </>
          )}

          {columns && mode !== "saved" && (
            <div className="row">
              <label>text / state column</label>
              <select
                value={textCol}
                onChange={(e) => setTextCol(e.target.value)}
                style={{ width: 220 }}
              >
                <option value="">—</option>
                <option value="__all__">all other columns as JSON</option>
                {columns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <label>label column</label>
              <select
                value={labelCol}
                onChange={(e) => setLabelCol(e.target.value)}
                style={{ width: 160 }}
              >
                <option value="">—</option>
                {columns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          <div className="row">
            <button
              className="ghost"
              disabled={planning || !aiEnabled}
              onClick={makePlan}
              title="Ask the text model to propose state columns, question type, criteria and label mapping"
            >
              {planning
                ? "Preparing…"
                : plan
                  ? "↻ Re-prepare with AI"
                  : "✨ Prepare with AI"}
            </button>
            {plan && (
              <label>
                <input
                  type="checkbox"
                  checked={usePlan}
                  onChange={(e) => setUsePlan(e.target.checked)}
                  style={{ width: "auto", marginRight: 6 }}
                />
                use plan ({plan.question.type})
                {planSource === "saved" ? " · restored" : ""}
              </label>
            )}
            {!plan && (
              <span className="small">
                {mode === "preset"
                  ? "Optional: presets are ready to evaluate as-is (choice over their labels)."
                  : "Optional: without a plan the label column is evaluated as a choice question."}
              </span>
            )}
            {!aiEnabled && (
              <span className="small">
                Add an OpenRouter key to use the AI preparer.
              </span>
            )}
          </div>
          {plan && usePlan && <PlanEditor plan={plan} onChange={updatePlan} />}
        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ marginBottom: 4 }}>
            Compare these models — tick two or more; they all run on the same samples with the same question
          </div>
          <div className="chips">
            {COMPARE_OPTIONS.filter((o) => optionAvailable(o.key).ok || comparePick.includes(o.key) || showUnavailable).map((o) => {
              const av = optionAvailable(o.key);
              const on = comparePick.includes(o.key);
              return (
                <button
                  key={o.key}
                  className={`chip ${on ? "on" : ""}`}
                  disabled={!av.ok && !on}
                  title={av.ok ? o.label : av.why}
                  onClick={() =>
                    setComparePick((p) =>
                      p.includes(o.key) ? p.filter((x) => x !== o.key) : [...p, o.key],
                    )
                  }
                >
                  {on ? "☑" : "☐"} {o.label}
                  {!av.ok && <span className="small"> · unavailable</span>}
                </button>
              );
            })}
          </div>
          <div className="small" style={{ marginTop: 4 }}>
            {comparePick.length < 2
              ? "Pick at least two."
              : `${comparePick.length} selected · takes about ${comparePick.length}× a single evaluation.`}
            {hiddenCount > 0 && !showUnavailable && (
              <>
                {" · "}
                <button className="chip" style={{ padding: "0 7px", fontSize: 11 }} onClick={() => setShowUnavailable(true)}>
                  {hiddenCount} hidden: cannot run on this machine
                </button>
              </>
            )}
            {showUnavailable && (
              <>
                {" · "}
                <button className="chip" style={{ padding: "0 7px", fontSize: 11 }} onClick={() => setShowUnavailable(false)}>
                  hide unavailable
                </button>
              </>
            )}
          </div>
        </div>
          <div className="row">
            {(mode === "preset" || mode === "hf") && (
              <>
                <label>split</label>
                {Object.keys(splits).length > 0 ? (
                  <select
                    value={split}
                    onChange={(e) => setSplit(e.target.value)}
                    style={{ width: 200 }}
                  >
                    {Object.entries(splits).map(([name, n]) => (
                      <option key={name} value={name}>
                        {name === "all" ? "all splits (mixed)" : name} ·{" "}
                        {n.toLocaleString()} rows
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={split}
                    onChange={(e) => setSplit(e.target.value)}
                    style={{ width: 110 }}
                    placeholder={splitsLoading ? "loading…" : "test"}
                  />
                )}
              </>
            )}
            <label>samples</label>
            <input
              type="number"
              min={1}
              max={maxSamples}
              value={limit}
              onChange={(e) =>
                setLimit(
                  Math.min(Math.max(1, +e.target.value || 1), maxSamples),
                )
              }
              style={{ width: 90 }}
            />
            {totalRows !== undefined && (
              <span className="small">
                of {totalRows.toLocaleString()}
                {offset ? ` (from ${offset})` : ""}
                <button
                  className="chip"
                  style={{ marginLeft: 6, padding: "1px 7px", fontSize: 11 }}
                  onClick={() => setLimit(maxSamples)}
                  title="Evaluate every remaining row"
                >
                  all
                </button>
              </span>
            )}
            <label>offset</label>
            <input
              type="number"
              min={0}
              value={offset}
              onChange={(e) => setOffset(+e.target.value)}
              style={{ width: 90 }}
            />
            {!(plan && usePlan) && (
              <label title="For many-label sets: embed-rank labels and ask Laya only over the top-k. 0 = off.">
                shortlist k
              </label>
            )}
            {!(plan && usePlan) && (
              <input
                type="number"
                min={0}
                max={64}
                value={shortlist}
                onChange={(e) => setShortlist(+e.target.value)}
                style={{ width: 80 }}
              />
            )}
            {!(plan && usePlan) && (
              <label title="Generated once per dataset and saved; tick refresh to regenerate">
                <input
                  type="checkbox"
                  checked={useAi}
                  disabled={!aiEnabled}
                  onChange={(e) => setUseAi(e.target.checked)}
                  style={{ width: "auto", marginRight: 6 }}
                />
                AI-written label criteria
              </label>
            )}
            {!(plan && usePlan) && useAi && (
              <label title="Ignore the saved criteria and write them again">
                <input
                  type="checkbox"
                  checked={refreshCriteria}
                  onChange={(e) => setRefreshCriteria(e.target.checked)}
                  style={{ width: "auto", marginRight: 6 }}
                />
                refresh
              </label>
            )}
            <button
              className="primary"
              disabled={busy || !ready}
              onClick={run}
              title={notReadyWhy || "Evaluate with the selected decision model"}
            >
              {busy && !compareStage ? "Evaluating…" : "Evaluate"}
            </button>
            <button
              className="ghost"
              disabled={busy || !ready || comparePick.length < 2}
              onClick={compareModels}
              title={
                notReadyWhy ||
                "Run the same samples through the selected engine and the one chosen on the right, then compare accuracy, speed and agreement"
              }
            >
              {compareStage ? `Comparing ${compareStage}` : "⚖ Compare with…"}
            </button>
            <span className="small">tick models below →</span>
            {busy && (
              <button
                className="ghost"
                onClick={() => abortRef.current?.abort()}
              >
                Stop
              </button>
            )}
            {!busy && notReadyWhy && (
              <span className="small" style={{ color: "var(--bad)" }}>
                {notReadyWhy}
              </span>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="small" style={{ marginBottom: 2 }}>
              Decision model
            </div>
            <EnginePicker
              value={engine}
              onChange={setEngine}
              compact
              openrouterReady={aiEnabled}
              typesafeReady={typesafeReady}
            />
          </div>
          {textCol === "__all__" && (
            <div className="small" style={{ marginTop: 6 }}>
              Each row is sent as a JSON object. Fine for a few readable fields;
              for purely numeric tables (e.g. fraud features V1…V28) a classical
              model in the ML playground will do far better.
            </div>
          )}
          {labelCount !== undefined && labelCount > 30 && shortlist === 0 && (
            <div className="small" style={{ marginTop: 6 }}>
              {labelCount} labels: consider a shortlist (e.g. 10) and AI
              criteria for better zero-shot accuracy.
            </div>
          )}
          {(busy || live) && (
            <div style={{ marginTop: 10 }}>
              <div className="live">
                <span>
                  status: <b>{status}</b>
                  {status.startsWith("loading") && (
                    <span className="step on" style={{ marginLeft: 6 }}>
                      loading model
                    </span>
                  )}
                </span>
                {loadInfo && <span>{loadInfo}</span>}
                {live && (
                  <>
                    <span>
                      sample <b>{live.i}</b> / {live.n}
                    </span>
                    {live.i > 0 && (
                      <>
                        <span>
                          running accuracy{" "}
                          <b>{(live.accuracy * 100).toFixed(1)}%</b>
                        </span>
                        <span>
                          elapsed <b>{live.elapsed}s</b>
                        </span>
                        <span>
                          ETA <b>{live.eta}s</b>
                        </span>
                        <span>
                          avg request{" "}
                          <b>
                            {live.avg_ms !== undefined
                              ? live.avg_ms >= 1000
                                ? `${(live.avg_ms / 1000).toFixed(2)} s`
                                : `${live.avg_ms.toFixed(0)} ms`
                              : "—"}
                          </b>
                        </span>
                        {live.i > 0 && (
                          <span title="Wall-clock time per completed sample, parallel requests included">
                            effective{" "}
                            <b>
                              {(live.elapsed / live.i) * 1000 >= 1000
                                ? `${(live.elapsed / live.i).toFixed(2)} s`
                                : `${((live.elapsed / live.i) * 1000).toFixed(0)} ms`}
                              /sample
                            </b>
                            {live.concurrency && live.concurrency > 1
                              ? ` · ${live.concurrency} in parallel`
                              : ""}
                          </span>
                        )}
                        {live.mem && (
                          <span title="Backend process memory while Laya runs (— for Jev, which runs in the cloud)">
                            RAM <b>{(live.mem.ram_mb / 1024).toFixed(2)} GB</b>
                            {" · VRAM "}
                            <b>
                              {live.mem.vram_mb != null
                                ? `${(live.mem.vram_mb / 1024).toFixed(2)} GB`
                                : "—"}
                            </b>
                          </span>
                        )}
                        {!live.mem && engine.kind === "jev" && (
                          <span>
                            RAM <b>—</b> · VRAM <b>—</b>{" "}
                            <span className="small">(cloud)</span>
                          </span>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="progress">
                <div
                  style={{ width: live ? `${(live.i / live.n) * 100}%` : "0%" }}
                />
              </div>
              {busy && liveRows.length > 0 && (
                <EvalTable rows={liveRows} compact />
              )}
            </div>
          )}
          {error && <div className="error">{error}</div>}
        </section>

        {compare && <CompareView entries={compare} />}
        {result && !compare && (
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="metrics">
              <div className="metric">
                <div className="k">accuracy</div>
                <div className="v">{(result.accuracy * 100).toFixed(1)}%</div>
              </div>
              <div className="metric">
                <div className="k">samples</div>
                <div className="v">{result.n}</div>
              </div>
              {result.question_type && result.question_type !== "choice" && (
                <div className="metric">
                  <div className="k">question</div>
                  <div className="v" style={{ fontSize: 15 }}>
                    {result.question_type}
                    {result.extra_metrics?.mae !== undefined ? (
                      <span className="small">
                        {" "}
                        · MAE {result.extra_metrics.mae.toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="metric">
                <div className="k">labels</div>
                <div className="v">
                  {result.labels.length}
                  {result.shortlist_k ? (
                    <span className="small"> (top-{result.shortlist_k})</span>
                  ) : null}
                </div>
              </div>
              {result.extra_metrics?.avg_query_ms !== undefined && (
                <div className="metric">
                  <div className="k">avg per query</div>
                  <div className="v">
                    {result.extra_metrics.avg_query_ms >= 1000
                      ? `${(result.extra_metrics.avg_query_ms / 1000).toFixed(2)} s`
                      : `${result.extra_metrics.avg_query_ms.toFixed(0)} ms`}
                  </div>
                  <div className="small">
                    {result.extra_metrics.ram_peak_mb !== undefined
                      ? `RAM peak ${(result.extra_metrics.ram_peak_mb / 1024).toFixed(2)} GB`
                      : ""}
                    {result.extra_metrics.vram_peak_mb !== undefined
                      ? ` · VRAM ${(result.extra_metrics.vram_peak_mb / 1024).toFixed(2)} GB`
                      : ""}
                    {result.extra_metrics.ram_peak_mb !== undefined
                      ? " · "
                      : ""}
                    {result.extra_metrics.total_query_s.toFixed(1)}s total
                    {result.extra_metrics.model_load_s
                      ? ` · +${result.extra_metrics.model_load_s.toFixed(1)}s model load`
                      : ""}
                  </div>
                </div>
              )}
              <div className="metric">
                <div className="k">checkpoint</div>
                <div className="v" style={{ fontSize: 15 }}>
                  {result.routing?.model ?? "—"}
                </div>
              </div>
            </div>
            <div className="scroll" style={{ maxHeight: 520 }}>
              <EvalTable rows={result.rows} />
            </div>
            <details>
              <summary>Criteria used for each label</summary>
              <pre>{JSON.stringify(result.criteria, null, 2)}</pre>
            </details>
            <details>
              <summary>Per-label accuracy</summary>
              <pre>{JSON.stringify(result.per_label, null, 2)}</pre>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
