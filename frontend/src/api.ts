import type { ChatMsg, ChatSession, ChatSessionSummary, ChatTurn, DatasetInfo, DatasetSource, Engine, EvalEvent, EvalResult, InspectResult, KaggleInspect, ORModel, PredictResult, Questions, State, UploadResult, UsageSummary } from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!r.ok) {
    let msg = r.statusText
    try {
      msg = (await r.json()).detail ?? msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return r.json()
}

export const api = {
  health: () => req<{ ok: boolean; openrouter_configured: boolean; openrouter_model: string; decision_engine: Engine }>('/health'),
  predict: (state: State, questions: Questions, engine?: Engine | null) =>
    req<PredictResult>('/predict', { method: 'POST', body: JSON.stringify({ state, questions, engine: engine ?? undefined }) }),
  orModels: () => req<ORModel[]>('/openrouter/models'),
  chat: (message: string, session_id: string | null, engine?: Engine | null) =>
    req<ChatTurn & { session_id: string; title: string; message: ChatMsg }>('/chat', { method: 'POST', body: JSON.stringify({ message, session_id, engine: engine ?? undefined }) }),
  sessions: () => req<ChatSessionSummary[]>('/chat/sessions'),
  session: (id: string) => req<ChatSession>(`/chat/sessions/${id}`),
  deleteSession: (id: string) => req<{ ok: boolean }>(`/chat/sessions/${id}`, { method: 'DELETE' }),
  deleteAllSessions: () => req<{ ok: boolean; deleted: number }>('/chat/sessions', { method: 'DELETE' }),
  usage: (days?: number) => req<UsageSummary>(`/usage?limit=300${days ? `&days=${days}` : ''}`),
  clearUsage: () => req<{ ok: boolean }>('/usage', { method: 'DELETE' }),
  skill: () => req<{ sources: string[]; guide: string }>('/skill'),
  /** Streams NDJSON progress events; resolves when the stream ends. */
  evaluateStream: async (body: Record<string, unknown>, onEvent: (e: EvalEvent) => void, signal?: AbortSignal) => {
    const r = await fetch('/api/datasets/evaluate/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText)
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) onEvent(JSON.parse(line))
      }
    }
  },
  prepare: (description: string, sample_text?: string) =>
    req<{ state: State | null; questions: Questions; model: string }>('/ai/prepare', {
      method: 'POST',
      body: JSON.stringify({ description, sample_text }),
    }),
  datasets: () => req<DatasetInfo[]>('/datasets'),
  evaluate: (body: {
    source: DatasetSource
    split: string
    limit: number
    offset: number
    use_ai_criteria: boolean
    shortlist_k?: number | null
  }) => req<EvalResult>('/datasets/evaluate', { method: 'POST', body: JSON.stringify(body) }),
  inspectKaggle: (ref: string, file?: string, header = true) => req<KaggleInspect>('/datasets/kaggle/inspect', { method: 'POST', body: JSON.stringify({ ref, file, header }) }),
  inspect: (ref: string) => req<InspectResult>('/datasets/inspect', { method: 'POST', body: JSON.stringify({ ref }) }),
  upload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch('/api/datasets/upload', { method: 'POST', body: fd })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText)
    return (await r.json()) as UploadResult
  },
}

export interface SettingsInfo {
  openrouter_key_set: boolean
  openrouter_key_masked: string | null
  openrouter_key_source: 'ui' | 'env' | null
  openrouter_model: string
  decision_engine: Engine
  typesafe_key_set: boolean
  typesafe_key_masked: string | null
  kaggle_username: string | null
}

export const settingsApi = {
  get: () => req<SettingsInfo>('/settings'),
  setKey: (api_key: string, model?: string) =>
    req<{ ok: boolean; masked: string; label?: string; model: string }>('/settings/openrouter', {
      method: 'PUT',
      body: JSON.stringify({ api_key, model: model || undefined }),
    }),
  clearKey: () => req<{ ok: boolean }>('/settings/openrouter', { method: 'DELETE' }),
  setPrefs: (body: { openrouter_model?: string; decision_engine?: Engine }) =>
    req<{ ok: boolean; openrouter_model: string; decision_engine: Engine }>('/settings/prefs', { method: 'PUT', body: JSON.stringify(body) }),
  setTypesafeKey: (api_key: string) => req<{ ok: boolean; masked: string }>('/settings/typesafe', { method: 'PUT', body: JSON.stringify({ api_key }) }),
  clearTypesafeKey: () => req<{ ok: boolean }>('/settings/typesafe', { method: 'DELETE' }),
  setKaggle: (username: string, key: string) => req<{ ok: boolean; username: string }>('/settings/kaggle', { method: 'PUT', body: JSON.stringify({ username, key }) }),
  clearKaggle: () => req<{ ok: boolean }>('/settings/kaggle', { method: 'DELETE' }),
}
