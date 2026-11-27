import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, today } from '../lib/db'
import { fmtDay } from '../lib/dates'
import { fmtLb, oneRepMaxOn } from '../lib/targets'
import { LIFTS, type Lift } from '../lib/types'
import ExerciseHistory from '../components/ExerciseHistory'
import { saveOneRepMax, startTest, testDueInfo, testInProgress } from '../lib/workout'

/** The exercise whose sessions chart each lift (Deadlift has none in the program). */
const LIFT_EXERCISE: Partial<Record<Lift, string>> = {
  snatch: 'ex-snatch',
  clean_and_jerk: 'ex-clean-and-jerk',
  back_squat: 'ex-back-squat',
  front_squat: 'ex-front-squat',
}

const day = (d: string) => fmtDay(d)

export default function Lifts({ onOpenToday }: { onOpenToday: () => void }) {
  const maxes = useLiveQuery(() => db.one_rep_maxes.toArray()) ?? []
  const [editing, setEditing] = useState<Lift | null>(null)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState<Lift | null>(null)
  const [hist, setHist] = useState<{ lift: Lift; name: string } | null>(null)
  const test = useLiveQuery(async () => ({ running: await testInProgress(), info: await testDueInfo() }), [maxes.length])

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
      <article className="card">
        <div className="row-between">
          <div>
            <h2>MAX WEEK test</h2>
            <div className="muted">
              {test?.running
                ? 'In progress — continue on Today.'
                : test?.info.dueDate
                  ? `${test.info.due ? 'Due since' : 'Next due'} ${new Date(test.info.dueDate + 'T12:00').toLocaleDateString()}`
                  : 'Every 3 months'}
            </div>
          </div>
          <button
            className="primary"
            onClick={async () => {
              if (test?.running) return onOpenToday()
              if (!window.confirm('Start MAX WEEK now? Your place in the program stays where it is.')) return
              await startTest()
              onOpenToday()
            }}
          >
            {test?.running ? 'Open' : 'Start test'}
          </button>
        </div>
      </article>

      {LIFTS.map(({ id, name }) => {
        const cur = oneRepMaxOn(maxes, id, today())
        const history = maxes
          .filter((m) => m.lift === id && !m.deleted_at)
          .sort((a, b) => (a.date < b.date ? 1 : -1))
        return (
          <article key={id} className="card lift">
            <div className="lift-row">
              <div>
                <h2>
                  <button className="name-link" onClick={() => setHist({ lift: id, name })}>
                    {name}
                  </button>
                </h2>
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
      {hist && (
        <ExerciseHistory exerciseId={LIFT_EXERCISE[hist.lift]} lift={hist.lift} title={hist.name} onClose={() => setHist(null)} />
      )}
    </div>
  )
}
