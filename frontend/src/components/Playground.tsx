import { marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { ChatMsg, ChatSessionSummary, Engine, PredictResult, Question, Questions, QuestionType } from '../types'
import AnswerList from './AnswerList'
import EnginePicker from './EnginePicker'
import LangPicker from './LangPicker'

const DEFAULT_UI = {
  intro: 'Hi! Tell me what you want to decide and paste the text, in any language. I will turn it into typed questions, run the decision model, and explain the result.',
  placeholder: 'Describe what to decide and paste the text…  (Enter to send, Shift+Enter for newline)',
  starters: [
    'Is this support email urgent, and which team should handle it? "Hi, we were billed twice for March. Refund it today or we cancel."',
    'Rate how positive this review is, 0 to 4: "Great battery, awful screen."',
    'Does this message contain a threat to leave? "If this happens again I am switching providers."',
    'Classify this message as complaint / praise / question: "Your app is great, thank you!"',
  ],
}

const DEFAULT_QUESTIONS: Questions = {
  department: { type: 'choice', instructions: 'Which department should handle this request?', criteria: { billing: 'invoices, payments, refunds', technical: 'bugs, outages, system errors', sales: 'pricing, new contracts', other: 'everything else' } },
  urgency: { type: 'score', instructions: 'How urgent is this request?', criteria: ['not urgent', 'soon', 'critical deadline or blocking issue'] },
  churn_risk: { type: 'noul', instructions: 'Does the user threaten to cancel or leave?' },
}

function levelsOf(q?: Questions | null): Record<string, string[]> | undefined {
  if (!q) return undefined
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(q)) if (v.type === 'score' && Array.isArray(v.criteria)) out[k] = v.criteria
  return out
}
function safeParse(t: string): Questions | null {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

const TEMPLATES: Record<QuestionType, { help: string; make: () => Question }> = {
  choice: { help: 'Pick one option from a set you define. Returns the chosen option, the full probability distribution and a confidence.', make: () => ({ type: 'choice', instructions: 'Which category fits best?', criteria: { option_a: 'describe when option_a applies', option_b: 'describe when option_b applies', other: 'anything else' } }) },
  score: { help: 'Rate the state along an ordered rubric (2–10 levels, low → high). Returns the expected level as a number plus per-level probabilities.', make: () => ({ type: 'score', instructions: 'How severe is this?', criteria: ['not at all', 'somewhat', 'very'] }) },
  noul: { help: 'A yes/no question. Returns the probability (0–1) that the answer is yes.', make: () => ({ type: 'noul', instructions: 'Is this a question about the model?' }) },
}

function md(text: string) {
  return { __html: marked.parse(text, { async: false }) as string }
}

export default function Playground({ aiEnabled, defaultEngine, typesafeReady }: { aiEnabled: boolean; defaultEngine: Engine; typesafeReady: boolean }) {
  const [mode, setMode] = useState<'chat' | 'manual'>('chat')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [engine, setEngine] = useState<Engine>(defaultEngine)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<{ stage: string; message: string } | null>(null)
  const [error, setError] = useState('')
  const [stateText, setStateText] = useState('')
  const [questionsText, setQuestionsText] = useState(JSON.stringify(DEFAULT_QUESTIONS, null, 2))
  const [advResult, setAdvResult] = useState<PredictResult | null>(null)
  const [manualStatus, setManualStatus] = useState('')
  const [lang, setLang] = useState<string>(() => {
    try {
      return localStorage.getItem('chat-lang') ?? 'Auto'
    } catch {
      return 'Auto'
    }
  })
  const [manualMs, setManualMs] = useState<number | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const [ui, setUi] = useState(DEFAULT_UI)
  const [uiLoading, setUiLoading] = useState(false)
  useEffect(() => {
    let alive = true
    setUi(DEFAULT_UI)
    setUiLoading(lang !== 'Auto' && lang !== 'English')
    api
      .learnI18n(lang, 'chat')
      .then((r) => alive && setUi({ intro: r.intro, placeholder: r.placeholder, starters: r.starters }))
      .catch(() => alive && setUi(DEFAULT_UI))
      .finally(() => alive && setUiLoading(false))
    return () => {
      alive = false
    }
  }, [lang])

  useEffect(() => {
    setEngine(defaultEngine)
  }, [defaultEngine])
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, busy])
  const loadSessions = () => api.sessions().then(setSessions).catch(() => setSessions([]))
  useEffect(() => {
    loadSessions()
  }, [])

  async function openSession(id: string) {
    try {
      const s = await api.session(id)
      setSessionId(s.id)
      setMsgs(s.messages)
      if (s.engine) setEngine(s.engine)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  function newChat() {
    setSessionId(null)
    setMsgs([])
    setError('')
  }
  async function removeSession(id: string) {
    await api.deleteSession(id)
    if (id === sessionId) newChat()
    loadSessions()
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    setError('')
    const next: ChatMsg[] = [...msgs, { role: 'user', content }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      setStage({ stage: 'thinking', message: 'sending…' })
      const t = await api.chatStream(content, sessionId, engine, (stg, message) => setStage({ stage: stg, message }), lang === 'Auto' ? undefined : lang)
      setSessionId(t.session_id)
      setMsgs([...next, t.message])
      loadSessions()
      if (t.spec) {
        setStateText(typeof t.spec.state === 'string' ? t.spec.state : JSON.stringify(t.spec.state, null, 2))
        setQuestionsText(JSON.stringify(t.spec.questions, null, 2))
        setAdvResult(t.result)
      }
    } catch (e) {
      setError((e as Error).message)
      setMsgs(next)
    } finally {
      setBusy(false)
      setStage(null)
    }
  }

  async function runManual() {
    setError('')
    setBusy(true)
    setManualMs(null)
    const label = engine.kind === 'laya' ? 'Laya (local)' : `Jev (${engine.model ?? 'jev-1.13'} via OpenRouter)`
    setManualStatus(`deciding with ${label}…${engine.kind === 'laya' && !advResult ? ' (first call loads the model, ~30 s)' : ''}`)
    const t0 = performance.now()
    try {
      const st = stateText.trim().startsWith('{') ? JSON.parse(stateText) : stateText
      const q = JSON.parse(questionsText) as Questions
      setAdvResult(await api.predict(st, q, engine))
      setManualMs(Math.round(performance.now() - t0))
      setManualStatus('')
    } catch (e) {
      setError((e as Error).message)
      setManualStatus('')
    } finally {
      setBusy(false)
    }
  }

  function addQuestion(t: QuestionType) {
    let q: Questions = {}
    try {
      q = JSON.parse(questionsText) || {}
    } catch {
      q = {}
    }
    let name = t === 'noul' ? 'is_yes' : t
    let i = 2
    while (q[name]) name = `${t}_${i++}`
    setQuestionsText(JSON.stringify({ ...q, [name]: TEMPLATES[t].make() }, null, 2))
  }

  return (
    <div>
      <section className="panel">
        <h2>Decision model</h2>
        <EnginePicker value={engine} onChange={setEngine} compact openrouterReady={aiEnabled} typesafeReady={typesafeReady} />
      </section>

      <div className="tabs" style={{ marginTop: 16 }}>
        <button className={mode === 'chat' ? 'active' : ''} onClick={() => setMode('chat')}>
          Chat
        </button>
        <button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>
          Manual JSON
        </button>
      </div>

      {mode === 'chat' && (
        <div className="chatwrap">
          <section className="panel">
            <h2>Sessions</h2>
            <button className="ghost" style={{ width: '100%', marginBottom: 8 }} onClick={newChat} disabled={busy}>
              + New chat
            </button>
            <div className="sessions">
              {sessions.length === 0 && <div className="small">No saved chats yet.</div>}
              {sessions.map((s) => (
                <div key={s.id} className={`session ${s.id === sessionId ? 'on' : ''}`} onClick={() => openSession(s.id)} title={`${s.title} · ${new Date(s.updated * 1000).toLocaleString()}`}>
                  <span>{s.title}</span>
                  <small>{Math.floor(s.count / 2)}</small>
                  <button
                    title="Delete this chat"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSession(s.id)
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {sessions.length > 1 && (
              <button
                className="chip"
                style={{ marginTop: 8 }}
                onClick={() => {
                  if (confirm('Delete all chats?')) api.deleteAllSessions().then(() => (newChat(), loadSessions()))
                }}
              >
                Delete all
              </button>
            )}
          </section>

          <section className="panel">
            <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>Chat{sessionId ? '' : ' · new'}</span>
              <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                reply in
                <LangPicker
                  value={lang}
                  onChange={(v) => {
                    setLang(v)
                    try {
                      localStorage.setItem('chat-lang', v)
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </span>
            </h2>
            {!aiEnabled && <div className="error">Add an OpenRouter key in Settings and pick a text model to chat. The Manual JSON tab works without it.</div>}
            <div className="chat">
              {msgs.length === 0 && (
                <div className="msg assistant">
                  <p style={{ opacity: uiLoading ? 0.6 : 1 }}>{ui.intro}</p>
                  {uiLoading && <div className="small"><span className="step on">translating to {lang}…</span> first time only, then cached</div>}
                  <div className="suggest" style={{ opacity: uiLoading ? 0.6 : 1 }}>
                    {ui.starters.map((s) => (
                      <button key={s} className="chip" onClick={() => send(s)} disabled={!aiEnabled}>
                        {s.length > 70 ? s.slice(0, 68) + '…' : s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div dangerouslySetInnerHTML={md(m.content)} />
                  {m.result && <AnswerList result={m.result} levels={levelsOf(m.spec?.questions)} />}
                  {m.spec && (
                    <details>
                      <summary>Questions JSON used</summary>
                      <pre>{JSON.stringify(m.spec, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ))}
              {busy && (
                <div className="msg assistant">
                  <div className="stage">
                    {['preparing', 'deciding', 'explaining'].map((st) => (
                      <span key={st} className={`step ${stage?.stage === st ? 'on' : ''} ${['preparing', 'deciding', 'explaining'].indexOf(st) < ['preparing', 'deciding', 'explaining'].indexOf(stage?.stage ?? '') ? 'done' : ''}`}>
                        {st}
                      </span>
                    ))}
                  </div>
                  <div className="small">{stage?.message ?? 'thinking…'}</div>
                </div>
              )}
              <div ref={bottom} />
            </div>
            <div className="composer">
              <textarea
                placeholder={ui.placeholder}
                value={input}
                disabled={!aiEnabled || busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(input)
                  }
                }}
              />
              <button className="primary" disabled={!aiEnabled || busy || !input.trim()} onClick={() => send(input)}>
                Send
              </button>
            </div>
            {error && <div className="error">{error}</div>}
          </section>
        </div>
      )}

      {mode === 'manual' && (
        <section className="panel">
          <h2>Manual · state + questions JSON</h2>
          <div className="grid">
            <div>
              <div className="small">State (text or JSON)</div>
              <textarea className="code" style={{ minHeight: 120 }} value={stateText} onChange={(e) => setStateText(e.target.value)} placeholder="Paste text or a JSON object" />
              <div className="small" style={{ marginTop: 8 }}>Questions JSON · add a question of each type:</div>
              <div className="chips" style={{ margin: '4px 0 6px' }}>
                {(Object.keys(TEMPLATES) as QuestionType[]).map((t) => (
                  <button key={t} className="chip" title={TEMPLATES[t].help} onClick={() => addQuestion(t)}>
                    + {t === 'noul' ? 'noul (yes/no)' : t}
                  </button>
                ))}
                <button className="chip" onClick={() => setQuestionsText(JSON.stringify(DEFAULT_QUESTIONS, null, 2))}>
                  example set
                </button>
                <button className="chip" onClick={() => setQuestionsText('{}')}>
                  clear
                </button>
              </div>
              <textarea className="code" value={questionsText} onChange={(e) => setQuestionsText(e.target.value)} />
              <details>
                <summary>The three query types</summary>
                <ul className="small">
                  {(Object.keys(TEMPLATES) as QuestionType[]).map((t) => (
                    <li key={t}>
                      <b>{t}</b> — {TEMPLATES[t].help}
                    </li>
                  ))}
                </ul>
              </details>
              <div className="row">
                <button className="primary" disabled={busy || !stateText.trim()} onClick={runManual}>
                  {busy && manualStatus ? 'Running…' : 'Run'}
                </button>
                {manualStatus && (
                  <span className="small">
                    <span className="step on" style={{ marginRight: 6 }}>deciding</span>
                    {manualStatus}
                  </span>
                )}
                {!manualStatus && manualMs !== null && <span className="small">answered in {manualMs} ms</span>}
              </div>
            </div>
            <div>
              {advResult ? <AnswerList result={advResult} levels={levelsOf(safeParse(questionsText))} /> : <div className="small">Answers appear here.</div>}
              {advResult && (
                <details>
                  <summary>Raw JSON</summary>
                  <pre>{JSON.stringify(advResult, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
          {error && <div className="error">{error}</div>}
        </section>
      )}
    </div>
  )
}
