import { useState } from 'react'
import { api } from '../api'
import type { PredictResult, Questions, State } from '../types'

const DEFAULT_STATE = {
  from: 'user@acme.com',
  subject: 'Duplicate charge on invoice #4411',
  body: 'Hi, we were billed twice for March. Please refund the duplicate today or we will cancel our plan.',
}

const DEFAULT_QUESTIONS: Questions = {
  department: {
    type: 'choice',
    instructions: 'Which department should handle this request?',
    criteria: {
      billing: 'invoices, payments, refunds',
      technical: 'bugs, outages, system errors',
      sales: 'pricing, new contracts',
      other: 'everything else',
    },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is this request?',
    criteria: ['not urgent', 'soon', 'critical deadline or blocking issue'],
  },
  churn_risk: { type: 'noul', instructions: 'Does the user threaten to cancel or leave?' },
}

function parseState(s: string): State {
  const t = s.trim()
  if (t.startsWith('{')) return JSON.parse(t)
  return t
}

export default function Playground({ aiEnabled }: { aiEnabled: boolean }) {
  const [stateText, setStateText] = useState(JSON.stringify(DEFAULT_STATE, null, 2))
  const [questionsText, setQuestionsText] = useState(JSON.stringify(DEFAULT_QUESTIONS, null, 2))
  const [description, setDescription] = useState('')
  const [result, setResult] = useState<PredictResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'predict' | 'ai' | null>(null)

  async function runPredict() {
    setError('')
    setBusy('predict')
    try {
      const r = await api.predict(parseState(stateText), JSON.parse(questionsText))
      setResult(r)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  async function runPrepare() {
    setError('')
    setBusy('ai')
    try {
      const r = await api.prepare(description, stateText.trim() || undefined)
      setQuestionsText(JSON.stringify(r.questions, null, 2))
      if (r.state && !stateText.trim()) {
        setStateText(typeof r.state === 'string' ? r.state : JSON.stringify(r.state, null, 2))
      }
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid">
      <div>
        <section className="panel">
          <h2>AI layer · describe what to decide</h2>
          <textarea
            rows={3}
            placeholder="e.g. Classify support emails into billing/technical/sales, rate urgency 0-2, and flag churn risk"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="row">
            <button className="primary" disabled={!aiEnabled || !description.trim() || busy !== null} onClick={runPrepare}>
              {busy === 'ai' ? 'Generating…' : 'Generate questions JSON'}
            </button>
            {!aiEnabled && <span className="small">Add an OpenRouter key in Settings to enable.</span>}
          </div>
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <h2>State (text or JSON)</h2>
          <textarea className="code" style={{ minHeight: 140 }} value={stateText} onChange={(e) => setStateText(e.target.value)} />
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Questions JSON</h2>
          <textarea className="code" value={questionsText} onChange={(e) => setQuestionsText(e.target.value)} />
          <div className="row">
            <button className="primary" disabled={busy !== null} onClick={runPredict}>
              {busy === 'predict' ? 'Running…' : 'Run Laya'}
            </button>
            <button
              className="ghost"
              onClick={() => {
                setStateText(JSON.stringify(DEFAULT_STATE, null, 2))
                setQuestionsText(JSON.stringify(DEFAULT_QUESTIONS, null, 2))
              }}
            >
              Reset example
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </section>
      </div>

      <section className="panel">
        <h2>Answers</h2>
        {!result && <div className="small">Run a prediction to see typed answers with calibrated confidence.</div>}
        {result && (
          <>
            <div className="answers">
              {Object.entries(result.answers).map(([name, a]) => {
                const value =
                  a.type === 'choice' ? a.choice : a.type === 'score' ? a.score : `${((a.noul ?? 0) * 100).toFixed(1)}% yes`
                const conf = a.confidence ?? (a.type === 'noul' ? Math.max(a.noul ?? 0, 1 - (a.noul ?? 0)) : 0)
                return (
                  <div key={name} className="answer">
                    <div style={{ flex: 1 }}>
                      <div className="q">
                        {name} · {a.type}
                      </div>
                      <div className="v">{String(value)}</div>
                      <div className="bar">
                        <div style={{ width: `${Math.round(conf * 100)}%` }} />
                      </div>
                    </div>
                    <div className="small">{(conf * 100).toFixed(1)}%</div>
                  </div>
                )
              })}
            </div>
            {result.routing && (
              <div className="routing">
                routed to <b>{result.routing.model}</b> — {result.routing.reason}
              </div>
            )}
            <details>
              <summary>Raw JSON</summary>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
    </div>
  )
}
