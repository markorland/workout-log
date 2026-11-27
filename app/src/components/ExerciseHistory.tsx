import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../lib/db'
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
  const pts = sessions
    .filter((s) => s.top && s.top.weight_lb !== null)
    .map((s) => ({ t: timeOf(s.date), w: s.top!.weight_lb!, reps: s.top!.actual_reps, date: s.date }))
    .filter((p) => !Number.isNaN(p.t))
    .sort((a, b) => a.t - b.t)
  const [sel, setSel] = useState<number | null>(pts.length ? pts.length - 1 : null)

  if (pts.length === 0) return <p className="muted">Bodyweight only — no weights to chart.</p>
  if (pts.length === 1) {
    // One data point is a number, not a chart.
    return (
      <div className="stat">
        <div className="stat-value">{fmtLb(pts[0].w)} lb</div>
        <div className="muted">
          × {pts[0].reps} on {shortDate(pts[0].date)}
        </div>
      </div>
    )
  }

  const W = 340
  const H = 150
  const pad = { l: 40, r: 12, t: 12, b: 22 }
  const minW = Math.min(...pts.map((p) => p.w))
  const maxW = Math.max(...pts.map((p) => p.w))
  const span = Math.max(10, maxW - minW)
  const lo = Math.floor((minW - span * 0.15) / 5) * 5
  const hi = Math.ceil((maxW + span * 0.15) / 5) * 5
  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r)
  const y = (w: number) => pad.t + (1 - (w - lo) / (hi - lo)) * (H - pad.t - pad.b)
  const ticks = [lo, Math.round((lo + hi) / 2 / 5) * 5, hi]
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ')
  const s = sel !== null ? pts[sel] : null

  return (
    <div className="chart">
      <div className="chart-readout">
        {s ? (
          <>
            <b>{fmtLb(s.w)} lb</b> × {s.reps} · {shortDate(s.date)}
          </>
        ) : (
          <span className="muted">Tap a point</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Top set over time, ${pts.length} sessions`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="axis">
              {v}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} className="axis">
          {shortDate(pts[0].date)}
        </text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="axis">
          {shortDate(pts[pts.length - 1].date)}
        </text>
        <path d={path} className="line" />
        {pts.map((p, i) => (
          <g key={i} onClick={() => setSel(i)}>
            {/* Hit target bigger than the mark. */}
            <circle cx={x(p.t)} cy={y(p.w)} r={14} className="hit" />
            <circle cx={x(p.t)} cy={y(p.w)} r={i === sel ? 5.5 : 4} className={i === sel ? 'dot selected' : 'dot'} />
          </g>
        ))}
      </svg>
    </div>
  )
}
