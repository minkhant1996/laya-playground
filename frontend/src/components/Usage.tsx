import { useEffect, useState } from 'react'
import { api } from '../api'
import type { UsageBucket, UsageSummary } from '../types'
import { useConfirm } from './ConfirmDialog'
import SystemStats from './SystemStats'

const usd = (v: number) => (v ? `$${v.toFixed(v < 0.01 ? 5 : 4)}` : '$0')
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`)
const n = (v: number) => v.toLocaleString()

function BucketTable({ rows, label }: { rows: UsageBucket[]; label: string }) {
  if (!rows.length) return null
  return (
    <table className="aligned" style={{ marginBottom: 14 }}>
      <thead>
        <tr>
          <th>{label}</th>
          <th>calls</th>
          <th>errors</th>
          <th>in tokens</th>
          <th>out tokens</th>
          <th>cost</th>
          <th>avg latency</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td>{n(r.calls)}</td>
            <td className={r.errors ? 'bad' : ''}>{r.errors}</td>
            <td>{n(r.input_tokens)}</td>
            <td>{n(r.output_tokens)}</td>
            <td>{usd(r.cost_usd)}</td>
            <td>{ms(r.avg_latency_ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Usage() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [days, setDays] = useState<number | undefined>(undefined)
  const [error, setError] = useState('')
  const { confirm, dialog } = useConfirm()

  const load = (d = days) => api.usage(d).then(setData).catch((e) => setError((e as Error).message))
  useEffect(() => {
    load()
    const t = setInterval(() => load(), 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

  return (
    <div>
      {dialog}
      <section className="panel">
        <h2>Usage</h2>
        <div className="row" style={{ marginTop: 0 }}>
          {[
            [undefined, 'all time'],
            [1, 'today'],
            [7, '7 days'],
            [30, '30 days'],
          ].map(([d, l]) => (
            <button key={String(l)} className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d as number | undefined)}>
              {l as string}
            </button>
          ))}
          <span className="small">auto-refreshes every 5 s</span>
          <button
            className="ghost"
            style={{ marginLeft: 'auto' }}
            onClick={async () => {
              if (await confirm({ title: 'Clear the usage log?', confirmLabel: 'Clear' })) api.clearUsage().then(() => load())
            }}
          >
            Clear log
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {data && (
          <div className="metrics" style={{ flexWrap: 'wrap' }}>
            <div className="metric">
              <div className="k">calls</div>
              <div className="v">{n(data.total.calls)}</div>
            </div>
            <div className="metric">
              <div className="k">input tokens</div>
              <div className="v">{n(data.total.input_tokens)}</div>
            </div>
            <div className="metric">
              <div className="k">output tokens</div>
              <div className="v">{n(data.total.output_tokens)}</div>
            </div>
            <div className="metric">
              <div className="k">est. cost (OpenRouter)</div>
              <div className="v">{usd(data.total.cost_usd)}</div>
            </div>
            <div className="metric">
              <div className="k">avg latency</div>
              <div className="v">{ms(data.total.avg_latency_ms)}</div>
            </div>
            <div className="metric">
              <div className="k">errors</div>
              <div className="v" style={{ color: data.total.errors ? 'var(--bad)' : undefined }}>{data.total.errors}</div>
            </div>
          </div>
        )}
        <div className="small">Cost uses OpenRouter's listed prices per model. Laya (local) is free; Jev cost is not estimated (tokens are still counted).</div>
      </section>
      <SystemStats />
      {data && (
        <>
          <section className="panel" style={{ marginTop: 16 }}>
            <h2>Breakdown</h2>
            <BucketTable rows={data.by_model} label="engine : model" />
            <BucketTable rows={data.by_purpose} label="purpose" />
            <BucketTable rows={data.by_day} label="day" />
          </section>
          <section className="panel" style={{ marginTop: 16 }}>
            <h2>Recent calls ({data.recent.length})</h2>
            <div className="scroll" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>time</th>
                    <th>purpose</th>
                    <th>engine</th>
                    <th>model</th>
                    <th>q</th>
                    <th>in</th>
                    <th>out</th>
                    <th>cost</th>
                    <th>latency</th>
                    <th>status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={i}>
                      <td>{new Date(r.ts * 1000).toLocaleTimeString()}</td>
                      <td>{r.purpose}</td>
                      <td>{r.engine}</td>
                      <td>{r.model ?? '—'}</td>
                      <td>{r.questions ?? ''}</td>
                      <td>{r.input_tokens ?? ''}</td>
                      <td>{r.output_tokens ?? ''}</td>
                      <td>{r.cost_usd != null ? usd(r.cost_usd) : ''}</td>
                      <td>{r.latency_ms != null ? ms(r.latency_ms) : ''}</td>
                      <td className={r.ok ? 'ok' : 'bad'} title={r.error ?? ''}>
                        {r.ok ? 'ok' : 'error'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
