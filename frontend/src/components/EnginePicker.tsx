import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Engine, EnginesInfo } from '../types'

interface Props {
  value: Engine
  onChange: (e: Engine) => void
  compact?: boolean
  typesafeReady?: boolean
  openrouterReady?: boolean
}

let cache: EnginesInfo | null = null

export function engineLabel(e: Engine): string {
  if (e.kind === 'laya') return 'Laya (local)'
  if (e.kind === 'jev') return `Jev (${e.model ?? 'jev-1.13'} via OpenRouter)`
  if (e.kind === 'openjev') return `openjev ${(e.model ?? 'qwen3.5-0.8b-nli-v2s-long').replace('qwen3.5-', '').replace('-nli', '')} (local)`
  return 'Jev-Omni (local GPU)'
}

/** Which model answers the typed questions. */
export default function EnginePicker({ value, onChange, compact }: Props) {
  const [info, setInfo] = useState<EnginesInfo | null>(cache)
  useEffect(() => {
    api
      .engines()
      .then((i) => {
        cache = i
        setInfo(i)
      })
      .catch(() => undefined)
  }, [])
  const gb = (mb: number) => `${(mb / 1024).toFixed(0)} GB`
  const Opt = ({ kind, label, available, why, onPick }: { kind: Engine['kind']; label: string; available: boolean; why?: string; onPick: () => void }) => (
    <label title={why || label} style={{ opacity: available ? 1 : 0.55 }}>
      <input type="radio" checked={value.kind === kind} onChange={onPick} /> {label}
      {!available && why && <span className="small"> · {why.length > 60 ? why.slice(0, 58) + '…' : why}</span>}
    </label>
  )
  return (
    <div>
      <div className="radio">
        <Opt kind="laya" label="Laya (local)" available={info?.laya.available ?? true} why={info?.laya.why} onPick={() => onChange({ kind: 'laya' })} />
        <Opt kind="jev" label="Jev (typesafe/jev-1.13 via OpenRouter)" available={info?.jev.available ?? true} why={info?.jev.why} onPick={() => onChange({ kind: 'jev', model: 'jev-1.13' })} />
        <Opt kind="openjev" label="openjev (local, MIT)" available={info?.openjev.available ?? true} onPick={() => onChange({ kind: 'openjev', model: value.kind === 'openjev' ? value.model : 'qwen3.5-0.8b-nli-v2s-long' })} />
        <Opt kind="jev_omni" label="Jev-Omni (local GPU, multimodal 12B)" available={info?.jev_omni.available ?? false} why={info?.jev_omni.why} onPick={() => onChange({ kind: 'jev_omni' })} />
      </div>
      {value.kind === 'jev' && (
        <div className="row" style={{ marginTop: 4 }}>
          <select value={value.model ?? 'jev-1.13'} onChange={(e) => onChange({ kind: 'jev', model: e.target.value })} style={{ maxWidth: 200 }}>
            <option value="jev-1.13">jev-1.13</option>
            <option value="jev-latest">jev-latest (alias, currently the same weights as 1.13)</option>
          </select>
          {!compact && <span className="small">Runs through your OpenRouter key ($0.042 / 1M input tokens); falls back to a TypeSafe key.</span>}
        </div>
      )}
      {value.kind === 'openjev' && (
        <div className="row" style={{ marginTop: 4 }}>
          <select value={value.model ?? 'qwen3.5-0.8b-nli-v2s-long'} onChange={(e) => onChange({ kind: 'openjev', model: e.target.value })} style={{ maxWidth: 420 }}>
            {Object.entries(info?.openjev.variants ?? { 'qwen3.5-0.8b-nli-v2s-long': { label: 'openjev 0.8B', ram_mb: 2500, vram_mb: 2000, available: true } }).map(([k, v]) => (
              <option key={k} value={k} disabled={!v.available}>
                {v.label} · ~{gb(v.ram_mb)} RAM{v.available ? '' : ' · not enough memory'}
              </option>
            ))}
          </select>
          {!compact && (
            <span className="small">
              Open NLI cross-encoder (Qwen3.5) used as a decision model; runs on CPU or GPU. <a href={info?.openjev.url} target="_blank" rel="noreferrer">model card ↗</a>
            </span>
          )}
        </div>
      )}
      {value.kind === 'jev_omni' && !compact && (
        <div className="small" style={{ marginTop: 4 }}>
          Gemma 4 12B multimodal classifier (text, image, audio, video). Needs an NVIDIA GPU with ~{gb(info?.jev_omni.vram_mb ?? 26000)} VRAM; ~24 GB download.{' '}
          <a href={info?.jev_omni.url} target="_blank" rel="noreferrer">model card ↗</a>
          {info && !info.jev_omni.available && <div style={{ color: '#ffb454' }}>⚠ {info.jev_omni.why}</div>}
        </div>
      )}
    </div>
  )
}
