// On-phone database (IndexedDB via Dexie). Every write lands here first; the
// sync engine uploads rows marked dirty and downloads server changes.
import Dexie, { type EntityTable } from 'dexie'
import type {
  Exercise, Meta, OneRepMax, Program, Session, SetLog, Settings, TrackState, Workout, WorkoutItem,
} from './types'

export class AppDB extends Dexie {
  programs!: EntityTable<Program, 'id'>
  workouts!: EntityTable<Workout, 'id'>
  workout_items!: EntityTable<WorkoutItem, 'id'>
  exercises!: EntityTable<Exercise, 'id'>
  sessions!: EntityTable<Session, 'id'>
  set_logs!: EntityTable<SetLog, 'id'>
  one_rep_maxes!: EntityTable<OneRepMax, 'id'>
  track_state!: EntityTable<TrackState, 'id'>
  settings!: EntityTable<Settings, 'id'>
  meta!: EntityTable<Meta, 'key'>

  constructor(name = 'workout-log') {
    super(name)
    this.version(1).stores({
      programs: 'id, track, seq',
      workouts: 'id, program, seq, [program+seq]',
      workout_items: 'id, workout',
      exercises: 'id',
      sessions: 'id, workout, started_at, dirty',
      set_logs: 'id, session, exercise, [session+workout_item], dirty',
      one_rep_maxes: 'id, lift, date, dirty',
      track_state: 'id, program, dirty',
      settings: 'id, dirty',
      meta: 'key',
    })
  }
}

export let db = new AppDB()

/** Tests use a fresh database per run. */
export function useDatabase(next: AppDB) {
  db = next
}

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
}

/** App-written tables, in upload order (parents before children). */
export const SYNCED_TABLES = ['sessions', 'set_logs', 'one_rep_maxes', 'track_state', 'settings'] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

/** Template tables, downloaded once (and on "Refresh templates"). */
export const TEMPLATE_TABLES = ['programs', 'workouts', 'workout_items', 'exercises'] as const
export type TemplateTable = (typeof TEMPLATE_TABLES)[number]

export function nowIso(): string {
  return new Date().toISOString()
}

/** PocketBase date string for a moment (default now). */
export function pbDate(d: Date = new Date()): string {
  return d.toISOString().replace('T', ' ')
}

/** Local calendar day as YYYY-MM-DD. */
export function today(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function newId(): string {
  return crypto.randomUUID()
}

/** Count of rows waiting to upload. */
export async function pendingCount(): Promise<number> {
  let n = 0
  for (const t of SYNCED_TABLES) n += await db.table(t).where('dirty').equals(1).count()
  return n
}
