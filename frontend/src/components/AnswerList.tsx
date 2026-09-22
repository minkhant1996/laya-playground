import type { PredictResult } from '../types'

export default function AnswerList({ result }: { result: PredictResult }) {
  return (
    <div className="answers">
      {Object.entries(result.answers).map(([name, a]) => {
        const value = a.type === 'choice' ? a.choice : a.type === 'score' ? a.score : `${((a.noul ?? 0) * 100).toFixed(1)}% yes`
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
      {result.routing && (
        <div className="routing">
          answered by <b>{result.routing.model}</b> — {result.routing.reason}
        </div>
      )}
    </div>
  )
}
