import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import ExerciseHistory from '../components/ExerciseHistory'
import { db } from '../lib/db'
import { fmtWhen } from '../lib/dates'
import { fmtLb } from '../lib/targets'
import { sessionRound, sessionTime } from '../lib/workout'
import type { SetLog } from '../lib/types'

const when = (d: string) => fmtWhen(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

/** Past sessions, newest first, with what was logged. */
export default function History() {
  const [openEx, setOpenEx] = useState<{ id: string; name: string } | null>(null)

  const sessions = useLiveQuery(async () => {
    const rows = (await db.sessions.toArray())
      .filter((s) => !s.deleted_at && (s.finished_at || s.status))
      .sort((a, b) => (sessionTime(a) < sessionTime(b) ? 1 : -1))
    const out = []
    for (const s of rows) {
      const workout = await db.workouts.get(s.workout)
      const program = workout ? await db.programs.get(workout.program) : undefined
      const logs = (await db.set_logs.where('session').equals(s.id).toArray()).filter((l) => l.completed && !l.deleted_at)
      // Keep the workout's own order (block A, B, C…), then set number.
      const items = await db.workout_items.bulkGet([...new Set(logs.map((l) => l.workout_item))])
      const order = new Map(items.filter(Boolean).map((it) => [it!.id, it!.order]))
      const byExercise = new Map<string, SetLog[]>()
      const sorted = logs.sort(
        (a, b) => (order.get(a.workout_item) ?? 99) - (order.get(b.workout_item) ?? 99) || a.set_index - b.set_index,
      )
      for (const l of sorted) {
        byExercise.set(l.exercise, [...(byExercise.get(l.exercise) ?? []), l])
      }
      const exNames = new Map((await db.exercises.bulkGet([...byExercise.keys()])).filter(Boolean).map((e) => [e!.id, e!.name]))
      out.push({ s, workout, program, groups: [...byExercise.entries()].map(([id, sets]) => ({ id, name: exNames.get(id) ?? id, sets })) })
    }
    return out
  })

  if (!sessions) return null

  return (
    <div className="history-screen">
      <h1>History</h1>
      {sessions.length === 0 && <p className="muted">No finished workouts yet.</p>}
      {sessions.map(({ s, workout, program, groups }) => (
        <article key={s.id} className="card">
          <div className="row-between">
            <div>
              <div className="program">{program?.name ?? 'Workout'}</div>
              <h2>
                {workout?.week && workout?.day && s.track !== 'test' ? `Week ${workout.week} · Day ${workout.day}` : workout?.title}
              </h2>
            </div>
            <span className={`pill ${s.status || 'open'}`}>{s.status === 'skipped' ? 'Skipped' : s.status === 'done' ? 'Done' : 'Open'}</span>
          </div>
          <div className="muted">
            {when(sessionTime(s))}
            {s.track !== 'test' && ` · Round ${sessionRound(s)}`}
          </div>
          {groups.length > 0 && (
            <ul className="history-sets">
              {groups.map((g) => (
                <li key={g.id}>
                  <button className="name-link" onClick={() => setOpenEx({ id: g.id, name: g.name })}>
                    {g.name}
                  </button>
                  <span className="muted">
                    {' '}
                    {g.sets.map((x) => `${x.weight_lb === null ? 'BW' : fmtLb(x.weight_lb)}×${x.actual_reps ?? '–'}`).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
      {openEx && <ExerciseHistory exerciseId={openEx.id} title={openEx.name} onClose={() => setOpenEx(null)} />}
    </div>
  )
}
