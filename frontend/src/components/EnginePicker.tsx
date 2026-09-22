import type { Engine } from '../types'

interface Props {
  value: Engine
  onChange: (e: Engine) => void
  compact?: boolean
  typesafeReady?: boolean
  openrouterReady?: boolean
}

/** Which model answers the typed questions: Laya (local) or TypeSafe's Jev (through OpenRouter). */
export default function EnginePicker({ value, onChange, compact, typesafeReady, openrouterReady }: Props) {
  return (
    <div>
      <div className="radio">
        <label>
          <input type="radio" checked={value.kind === 'laya'} onChange={() => onChange({ kind: 'laya' })} /> Laya (local)
        </label>
        <label>
          <input type="radio" checked={value.kind === 'jev'} onChange={() => onChange({ kind: 'jev', model: 'jev-1.13' })} /> Jev (typesafe/jev-1.13 via OpenRouter)
          {openrouterReady === false && typesafeReady === false && <span className="small"> (needs OpenRouter or TypeSafe key)</span>}
        </label>
      </div>
      {value.kind === 'jev' && (
        <div className="row" style={{ marginTop: 4 }}>
          <select value={value.model ?? 'jev-1.13'} onChange={(e) => onChange({ kind: 'jev', model: e.target.value })} style={{ maxWidth: 200 }}>
            <option value="jev-1.13">jev-1.13</option>
            <option value="jev-latest">jev-latest</option>
          </select>
          {!compact && <span className="small">Runs through your OpenRouter key ($0.042 / 1M input tokens); falls back to a TypeSafe key.</span>}
        </div>
      )}
    </div>
  )
}
