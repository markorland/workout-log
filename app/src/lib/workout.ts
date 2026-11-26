// Workout actions: the main track's position, sessions, set logging, 1RMs.
// Every function writes to Dexie only and marks rows dirty for the next sync.
import { db, getMeta, newId, nowIso, pbDate, today } from './db'
import { refreshPending } from './sync'
import type { Lift, OneRepMax, PlannedSet, Session, SetLog, TrackState, WorkoutItem } from './types'

export const MAIN_TRACK_ID = 'track-main'
const FIRST_MAIN_WORKOUT = 'main-0001' // Beginner's Cycle 1, W1D1

const stamp = () => ({ dirty: 1 as const, local_updated: nowIso() })

/**
 * Make sure the main track has a position. Waits for the first sync, so a
 * position already saved on the server (from another device) wins.
 */
export async function ensureMainTrack(): Promise<TrackState | undefined> {
  const existing = await db.track_state.get(MAIN_TRACK_ID)
  if (existing) return existing
  if (!(await getMeta('syncedOnce'))) return undefined
  const first = await db.workouts.get(FIRST_MAIN_WORKOUT)
  if (!first) return undefined
  const t: TrackState = {
    id: MAIN_TRACK_ID, program: first.program, current_workout: first.id, round: 1, status: 'active', ...stamp(),
  }
  await db.track_state.put(t)
  await refreshPending()
  return t
}

/** The open (unfinished) session for a workout, if any. */
export async function openSession(workoutId: string): Promise<Session | undefined> {
  const rows = await db.sessions.where('workout').equals(workoutId).toArray()
  return rows
    .filter((s) => !s.finished_at && !s.deleted_at)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0]
}

export async function startSession(workoutId: string, track: Session['track'] = 'main'): Promise<Session> {
  const open = await openSession(workoutId)
  if (open) return open
  const s: Session = {
    id: newId(), workout: workoutId, track, status: '', started_at: pbDate(), finished_at: '',
    bodyweight_lb: null, notes: '', deleted_at: '', ...stamp(),
  }
  await db.sessions.put(s)
  await refreshPending()
  return s
}

export interface SetSlot {
  item: WorkoutItem
  setIndex: number // 1-based
  side: '' | 'left' | 'right'
  planned: PlannedSet | null
}

/** Find the logged row for a slot in a session. */
export async function findLog(sessionId: string, slot: SetSlot): Promise<SetLog | undefined> {
  const rows = await db.set_logs.where('[session+workout_item]').equals([sessionId, slot.item.id]).toArray()
  return rows.find((r) => r.set_index === slot.setIndex && r.side === slot.side && !r.deleted_at)
}

/** Save a set (creating the session on the first logged set). */
export async function saveSet(
  workoutId: string,
  slot: SetSlot,
  values: { weight_lb: number | null; actual_reps: number | null; completed: boolean },
): Promise<SetLog> {
  const session = await startSession(workoutId)
  const existing = await findLog(session.id, slot)
  const row: SetLog = {
    id: existing?.id ?? newId(),
    session: session.id,
    workout_item: slot.item.id,
    exercise: slot.item.exercise,
    set_index: slot.setIndex,
    planned_pct: slot.planned?.pct ?? null,
    planned_reps: slot.planned?.reps ?? slot.planned?.seconds ?? null,
    side: slot.side,
    weight_lb: values.weight_lb,
    actual_reps: values.actual_reps,
    completed: values.completed,
    deleted_at: '',
    ...(existing?.updated ? { updated: existing.updated } : {}),
    ...stamp(),
  }
  await db.set_logs.put(row)
  await refreshPending()
  return row
}

/** Close the session and move the main track to the next workout. */
export async function finishWorkout(workoutId: string): Promise<string | null> {
  const session = await startSession(workoutId)
  await db.sessions.update(session.id, { finished_at: pbDate(), status: 'done', ...stamp() })
  const w = await db.workouts.get(workoutId)
  const track = await db.track_state.get(MAIN_TRACK_ID)
  let nextId: string | null = null
  if (w && track && track.current_workout === workoutId) {
    const next = await db.workouts
      .where('seq')
      .above(w.seq)
      .filter((x) => x.id.startsWith('main-'))
      .sortBy('seq')
    if (next[0]) {
      nextId = next[0].id
      await db.track_state.update(MAIN_TRACK_ID, { current_workout: next[0].id, program: next[0].program, ...stamp() })
    }
  }
  await refreshPending()
  return nextId
}

/** Save a 1RM for today (one row per lift per day; a second edit replaces it). */
export async function saveOneRepMax(lift: Lift, weight: number, note = ''): Promise<void> {
  const day = today()
  const id = `orm-${lift.replace(/_/g, '-')}-${day}`
  const existing = await db.one_rep_maxes.get(id)
  const row: OneRepMax = {
    id, lift, weight_lb: weight, date: `${day} 00:00:00.000Z`, source: 'manual', session: '', note,
    deleted_at: '', ...(existing?.updated ? { updated: existing.updated } : {}), ...stamp(),
  }
  await db.one_rep_maxes.put(row)
  await refreshPending()
}

/** The most recent completed sets of an exercise, from the latest session other than `excludeSession`. */
export async function lastLogged(exerciseId: string, excludeSession?: string): Promise<{ date: string; sets: SetLog[] } | null> {
  const logs = (await db.set_logs.where('exercise').equals(exerciseId).toArray()).filter(
    (l) => l.completed && !l.deleted_at && l.session !== excludeSession && l.weight_lb !== null,
  )
  if (!logs.length) return null
  const sessions = await db.sessions.bulkGet([...new Set(logs.map((l) => l.session))])
  const started = new Map(sessions.filter(Boolean).map((s) => [s!.id, s!.started_at]))
  const latest = [...started.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1))[0]
  if (!latest) return null
  const sets = logs.filter((l) => l.session === latest[0]).sort((a, b) => a.set_index - b.set_index)
  return { date: latest[1], sets }
}
