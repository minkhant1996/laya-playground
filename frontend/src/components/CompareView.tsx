import type { EvalResult } from '../types'

const isCloud = (r: EvalResult) => (r.routing?.model ?? '').startsWith('jev:')
const mem = (mb?: number) => (mb === undefined ? '—' : `${(mb / 1024).toFixed(2)} GB`)
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`)

/** Side-by-side comparison of two evaluation results over the same samples. */
export default function CompareView({ a, b, labelA, labelB }: { a: EvalResult; b: EvalResult; labelA: string; labelB: string }) {
  const n = Math.min(a.rows.length, b.rows.length)
  let agree = 0
  let bothRight = 0
  let onlyA = 0
  let onlyB = 0
  for (let i = 0; i < n; i++) {
    if (a.rows[i].pred === b.rows[i].pred) agree++
    if (a.rows[i].correct && b.rows[i].correct) bothRight++
    else if (a.rows[i].correct) onlyA++
    else if (b.rows[i].correct) onlyB++
  }
  const winner = a.accuracy === b.accuracy ? null : a.accuracy > b.accuracy ? labelA : labelB
  const faster = (a.extra_metrics?.avg_query_ms ?? 0) <= (b.extra_metrics?.avg_query_ms ?? 0) ? labelA : labelB
  const avgConf = (r: EvalResult) => {
    const c = r.rows.filter((x) => x.confidence != null)
    return c.length ? c.reduce((s, x) => s + (x.confidence ?? 0), 0) / c.length : 0
  }

  const Row = ({ k, va, vb, best }: { k: string; va: string; vb: string; best?: 'a' | 'b' | null }) => (
    <tr>
      <td>{k}</td>
      <td className={best === 'a' ? 'ok' : ''} style={{ textAlign: 'right' }}>
        {va}
      </td>
      <td className={best === 'b' ? 'ok' : ''} style={{ textAlign: 'right' }}>
        {vb}
      </td>
    </tr>
  )

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2>Model comparison · {n} samples · same question and criteria</h2>
      <div className="metrics" style={{ flexWrap: 'wrap' }}>
        <div className="metric">
          <div className="k">more accurate</div>
          <div className="v" style={{ fontSize: 16 }}>{winner ?? 'tie'}</div>
        </div>
        <div className="metric">
          <div className="k">faster per query</div>
          <div className="v" style={{ fontSize: 16 }}>{faster}</div>
        </div>
        <div className="metric">
          <div className="k">agreement</div>
          <div className="v">{n ? `${((agree / n) * 100).toFixed(0)}%` : '—'}</div>
        </div>
        <div className="metric">
          <div className="k">both right / only {labelA} / only {labelB}</div>
          <div className="v" style={{ fontSize: 16 }}>
            {bothRight} / {onlyA} / {onlyB}
          </div>
        </div>
      </div>
      <table className="aligned" style={{ marginBottom: 14 }}>
        <thead>
          <tr>
            <th>metric</th>
            <th style={{ textAlign: 'right' }}>{labelA}</th>
            <th style={{ textAlign: 'right' }}>{labelB}</th>
          </tr>
        </thead>
        <tbody>
          <Row k="accuracy" va={`${(a.accuracy * 100).toFixed(1)}%`} vb={`${(b.accuracy * 100).toFixed(1)}%`} best={a.accuracy === b.accuracy ? null : a.accuracy > b.accuracy ? 'a' : 'b'} />
          <Row
            k="avg per query"
            va={ms(a.extra_metrics?.avg_query_ms ?? 0)}
            vb={ms(b.extra_metrics?.avg_query_ms ?? 0)}
            best={(a.extra_metrics?.avg_query_ms ?? 0) <= (b.extra_metrics?.avg_query_ms ?? 0) ? 'a' : 'b'}
          />
          <Row k="total decision time" va={`${(a.extra_metrics?.total_query_s ?? 0).toFixed(1)} s`} vb={`${(b.extra_metrics?.total_query_s ?? 0).toFixed(1)} s`} />
          <Row k="avg confidence" va={`${(avgConf(a) * 100).toFixed(0)}%`} vb={`${(avgConf(b) * 100).toFixed(0)}%`} />
          {a.extra_metrics?.mae !== undefined && <Row k="MAE (score)" va={a.extra_metrics.mae.toFixed(2)} vb={(b.extra_metrics?.mae ?? 0).toFixed(2)} best={a.extra_metrics.mae <= (b.extra_metrics?.mae ?? 0) ? 'a' : 'b'} />}
          <Row k="RAM · backend peak" va={mem(a.extra_metrics?.ram_peak_mb)} vb={mem(b.extra_metrics?.ram_peak_mb)} />
          <Row k="VRAM · peak" va={mem(a.extra_metrics?.vram_peak_mb)} vb={mem(b.extra_metrics?.vram_peak_mb)} />
          <Row k="checkpoint" va={a.routing?.model ?? '—'} vb={b.routing?.model ?? '—'} />
          <Row k="cost" va={isCloud(a) ? 'OpenRouter, see Usage' : 'free (local)'} vb={isCloud(b) ? 'OpenRouter, see Usage' : 'free (local)'} />
          <Row k="runs on" va={isCloud(a) ? 'TypeSafe cloud via OpenRouter' : 'your machine'} vb={isCloud(b) ? 'TypeSafe cloud via OpenRouter' : 'your machine'} />
        </tbody>
      </table>
      <div className="scroll" style={{ maxHeight: 520 }}>
        <table>
          <thead>
            <tr>
              <th>text</th>
              <th>actual</th>
              <th>{labelA}</th>
              <th>{labelB}</th>
            </tr>
          </thead>
          <tbody>
            {a.rows.slice(0, n).map((r, i) => {
              const s = b.rows[i]
              return (
                <tr key={i}>
                  <td className="small">{r.text.length > 110 ? r.text.slice(0, 108) + '…' : r.text}</td>
                  <td>{r.gold}</td>
                  <td className={r.correct ? 'ok' : 'bad'}>
                    {r.pred} <span className="small">{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : ''}</span>
                  </td>
                  <td className={s.correct ? 'ok' : 'bad'}>
                    {s.pred} <span className="small">{s.confidence != null ? `${(s.confidence * 100).toFixed(0)}%` : ''}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary>Per-label accuracy</summary>
        <table className="aligned">
          <thead>
            <tr>
              <th>label</th>
              <th style={{ textAlign: 'right' }}>{labelA}</th>
              <th style={{ textAlign: 'right' }}>{labelB}</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys({ ...a.per_label, ...b.per_label }).map((l) => (
              <tr key={l}>
                <td>{l}</td>
                <td style={{ textAlign: 'right' }}>{a.per_label[l] ? `${(a.per_label[l].accuracy * 100).toFixed(0)}% (${a.per_label[l].n})` : '—'}</td>
                <td style={{ textAlign: 'right' }}>{b.per_label[l] ? `${(b.per_label[l].accuracy * 100).toFixed(0)}% (${b.per_label[l].n})` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
