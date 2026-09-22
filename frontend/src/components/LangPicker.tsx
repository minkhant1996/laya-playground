import { useEffect, useMemo, useRef, useState } from 'react'
import { AUTO, LANGUAGES, type Lang } from '../languages'

/** Searchable language picker with flags. `value` is the English name, or 'Auto'. */
export default function LangPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const all = useMemo(() => [AUTO, ...LANGUAGES], [])
  const current = all.find((l) => l.name === value) ?? AUTO

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  useEffect(() => {
    if (open) {
      setQ('')
      setHl(0)
      setTimeout(() => input.current?.focus(), 0)
    }
  }, [open])

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return all
    return all.filter((l) => l.name.toLowerCase().includes(t) || l.native.toLowerCase().includes(t))
  }, [q, all])

  const pick = (l: Lang) => {
    onChange(l.name)
    setOpen(false)
  }

  return (
    <div className="pick langpick" ref={box}>
      <button type="button" className="chip" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => setOpen((o) => !o)}>
        {current.flag} {current.name}
        {current !== AUTO ? <span className="small"> · {current.native}</span> : <span className="small"> · {current.native}</span>} ▾
      </button>
      {open && (
        <div className="list" style={{ minWidth: 300, left: 'auto', right: 0 }}>
          <div style={{ padding: 6 }}>
            <input
              ref={input}
              placeholder="type to search… (e.g. burm, ไทย, 日本)"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setHl(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, hits.length - 1))
                else if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0))
                else if (e.key === 'Enter' && hits[hl]) pick(hits[hl])
                else if (e.key === 'Escape') setOpen(false)
              }}
            />
          </div>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {hits.length === 0 && <div className="small" style={{ padding: 8 }}>no match</div>}
            {hits.map((l, i) => (
              <button key={l.name} type="button" className={i === hl ? 'hl' : ''} onMouseEnter={() => setHl(i)} onClick={() => pick(l)}>
                <span>
                  {l.flag} <b>{l.name}</b>
                </span>
                <small>{l.native}</small>
              </button>
            ))}
          </div>
          <div className="small" style={{ padding: '4px 8px 6px', borderTop: '1px solid var(--border)' }}>{LANGUAGES.length} languages</div>
        </div>
      )}
    </div>
  )
}
