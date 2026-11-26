import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, today } from '../lib/db'
import { fmtLb, oneRepMaxOn } from '../lib/targets'
import { LIFTS, type Lift } from '../lib/types'
import { saveOneRepMax } from '../lib/workout'

const day = (d: string) => new Date(d.slice(0, 10) + 'T12:00').toLocaleDateString()

export default function Lifts() {
  const maxes = useLiveQuery(() => db.one_rep_maxes.toArray()) ?? []
  const [editing, setEditing] = useState<Lift | null>(null)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState<Lift | null>(null)

  async function save(lift: Lift) {
    const n = Number(value.replace(',', '.'))
    if (!value.trim() || Number.isNaN(n) || n <= 0) return
    await saveOneRepMax(lift, n)
    setEditing(null)
  }

  return (
    <div className="lifts">
      <h1>Lifts</h1>
      <p className="muted">
        Percent targets use these maxes. Each change is saved as a new dated entry, so your history is kept. Clean and
        jerk lifts all use the Clean &amp; Jerk max.
      </p>
      {LIFTS.map(({ id, name }) => {
        const cur = oneRepMaxOn(maxes, id, today())
        const history = maxes
          .filter((m) => m.lift === id && !m.deleted_at)
          .sort((a, b) => (a.date < b.date ? 1 : -1))
        return (
          <article key={id} className="card lift">
            <div className="lift-row">
              <div>
                <h2>{name}</h2>
                <div className="muted">
                  {cur ? `${day(cur.date)} · ${cur.source === 'test' ? 'from a test' : 'entered'}` : 'No max yet'}
                </div>
              </div>
              <div className="lift-value">{cur ? `${fmtLb(cur.weight_lb)} lb` : '—'}</div>
            </div>
            {editing === id ? (
              <form
                className="lift-edit"
                onSubmit={(e) => {
                  e.preventDefault()
                  void save(id)
                }}
              >
                <input inputMode="decimal" autoFocus placeholder="New 1RM (lb)" value={value} onChange={(e) => setValue(e.target.value)} />
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="primary">Save</button>
              </form>
            ) : (
              <div className="lift-actions">
                <button
                  onClick={() => {
                    setEditing(id)
                    setValue(cur ? fmtLb(cur.weight_lb) : '')
                  }}
                >
                  Update
                </button>
                {history.length > 1 && (
                  <button className="link" onClick={() => setOpen(open === id ? null : id)}>
                    {open === id ? 'Hide history' : `History (${history.length})`}
                  </button>
                )}
              </div>
            )}
            {open === id && (
              <ul className="history">
                {history.map((m) => (
                  <li key={m.id}>
                    {day(m.date)} — {fmtLb(m.weight_lb)} lb{m.source === 'test' ? ' (test)' : ''}
                  </li>
                ))}
              </ul>
            )}
          </article>
        )
      })}
    </div>
  )
}
