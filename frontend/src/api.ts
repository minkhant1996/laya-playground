import type { DatasetInfo, DatasetSource, EvalResult, InspectResult, PredictResult, Questions, State, UploadResult } from './types'

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
  health: () => req<{ ok: boolean; openrouter_configured: boolean; openrouter_model: string }>('/health'),
  predict: (state: State, questions: Questions) =>
    req<PredictResult>('/predict', { method: 'POST', body: JSON.stringify({ state, questions }) }),
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
}

export const settingsApi = {
  get: () => req<SettingsInfo>('/settings'),
  setKey: (api_key: string, model?: string) =>
    req<{ ok: boolean; masked: string; label?: string; model: string }>('/settings/openrouter', {
      method: 'PUT',
      body: JSON.stringify({ api_key, model: model || undefined }),
    }),
  clearKey: () => req<{ ok: boolean }>('/settings/openrouter', { method: 'DELETE' }),
}
