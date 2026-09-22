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
          <input type="radio" checked={value.kind === 'openrouter'} onChange={() => onChange({ kind: 'openrouter', model: value.model ?? '' })} /> OpenRouter LLM
          {openrouterReady === false && <span className="small"> (no key)</span>}
        </label>
        <label>
          <input type="radio" checked={value.kind === 'jev'} onChange={() => onChange({ kind: 'jev', model: 'jev-latest' })} /> Jev (TypeSafe API)
          {typesafeReady === false && <span className="small"> (no key)</span>}
        </label>
      </div>
      {value.kind === 'openrouter' && <ModelPicker value={value.model ?? ''} onChange={(m) => onChange({ kind: 'openrouter', model: m })} />}
      {value.kind === 'jev' && !compact && (
        <input value={value.model ?? 'jev-latest'} onChange={(e) => onChange({ kind: 'jev', model: e.target.value })} placeholder="jev-latest" style={{ maxWidth: 240 }} />
      )}
    </div>
  )
}
