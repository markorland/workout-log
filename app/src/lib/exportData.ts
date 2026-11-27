// Export logs as CSV (one row per set) or JSON (all app data).
import { db, today } from './db'
import { sessionTime } from './workout'

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Every logged set, oldest first, with its workout and exercise names. */
export async function buildCsv(): Promise<string> {
  const sessions = new Map((await db.sessions.toArray()).filter((s) => !s.deleted_at).map((s) => [s.id, s]))
  const workouts = new Map((await db.workouts.toArray()).map((w) => [w.id, w]))
  const programs = new Map((await db.programs.toArray()).map((p) => [p.id, p]))
  const items = new Map((await db.workout_items.toArray()).map((i) => [i.id, i]))
  const exercises = new Map((await db.exercises.toArray()).map((e) => [e.id, e]))
  const logs = (await db.set_logs.toArray()).filter((l) => !l.deleted_at && sessions.has(l.session))

  const header = [
    'date', 'session_status', 'track', 'program', 'workout', 'timeline_no', 'block', 'exercise', 'set', 'side',
    'planned_pct', 'planned_reps', 'weight_lb', 'reps', 'completed',
  ]
  const rows = logs
    .map((l) => {
      const s = sessions.get(l.session)!
      const w = workouts.get(s.workout)
      const item = items.get(l.workout_item)
      return {
        sort: `${sessionTime(s)}|${String(item?.order ?? 99).padStart(3, '0')}|${String(l.set_index).padStart(3, '0')}|${l.side}`,
        cells: [
          sessionTime(s).slice(0, 10), s.status || 'open', s.track, programs.get(w?.program ?? '')?.name ?? '',
          w ? (w.week && w.day ? `W${w.week}D${w.day}` : w.title) : s.workout, w?.seq ?? '', item?.block ?? '',
          exercises.get(l.exercise)?.name ?? l.exercise, l.set_index, l.side, l.planned_pct, l.planned_reps,
          l.weight_lb, l.actual_reps, l.completed ? 'yes' : 'no',
        ],
      }
    })
    .sort((a, b) => (a.sort < b.sort ? -1 : 1))
  return [header, ...rows.map((r) => r.cells)].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

/** Everything the app writes (sessions, sets, 1RMs, positions, settings). */
export async function buildJson(): Promise<string> {
  const strip = <T extends object>(rows: T[]) =>
    rows.map((r) => {
      const { dirty: _d, local_updated: _l, ...rest } = r as Record<string, unknown>
      return rest
    })
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      units: 'lb',
      sessions: strip(await db.sessions.toArray()),
      set_logs: strip(await db.set_logs.toArray()),
      one_rep_maxes: strip(await db.one_rep_maxes.toArray()),
      track_state: strip(await db.track_state.toArray()),
      settings: strip(await db.settings.toArray()),
      body_parts: strip(await db.body_parts.toArray()),
      body_measurements: strip(await db.body_measurements.toArray()),
      // Photo details only; the images stay on the server.
      progress_photos: strip(await db.progress_photos.toArray()),
    },
    null,
    2,
  )
}

/** Share the file (iOS share sheet: Save to Files, AirDrop…) or download it. */
export async function shareOrDownload(text: string, filename: string, type: string): Promise<void> {
  const file = new File([text], filename, { type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return // user closed the sheet
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const exportName = (ext: string) => `workout-log-${today()}.${ext}`
