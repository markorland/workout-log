import { useLiveQuery } from 'dexie-react-hooks'
import { scrollToTop } from '../lib/scroll'
import { useEffect, useMemo, useState } from 'react'
import ExerciseCard from '../components/ExerciseCard'
import TestDueCard from '../components/TestDueCard'
import { db, getMeta } from '../lib/db'
import { activeSupplementals, ensureSupplementalTracks, trackIdFor } from '../lib/programs'
import { blockGroup } from '../lib/slots'
import { checkAndSync } from '../lib/sync'
import { DEFAULT_SETTINGS, fmtLb } from '../lib/targets'
import { liftName, type WorkoutItem } from '../lib/types'
import {
  activeWorkoutId, endTest, ensureMainTrack, finishWorkout, MAIN_TRACK_ID, showTestDueCard, skipWorkout, testDueInfo,
  trackOf, type FinishResult,
} from '../lib/workout'

interface TodayProps {
  onGoToLifts: () => void
  /** A supplemental session opened from its card (null = the main/test workout). */
  supWorkoutId: string | null
  onOpenSupplemental: (workoutId: string) => void
  onCloseSupplemental: () => void
}

export default function Today({ onGoToLifts, supWorkoutId, onOpenSupplemental, onCloseSupplemental }: TodayProps) {
  const ready = useLiveQuery(async () => !!(await getMeta('syncedOnce')) && (await db.workouts.count()) > 0)
  const mainTrack = useLiveQuery(() => db.track_state.get(MAIN_TRACK_ID))
  const mainWorkoutId = useLiveQuery(() => activeWorkoutId())
  const workoutId = supWorkoutId ?? mainWorkoutId

  useEffect(() => {
    if (ready && mainTrack === undefined) void ensureMainTrack()
    if (ready) void ensureSupplementalTracks()
  }, [ready, mainTrack])

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
    const testDays = trackOf(workoutId) === 'test' ? await db.workouts.where('program').equals(workout.program).count() : 0
    const supTrack = trackOf(workoutId) === 'supplemental' ? await db.track_state.get(trackIdFor(workout.program)) : undefined
    const programCount = supTrack ? await db.workouts.where('program').equals(workout.program).count() : 0
    return { workout, program, items, exercises, mainCount, session, logs, testDays, supTrack, programCount }
  }, [workoutId])

  const supCards = useLiveQuery(() => activeSupplementals()) ?? []
  const testCard = useLiveQuery(async () => ((await showTestDueCard()) ? await testDueInfo() : null), [workoutId])
  const maxes = useLiveQuery(() => db.one_rep_maxes.toArray()) ?? []
  const settings = useLiveQuery(() => db.settings.get('settings')) ?? DEFAULT_SETTINGS
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FinishResult | null>(null)

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

  const { workout, program, exercises, mainCount, session, logs, testDays, supTrack, programCount } = data
  const isTest = trackOf(workout.id) === 'test'
  const isSup = trackOf(workout.id) === 'supplemental'
  const exMap = new Map(exercises.filter(Boolean).map((e) => [e!.id, e!]))
  const done = logs.filter((l) => l.completed && !l.deleted_at).length
  const weekDay = isTest
    ? `Day ${workout.seq} of ${testDays}`
    : isSup
      ? workout.title
      : workout.week && workout.day
      ? `Week ${workout.week} · Day ${workout.day}`
      : workout.title

  async function close(kind: 'finish' | 'skip') {
    const msg =
      kind === 'skip'
        ? 'Skip this workout? It’s marked skipped and you move to the next one.'
        : done
          ? 'Finish this workout?'
          : 'No sets logged yet. Finish and move to the next workout anyway?'
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      const r = kind === 'finish' ? await finishWorkout(workout.id) : await skipWorkout(workout.id)
      if (r.raised.length || r.testComplete || r.programRestarted || r.mainLooped) setResult(r)
      if (isSup) onCloseSupplemental()
      scrollToTop()
      void checkAndSync({ resetRetries: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="today">
      {result && (
        <article className="card result">
          <h2>
            {result.mainLooped || result.programRestarted ? 'Program complete' : result.testComplete ? 'Test complete' : 'Test day done'}
          </h2>
          {result.mainLooped ? (
            <p className="muted">
              Starting <b>Round {result.mainLooped.round}</b> at {result.mainLooped.title}. The Beginner&rsquo;s Cycles are skipped;
              use Timeline &rarr; Back to Beginner&rsquo;s Cycle 1 after a break.
            </p>
          ) : result.programRestarted ? (
            <p className="muted">Starting the next round at Phase 1. Use heavier weights than last time.</p>
          ) : result.raised.length ? (
            <ul>
              {result.raised.map((r) => (
                <li key={r.lift}>
                  {liftName(r.lift)}: {r.from === null ? 'new max' : `${fmtLb(r.from)} →`} <b>{fmtLb(r.to)} lb</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No maxes beaten this time; your 1RMs stay as they were.</p>
          )}
          <button onClick={() => setResult(null)}>OK</button>
        </article>
      )}

      {!isTest && !isSup && testCard && <TestDueCard dueDate={testCard.dueDate} />}

      {!isSup && supCards.length > 0 && (
        <section className="sup-chips" aria-label="Supplemental programs">
          <div className="sup-chips-label">Supplemental</div>
          <div className="sup-chips-row">
            {supCards.map((c) => (
              <button
                key={c.program.id}
                className="sup-chip"
                title={`${c.program.name}: ${c.title}`}
                onClick={() => {
                  onOpenSupplemental(c.workoutId)
                  scrollToTop()
                }}
              >
                <span className="sup-chip-name">{c.program.name}</span>
                <span className="sup-chip-session">· {c.tag} ›</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {isSup && (
        <button className="back-link" onClick={onCloseSupplemental}>
          ‹ Back to main workout
        </button>
      )}

      <section className="workout-head">
        <div className="program">{isTest ? `Test · ${program?.name}` : program?.name}</div>
        <h1>{weekDay}</h1>
        <div className="muted">
          {isTest
            ? 'Keep adding attempts until you miss. Beaten maxes update when you finish.'
            : isSup
              ? `Session ${workout.seq} of ${programCount}${supTrack && supTrack.round > 1 ? ` · Round ${supTrack.round}` : ''}`
              : `#${workout.seq} of ${mainCount} · Round ${mainTrack?.round || 1} · originally ${new Date(workout.original_date.slice(0, 10) + 'T12:00').toLocaleDateString()}`}
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
              program={program}
              onGoToLifts={onGoToLifts}
            />
          ))}
        </section>
      ))}

      <button className="primary finish" disabled={busy} onClick={() => void close('finish')}>
        {busy ? 'Saving…' : isTest ? `Finish day ${workout.seq}` : isSup ? 'Finish session' : 'Finish workout'}
      </button>
      {isSup ? (
        <button className="secondary-wide" disabled={busy} onClick={() => void close('skip')}>
          Skip session
        </button>
      ) : isTest ? (
        <button
          className="secondary-wide"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Stop the test? Days you finished keep their results.')) void endTest()
          }}
        >
          Stop test
        </button>
      ) : (
        <button className="secondary-wide" disabled={busy} onClick={() => void close('skip')}>
          Skip workout
        </button>
      )}

    </div>
  )
}
