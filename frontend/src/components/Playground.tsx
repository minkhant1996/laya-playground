import { marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { ChatMsg, ChatSessionSummary, Engine, PredictResult, Questions } from '../types'
import AnswerList from './AnswerList'
import EnginePicker from './EnginePicker'

const SUGGESTIONS = [
  'Is this support email urgent, and which team should handle it? "Hi, we were billed twice for March. Refund it today or we cancel."',
  'Rate how positive these reviews are, 0 to 4: "Great battery, awful screen."',
  'Does this message contain a threat to leave? "If this happens again I am switching providers."',
  'Route this Hindi message to billing / technical / sales: "मेरा भुगतान दो बार कट गया है"',
]

const DEFAULT_QUESTIONS: Questions = {
  department: { type: 'choice', instructions: 'Which department should handle this request?', criteria: { billing: 'invoices, payments, refunds', technical: 'bugs, outages, system errors', sales: 'pricing, new contracts', other: 'everything else' } },
  urgency: { type: 'score', instructions: 'How urgent is this request?', criteria: ['not urgent', 'soon', 'critical deadline or blocking issue'] },
  churn_risk: { type: 'noul', instructions: 'Does the user threaten to cancel or leave?' },
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
  const [error, setError] = useState('')
  const [stateText, setStateText] = useState('')
  const [questionsText, setQuestionsText] = useState(JSON.stringify(DEFAULT_QUESTIONS, null, 2))
  const [advResult, setAdvResult] = useState<PredictResult | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

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
      const t = await api.chat(content, sessionId, engine)
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
    }
  }

  async function runManual() {
    setError('')
    setBusy(true)
    try {
      const st = stateText.trim().startsWith('{') ? JSON.parse(stateText) : stateText
      setAdvResult(await api.predict(st, JSON.parse(questionsText), engine))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
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
            <h2>Chat{sessionId ? '' : ' · new'}</h2>
            {!aiEnabled && <div className="error">Add an OpenRouter key in Settings and pick a text model to chat. The Manual JSON tab works without it.</div>}
            <div className="chat">
              {msgs.length === 0 && (
                <div className="msg assistant">
                  <p>Hi! Tell me what you want to decide and paste the text. I will turn it into typed questions, run the decision model, and explain the result.</p>
                  <div className="suggest">
                    {SUGGESTIONS.map((s) => (
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
                  {m.result && <AnswerList result={m.result} />}
                  {m.spec && (
                    <details>
                      <summary>Questions JSON used</summary>
                      <pre>{JSON.stringify(m.spec, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ))}
              {busy && <div className="msg assistant small">thinking…</div>}
              <div ref={bottom} />
            </div>
            <div className="composer">
              <textarea
                placeholder="Describe what to decide and paste the text…  (Enter to send, Shift+Enter for newline)"
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
              <div className="small" style={{ marginTop: 8 }}>Questions JSON</div>
              <textarea className="code" value={questionsText} onChange={(e) => setQuestionsText(e.target.value)} />
              <div className="row">
                <button className="primary" disabled={busy || !stateText.trim()} onClick={runManual}>
                  Run
                </button>
                <button className="ghost" onClick={() => setQuestionsText(JSON.stringify(DEFAULT_QUESTIONS, null, 2))}>
                  Example questions
                </button>
              </div>
            </div>
            <div>
              {advResult ? <AnswerList result={advResult} /> : <div className="small">Answers appear here.</div>}
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
