import type { Answer, PredictResult } from '../types'

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`

function Choice({ a }: { a: Answer }) {
  const probs = (a.probabilities as Record<string, number> | undefined) ?? (a.choice ? { [a.choice]: a.confidence ?? 1 } : {})
  const rows = Object.entries(probs).sort((x, y) => y[1] - x[1])
  return (
    <div className="dist">
      {rows.slice(0, 12).map(([opt, p]) => (
        <div key={opt} className={`opt ${opt === a.choice ? 'win' : ''}`}>
          <span className="name">{opt}</span>
          <span className="track">
            <span style={{ width: `${Math.max(p * 100, 1)}%` }} />
          </span>
          <span className="p">{pct(p)}</span>
        </div>
      ))}
      {rows.length > 12 && <div className="small">+{rows.length - 12} more options</div>}
    </div>
  )
}

function Score({ a, levels }: { a: Answer; levels?: string[] }) {
  const probs = (a.probabilities as Record<string, number> | undefined) ?? {}
  const n = levels?.length ?? Math.max(Object.keys(probs).length, 2)
  const max = n - 1
  const v = Number(a.score ?? 0)
  return (
    <div className="score">
      <div className="scale">
        <div className="fill" style={{ width: `${(v / max) * 100}%` }} />
        <div className="marker" style={{ left: `${(v / max) * 100}%` }} title={`${v.toFixed(2)} / ${max}`} />
      </div>
      <div className="ticks">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} title={levels?.[i]}>
            <b>{i}</b>
            {probs[String(i)] !== undefined ? ` ${pct(probs[String(i)])}` : ''}
            {levels?.[i] ? <div className="small">{levels[i].length > 18 ? levels[i].slice(0, 17) + '…' : levels[i]}</div> : null}
          </span>
        ))}
      </div>
    </div>
  )
}

function Noul({ a }: { a: Answer }) {
  const yes = a.noul ?? 0
  return (
    <div className="dist">
      <div className={`opt ${yes >= 0.5 ? 'win' : ''}`}>
        <span className="name">yes</span>
        <span className="track">
          <span style={{ width: `${Math.max(yes * 100, 1)}%` }} />
        </span>
        <span className="p">{pct(yes)}</span>
      </div>
      <div className={`opt ${yes < 0.5 ? 'win' : ''}`}>
        <span className="name">no</span>
        <span className="track">
          <span style={{ width: `${Math.max((1 - yes) * 100, 1)}%` }} />
        </span>
        <span className="p">{pct(1 - yes)}</span>
      </div>
    </div>
  )
}

export default function AnswerList({ result, levels }: { result: PredictResult; levels?: Record<string, string[]> }) {
  return (
    <div className="answers">
      {Object.entries(result.answers).map(([name, a]) => {
        const headline = a.type === 'choice' ? a.choice : a.type === 'score' ? `${Number(a.score).toFixed(2)}` : (a.noul ?? 0) >= 0.5 ? 'yes' : 'no'
        const conf = a.confidence ?? (a.type === 'noul' ? Math.max(a.noul ?? 0, 1 - (a.noul ?? 0)) : undefined)
        return (
          <div key={name} className="answer" style={{ flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <span className="q">
                  {name} · <span className="kind">{a.type === 'noul' ? 'noul (yes/no)' : a.type}</span>
                </span>
                <div className="v">{String(headline)}</div>
              </div>
              {conf !== undefined && (
                <div className="small" title="Calibrated confidence in this answer">
                  confidence <b>{pct(conf)}</b>
                </div>
              )}
            </div>
            {a.type === 'choice' && <Choice a={a} />}
            {a.type === 'score' && <Score a={a} levels={levels?.[name]} />}
            {a.type === 'noul' && <Noul a={a} />}
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
