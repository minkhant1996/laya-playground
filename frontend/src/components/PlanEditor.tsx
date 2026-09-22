import { useState } from 'react'
import type { EvalPlan, PlanResult, Question, QuestionType } from '../types'

interface Props {
  plan: PlanResult
  onChange: (p: EvalPlan) => void
}

/** Editable evaluation plan proposed by the agent: state columns, label column, question, label mapping. */
export default function PlanEditor({ plan, onChange }: Props) {
  const [critText, setCritText] = useState(JSON.stringify(plan.question.criteria ?? (plan.question.type === 'noul' ? null : {}), null, 2))
  const [critErr, setCritErr] = useState('')

  const cols = plan.columns
  const stateCols: string[] | 'all' = plan.state_columns === '__all__' || plan.state_columns == null ? 'all' : Array.isArray(plan.state_columns) ? plan.state_columns : [plan.state_columns]
  const set = (patch: Partial<EvalPlan>) => onChange({ state_columns: plan.state_columns, label_column: plan.label_column, question: plan.question, label_map: plan.label_map, ...patch })
  const setQ = (patch: Partial<Question>) => set({ question: { ...plan.question, ...patch } })

  function toggleCol(c: string) {
    const cur = stateCols === 'all' ? cols.filter((x) => x !== plan.label_column) : stateCols
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
    set({ state_columns: next.length === 1 ? next[0] : next })
  }
  function changeType(t: QuestionType) {
    let criteria: Question['criteria']
    let label_map: EvalPlan['label_map'] = {}
    if (t === 'choice') {
      criteria = Object.fromEntries(plan.label_values.map((v) => [v.replace(/[\s-]+/g, '_').toLowerCase(), v]))
      label_map = Object.fromEntries(plan.label_values.map((v) => [v, v.replace(/[\s-]+/g, '_').toLowerCase()]))
    } else if (t === 'score') {
      criteria = plan.label_values.map((v) => v)
      label_map = Object.fromEntries(plan.label_values.map((v, i) => [v, i]))
    } else {
      criteria = undefined
      label_map = Object.fromEntries(plan.label_values.map((v) => [v, /^(1|true|yes|y|positive)$/i.test(v)]))
    }
    setCritText(JSON.stringify(criteria ?? null, null, 2))
    set({ question: { ...plan.question, type: t, criteria }, label_map })
  }
  function applyCriteria(text: string) {
    setCritText(text)
    try {
      const c = JSON.parse(text)
      setCritErr('')
      setQ({ criteria: c ?? undefined })
    } catch {
      setCritErr('criteria must be valid JSON')
    }
  }
  const options: string[] = plan.question.type === 'choice' ? Object.keys((plan.question.criteria as Record<string, string>) ?? {}) : plan.question.type === 'score' ? ((plan.question.criteria as string[]) ?? []).map((_, i) => String(i)) : ['true', 'false']

  return (
    <div className="step" style={{ marginTop: 10 }}>
      <header>
        <b>Evaluation plan (agent proposal, editable)</b>
        <span className="small">{plan.dataset} · {plan.size} rows</span>
      </header>
      {plan.rationale && <div className="small" style={{ marginBottom: 8 }}>{plan.rationale}</div>}

      <div className="small" style={{ marginBottom: 4 }}>State columns (what the model reads)</div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {cols
          .filter((c) => c !== plan.label_column)
          .map((c) => (
            <button key={c} className={`chip ${stateCols === 'all' || stateCols.includes(c) ? 'on' : ''}`} onClick={() => toggleCol(c)}>
              {c}
            </button>
          ))}
      </div>

      <div className="row" style={{ marginTop: 0 }}>
        <label>label column</label>
        <select value={plan.label_column ?? ''} onChange={(e) => set({ label_column: e.target.value })} style={{ width: 180 }}>
          {cols.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label>question type</label>
        <select value={plan.question.type} onChange={(e) => changeType(e.target.value as QuestionType)} style={{ width: 150 }}>
          <option value="choice">choice</option>
          <option value="score">score</option>
          <option value="noul">noul (yes/no)</option>
        </select>
      </div>

      <div className="small" style={{ marginTop: 10 }}>Instructions</div>
      <input value={plan.question.instructions} onChange={(e) => setQ({ instructions: e.target.value })} />

      {plan.question.type !== 'noul' && (
        <>
          <div className="small" style={{ marginTop: 10 }}>{plan.question.type === 'choice' ? 'Criteria · option → rubric (JSON object)' : 'Criteria · ordered levels, low → high (JSON array)'}</div>
          <textarea className="code" style={{ minHeight: 140 }} value={critText} onChange={(e) => applyCriteria(e.target.value)} />
          {critErr && <div className="error">{critErr}</div>}
        </>
      )}

      <div className="small" style={{ marginTop: 10 }}>Label mapping · dataset value → expected answer</div>
      <div className="scroll" style={{ maxHeight: 220 }}>
        <table>
          <tbody>
            {plan.label_values.map((v) => (
              <tr key={v}>
                <td>{v}</td>
                <td>
                  <select
                    value={String(plan.label_map[v] ?? '')}
                    onChange={(e) => {
                      const val = plan.question.type === 'score' ? Number(e.target.value) : plan.question.type === 'noul' ? e.target.value === 'true' : e.target.value
                      set({ label_map: { ...plan.label_map, [v]: val } })
                    }}
                    style={{ padding: 4 }}
                  >
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {plan.question.type === 'score' ? `${o} · ${(plan.question.criteria as string[])[Number(o)] ?? ''}` : o}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
