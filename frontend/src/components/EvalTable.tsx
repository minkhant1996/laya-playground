import type { EvalRow } from '../types'

export default function EvalTable({ rows, compact }: { rows: EvalRow[]; compact?: boolean }) {
  return (
    <table className="evaltable">
      <thead>
        <tr>
          <th>text</th>
          <th>actual</th>
          <th>predicted</th>
          <th style={{ textAlign: 'right' }}>confidence</th>
          <th style={{ textAlign: 'right' }}>time</th>
          <th style={{ textAlign: 'right' }}>result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className={compact ? 'small' : ''}>{compact && r.text.length > 90 ? r.text.slice(0, 88) + '…' : r.text}</td>
            <td>{r.gold}</td>
            <td className={r.correct ? 'ok' : 'bad'}>{r.pred}</td>
            <td style={{ textAlign: 'right' }}>{r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : ''}</td>
            <td style={{ textAlign: 'right' }} className="small">{r.ms != null ? (r.ms >= 1000 ? `${(r.ms / 1000).toFixed(2)} s` : `${r.ms.toFixed(0)} ms`) : ''}</td>
            <td style={{ textAlign: 'right' }}>
              <span className={`badge ${r.correct ? 'ok' : 'bad'}`}>{r.correct ? '✓ correct' : '✗ wrong'}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
