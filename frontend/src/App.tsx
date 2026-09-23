import { useEffect, useState } from 'react'
import { api, settingsApi } from './api'
import type { Engine } from './types'
import { engineLabel } from './components/EnginePicker'
import Playground from './components/Playground'
import DatasetEval from './components/DatasetEval'
import Settings from './components/Settings'
import Usage from './components/Usage'
import Learn from './components/Learn'
import SystemStats from './components/SystemStats'

type Tab = 'playground' | 'datasets' | 'learn' | 'settings' | 'usage'

export default function App() {
  const [tab, setTab] = useState<Tab>('playground')
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)

  const [typesafeReady, setTypesafeReady] = useState(false)
  const loadHealth = () =>
    Promise.all([api.health().then(setHealth), settingsApi.get().then((s) => setTypesafeReady(s.typesafe_key_set))]).catch(() => setHealth(null))
  const engine: Engine = health?.decision_engine ?? { kind: 'laya' }
  useEffect(() => {
    loadHealth()
  }, [])

  return (
    <div className="app">
      <header>
        <h1>System One Playground</h1>
        <span className="status">
          {health
            ? `backend ok · text model: ${health.openrouter_configured ? health.openrouter_model : 'OpenRouter not configured'} · decisions: ${engineLabel(engine)}`
            : 'backend offline'}
          {health && <SystemStats compact />}
        </span>
      </header>
      <nav className="tabs">
        <button className={tab === 'playground' ? 'active' : ''} onClick={() => setTab('playground')}>
          Playground
        </button>
        <button className={tab === 'datasets' ? 'active' : ''} onClick={() => setTab('datasets')}>
          Dataset eval
        </button>
        <button className={tab === 'learn' ? 'active' : ''} onClick={() => setTab('learn')}>
          Learn
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Settings
        </button>
        <button className={tab === 'usage' ? 'active' : ''} onClick={() => setTab('usage')}>
          Usage
        </button>
      </nav>
      {tab === 'playground' && <Playground aiEnabled={!!health?.openrouter_configured} defaultEngine={engine} typesafeReady={typesafeReady} />}
      {tab === 'datasets' && <DatasetEval aiEnabled={!!health?.openrouter_configured} defaultEngine={engine} typesafeReady={typesafeReady} />}
      {tab === 'learn' && <Learn aiEnabled={!!health?.openrouter_configured} textModel={health?.openrouter_model ?? ''} />}
      {tab === 'settings' && <Settings onChange={loadHealth} />}
      {tab === 'usage' && <Usage />}
    </div>
  )
}
