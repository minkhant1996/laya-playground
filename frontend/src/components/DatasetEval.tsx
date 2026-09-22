import { useEffect, useRef, useState } from 'react'
import EnginePicker from './EnginePicker'
import EvalTable from './EvalTable'
import { api } from '../api'
import type { DatasetInfo, DatasetSource, Engine, EvalResult, EvalRow, InspectResult, KaggleInspect, UploadResult } from '../types'

type Mode = 'preset' | 'hf' | 'upload' | 'kaggle'

export default function DatasetEval({ aiEnabled, defaultEngine, typesafeReady }: { aiEnabled: boolean; defaultEngine: Engine; typesafeReady: boolean }) {
  const [mode, setMode] = useState<Mode>('preset')
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [datasetId, setDatasetId] = useState('banking77')

  // hf link mode
  const [hfRef, setHfRef] = useState('')
  const [hfConfig, setHfConfig] = useState('')
  const [inspect, setInspect] = useState<InspectResult | null>(null)
  const [inspecting, setInspecting] = useState(false)

  // kaggle mode
  const [kgRef, setKgRef] = useState('')
  const [kg, setKg] = useState<KaggleInspect | null>(null)
  const [kgBusy, setKgBusy] = useState(false)
  const [kgHeader, setKgHeader] = useState(true)

  // upload mode
  const [upload, setUpload] = useState<UploadResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // shared
  const [textCol, setTextCol] = useState('')
  const [labelCol, setLabelCol] = useState('')
  const [split, setSplit] = useState('test')
  const [limit, setLimit] = useState(30)
  const [offset, setOffset] = useState(0)
  const [useAi, setUseAi] = useState(true)
  const [shortlist, setShortlist] = useState(0)
  const [result, setResult] = useState<EvalResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState<Engine>(defaultEngine)
  const [status, setStatus] = useState('')
  const [live, setLive] = useState<{ i: number; n: number; accuracy: number; elapsed: number; eta: number } | null>(null)
  const [liveRows, setLiveRows] = useState<EvalRow[]>([])
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    setEngine(defaultEngine)
  }, [defaultEngine])

  useEffect(() => {
    api.datasets().then(setDatasets).catch(() => setDatasets([]))
  }, [])

  async function doInspect() {
    setError('')
    setInspect(null)
    setInspecting(true)
    try {
      const ref = hfConfig ? `${hfRef.trim()}:${hfConfig.trim()}` : hfRef.trim()
      const r = await api.inspect(ref)
      setInspect(r)
      if (r.needs_config) {
        setHfConfig(r.configs[0] ?? '')
      } else {
        setTextCol(r.text_column ?? '')
        setLabelCol(r.label_column ?? '')
        if (r.default_split) setSplit(r.default_split)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setInspecting(false)
    }
  }

  async function doKaggle(file?: string, header = kgHeader) {
    setError('')
    setKgBusy(true)
    try {
      const r = await api.inspectKaggle(kgRef, file, header)
      setKg(r)
      setTextCol(r.text_column ?? '')
      setLabelCol(r.label_column ?? '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setKgBusy(false)
    }
  }

  async function doUpload(file: File) {
    setError('')
    setUpload(null)
    try {
      const r = await api.upload(file)
      setUpload(r)
      setTextCol(r.text_column ?? '')
      setLabelCol(r.label_column ?? '')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function buildSource(): DatasetSource | null {
    if (mode === 'preset') return { kind: 'preset', dataset_id: datasetId }
    if (mode === 'hf') {
      if (!inspect || inspect.needs_config) return null
      return { kind: 'hf', path: inspect.path, config: inspect.config ?? null, text_column: textCol, label_column: labelCol }
    }
    if (mode === 'kaggle') {
      if (!kg) return null
      return { kind: 'kaggle', path: kg.path, file: kg.file, header: kg.header, text_column: textCol, label_column: labelCol }
    }
    if (!upload) return null
    return { kind: 'upload', upload_id: upload.upload_id, text_column: textCol, label_column: labelCol }
  }

  async function run() {
    const source = buildSource()
    if (!source) {
      setError(mode === 'hf' || mode === 'kaggle' ? 'Load a dataset link first.' : 'Upload a file first.')
      return
    }
    setError('')
    setBusy(true)
    setResult(null)
    setLive(null)
    setLiveRows([])
    setStatus('starting')
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await api.evaluateStream(
        { source, split, limit, offset, use_ai_criteria: useAi && aiEnabled, shortlist_k: shortlist > 1 ? shortlist : null, engine },
        (ev) => {
          if (ev.type === 'status') setStatus(ev.message)
          else if (ev.type === 'start') setStatus(`running ${ev.n} samples on ${ev.engine.kind === 'laya' ? 'Laya (local)' : ev.engine.model}`)
          else if (ev.type === 'row') {
            setLive({ i: ev.i, n: ev.n, accuracy: ev.accuracy, elapsed: ev.elapsed, eta: ev.eta })
            setLiveRows((r) => [ev.row, ...r].slice(0, 12))
          } else if (ev.type === 'done') {
            setResult(ev.result)
            setStatus('done')
          } else if (ev.type === 'error') setError(ev.message)
        },
        ac.signal,
      )
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      else setStatus('stopped')
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const current = datasets.find((d) => d.id === datasetId)
  const columns = mode === 'hf' ? inspect?.columns : mode === 'upload' ? upload?.columns : mode === 'kaggle' ? kg?.columns : undefined
  const labelCount = mode === 'hf' ? inspect?.labels?.length : mode === 'upload' ? upload?.labels.length : mode === 'kaggle' ? kg?.labels.length : undefined

  return (
    <div>
      <section className="panel">
        <h2>Data source</h2>
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button className={mode === 'preset' ? 'active' : ''} onClick={() => setMode('preset')}>
            Preset
          </button>
          <button className={mode === 'kaggle' ? 'active' : ''} onClick={() => setMode('kaggle')}>
            Kaggle link
          </button>
          <button className={mode === 'hf' ? 'active' : ''} onClick={() => setMode('hf')}>
            Hugging Face link
          </button>
          <button className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}>
            Upload JSON / CSV
          </button>
        </div>

        {mode === 'preset' && (
          <>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} style={{ maxWidth: 320 }}>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {current && (
              <div className="small" style={{ marginTop: 8 }}>
                {current.path}
                {current.config ? ` (${current.config})` : ''} — {current.description}
              </div>
            )}
          </>
        )}

        {mode === 'hf' && (
          <>
            <div className="row" style={{ marginTop: 0 }}>
              <input
                placeholder="https://huggingface.co/datasets/owner/name  or  owner/name"
                value={hfRef}
                onChange={(e) => setHfRef(e.target.value)}
                style={{ flex: 1, minWidth: 260 }}
              />
              {inspect?.needs_config && (
                <select value={hfConfig} onChange={(e) => setHfConfig(e.target.value)} style={{ width: 180 }}>
                  {inspect.configs.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
              <button className="primary" disabled={inspecting || !hfRef.trim()} onClick={doInspect}>
                {inspecting ? 'Downloading…' : inspect?.needs_config ? 'Load config' : 'Load'}
              </button>
            </div>
            {inspect?.needs_config && <div className="small" style={{ marginTop: 6 }}>This dataset has several configs — pick one and load again.</div>}
            {inspect && !inspect.needs_config && (
              <div className="small" style={{ marginTop: 8 }}>
                {inspect.path}
                {inspect.config ? ` (${inspect.config})` : ''} · splits: {inspect.splits?.join(', ')} · {inspect.size} rows in {inspect.default_split} · {inspect.labels?.length} labels
              </div>
            )}
          </>
        )}

        {mode === 'kaggle' && (
          <>
            <div className="row" style={{ marginTop: 0 }}>
              <input placeholder="https://www.kaggle.com/datasets/owner/name  or  owner/name" value={kgRef} onChange={(e) => setKgRef(e.target.value)} style={{ flex: 1, minWidth: 260 }} />
              <button className="primary" disabled={kgBusy || !kgRef.trim()} onClick={() => doKaggle()}>
                {kgBusy ? 'Downloading…' : 'Load'}
              </button>
            </div>
            <div className="small" style={{ marginTop: 6 }}>Public datasets download without an account. For private or competition data add Kaggle credentials in Settings.</div>
            {kg && (
              <div className="row">
                <label>file</label>
                <select value={kg.file} onChange={(e) => doKaggle(e.target.value)} style={{ maxWidth: 360 }}>
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
                      setKgHeader(e.target.checked)
                      doKaggle(kg.file, e.target.checked)
                    }}
                    style={{ width: 'auto', marginRight: 6 }}
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

        {mode === 'upload' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.jsonl,.ndjson,.csv,.tsv"
              onChange={(e) => e.target.files?.[0] && doUpload(e.target.files[0])}
            />
            <div className="small" style={{ marginTop: 6 }}>
              A list of records like <code>{'[{"text": "...", "label": "..."}]'}</code>, JSONL, a Hugging Face rows export, or CSV with a header. Max 25 MB.
            </div>
            {upload && (
              <div className="small" style={{ marginTop: 8 }}>
                {upload.filename} · {upload.size} rows · {upload.labels.length} labels
              </div>
            )}
          </>
        )}

        {columns && (
          <div className="row">
            <label>text column</label>
            <select value={textCol} onChange={(e) => setTextCol(e.target.value)} style={{ width: 160 }}>
              <option value="">—</option>
              {columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label>label column</label>
            <select value={labelCol} onChange={(e) => setLabelCol(e.target.value)} style={{ width: 160 }}>
              <option value="">—</option>
              {columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        )}

        <div className="row">
          {mode !== 'upload' && mode !== 'kaggle' && (
            <>
              <label>split</label>
              <input value={split} onChange={(e) => setSplit(e.target.value)} style={{ width: 110 }} />
            </>
          )}
          <label>samples</label>
          <input type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(+e.target.value)} style={{ width: 90 }} />
          <label>offset</label>
          <input type="number" min={0} value={offset} onChange={(e) => setOffset(+e.target.value)} style={{ width: 90 }} />
          <label title="For many-label sets: embed-rank labels and ask Laya only over the top-k. 0 = off.">shortlist k</label>
          <input type="number" min={0} max={64} value={shortlist} onChange={(e) => setShortlist(+e.target.value)} style={{ width: 80 }} />
          <label>
            <input type="checkbox" checked={useAi} disabled={!aiEnabled} onChange={(e) => setUseAi(e.target.checked)} style={{ width: 'auto', marginRight: 6 }} />
            AI-written label criteria
          </label>
          <button className="primary" disabled={busy} onClick={run}>
            {busy ? 'Evaluating…' : 'Evaluate'}
          </button>
          {busy && (
            <button className="ghost" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ marginBottom: 2 }}>Decision model</div>
          <EnginePicker value={engine} onChange={setEngine} compact openrouterReady={aiEnabled} typesafeReady={typesafeReady} />
        </div>
        {labelCount !== undefined && labelCount > 30 && shortlist === 0 && (
          <div className="small" style={{ marginTop: 6 }}>{labelCount} labels: consider a shortlist (e.g. 10) and AI criteria for better zero-shot accuracy.</div>
        )}
        {(busy || live) && (
          <div style={{ marginTop: 10 }}>
            <div className="live">
              <span>
                status: <b>{status}</b>
              </span>
              {live && (
                <>
                  <span>
                    sample <b>{live.i}</b> / {live.n}
                  </span>
                  <span>
                    running accuracy <b>{(live.accuracy * 100).toFixed(1)}%</b>
                  </span>
                  <span>
                    elapsed <b>{live.elapsed}s</b>
                  </span>
                  <span>
                    ETA <b>{live.eta}s</b>
                  </span>
                </>
              )}
            </div>
            <div className="progress">
              <div style={{ width: live ? `${(live.i / live.n) * 100}%` : '0%' }} />
            </div>
            {busy && liveRows.length > 0 && <EvalTable rows={liveRows} compact />}
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </section>

      {result && (
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
            <div className="metric">
              <div className="k">labels</div>
              <div className="v">
                {result.labels.length}
                {result.shortlist_k ? <span className="small"> (top-{result.shortlist_k})</span> : null}
              </div>
            </div>
            <div className="metric">
              <div className="k">checkpoint</div>
              <div className="v" style={{ fontSize: 15 }}>{result.routing?.model ?? '—'}</div>
            </div>
          </div>
          <EvalTable rows={result.rows} />
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
  )
}
