import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { ORModel } from '../types'

let cache: ORModel[] | null = null

/** Searchable picker over every model OpenRouter serves (id, name, price per 1M tokens). */
export default function ModelPicker({ value, onChange, placeholder }: { value: string; onChange: (id: string) => void; placeholder?: string }) {
  const [models, setModels] = useState<ORModel[]>(cache ?? [])
  const [q, setQ] = useState(value)
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (cache) return
    api
      .orModels()
      .then((m) => {
        cache = m
        setModels(m)
      })
      .catch((e) => setErr((e as Error).message))
  }, [])
  useEffect(() => setQ(value), [value])
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    const terms = t.split(/\s+/).filter(Boolean)
    const list = terms.length ? models.filter((m) => terms.every((w) => m.id.toLowerCase().includes(w) || m.name.toLowerCase().includes(w))) : models
    return list.slice(0, 60)
  }, [q, models])

  const pick = (id: string) => {
    onChange(id)
    setQ(id)
    setOpen(false)
  }
  const price = (m: ORModel) => (m.prompt_price || m.completion_price ? `$${m.prompt_price.toFixed(2)} / $${m.completion_price.toFixed(2)} per 1M` : 'free')

  return (
    <div className="pick" ref={box}>
      <input
        value={q}
        placeholder={placeholder ?? 'search models, e.g. claude sonnet, gpt-4o, gemini flash'}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setHl(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, hits.length - 1))
          else if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0))
          else if (e.key === 'Enter' && hits[hl]) pick(hits[hl].id)
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && (
        <div className="list">
          {err && <div className="error" style={{ padding: 8 }}>{err}</div>}
          {!err && hits.length === 0 && <div className="small" style={{ padding: 8 }}>{models.length ? 'no match' : 'loading models…'}</div>}
          {hits.map((m, i) => (
            <button key={m.id} type="button" className={i === hl ? 'hl' : ''} onMouseEnter={() => setHl(i)} onClick={() => pick(m.id)}>
              <span>
                <b>{m.id}</b> <small>{m.name !== m.id ? m.name : ''}</small>
              </span>
              <small>
                {m.context ? `${Math.round(m.context / 1000)}k · ` : ''}
                {price(m)}
              </small>
            </button>
          ))}
        </div>
      )}
      {models.length > 0 && <div className="small" style={{ marginTop: 4 }}>{models.length} models on OpenRouter · prices are input / output per 1M tokens</div>}
    </div>
  )
}
