// Supplemental programs: saving uploads, track status, restart, suggestions.
import { db, nowIso } from './db'
import { createRecord, deleteRecord } from './pb'
import type { BuiltProgram } from './programCsv'
import { pullTemplates, refreshPending } from './sync'
import type { Exercise, Program, SetLog, TrackState, WorkoutItem } from './types'

const stamp = () => ({ dirty: 1 as const, local_updated: nowIso() })

export const trackIdFor = (programId: string) => `track-${programId}`

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** Every supplemental program gets a track; ones the importer made start paused. */
export async function ensureSupplementalTracks(): Promise<void> {
  const programs = await db.programs.where('track').equals('supplemental').toArray()
  for (const p of programs) {
    const id = trackIdFor(p.id)
    if (await db.track_state.get(id)) continue
    const first = (await db.workouts.where('program').equals(p.id).sortBy('seq'))[0]
    if (!first) continue
    await db.track_state.put({
      id, program: p.id, current_workout: first.id, round: 1, status: p.id.startsWith('sup-') ? 'active' : 'paused', ...stamp(),
    })
  }
  await refreshPending()
}

export async function setProgramStatus(programId: string, status: TrackState['status']): Promise<void> {
  const id = trackIdFor(programId)
  const t = await db.track_state.get(id)
  if (!t) return
  let current = t.current_workout
  if (status === 'active' && !current) {
    current = (await db.workouts.where('program').equals(programId).sortBy('seq'))[0]?.id ?? ''
  }
  await db.track_state.update(id, { status, current_workout: current, ...stamp() })
  await refreshPending()
}

/** "Restart at Phase 1": back to the first session, next round. */
export async function restartProgram(programId: string): Promise<void> {
  const id = trackIdFor(programId)
  const t = await db.track_state.get(id)
  const first = (await db.workouts.where('program').equals(programId).sortBy('seq'))[0]
  if (!t || !first) return
  await db.track_state.update(id, { current_workout: first.id, round: (t.round ?? 1) + 1, status: 'active', ...stamp() })
  await refreshPending()
}

export async function setCurrentSupplemental(workoutId: string): Promise<void> {
  const w = await db.workouts.get(workoutId)
  if (!w) return
  const id = trackIdFor(w.program)
  const t = await db.track_state.get(id)
  if (!t) return
  await db.track_state.update(id, { current_workout: w.id, status: t.status === 'archived' ? 'active' : t.status, ...stamp() })
  await refreshPending()
}

/** Active supplemental programs and their next session, for the Today cards. */
export async function activeSupplementals(): Promise<{ program: Program; track: TrackState; workoutId: string; title: string; tag: string }[]> {
  const tracks = (await db.track_state.toArray()).filter((t) => t.id.startsWith('track-') && t.status === 'active' && t.current_workout)
  const out = []
  for (const t of tracks) {
    const program = await db.programs.get(t.program)
    if (!program || program.track !== 'supplemental') continue
    const w = await db.workouts.get(t.current_workout)
    if (!w) continue
    // Short chip tag: session number in the program (+ A/B label), never the long title.
    const position = (await db.workouts.where('program').equals(program.id).sortBy('seq')).findIndex((x) => x.id === w.id) + 1
    out.push({ program, track: t, workoutId: w.id, title: w.title, tag: `S${position}${w.label ? ` (${w.label})` : ''}` })
  }
  return out.sort((a, b) => a.program.seq - b.program.seq)
}

// ---------------------------------------------------------------------------
// Saving an uploaded program (needs a connection: templates are server-owned)
// ---------------------------------------------------------------------------

export async function saveProgram(built: BuiltProgram, onProgress?: (done: number, total: number) => void): Promise<void> {
  const total = built.newExercises.length + 1 + built.workouts.length + built.items.length
  let done = 0
  const tick = () => onProgress?.(++done, total)
  for (const ex of built.newExercises) {
    await createRecord('exercises', ex as unknown as Record<string, unknown>)
    tick()
  }
  try {
    await createRecord('programs', built.program as unknown as Record<string, unknown>)
    tick()
    for (const w of built.workouts) {
      await createRecord('workouts', w as unknown as Record<string, unknown>)
      tick()
    }
    for (const it of built.items) {
      await createRecord('workout_items', it as unknown as Record<string, unknown>)
      tick()
    }
  } catch (e) {
    // Don't leave a half-saved program behind (deleting it removes its workouts too).
    await deleteRecord('programs', built.program.id).catch(() => {})
    throw e
  }
  await pullTemplates()
  await ensureSupplementalTracks()
}

/** Delete an uploaded program from the server (only "sup-" programs can be deleted). */
export async function deleteProgram(programId: string): Promise<void> {
  if (!programId.startsWith('sup-')) throw new Error('Only uploaded programs can be deleted.')
  await deleteRecord('programs', programId)
  await db.track_state.delete(trackIdFor(programId))
  await pullTemplates()
}

// ---------------------------------------------------------------------------
// Suggested weights (per-program progression rule)
// ---------------------------------------------------------------------------

export interface Suggestion {
  weight: number | null
  note: string
}

/**
 * The program's rule applied to this exercise's last session in the same
 * program and phase (excluding the current session).
 *   double: hit the top of the range on every set -> last + jump, else same.
 *   fixed:  last + jump every time.
 * Returns null when the program has no rule (caller falls back to last weight).
 */
export async function suggestFor(
  item: WorkoutItem,
  program: Program | undefined,
  exercise: Exercise | undefined,
  currentSessionId: string | undefined,
): Promise<Suggestion | null> {
  if (!program || (program.progression !== 'double' && program.progression !== 'fixed')) return null
  const workout = await db.workouts.get(item.workout)
  const phase = workout?.phase ?? ''
  const samePhase = new Set(
    (await db.workouts.where('program').equals(program.id).toArray()).filter((w) => w.phase === phase).map((w) => w.id),
  )
  const sessions = (await db.sessions.toArray())
    .filter((s) => samePhase.has(s.workout) && s.id !== currentSessionId && !s.deleted_at)
    .sort((a, b) => ((a.started_at || a.finished_at) < (b.started_at || b.finished_at) ? 1 : -1))
  let last: SetLog[] = []
  for (const s of sessions) {
    last = (await db.set_logs.where('session').equals(s.id).toArray()).filter(
      (l) => l.exercise === item.exercise && l.completed && !l.deleted_at,
    )
    if (last.length) break
  }
  const bodyweight = exercise?.load_type === 'bodyweight'
  if (!last.length) return { weight: null, note: bodyweight ? '' : 'First time this phase: pick a starting weight.' }

  const top = item.rep_max ?? item.rep_min ?? 0
  const needed = item.set_count ?? last.length
  const allTop = last.length >= needed && last.every((l) => (l.actual_reps ?? 0) >= top)
  if (bodyweight) return { weight: null, note: allTop ? 'Top of range last time: make it harder.' : '' }

  const lastWeight = Math.max(...last.map((l) => l.weight_lb ?? 0))
  const jump = item.weight_jump ?? 0
  if (program.progression === 'fixed') return { weight: lastWeight + jump, note: jump ? `+${jump} lb from last time` : 'Same as last time' }
  return allTop && jump
    ? { weight: lastWeight + jump, note: `Hit the top last time: +${jump} lb` }
    : { weight: lastWeight, note: allTop ? 'Same as last time' : 'Same as last time until every set reaches the top' }
}
