import { useEffect, useState } from 'react'
import { settingsApi, type SettingsInfo } from '../api'

export default function Settings({ onChange }: { onChange: () => void }) {
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const i = await settingsApi.get()
    setInfo(i)
    setModel(i.openrouter_model)
  }
  useEffect(() => {
    refresh().catch(() => setInfo(null))
  }, [])

  async function save() {
    setError('')
    setMsg('')
    setBusy(true)
    try {
      const r = await settingsApi.setKey(key.trim(), model.trim())
      setKey('') // drop plaintext from memory/DOM as soon as it's stored
      setMsg(`Key ${r.masked} verified${r.label ? ` (${r.label})` : ''} and saved encrypted on the backend.`)
      await refresh()
      onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setError('')
    setMsg('')
    await settingsApi.clearKey()
    setMsg('Saved key removed.')
    await refresh()
    onChange()
  }

  return (
    <section className="panel" style={{ maxWidth: 620 }}>
      <h2>OpenRouter API key</h2>
      <div className="small" style={{ marginBottom: 10 }}>
        {info?.openrouter_key_set
          ? `Active key: ${info.openrouter_key_masked} (from ${info.openrouter_key_source === 'ui' ? 'this UI' : 'backend .env'})`
          : 'No key configured. AI features are disabled until you add one.'}
      </div>
      <form
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault()
          if (key.trim()) save()
        }}
      >
        <input
          type={show ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-or-v1-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <div className="row">
          <label>model</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} style={{ maxWidth: 300 }} placeholder="anthropic/claude-sonnet-4.5" />
        </div>
        <div className="row">
          <button className="primary" type="submit" disabled={busy || key.trim().length < 20}>
            {busy ? 'Verifying…' : 'Verify & save'}
          </button>
          <button className="ghost" type="button" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
          {info?.openrouter_key_source === 'ui' && (
            <button className="ghost" type="button" onClick={clear}>
              Remove saved key
            </button>
          )}
        </div>
      </form>
      {msg && <div className="small" style={{ marginTop: 8, color: 'var(--ok)' }}>{msg}</div>}
      {error && <div className="error">{error}</div>}
      <details>
        <summary>How the key is protected</summary>
        <ul className="small">
          <li>The key is sent once over the local backend and never stored in the browser (no localStorage/cookies).</li>
          <li>It is validated against OpenRouter, then encrypted at rest (Fernet) in <code>backend/data/</code> with 0600 file permissions.</li>
          <li>The backend never returns the key; only the last 4 characters are shown.</li>
          <li>The backend binds to localhost only and allows requests only from the dev frontend origin.</li>
        </ul>
      </details>
    </section>
  )
}
