import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB, setDatabase } from './db'
import type { Exercise, Program, Workout, WorkoutItem } from './types'

let db: AppDB
let pr: typeof import('./programs')
let wk: typeof import('./workout')

const program = (progression: string, end_action: 'restart' | 'stop' = 'restart'): Program => ({
  id: 'sup-arm', name: 'Arm Program', track: 'supplemental', seq: 2, role: '', rotation: 'alternate', progression,
  start_date: '', end_date: '', end_action,
})
const wo = (id: string, seq: number, phase: string, label: string): Workout => ({
  id, program: 'sup-arm', seq, kind: 'regular', phase, label, title: id, week: 1, day: seq, original_date: '',
})
const item = (id: string, workout: string, exercise: string, jump: number | null): WorkoutItem => ({
  id, workout, block: 'A', order: 1, exercise, raw_name: exercise, raw_scheme: '', prescription: '3 × 8–12', notes: '',
  scheme_type: 'sets_reps', planned_sets: [{ reps: 8, rep_max: 12 }, { reps: 8, rep_max: 12 }, { reps: 8, rep_max: 12 }],
  set_count: 3, rep_min: 8, rep_max: 12, per_side: false, seconds: null, open_ended: false, weight_jump: jump,
  base_lift_override: '', needs_review: false,
})
const ex = (id: string, load: Exercise['load_type']): Exercise => ({
  id, name: id, aliases: [], components: [], base_lift: '', is_main_lift: false, category: 'arms', load_type: load,
  unilateral: false, form_cue: '', video_url: '',
})

async function setup(progression = 'double', end: 'restart' | 'stop' = 'restart') {
  db = new AppDB(`pr-${Math.random()}`)
  setDatabase(db)
  pr = await import('./programs')
  wk = await import('./workout')
  await db.programs.put(program(progression, end))
  await db.workouts.bulkPut([wo('sup-arm-p1-s01', 1, 'Foundation', 'A'), wo('sup-arm-p1-s02', 2, 'Foundation', 'A'), wo('sup-arm-p2-s01', 3, 'Volume', 'A')])
  await db.exercises.bulkPut([ex('ex-curl', 'weight'), ex('ex-dip', 'bodyweight')])
  await db.workout_items.bulkPut([
    item('i1', 'sup-arm-p1-s01', 'ex-curl', 2.5), item('i1d', 'sup-arm-p1-s01', 'ex-dip', null),
    item('i2', 'sup-arm-p1-s02', 'ex-curl', 2.5), item('i2d', 'sup-arm-p1-s02', 'ex-dip', null),
    item('i3', 'sup-arm-p2-s01', 'ex-curl', 2.5),
  ])
  await pr.ensureSupplementalTracks()
}

const log = async (workoutId: string, it: WorkoutItem, reps: number[], weight: number | null) => {
  for (let i = 0; i < reps.length; i++) {
    await wk.saveSet(workoutId, { item: it, setIndex: i + 1, side: '', planned: it.planned_sets![i] }, { weight_lb: weight, actual_reps: reps[i], completed: true })
  }
}

describe('supplemental tracks', () => {
  beforeEach(() => setup())

  it('uploaded programs start active at the first session', async () => {
    const t = await db.track_state.get('track-sup-arm')
    expect(t).toMatchObject({ status: 'active', current_workout: 'sup-arm-p1-s01', round: 1 })
    expect((await pr.activeSupplementals()).map((a) => a.workoutId)).toEqual(['sup-arm-p1-s01'])
  })

  it('finishing a session moves only that program; the end restarts at phase 1 as round 2', async () => {
    await db.track_state.put({ id: wk.MAIN_TRACK_ID, program: 'p', current_workout: 'main-0001', round: 1, status: 'active', dirty: 0, local_updated: '' })
    expect((await wk.finishWorkout('sup-arm-p1-s01')).nextId).toBe('sup-arm-p1-s02')
    await wk.finishWorkout('sup-arm-p1-s02')
    const last = await wk.finishWorkout('sup-arm-p2-s01')
    expect(last).toMatchObject({ nextId: 'sup-arm-p1-s01', programRestarted: true })
    expect(await db.track_state.get('track-sup-arm')).toMatchObject({ current_workout: 'sup-arm-p1-s01', round: 2 })
    expect((await db.track_state.get(wk.MAIN_TRACK_ID))!.current_workout).toBe('main-0001')
  })

  it('pause, archive, restart and set as current', async () => {
    await pr.setProgramStatus('sup-arm', 'paused')
    expect(await pr.activeSupplementals()).toEqual([])
    await pr.setCurrentSupplemental('sup-arm-p2-s01')
    expect((await db.track_state.get('track-sup-arm'))!.current_workout).toBe('sup-arm-p2-s01')
    await pr.restartProgram('sup-arm')
    expect(await db.track_state.get('track-sup-arm')).toMatchObject({ status: 'active', current_workout: 'sup-arm-p1-s01', round: 2 })
  })
})

describe('end action "stop"', () => {
  it('archives the program after the last session', async () => {
    await setup('double', 'stop')
    await wk.setCurrentMain('x') // no-op
    await pr.setCurrentSupplemental('sup-arm-p2-s01')
    await wk.finishWorkout('sup-arm-p2-s01')
    expect(await db.track_state.get('track-sup-arm')).toMatchObject({ status: 'archived', current_workout: '' })
  })
})

describe('double progression', () => {
  beforeEach(() => setup('double'))
  const it1 = () => db.workout_items.get('i1') as Promise<WorkoutItem>
  const it2 = () => db.workout_items.get('i2') as Promise<WorkoutItem>

  it('first time in a phase: no weight, asks for a starting weight', async () => {
    const s = await pr.suggestFor(await it1(), await db.programs.get('sup-arm'), await db.exercises.get('ex-curl'), undefined)
    expect(s).toEqual({ weight: null, note: 'First time this phase: pick a starting weight.' })
  })

  it('top of the range on every set -> last + jump; otherwise the same weight', async () => {
    await log('sup-arm-p1-s01', await it1(), [12, 12, 12], 20)
    await wk.finishWorkout('sup-arm-p1-s01')
    const up = await pr.suggestFor(await it2(), await db.programs.get('sup-arm'), await db.exercises.get('ex-curl'), undefined)
    expect(up).toEqual({ weight: 22.5, note: 'Hit the top last time: +2.5 lb' })

    await log('sup-arm-p1-s02', await it2(), [12, 11, 10], 22.5)
    await wk.finishWorkout('sup-arm-p1-s02')
    // Next session in the same phase would repeat 22.5.
    const same = await pr.suggestFor(await it1(), await db.programs.get('sup-arm'), await db.exercises.get('ex-curl'), undefined)
    expect(same!.weight).toBe(22.5)
  })

  it('a new phase starts blank again', async () => {
    await log('sup-arm-p1-s01', await it1(), [12, 12, 12], 20)
    await wk.finishWorkout('sup-arm-p1-s01')
    const p2 = (await db.workout_items.get('i3'))!
    const s = await pr.suggestFor(p2, await db.programs.get('sup-arm'), await db.exercises.get('ex-curl'), undefined)
    expect(s!.weight).toBeNull()
  })

  it('bodyweight: "make it harder" once every set hits the top', async () => {
    const dip = (await db.workout_items.get('i1d'))!
    await log('sup-arm-p1-s01', dip, [12, 12, 12], null)
    await wk.finishWorkout('sup-arm-p1-s01')
    const s = await pr.suggestFor((await db.workout_items.get('i2d'))!, await db.programs.get('sup-arm'), await db.exercises.get('ex-dip'), undefined)
    expect(s).toEqual({ weight: null, note: 'Top of range last time: make it harder.' })
  })

  it('no rule ("none") returns null so the app falls back to last weight', async () => {
    await db.programs.put(program('none'))
    expect(await pr.suggestFor(await it1(), await db.programs.get('sup-arm'), undefined, undefined)).toBeNull()
  })
})

describe('fixed progression', () => {
  it('adds the jump every time', async () => {
    await setup('fixed')
    const i1 = (await db.workout_items.get('i1'))!
    await log('sup-arm-p1-s01', i1, [9, 8, 8], 20)
    await wk.finishWorkout('sup-arm-p1-s01')
    const s = await pr.suggestFor((await db.workout_items.get('i2'))!, await db.programs.get('sup-arm'), await db.exercises.get('ex-curl'), undefined)
    expect(s).toEqual({ weight: 22.5, note: '+2.5 lb from last time' })
  })
})
