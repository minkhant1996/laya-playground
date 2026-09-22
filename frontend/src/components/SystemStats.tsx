import { useEffect, useState } from 'react'
import { api } from '../api'
import type { SystemInfo } from '../types'

const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`

function Meter({ label, used, total, extra }: { label: string; used: number; total: number; extra?: string }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className="metric" style={{ minWidth: 200 }}>
      <div className="k">{label}</div>
      <div className="v" style={{ fontSize: 16 }}>
        {gb(used)} <span className="small">/ {gb(total)}</span>
      </div>
      <div className="bar">
        <div style={{ width: `${pct}%`, background: pct > 90 ? 'var(--bad)' : pct > 75 ? '#ffb454' : 'var(--accent)' }} />
      </div>
      {extra && <div className="small">{extra}</div>}
    </div>
  )
}

/** Live RAM / VRAM / CPU panel (polls every 3 s). `compact` renders a one-line header chip. */
export default function SystemStats({ compact }: { compact?: boolean }) {
  const [s, setS] = useState<SystemInfo | null>(null)
  useEffect(() => {
    const load = () => api.system().then(setS).catch(() => setS(null))
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])
  if (!s) return null
  const gpu = s.gpus[0]
  if (compact) {
    return (
      <span className="small" title={`${s.os} · Laya on ${s.laya_device}${s.note ? ` · ${s.note}` : ''}`}>
        · RAM {gb(s.ram.used_mb)}/{gb(s.ram.total_mb)} · backend {gb(s.process.rss_mb)}
        {gpu ? ` · VRAM ${gb(gpu.used_mb)}/${gb(gpu.total_mb)}` : ' · no GPU'} · Laya: {s.laya_loaded ? `loaded (${s.laya_device})` : 'not loaded'}
      </span>
    )
  }
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2>Resources · {s.os}</h2>
      <div className="metrics" style={{ flexWrap: 'wrap' }}>
        <Meter label="system RAM" used={s.ram.used_mb} total={s.ram.total_mb} extra={`CPU ${s.cpu_percent.toFixed(0)}%`} />
        <Meter label="backend process (RSS)" used={s.process.rss_mb} total={s.ram.total_mb} extra={s.laya_loaded ? `Laya loaded on ${s.laya_device}` : 'Laya not loaded yet (loads on first use, ~2.3 GB)'} />
        {s.gpus.map((g) => (
          <Meter key={g.index} label={`VRAM · ${g.name}`} used={g.used_mb} total={g.total_mb} extra={g.process_mb != null ? `this process ${gb(g.process_mb)}` : 'all processes'} />
        ))}
        {s.gpus.length === 0 && (
          <div className="metric">
            <div className="k">GPU</div>
            <div className="v" style={{ fontSize: 16 }}>none detected</div>
          </div>
        )}
      </div>
      {s.note && <div className="small" style={{ color: '#ffb454' }}>⚠ {s.note}</div>}
      {!s.laya_loaded && s.free_mb < s.laya_min_free_mb && (
        <div className="small" style={{ color: 'var(--bad)' }}>
          ⚠ Only {gb(s.free_mb)} RAM free; Laya needs about {gb(s.laya_min_free_mb)} to load. The backend will refuse to load it rather than exhaust memory. Use Jev or close other programs.
        </div>
      )}
    </section>
  )
}
