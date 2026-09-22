import { marked } from 'marked'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { ChatSessionSummary, LearnDoc, LearnMsg } from '../types'
import LangPicker from './LangPicker'
import { useConfirm } from './ConfirmDialog'

const DEFAULT_UI = {
  intro: 'Ask anything about System One models, Jev, Laya, the three question types, confidence, or the design patterns, in any language. I answer in your language, only from the documents in the hub, and cite them.',
  placeholder: 'Ask about System One, Jev or Laya…',
  starters: [
    'What is a System One model and how is it different from an LLM?',
    'When should I use choice vs score vs noul?',
    'How do I structure the state for a support ticket?',
    'Explain confidence-gated routing with an example.',
    'What is speculative fan-out?',
    'How does Laya differ from Jev?',
  ],
}

function md(text: string) {
  return { __html: marked.parse(text, { async: false }) as string }
}

export default function Learn({ aiEnabled, textModel }: { aiEnabled: boolean; textModel: string }) {
  const [docs, setDocs] = useState<LearnDoc[]>([])
  const [msgs, setMsgs] = useState<LearnMsg[]>([])
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<{ stage: string; message: string } | null>(null)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState<{ file: string; content: string } | null>(null)
  const [lang, setLang] = useState<string>(() => {
    try {
      const v = localStorage.getItem('learn-lang')
      return v && !v.startsWith('Auto (') ? v : 'Auto'
    } catch {
      return 'Auto'
    }
  })
  const bottom = useRef<HTMLDivElement>(null)
  const { confirm, dialog } = useConfirm()
  const [ui, setUi] = useState(DEFAULT_UI)
  const [uiLoading, setUiLoading] = useState(false)

  const loadSessions = () => api.learnSessions().then(setSessions).catch(() => setSessions([]))
  useEffect(() => {
    api.learnDocs().then(setDocs).catch(() => setDocs([]))
    loadSessions()
  }, [])
  async function openSession(id: string) {
    try {
      const s = await api.learnSession(id)
      setSessionId(s.id)
      setMsgs(s.messages)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  function newSession() {
    setSessionId(null)
    setMsgs([])
    setError('')
  }
  async function removeSession(id: string) {
    const s = sessions.find((x) => x.id === id)
    if (!(await confirm({ title: 'Delete this session?', message: <span>“{s?.title ?? id}” will be removed.</span> }))) return
    await api.deleteLearnSession(id)
    if (id === sessionId) newSession()
    loadSessions()
  }
  useEffect(() => {
    let alive = true
    setUi(DEFAULT_UI)
    setUiLoading(lang !== 'Auto' && lang !== 'English')
    api
      .learnI18n(lang)
      .then((r) => {
        if (alive) setUi({ intro: r.intro, placeholder: r.placeholder, starters: r.starters })
      })
      .catch(() => alive && setUi(DEFAULT_UI))
      .finally(() => alive && setUiLoading(false))
    return () => {
      alive = false
    }
  }, [lang])
  useEffect(() => {
    if (!viewing) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setViewing(null)
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [viewing])
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, busy])

  async function ask(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setError('')
    const next: LearnMsg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    setStage({ stage: 'selecting', message: 'starting…' })
    try {
      const r = await api.learnAsk(q, msgs.map((m) => ({ role: m.role, content: m.content })), (stg, message) => setStage({ stage: stg, message }), lang === 'Auto' ? undefined : lang, sessionId)
      setSessionId(r.session_id)
      setMsgs([...next, { role: 'assistant', content: r.answer, sources: r.sources }])
      loadSessions()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setStage(null)
    }
  }

  async function open(file: string) {
    try {
      setViewing(await api.learnDoc(file))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="chatwrap" style={{ gridTemplateColumns: '260px 1fr' }}>
      {dialog}
      <div>
      <section className="panel">
        <h2>Sessions</h2>
        <button className="ghost" style={{ width: '100%', marginBottom: 8 }} onClick={newSession} disabled={busy}>
          + New session
        </button>
        <div className="sessions" style={{ maxHeight: 220 }}>
          {sessions.length === 0 && <div className="small">No saved sessions yet.</div>}
          {sessions.map((s) => (
            <div key={s.id} className={`session ${s.id === sessionId ? 'on' : ''}`} onClick={() => openSession(s.id)} title={`${s.title} · ${new Date(s.updated * 1000).toLocaleString()}`}>
              <span>{s.title}</span>
              <small>{Math.floor(s.count / 2)}</small>
              <button
                title="Delete this session"
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
            onClick={async () => {
              if (await confirm({ title: 'Delete all Learn sessions?', message: `${sessions.length} saved sessions will be removed.` })) api.deleteAllLearnSessions().then(() => (newSession(), loadSessions()))
            }}
          >
            Delete all
          </button>
        )}
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Knowledge hub ({docs.length})</h2>
        <div className="small" style={{ marginBottom: 8 }}>The assistant may read only these files (backend/knowledge-hub). Click to view, or open the source link.</div>
        <div className="sessions" style={{ maxHeight: '40vh' }}>
          {docs.map((d) => (
            <div key={d.file} className={`session ${viewing?.file === d.file ? 'on' : ''}`} onClick={() => open(d.file)} title={d.summary}>
              <span>{d.title}</span>
              <a href={d.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={d.url} style={{ color: 'var(--muted)', textDecoration: 'none' }}>
                ↗
              </a>
            </div>
          ))}
        </div>
      </section>
      </div>

      <div>
        <section className="panel">
          <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>
              Learn about System One · Jev · Laya{sessionId ? '' : ' · new session'}
              {uiLoading && <span className="badge warn" style={{ marginLeft: 10 }}>⏳ translating to {lang}… (first time only)</span>}
            </span>
            <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              answer in
              <LangPicker
                value={lang}
                onChange={(v) => {
                  setLang(v)
                  try {
                    localStorage.setItem('learn-lang', v)
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </span>
          </h2>
          {!aiEnabled && <div className="error">Add an OpenRouter key in Settings to ask questions. You can still read the documents on the left.</div>}
          <div className="chat">
            {msgs.length === 0 && (
              <div className="msg assistant">
                <p style={{ opacity: uiLoading ? 0.6 : 1 }}>{ui.intro}</p>
                <div className="suggest" style={{ opacity: uiLoading ? 0.6 : 1 }}>
                  {ui.starters.map((s) => (
                    <button key={s} className="chip" onClick={() => ask(s)} disabled={!aiEnabled}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div dangerouslySetInnerHTML={md(m.content)} />
                {m.sources && m.sources.length > 0 && (
                  <div className="small" style={{ marginTop: 6 }}>
                    Sources:{' '}
                    {m.sources.map((s) => (
                      <span key={s.n}>
                        [{s.n}]{' '}
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                          {s.title}
                        </a>{' '}
                        <button className="chip" style={{ padding: '0 6px', fontSize: 11 }} onClick={() => open(s.file)}>
                          view
                        </button>{' '}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="msg assistant">
                <div className="stage">
                  {['selecting', 'reading', 'answering'].map((st, idx) => (
                    <span key={st} className={`step ${stage?.stage === st ? 'on' : ''} ${idx < ['selecting', 'reading', 'answering'].indexOf(stage?.stage ?? '') ? 'done' : ''}`}>
                      {st}
                    </span>
                  ))}
                </div>
                <div className="small">{stage?.message}</div>
              </div>
            )}
            <div ref={bottom} />
          </div>
          <div className="composer">
            <textarea
              placeholder={`${ui.placeholder}  (${textModel || 'text model'})`}
              value={input}
              disabled={!aiEnabled || busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask(input)
                }
              }}
            />
            <button className="primary" disabled={!aiEnabled || busy || !input.trim()} onClick={() => ask(input)}>
              Ask
            </button>

          </div>
          {error && <div className="error">{error}</div>}
        </section>

        {viewing && (
          <div className="modal-bg" onClick={() => setViewing(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <header>
                <b>{docs.find((d) => d.file === viewing.file)?.title ?? viewing.file}</b>
                <span className="row" style={{ marginTop: 0 }}>
                  <a href={docs.find((d) => d.file === viewing.file)?.url} target="_blank" rel="noreferrer" className="chip" style={{ textDecoration: 'none' }}>
                    open source ↗
                  </a>
                  <button className="chip" onClick={() => setViewing(null)}>
                    ✕ close
                  </button>
                </span>
              </header>
              <div className="body" dangerouslySetInnerHTML={md(viewing.content)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
