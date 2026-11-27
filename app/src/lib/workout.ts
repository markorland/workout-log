// Workout actions: track positions, sessions, set logging, 1RMs and tests.
// Every function writes to Dexie only and marks rows dirty for the next sync.
import { db, getMeta, newId, nowIso, pbDate, setMeta, today } from './db'
import { refreshPending } from './sync'
import { oneRepMaxOn } from './targets'
import type { Lift, OneRepMax, PlannedSet, Session, SetLog, TrackState, Workout, WorkoutItem } from './types'

export const MAIN_TRACK_ID = 'track-main'
export const TEST_TRACK_ID = 'track-test'
const FIRST_MAIN_WORKOUT = 'main-0001' // Beginner's Cycle 1, W1D1
const STANDARD_TEST_PROGRAM = 'prog-test-max-week'

const stamp = () => ({ dirty: 1 as const, local_updated: nowIso() })

export function trackOf(workoutId: string): Session['track'] {
  if (workoutId.startsWith('test-')) return 'test'
  if (workoutId.startsWith('main-')) return 'main'
  return 'supplemental'
}

// ---------------------------------------------------------------------------
// Track positions
// ---------------------------------------------------------------------------

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

/** "Set as current" from the Timeline. */
export async function setCurrentMain(workoutId: string): Promise<void> {
  const w = await db.workouts.get(workoutId)
  if (!w || trackOf(workoutId) !== 'main') return
  const existing = await db.track_state.get(MAIN_TRACK_ID)
  await db.track_state.put({
    id: MAIN_TRACK_ID, program: w.program, current_workout: w.id, round: existing?.round ?? 1,
    status: 'active', ...(existing?.updated ? { updated: existing.updated } : {}), ...stamp(),
  })
  await refreshPending()
}

/** The workout Today should show: a test in progress, else the main track's. */
export async function activeWorkoutId(): Promise<string | undefined> {
  const test = await db.track_state.get(TEST_TRACK_ID)
  if (test && test.status === 'active' && test.current_workout) return test.current_workout
  return (await db.track_state.get(MAIN_TRACK_ID))?.current_workout
}

/** The next workout after `w` in the same track (main) or program (test). */
async function nextWorkout(w: Workout): Promise<Workout | undefined> {
  const prefix = w.id.split('-')[0] + '-'
  const candidates =
    trackOf(w.id) === 'main'
      ? await db.workouts.where('seq').above(w.seq).filter((x) => x.id.startsWith(prefix)).sortBy('seq')
      : (await db.workouts.where('program').equals(w.program).sortBy('seq')).filter((x) => x.seq > w.seq)
  return candidates[0]
}

// ---------------------------------------------------------------------------
// Sessions and sets
// ---------------------------------------------------------------------------

/** The open (unfinished) session for a workout, if any. */
export async function openSession(workoutId: string): Promise<Session | undefined> {
  const rows = await db.sessions.where('workout').equals(workoutId).toArray()
  return rows
    .filter((s) => !s.finished_at && !s.deleted_at)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0]
}

export async function startSession(workoutId: string): Promise<Session> {
  const open = await openSession(workoutId)
  if (open) return open
  const s: Session = {
    id: newId(), workout: workoutId, track: trackOf(workoutId), status: '', started_at: pbDate(), finished_at: '',
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

export interface FinishResult {
  nextId: string | null
  /** 1RMs raised by a finished test day. */
  raised: { lift: Lift; from: number | null; to: number }[]
  testComplete: boolean
  /** A supplemental program reached its end and started round 2, 3… */
  programRestarted?: boolean
}

/** Close the session ("done" or "skipped") and move its track to the next workout. */
async function closeWorkout(workoutId: string, status: 'done' | 'skipped'): Promise<FinishResult> {
  const session = await startSession(workoutId)
  await db.sessions.update(session.id, { finished_at: pbDate(), status, ...stamp() })
  const result: FinishResult = { nextId: null, raised: [], testComplete: false }
  const w = await db.workouts.get(workoutId)
  if (!w) return result

  const kind = trackOf(workoutId)
  const trackId = kind === 'test' ? TEST_TRACK_ID : kind === 'main' ? MAIN_TRACK_ID : `track-${w.program}`
  const track = await db.track_state.get(trackId)
  if (track && track.current_workout === workoutId) {
    const next = await nextWorkout(w)
    if (next) {
      result.nextId = next.id
      await db.track_state.update(trackId, { current_workout: next.id, program: next.program, ...stamp() })
    } else if (kind === 'test') {
      result.testComplete = true
      await db.track_state.update(trackId, { current_workout: '', status: 'archived', ...stamp() })
    } else if (kind === 'supplemental') {
      // End of a supplemental program: restart at Phase 1 (next round) or stop.
      const program = await db.programs.get(w.program)
      const first = (await db.workouts.where('program').equals(w.program).sortBy('seq'))[0]
      if (program?.end_action === 'stop' || !first) {
        await db.track_state.update(trackId, { current_workout: '', status: 'archived', ...stamp() })
      } else {
        result.nextId = first.id
        result.programRestarted = true
        await db.track_state.update(trackId, { current_workout: first.id, round: (track.round ?? 1) + 1, ...stamp() })
      }
    }
  }
  if (trackId === TEST_TRACK_ID && status === 'done') result.raised = await raiseFromTest(session.id)
  await refreshPending()
  return result
}

export const finishWorkout = (workoutId: string) => closeWorkout(workoutId, 'done')
export const skipWorkout = (workoutId: string) => closeWorkout(workoutId, 'skipped')

// ---------------------------------------------------------------------------
// 1RMs
// ---------------------------------------------------------------------------

function ormRow(lift: Lift, weight: number, source: OneRepMax['source'], session = '', note = '', existing?: OneRepMax): OneRepMax {
  const day = today()
  return {
    id: `orm-${lift.replace(/_/g, '-')}-${day}`, lift, weight_lb: weight, date: `${day} 00:00:00.000Z`, source,
    session, note, deleted_at: '', ...(existing?.updated ? { updated: existing.updated } : {}), ...stamp(),
  }
}

/** Save a 1RM for today (one row per lift per day; a second edit replaces it). */
export async function saveOneRepMax(lift: Lift, weight: number, note = ''): Promise<void> {
  const id = `orm-${lift.replace(/_/g, '-')}-${today()}`
  await db.one_rep_maxes.put(ormRow(lift, weight, 'manual', '', note, await db.one_rep_maxes.get(id)))
  await refreshPending()
}

/**
 * After a test day: for each lift tested, if the best completed weight beats
 * the current 1RM, add a dated 1RM row (source "test"). Never lowers a max.
 */
export async function raiseFromTest(sessionId: string): Promise<FinishResult['raised']> {
  const logs = (await db.set_logs.where('session').equals(sessionId).toArray()).filter(
    (l) => l.completed && !l.deleted_at && l.weight_lb !== null,
  )
  const best = new Map<Lift, number>()
  for (const l of logs) {
    const item = await db.workout_items.get(l.workout_item)
    const ex = await db.exercises.get(l.exercise)
    const lift = (item?.base_lift_override || ex?.base_lift || '') as Lift | ''
    if (!lift) continue
    best.set(lift, Math.max(best.get(lift) ?? 0, l.weight_lb!))
  }
  const maxes = await db.one_rep_maxes.toArray()
  const raised: FinishResult['raised'] = []
  for (const [lift, weight] of best) {
    const cur = oneRepMaxOn(maxes, lift, today())
    if (cur && weight <= cur.weight_lb) continue
    const id = `orm-${lift.replace(/_/g, '-')}-${today()}`
    await db.one_rep_maxes.put(ormRow(lift, weight, 'test', sessionId, 'MAX WEEK', await db.one_rep_maxes.get(id)))
    raised.push({ lift, from: cur?.weight_lb ?? null, to: weight })
  }
  return raised
}

// ---------------------------------------------------------------------------
// Tests (MAX WEEK)
// ---------------------------------------------------------------------------

/** When the test clock started: the last test session (done or skipped), else the earliest 1RM. */
export async function testBaseline(): Promise<string | null> {
  const tests = (await db.sessions.toArray()).filter(
    (s) => s.track === 'test' && !s.deleted_at && (s.status === 'done' || s.status === 'skipped'),
  )
  const last = tests.map((s) => s.finished_at || s.started_at).sort().pop()
  if (last) return last.slice(0, 10)
  const first = (await db.one_rep_maxes.toArray()).filter((m) => !m.deleted_at).map((m) => m.date).sort()[0]
  return first ? first.slice(0, 10) : null
}

export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d))
  return dt.toISOString().slice(0, 10)
}

export interface TestDue {
  due: boolean
  dueDate: string | null
}

export async function testDueInfo(onDay = today()): Promise<TestDue> {
  const months = (await db.settings.get('settings'))?.test_interval_months ?? 3
  const base = await testBaseline()
  if (!base) return { due: false, dueDate: null }
  const dueDate = addMonths(base, months)
  return { due: onDay >= dueDate, dueDate }
}

export async function testInProgress(): Promise<boolean> {
  const t = await db.track_state.get(TEST_TRACK_ID)
  return !!(t && t.status === 'active' && t.current_workout)
}

/** True when the main track sits on the first workout of a program. */
export async function atProgramBoundary(): Promise<boolean> {
  const main = await db.track_state.get(MAIN_TRACK_ID)
  if (!main?.current_workout) return false
  const w = await db.workouts.get(main.current_workout)
  if (!w) return false
  const first = (await db.workouts.where('program').equals(w.program).sortBy('seq'))[0]
  return first?.id === w.id
}

/** Should Today show the "Test due" card? */
export async function showTestDueCard(): Promise<boolean> {
  if (await testInProgress()) return false
  if (!(await atProgramBoundary())) return false
  if (!(await testDueInfo()).due) return false
  const main = await db.track_state.get(MAIN_TRACK_ID)
  return (await getMeta('testNotNow')) !== main?.program
}

/** Start MAX WEEK now. The main track's position is untouched. */
export async function startTest(programId = STANDARD_TEST_PROGRAM): Promise<string | null> {
  const first = (await db.workouts.where('program').equals(programId).sortBy('seq'))[0]
  if (!first) return null
  const existing = await db.track_state.get(TEST_TRACK_ID)
  await db.track_state.put({
    id: TEST_TRACK_ID, program: programId, current_workout: first.id, round: (existing?.round ?? 0) + 1,
    status: 'active', ...(existing?.updated ? { updated: existing.updated } : {}), ...stamp(),
  })
  await refreshPending()
  return first.id
}

/** Stop a test part-way (days already finished keep their results). */
export async function endTest(): Promise<void> {
  if (!(await db.track_state.get(TEST_TRACK_ID))) return
  await db.track_state.update(TEST_TRACK_ID, { current_workout: '', status: 'archived', ...stamp() })
  await refreshPending()
}

/** "Skip": record a skipped test, which resets the 3-month clock. */
export async function skipTest(programId = STANDARD_TEST_PROGRAM): Promise<void> {
  const first = (await db.workouts.where('program').equals(programId).sortBy('seq'))[0]
  if (!first) return
  const now = pbDate()
  await db.sessions.put({
    id: newId(), workout: first.id, track: 'test', status: 'skipped', started_at: now, finished_at: now,
    bodyweight_lb: null, notes: 'Test skipped', deleted_at: '', ...stamp(),
  })
  await refreshPending()
}

/** "Not now": hide the card until the next program boundary. */
export async function notNowTest(): Promise<void> {
  const main = await db.track_state.get(MAIN_TRACK_ID)
  if (main) await setMeta('testNotNow', main.program)
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** When a session happened: its start, else its finish (never blank for a closed session). */
export function sessionTime(s: Pick<Session, 'started_at' | 'finished_at'>): string {
  return s.started_at || s.finished_at || ''
}

/** The most recent completed sets of an exercise, from the latest session other than `excludeSession`. */
export async function lastLogged(exerciseId: string, excludeSession?: string): Promise<{ date: string; sets: SetLog[] } | null> {
  const hist = await exerciseHistory(exerciseId, excludeSession)
  return hist[0] ? { date: hist[0].date, sets: hist[0].sets } : null
}

export interface ExerciseSession {
  sessionId: string
  workoutId: string
  date: string // session started_at
  sets: SetLog[]
  top: SetLog | null // heaviest completed set
}

/** Every session where the exercise was logged, newest first. */
export async function exerciseHistory(exerciseId: string, excludeSession?: string): Promise<ExerciseSession[]> {
  const logs = (await db.set_logs.where('exercise').equals(exerciseId).toArray()).filter(
    (l) => l.completed && !l.deleted_at && l.session !== excludeSession,
  )
  if (!logs.length) return []
  const sessions = (await db.sessions.bulkGet([...new Set(logs.map((l) => l.session))])).filter(
    (s): s is Session => !!s && !s.deleted_at,
  )
  return sessions
    .map((s) => {
      const sets = logs.filter((l) => l.session === s.id).sort((a, b) => a.set_index - b.set_index || a.side.localeCompare(b.side))
      const top = sets.reduce<SetLog | null>((a, b) => ((b.weight_lb ?? -1) > (a?.weight_lb ?? -1) ? b : a), null)
      return { sessionId: s.id, workoutId: s.workout, date: sessionTime(s), sets, top }
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}
