// Record shapes, mirroring the PocketBase collections (deploy/pocketbase/pb_migrations).
// All weights are lb. Dates are PocketBase strings: "2026-11-26 00:00:00.000Z".

export type Lift = 'snatch' | 'clean_and_jerk' | 'back_squat' | 'front_squat' | 'deadlift'

export const LIFTS: { id: Lift; name: string }[] = [
  { id: 'snatch', name: 'Snatch' },
  { id: 'clean_and_jerk', name: 'Clean & Jerk' },
  { id: 'back_squat', name: 'Back Squat' },
  { id: 'front_squat', name: 'Front Squat' },
  { id: 'deadlift', name: 'Deadlift' },
]

export const liftName = (l: Lift | '' | null | undefined) => LIFTS.find((x) => x.id === l)?.name ?? ''

// ---- templates (read-only, from the importer) -----------------------------

export interface Program {
  id: string
  name: string
  track: 'main' | 'supplemental' | 'test'
  seq: number
  role: string
  rotation: string
  progression: string
  start_date: string
  end_date: string
  // Uploaded supplemental programs (Phase 6)
  end_action?: '' | 'restart' | 'stop'
  sessions_per_week?: number | null
  weeks_per_phase?: number | null
  phase_names?: { phase: number; name: string; weeks: number }[] | null
}

export interface Workout {
  id: string
  program: string
  seq: number
  kind: 'regular' | 'test'
  phase: string
  label: string
  title: string
  week: number | null
  day: number | null
  original_date: string
}

export interface PlannedSet {
  pct?: number
  pct_range?: [number, number]
  reps?: number
  rep_max?: number
  per_side?: boolean
  seconds?: number
}

export interface WorkoutItem {
  id: string
  workout: string
  block: string
  order: number
  exercise: string
  raw_name: string
  raw_scheme: string
  prescription: string
  notes: string
  scheme_type: 'pct' | 'sets_reps' | 'sets_only' | 'max_attempt' | 'text'
  planned_sets: PlannedSet[] | null
  set_count: number | null
  rep_min: number | null
  rep_max: number | null
  per_side: boolean
  seconds: number | null
  open_ended: boolean
  weight_jump: number | null
  base_lift_override: Lift | ''
  needs_review: boolean
  form_cue?: string
  video_url?: string
}

export interface Exercise {
  id: string
  name: string
  aliases: string[] | null
  components: string[] | null
  base_lift: Lift | ''
  is_main_lift: boolean
  category: string
  load_type: 'weight' | 'bodyweight' | 'time' | 'text'
  unilateral: boolean
  form_cue: string
  video_url: string
}

// ---- app data (written on the phone, synced) -----------------------------

/** Local-only bookkeeping on app records. Stripped before upload. */
export interface Local {
  /** 1 = changed on the phone and not yet uploaded. */
  dirty: 0 | 1
  /** When the phone last changed it (ISO). */
  local_updated: string
  /** Server's `updated`, once it has been synced. */
  updated?: string
}

export interface Session extends Local {
  id: string
  workout: string
  track: 'main' | 'supplemental' | 'test'
  status: '' | 'done' | 'skipped'
  started_at: string
  finished_at: string
  bodyweight_lb: number | null
  notes: string
  deleted_at: string
}

export interface SetLog extends Local {
  id: string
  session: string
  workout_item: string
  exercise: string
  set_index: number
  planned_pct: number | null
  planned_reps: number | null
  side: '' | 'left' | 'right'
  weight_lb: number | null
  actual_reps: number | null
  completed: boolean
  deleted_at: string
}

export interface OneRepMax extends Local {
  id: string
  lift: Lift
  weight_lb: number
  date: string
  source: 'manual' | 'test'
  session: string
  note: string
  deleted_at: string
}

export interface TrackState extends Local {
  id: string
  program: string
  current_workout: string
  round: number
  status: 'active' | 'paused' | 'archived'
}

export interface Settings extends Local {
  id: string
  bar_weight_lb: number
  fractional_plates: Record<string, number>
  test_interval_months: number
  connect_shortcut_name: string
}

// ---- body tracking (Phase 7) ------------------------------------------------

export type BodyUnit = 'in' | 'lb' | '%'

export interface BodyPart extends Local {
  id: string
  key: string // e.g. "arm"
  label: string // e.g. "Arm"
  has_side: boolean
  unit: BodyUnit
  sort_order: number
  custom: boolean
}

export interface BodyMeasurement extends Local {
  id: string // "bm-<date>-<key>-<side|x>": one per day, part and side
  date: string // "YYYY-MM-DD 00:00:00.000Z"
  body_part: string // BodyPart id
  side: '' | 'left' | 'right'
  value: number
  unit: BodyUnit
  notes: string
  source: 'manual' | 'csv'
  deleted_at: string
}

export interface ProgressPhoto extends Local {
  id: string
  date: string
  pose: string
  image: string // file name on the server
  thumbnail: string
  notes: string
  deleted_at: string
}

/** A photo taken on the phone, waiting to upload (blobs stay on the phone until then). */
export interface QueuedPhoto {
  id: string
  date: string
  pose: string
  notes: string
  image: Blob
  thumbnail: Blob
  created: string
}

/** Small cached thumbnails of recent photos, for viewing offline. */
export interface ThumbCache {
  id: string // photo id
  blob: Blob
  cached: string
}

export interface Meta {
  key: string
  value: string
}
