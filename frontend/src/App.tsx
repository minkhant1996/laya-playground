import { useEffect, useState } from 'react'
import { api } from './api'
import Playground from './components/Playground'
import DatasetEval from './components/DatasetEval'
import Settings from './components/Settings'

type Tab = 'playground' | 'datasets' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('playground')
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)

  const loadHealth = () => api.health().then(setHealth).catch(() => setHealth(null))
  useEffect(() => {
    loadHealth()
  }, [])

  return (
    <div className="app">
      <header>
        <h1>Laya Playground</h1>
        <span className="status">
          {health
            ? `backend ok · OpenRouter ${health.openrouter_configured ? health.openrouter_model : 'not configured'}`
            : 'backend offline'}
        </span>
      </header>
      <nav className="tabs">
        <button className={tab === 'playground' ? 'active' : ''} onClick={() => setTab('playground')}>
          Playground
        </button>
        <button className={tab === 'datasets' ? 'active' : ''} onClick={() => setTab('datasets')}>
          Dataset eval
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Settings
        </button>
      </nav>
      {tab === 'playground' && <Playground aiEnabled={!!health?.openrouter_configured} />}
      {tab === 'datasets' && <DatasetEval aiEnabled={!!health?.openrouter_configured} />}
      {tab === 'settings' && <Settings onChange={loadHealth} />}
    </div>
  )
}
