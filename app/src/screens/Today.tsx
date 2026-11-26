import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import ExerciseCard from '../components/ExerciseCard'
import { db, getMeta } from '../lib/db'
import { blockGroup } from '../lib/slots'
import { checkAndSync } from '../lib/sync'
import { DEFAULT_SETTINGS } from '../lib/targets'
import type { WorkoutItem } from '../lib/types'
import { ensureMainTrack, finishWorkout, MAIN_TRACK_ID } from '../lib/workout'

export default function Today({ onGoToLifts }: { onGoToLifts: () => void }) {
  const ready = useLiveQuery(async () => !!(await getMeta('syncedOnce')) && (await db.workouts.count()) > 0)
  const track = useLiveQuery(() => db.track_state.get(MAIN_TRACK_ID))

  useEffect(() => {
    if (ready && !track) void ensureMainTrack()
  }, [ready, track])

  const workoutId = track?.current_workout
  const data = useLiveQuery(async () => {
    if (!workoutId) return null
    const workout = await db.workouts.get(workoutId)
    if (!workout) return null
    const program = await db.programs.get(workout.program)
    const items = (await db.workout_items.where('workout').equals(workoutId).toArray()).sort((a, b) => a.order - b.order)
    const exercises = await db.exercises.bulkGet([...new Set(items.map((i) => i.exercise))])
    const mainCount = await db.workouts.filter((w) => w.id.startsWith('main-')).count()
    const session = (await db.sessions.where('workout').equals(workoutId).toArray())
      .filter((s) => !s.finished_at && !s.deleted_at)
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0]
    const logs = session ? await db.set_logs.where('session').equals(session.id).toArray() : []
    return { workout, program, items, exercises, mainCount, session, logs }
  }, [workoutId])

  const maxes = useLiveQuery(() => db.one_rep_maxes.toArray()) ?? []
  const settings = useLiveQuery(() => db.settings.get('settings')) ?? DEFAULT_SETTINGS
  const [finishing, setFinishing] = useState(false)

  const groups = useMemo(() => {
    const out: { key: string; items: WorkoutItem[] }[] = []
    for (const it of data?.items ?? []) {
      const key = blockGroup(it.block)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(it)
      else out.push({ key, items: [it] })
    }
    return out
  }, [data?.items])

  if (ready === undefined) return null
  if (!ready) {
    return (
      <div className="empty">
        <p>Downloading your workouts…</p>
        <p className="muted">This needs a connection to the server the first time.</p>
      </div>
    )
  }
  if (!data) return <div className="empty">Loading…</div>

  const { workout, program, exercises, mainCount, session, logs } = data
  const exMap = new Map(exercises.filter(Boolean).map((e) => [e!.id, e!]))
  const done = logs.filter((l) => l.completed && !l.deleted_at).length
  const weekDay = workout.week && workout.day ? `Week ${workout.week} · Day ${workout.day}` : workout.title

  async function finish() {
    const msg = done ? 'Finish this workout?' : 'No sets logged yet. Finish and move to the next workout anyway?'
    if (!window.confirm(msg)) return
    setFinishing(true)
    try {
      await finishWorkout(workout.id)
      window.scrollTo({ top: 0 })
      void checkAndSync({ resetRetries: true })
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="today">
      <section className="workout-head">
        <div className="program">{program?.name}</div>
        <h1>{weekDay}</h1>
        <div className="muted">
          #{workout.seq} of {mainCount} · originally {new Date(workout.original_date.slice(0, 10) + 'T12:00').toLocaleDateString()}
          {session && ` · ${done} set${done === 1 ? '' : 's'} logged`}
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.key + g.items[0].id} className={g.items.length > 1 ? 'block superset' : 'block'}>
          {g.items.length > 1 && <div className="superset-label">Superset {g.key}</div>}
          {g.items.map((item) => (
            <ExerciseCard
              key={item.id}
              item={item}
              exercise={exMap.get(item.exercise)}
              workoutId={workout.id}
              sessionId={session?.id}
              logs={logs.filter((l) => l.workout_item === item.id && !l.deleted_at)}
              maxes={maxes}
              settings={settings}
              onGoToLifts={onGoToLifts}
            />
          ))}
        </section>
      ))}

      <button className="primary finish" disabled={finishing} onClick={() => void finish()}>
        {finishing ? 'Finishing…' : 'Finish workout'}
      </button>
    </div>
  )
}
