import { useEffect, useState } from 'react'
import { api, settingsApi, type SettingsInfo } from '../api'
import type { Engine } from '../types'
import EnginePicker from './EnginePicker'
import ModelPicker from './ModelPicker'

export default function Settings({ onChange }: { onChange: () => void }) {
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [key, setKey] = useState('')
  const [tsKey, setTsKey] = useState('')
  const [show, setShow] = useState(false)
  const [prepModel, setPrepModel] = useState('')
  const [engine, setEngine] = useState<Engine>({ kind: 'laya' })
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [skill, setSkill] = useState<{ sources: string[]; guide: string } | null>(null)

  async function refresh() {
    const i = await settingsApi.get()
    setInfo(i)
    setPrepModel(i.openrouter_model)
    setEngine(i.decision_engine)
  }
  useEffect(() => {
    refresh().catch(() => setInfo(null))
    api.skill().then(setSkill).catch(() => setSkill(null))
  }, [])

  const wrap = (name: string, fn: () => Promise<string>) => async () => {
    setError('')
    setMsg('')
    setBusy(name)
    try {
      setMsg(await fn())
      await refresh()
      onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const saveKey = wrap('key', async () => {
    const r = await settingsApi.setKey(key.trim())
    setKey('')
    return `OpenRouter key ${r.masked} verified${r.label ? ` (${r.label})` : ''} and saved encrypted.`
  })
  const saveTs = wrap('ts', async () => {
    const r = await settingsApi.setTypesafeKey(tsKey.trim())
    setTsKey('')
    return `TypeSafe key ${r.masked} verified with a Jev call and saved encrypted.`
  })
  const savePrefs = wrap('prefs', async () => {
    if (engine.kind === 'openrouter' && !engine.model) throw new Error('Pick an OpenRouter model for the decision engine.')
    await settingsApi.setPrefs({ openrouter_model: prepModel, decision_engine: engine })
    return 'Model preferences saved.'
  })

  return (
    <div className="grid">
      <div>
        <section className="panel">
          <h2>OpenRouter API key</h2>
          <div className="small" style={{ marginBottom: 10 }}>
            {info?.openrouter_key_set ? `Active key: ${info.openrouter_key_masked} (from ${info.openrouter_key_source === 'ui' ? 'this UI' : 'backend .env'})` : 'No key. Needed for the JSON preparer, AI label criteria, and OpenRouter decision models.'}
          </div>
          <form
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault()
              if (key.trim()) saveKey()
            }}
          >
            <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="sk-or-v1-…" value={key} onChange={(e) => setKey(e.target.value)} />
            <div className="row">
              <button className="primary" type="submit" disabled={!!busy || key.trim().length < 20}>
                {busy === 'key' ? 'Verifying…' : 'Verify & save'}
              </button>
              <button className="ghost" type="button" onClick={() => setShow((s) => !s)}>
                {show ? 'Hide' : 'Show'}
              </button>
              {info?.openrouter_key_source === 'ui' && (
                <button className="ghost" type="button" onClick={wrap('clear', async () => (await settingsApi.clearKey(), 'Saved OpenRouter key removed.'))}>
                  Remove
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <h2>TypeSafe API key (for Jev)</h2>
          <div className="small" style={{ marginBottom: 10 }}>
            {info?.typesafe_key_set ? `Active key: ${info.typesafe_key_masked}` : 'Optional. Lets you run the same questions on TypeSafe’s hosted Jev model. Get one at console.typesafe.ai/keys.'}
          </div>
          <form
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault()
              if (tsKey.trim()) saveTs()
            }}
          >
            <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="TypeSafe API key" value={tsKey} onChange={(e) => setTsKey(e.target.value)} />
            <div className="row">
              <button className="primary" type="submit" disabled={!!busy || tsKey.trim().length < 10}>
                {busy === 'ts' ? 'Verifying…' : 'Verify & save'}
              </button>
              {info?.typesafe_key_set && (
                <button className="ghost" type="button" onClick={wrap('clearts', async () => (await settingsApi.clearTypesafeKey(), 'TypeSafe key removed.'))}>
                  Remove
                </button>
              )}
            </div>
          </form>
          <details>
            <summary>How keys are protected</summary>
            <ul className="small">
              <li>Keys are sent once to the local backend and never stored in the browser; inputs are cleared after saving.</li>
              <li>Each key is verified with the provider, then encrypted at rest (Fernet) in <code>backend/data/</code> with 0600 permissions.</li>
              <li>The backend never returns a key; only the last 4 characters are shown. It binds to localhost and only accepts the dev frontend origin.</li>
            </ul>
          </details>
        </section>
      </div>

      <div>
        <section className="panel">
          <h2>JSON preparer model (OpenRouter)</h2>
          <div className="small" style={{ marginBottom: 8 }}>Text model that turns your description into Laya/Jev questions JSON and writes label criteria for datasets.</div>
          <ModelPicker value={prepModel} onChange={setPrepModel} placeholder="search OpenRouter models, e.g. claude sonnet 5, gpt, gemini flash" />
          {skill && (
            <details>
              <summary>Guided by the TypeSafe / Jev agent skill ({skill.sources.length} doc files)</summary>
              <div className="small">Files in backend/skills: {skill.sources.join(', ')}. The preparer prompt includes this distilled guidance:</div>
              <pre style={{ maxHeight: 260 }}>{skill.guide}</pre>
            </details>
          )}
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Decision model (answers the questions)</h2>
          <div className="small" style={{ marginBottom: 4 }}>Default engine for the Playground and Dataset eval. You can still override it per run.</div>
          <EnginePicker value={engine} onChange={setEngine} openrouterReady={!!info?.openrouter_key_set} typesafeReady={!!info?.typesafe_key_set} />
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={savePrefs}>
              {busy === 'prefs' ? 'Saving…' : 'Save model preferences'}
            </button>
          </div>
        </section>
        {msg && <div className="small" style={{ marginTop: 10, color: 'var(--ok)' }}>{msg}</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}
