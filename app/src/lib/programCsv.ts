// Supplemental program CSV: parse, check and expand into workouts.
// Format (docs/Plan.md, "Adding supplemental programs"):
//   phase,phase_name,weeks,workout,order,exercise,sets,rep_min,rep_max,load_type,weight_jump,unilateral,form_cue,video_url
import type { Exercise, Program, Workout, WorkoutItem } from './types'

export const REQUIRED = ['phase', 'weeks', 'workout', 'order', 'exercise', 'sets', 'rep_min', 'rep_max', 'load_type'] as const
export const OPTIONAL = ['phase_name', 'weight_jump', 'unilateral', 'form_cue', 'video_url'] as const

export interface ProgramRow {
  line: number // 1-based line in the file (header is line 1)
  phase: number
  phase_name: string
  weeks: number
  workout: string
  order: number
  exercise: string
  sets: number
  rep_min: number
  rep_max: number
  load_type: 'weight' | 'bodyweight' | 'time'
  weight_jump: number | null
  unilateral: boolean
  form_cue: string
  video_url: string
}

export interface ParseResult {
  rows: ProgramRow[]
  errors: string[] // block saving
  warnings: string[] // shown, don't block
}

export interface ProgramOptions {
  name: string
  rotation: 'alternate' | 'straight'
  sessionsPerWeek: number
  endAction: 'restart' | 'stop'
  progression: 'none' | 'double' | 'fixed'
}

export interface BuiltProgram {
  program: Omit<Program, 'start_date' | 'end_date'> & {
    end_action: string
    weeks_per_phase: number
    sessions_per_week: number
    phase_names: { phase: number; name: string; weeks: number }[]
  }
  workouts: Workout[]
  items: (WorkoutItem & { form_cue: string; video_url: string })[]
  newExercises: Exercise[]
}

// ---------------------------------------------------------------------------
// CSV text -> rows of strings (RFC 4180: quotes, doubled quotes, newlines in quotes)
// ---------------------------------------------------------------------------

export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// ---------------------------------------------------------------------------
// Rows -> checked ProgramRows
// ---------------------------------------------------------------------------

const int = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN)

export function parseProgramCsv(text: string): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const table = parseCsvText(text)
  if (table.length < 2) return { rows: [], errors: ['The file has no data rows.'], warnings }

  const header = table[0].map((h) => h.trim().toLowerCase())
  const missing = REQUIRED.filter((c) => !header.includes(c))
  if (missing.length) return { rows: [], errors: [`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`], warnings }
  const known = new Set<string>([...REQUIRED, ...OPTIONAL])
  const extra = header.filter((h) => h && !known.has(h))
  if (extra.length) warnings.push(`Ignoring unknown column${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}.`)
  const get = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim()

  const rows: ProgramRow[] = []
  table.slice(1).forEach((r, i) => {
    const line = i + 2
    const bad = (msg: string) => errors.push(`Row ${line}: ${msg}`)
    const phase = int(get(r, 'phase'))
    const weeks = int(get(r, 'weeks'))
    const order = int(get(r, 'order'))
    const sets = int(get(r, 'sets'))
    const repMin = int(get(r, 'rep_min'))
    const repMax = int(get(r, 'rep_max'))
    const loadType = get(r, 'load_type').toLowerCase()
    const jumpText = get(r, 'weight_jump')
    const uni = get(r, 'unilateral').toLowerCase()
    const video = get(r, 'video_url')
    const exercise = get(r, 'exercise')
    const workout = get(r, 'workout').toUpperCase()

    if (!(phase >= 1)) bad('phase must be a whole number (1, 2, 3…).')
    if (!(weeks >= 1)) bad('weeks must be a whole number of at least 1.')
    if (!workout) bad('workout is empty (use A, B…).')
    if (!(order >= 1)) bad('order must be a whole number of at least 1.')
    if (!exercise) bad('exercise is empty.')
    if (!(sets >= 1 && sets <= 20)) bad('sets must be a whole number from 1 to 20.')
    if (!(repMin >= 1)) bad('rep_min must be a whole number of at least 1.')
    if (!(repMax >= 1)) bad('rep_max must be a whole number of at least 1.')
    if (repMin >= 1 && repMax >= 1 && repMin > repMax) bad('rep_min is bigger than rep_max.')
    if (!['weight', 'bodyweight', 'time'].includes(loadType)) bad('load_type must be weight, bodyweight or time.')
    const jump = jumpText === '' ? null : Number(jumpText)
    if (jumpText !== '' && !(jump! >= 0)) bad('weight_jump must be a number of pounds (e.g. 2.5).')
    if (uni && !['yes', 'no', 'y', 'n', 'true', 'false'].includes(uni)) bad('unilateral must be yes or no.')
    if (video && !/^https?:\/\//i.test(video)) bad('video_url must start with http:// or https://.')

    rows.push({
      line, phase, phase_name: get(r, 'phase_name'), weeks, workout, order, exercise, sets, rep_min: repMin,
      rep_max: repMax, load_type: loadType as ProgramRow['load_type'], weight_jump: jump,
      unilateral: ['yes', 'y', 'true'].includes(uni), form_cue: get(r, 'form_cue'), video_url: video,
    })
  })

  // Consistency inside each phase.
  const byPhase = new Map<number, ProgramRow[]>()
  for (const r of rows) byPhase.set(r.phase, [...(byPhase.get(r.phase) ?? []), r])
  for (const [phase, rs] of byPhase) {
    if (new Set(rs.map((r) => r.weeks)).size > 1) errors.push(`Phase ${phase}: weeks differs between rows; use one value per phase.`)
    if (new Set(rs.map((r) => r.phase_name)).size > 1) errors.push(`Phase ${phase}: phase_name differs between rows.`)
    const seen = new Set<string>()
    for (const r of rs) {
      const key = `${r.workout}#${r.order}`
      if (seen.has(key)) errors.push(`Row ${r.line}: workout ${r.workout} already has an exercise at order ${r.order} in phase ${phase}.`)
      seen.add(key)
    }
  }
  const phases = [...byPhase.keys()].sort((a, b) => a - b)
  phases.forEach((p, i) => {
    if (p !== i + 1) errors.push(`Phases should be numbered 1, 2, 3… with no gaps (found ${phases.join(', ')}).`)
  })
  return { rows, errors: [...new Set(errors)], warnings }
}

// ---------------------------------------------------------------------------
// Rows + options -> program, workouts, items
// ---------------------------------------------------------------------------

export function slugify(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'program'
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Labels of the workouts in a phase, in order of first appearance (A, B…). */
function labelsOf(rows: ProgramRow[]): string[] {
  return [...new Set(rows.map((r) => r.workout))]
}

/**
 * Expand into concrete sessions.
 * - alternate: cycle the phase's workouts for weeks × sessions/week sessions
 *   (with A and B at 3 a week that's A-B-A, B-A-B, …).
 * - straight: each workout once per phase, in order.
 */
export function buildProgram(
  rows: ProgramRow[],
  opts: ProgramOptions,
  existing: { programIds: Set<string>; exercises: Exercise[]; nextSeq: number },
): BuiltProgram {
  let pid = `sup-${slugify(opts.name)}`
  for (let n = 2; existing.programIds.has(pid); n++) pid = `sup-${slugify(opts.name)}-${n}`

  // Exercises: reuse library entries by name, add new ones.
  const byName = new Map(existing.exercises.map((e) => [e.name.trim().toLowerCase(), e]))
  const usedIds = new Set(existing.exercises.map((e) => e.id))
  const newExercises: Exercise[] = []
  const exerciseId = (r: ProgramRow): string => {
    const hit = byName.get(r.exercise.toLowerCase())
    if (hit) return hit.id
    let id = `ex-${slugify(r.exercise)}`
    for (let n = 2; usedIds.has(id); n++) id = `ex-${slugify(r.exercise)}-${n}`
    const ex: Exercise = {
      id, name: r.exercise, aliases: [], components: [], base_lift: '', is_main_lift: false, category: 'accessory',
      load_type: r.load_type, unilateral: r.unilateral, form_cue: '', video_url: '',
    }
    usedIds.add(id)
    byName.set(r.exercise.toLowerCase(), ex)
    newExercises.push(ex)
    return id
  }

  const phases = [...new Set(rows.map((r) => r.phase))].sort((a, b) => a - b)
  const workouts: Workout[] = []
  const items: BuiltProgram['items'] = []
  const phaseNames: BuiltProgram['program']['phase_names'] = []
  let seq = 0
  for (const p of phases) {
    const rs = rows.filter((r) => r.phase === p)
    const name = rs[0].phase_name || `Phase ${p}`
    const weeks = rs[0].weeks
    phaseNames.push({ phase: p, name, weeks })
    const labels = labelsOf(rs)
    const sessions =
      opts.rotation === 'straight'
        ? labels
        : Array.from({ length: weeks * opts.sessionsPerWeek }, (_, i) => labels[i % labels.length])
    sessions.forEach((label, i) => {
      seq++
      const wid = `${pid}-p${p}-s${pad(i + 1)}`
      workouts.push({
        id: wid, program: pid, seq, kind: 'regular', phase: name, label,
        title: `${name} · Session ${i + 1} (${label})`,
        week: opts.rotation === 'straight' ? null : Math.floor(i / opts.sessionsPerWeek) + 1,
        day: opts.rotation === 'straight' ? i + 1 : (i % opts.sessionsPerWeek) + 1,
        original_date: '',
      })
      rs.filter((r) => r.workout === label)
        .sort((a, b) => a.order - b.order)
        .forEach((r, k) => {
          const timed = r.load_type === 'time'
          const planned = Array.from({ length: r.sets }, () =>
            timed ? { seconds: r.rep_min } : r.rep_max !== r.rep_min ? { reps: r.rep_min, rep_max: r.rep_max } : { reps: r.rep_min },
          )
          const range = r.rep_max !== r.rep_min ? `${r.rep_min}–${r.rep_max}` : `${r.rep_min}`
          items.push({
            id: `${wid}-${pad(k + 1)}`, workout: wid, block: String.fromCharCode(65 + k), order: k + 1,
            exercise: exerciseId(r), raw_name: r.exercise, raw_scheme: '',
            prescription: `${r.sets} × ${timed ? `${r.rep_min}s` : range}`, notes: '', scheme_type: 'sets_reps',
            planned_sets: planned, set_count: r.sets, rep_min: timed ? null : r.rep_min, rep_max: timed ? null : r.rep_max,
            per_side: r.unilateral, seconds: timed ? r.rep_min : null, open_ended: false,
            weight_jump: r.load_type === 'weight' ? r.weight_jump : null, base_lift_override: '', needs_review: false,
            form_cue: r.form_cue, video_url: r.video_url,
          })
        })
    })
  }

  return {
    program: {
      id: pid, name: opts.name, track: 'supplemental', seq: existing.nextSeq, role: '', rotation: opts.rotation,
      progression: opts.progression, end_action: opts.endAction, weeks_per_phase: phaseNames[0]?.weeks ?? 0,
      sessions_per_week: opts.sessionsPerWeek, phase_names: phaseNames,
    },
    workouts,
    items,
    newExercises,
  }
}

/** Warnings that depend on the chosen options. */
export function optionWarnings(rows: ProgramRow[], opts: ProgramOptions): string[] {
  const out: string[] = []
  if (opts.progression !== 'none') {
    const noJump = [...new Set(rows.filter((r) => r.load_type === 'weight' && r.weight_jump === null).map((r) => r.exercise))]
    if (noJump.length) out.push(`No weight_jump for: ${noJump.join(', ')}. Suggestions will repeat the last weight for these.`)
  }
  return out
}
