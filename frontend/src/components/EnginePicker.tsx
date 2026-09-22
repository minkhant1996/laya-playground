import type { Engine } from '../types'
import ModelPicker from './ModelPicker'

interface Props {
  value: Engine
  onChange: (e: Engine) => void
  compact?: boolean
  typesafeReady?: boolean
  openrouterReady?: boolean
}

/** Which model answers the typed questions: Laya (local), any OpenRouter LLM, or TypeSafe's Jev. */
export default function EnginePicker({ value, onChange, compact, typesafeReady, openrouterReady }: Props) {
  return (
    <div>
      <div className="radio">
        <label>
          <input type="radio" checked={value.kind === 'laya'} onChange={() => onChange({ kind: 'laya' })} /> Laya (local)
        </label>
        <label>
          <input type="radio" checked={value.kind === 'openrouter'} onChange={() => onChange({ kind: 'openrouter', model: value.kind === 'openrouter' ? value.model ?? '' : '' })} /> OpenRouter LLM
          {openrouterReady === false && <span className="small"> (no key)</span>}
        </label>
        <label>
          <input type="radio" checked={value.kind === 'jev'} onChange={() => onChange({ kind: 'jev', model: 'jev-1.13' })} /> Jev (TypeSafe)
          {openrouterReady === false && typesafeReady === false && <span className="small"> (needs OpenRouter or TypeSafe key)</span>}
        </label>
      </div>
      {value.kind === 'openrouter' && <ModelPicker value={value.model ?? ''} onChange={(m) => onChange({ kind: 'openrouter', model: m })} />}
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
