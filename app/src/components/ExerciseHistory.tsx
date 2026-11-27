import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import LineChart from './LineChart'
import { fmtDay, fmtWhen, timeOf } from '../lib/dates'
import { fmtLb } from '../lib/targets'
import type { Lift } from '../lib/types'
import { useScrollLock } from '../lib/useScrollLock'
import { exerciseHistory, type ExerciseSession } from '../lib/workout'

const SHORT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: '2-digit' }
const shortDate = (d: string) => fmtWhen(d, SHORT)

/** Bottom sheet: top set over time (chart) and every past session (the table view). */
export default function ExerciseHistory({
  exerciseId,
  title,
  lift,
  onClose,
}: {
  exerciseId?: string
  title: string
  lift?: Lift
  onClose: () => void
}) {
  useScrollLock()
  const sessions = useLiveQuery(() => (exerciseId ? exerciseHistory(exerciseId) : Promise.resolve([])), [exerciseId]) ?? []
  const maxes = useLiveQuery(
    async () => (lift ? (await db.one_rep_maxes.where('lift').equals(lift).toArray()).filter((m) => !m.deleted_at) : []),
    [lift],
  ) ?? []

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          <h3>{title}</h3>
          <button onClick={onClose}>Close</button>
        </div>

        {lift && maxes.length > 0 && (
          <section>
            <h4>1RM history</h4>
            <ul className="history">
              {maxes
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((m) => (
                  <li key={m.id}>
                    {fmtDay(m.date, SHORT)} — {fmtLb(m.weight_lb)} lb{m.source === 'test' ? ' (test)' : ''}
                  </li>
                ))}
            </ul>
          </section>
        )}

        {exerciseId && (
          <section>
            <h4>Top set</h4>
            {sessions.length === 0 ? (
              <p className="muted">Nothing logged yet.</p>
            ) : (
              <TopSetChart sessions={sessions} />
            )}
          </section>
        )}

        {sessions.length > 0 && (
          <section>
            <h4>Sessions</h4>
            <ul className="session-list">
              {sessions.map((s) => (
                <li key={s.sessionId}>
                  <div className="row-between">
                    <b>{shortDate(s.date)}</b>
                    <span className="muted">{s.workoutId}</span>
                  </div>
                  <div className="muted">
                    {s.sets.map((x) => `${x.weight_lb === null ? 'BW' : fmtLb(x.weight_lb)}×${x.actual_reps ?? '–'}${x.side ? x.side[0].toUpperCase() : ''}`).join(', ')}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

/** One series: heaviest completed set per session, oldest to newest. Tap a point for its value. */
function TopSetChart({ sessions }: { sessions: ExerciseSession[] }) {
  const points = sessions
    .filter((s) => s.top && s.top.weight_lb !== null)
    .map((s) => ({
      t: timeOf(s.date),
      v: s.top!.weight_lb!,
      readout: `${fmtLb(s.top!.weight_lb)} lb × ${s.top!.actual_reps ?? '–'} · ${shortDate(s.date)}`,
      axisLabel: shortDate(s.date),
    }))
  if (points.length === 0) return <p className="muted">Bodyweight only — no weights to chart.</p>
  return <LineChart points={points} unit="lb" minSpan={10} label="Top set over time" />
}
