import type { EvalResult } from '../types'

const isCloud = (r: EvalResult) => (r.routing?.model ?? '').startsWith('jev:')
const mem = (mb?: number) => (mb === undefined ? '—' : `${(mb / 1024).toFixed(2)} GB`)
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`)
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export interface CompareEntry {
  label: string
  result: EvalResult
}

/** Side-by-side comparison of two or more evaluation runs over the same samples. */
export default function CompareView({ entries }: { entries: CompareEntry[] }) {
  if (entries.length < 2) return null
  const n = Math.min(...entries.map((e) => e.result.rows.length))
  const results = entries.map((e) => e.result)

  // agreement: how often every model produced the same prediction
  let allAgree = 0
  const rightCount: number[] = new Array(entries.length).fill(0)
  let noneRight = 0
  let onlyOne = 0
  for (let i = 0; i < n; i++) {
    const preds = results.map((r) => r.rows[i].pred)
    if (preds.every((p) => p === preds[0])) allAgree++
    const correct = results.map((r) => r.rows[i].correct)
    correct.forEach((c, k) => {
      if (c) rightCount[k]++
    })
    const k = correct.filter(Boolean).length
    if (k === 0) noneRight++
    else if (k === 1) onlyOne++
  }

  const bestAcc = entries.reduce((a, b) => (a.result.accuracy >= b.result.accuracy ? a : b))
  const fastest = entries.reduce((a, b) =>
    (a.result.extra_metrics?.avg_query_ms ?? Infinity) <= (b.result.extra_metrics?.avg_query_ms ?? Infinity) ? a : b,
  )
  const avgConf = (r: EvalResult) => {
    const c = r.rows.filter((x) => x.confidence != null)
    return c.length ? c.reduce((s, x) => s + (x.confidence ?? 0), 0) / c.length : 0
  }

  const Row = ({ k, values, best, title }: { k: string; values: string[]; best?: number | null; title?: string }) => (
    <tr title={title}>
      <td>{k}</td>
      {values.map((v, i) => (
        <td key={i} style={{ textAlign: 'right' }} className={best === i ? 'ok' : ''}>
          {v}
        </td>
      ))}
    </tr>
  )
  const argmin = (xs: (number | undefined)[]) => {
    let bi = -1
    let bv = Infinity
    xs.forEach((x, i) => {
      if (x !== undefined && x < bv) {
        bv = x
        bi = i
      }
    })
    return bi < 0 ? null : bi
  }
  const argmax = (xs: (number | undefined)[]) => {
    let bi = -1
    let bv = -Infinity
    xs.forEach((x, i) => {
      if (x !== undefined && x > bv) {
        bv = x
        bi = i
      }
    })
    return bi < 0 ? null : bi
  }

  const labels = entries.map((e) => e.label)
  const allLabels = [...new Set(results.flatMap((r) => Object.keys(r.per_label)))]

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2>
        Model comparison · {entries.length} models · {n} samples · same question and criteria
      </h2>
      <div className="metrics" style={{ flexWrap: 'wrap' }}>
        <div className="metric">
          <div className="k">most accurate</div>
          <div className="v" style={{ fontSize: 15 }}>{bestAcc.label}</div>
          <div className="small">{pct(bestAcc.result.accuracy)}</div>
        </div>
        <div className="metric">
          <div className="k">fastest per query</div>
          <div className="v" style={{ fontSize: 15 }}>{fastest.label}</div>
          <div className="small">{ms(fastest.result.extra_metrics?.avg_query_ms ?? 0)}</div>
        </div>
        <div className="metric">
          <div className="k">all {entries.length} agree</div>
          <div className="v">{n ? pct(allAgree / n) : '—'}</div>
        </div>
        <div className="metric">
          <div className="k">none right / only one right</div>
          <div className="v" style={{ fontSize: 18 }}>
            {noneRight} / {onlyOne}
          </div>
          <div className="small">of {n} samples</div>
        </div>
      </div>

      <div className="scroll" style={{ maxHeight: 420 }}>
        <table className="aligned">
          <thead>
            <tr>
              <th>metric</th>
              {labels.map((l) => (
                <th key={l} style={{ textAlign: 'right' }}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row k="accuracy" values={results.map((r) => pct(r.accuracy))} best={argmax(results.map((r) => r.accuracy))} />
            <Row
              k="avg per query"
              values={results.map((r) => ms(r.extra_metrics?.avg_query_ms ?? 0))}
              best={argmin(results.map((r) => r.extra_metrics?.avg_query_ms))}
              title="Mean latency of a single request"
            />
            <Row k="total decision time" values={results.map((r) => `${(r.extra_metrics?.total_query_s ?? 0).toFixed(1)} s`)} />
            <Row k="avg confidence" values={results.map((r) => pct(avgConf(r)))} />
            {results.some((r) => r.extra_metrics?.mae !== undefined) && (
              <Row
                k="MAE (score)"
                values={results.map((r) => (r.extra_metrics?.mae !== undefined ? r.extra_metrics.mae.toFixed(2) : '—'))}
                best={argmin(results.map((r) => r.extra_metrics?.mae))}
              />
            )}
            <Row k="RAM · backend peak" values={results.map((r) => mem(r.extra_metrics?.ram_peak_mb))} />
            <Row k="VRAM · peak" values={results.map((r) => mem(r.extra_metrics?.vram_peak_mb))} />
            <Row k="checkpoint" values={results.map((r) => r.routing?.model ?? '—')} />
            <Row k="runs on" values={results.map((r) => (isCloud(r) ? 'TypeSafe cloud via OpenRouter' : 'your machine'))} />
            <Row k="cost" values={results.map((r) => (isCloud(r) ? 'OpenRouter, see Usage' : 'free (local)'))} />
            <Row k="correct" values={rightCount.map((c) => `${c} / ${n}`)} best={argmax(rightCount)} />
          </tbody>
        </table>
      </div>

      <div className="scroll" style={{ maxHeight: 520, marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>text</th>
              <th>actual</th>
              {labels.map((l) => (
                <th key={l}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results[0].rows.slice(0, n).map((r, i) => (
              <tr key={i}>
                <td className="small">{r.text.length > 90 ? r.text.slice(0, 88) + '…' : r.text}</td>
                <td>{r.gold}</td>
                {results.map((res, k) => {
                  const row = res.rows[i]
                  return (
                    <td key={k} className={row.correct ? 'ok' : 'bad'}>
                      {row.pred} <span className="small">{row.confidence != null ? `${(row.confidence * 100).toFixed(0)}%` : ''}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Per-label accuracy</summary>
        <div className="scroll" style={{ maxHeight: 360 }}>
          <table className="aligned">
            <thead>
              <tr>
                <th>label</th>
                {labels.map((l) => (
                  <th key={l} style={{ textAlign: 'right' }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allLabels.map((l) => (
                <tr key={l}>
                  <td>{l}</td>
                  {results.map((r, k) => (
                    <td key={k} style={{ textAlign: 'right' }}>
                      {r.per_label[l] ? `${(r.per_label[l].accuracy * 100).toFixed(0)}% (${r.per_label[l].n})` : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
