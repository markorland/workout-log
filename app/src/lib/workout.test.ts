import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB, setMeta, today, useDatabase } from './db'
import type { Exercise, OneRepMax, Program, Workout, WorkoutItem } from './types'

// Loaded after the database is swapped in, so every module sees the test DB.
let wk: typeof import('./workout')
let db: AppDB

const prog = (id: string, track: Program['track'], seq: number): Program => ({
  id, name: id, track, seq, role: '', rotation: 'straight', progression: '', start_date: '', end_date: '',
})
const wo = (id: string, program: string, seq: number): Workout => ({
  id, program, seq, kind: id.startsWith('test-') ? 'test' : 'regular', phase: '', label: '', title: id, week: 1, day: seq,
  original_date: '2021-01-01 00:00:00.000Z',
})
const ex = (id: string, base: Exercise['base_lift']): Exercise => ({
  id, name: id, aliases: [], components: [], base_lift: base, is_main_lift: !!base, category: 'oly',
  load_type: 'weight', unilateral: false, form_cue: '', video_url: '',
})
const item = (id: string, workout: string, exercise: string, pcts: number[], openEnded = false): WorkoutItem => ({
  id, workout, block: 'A', order: 1, exercise, raw_name: exercise, raw_scheme: '', prescription: '', notes: '',
  scheme_type: 'pct', planned_sets: pcts.map((pct) => ({ pct, reps: 1 })), set_count: pcts.length, rep_min: 1,
  rep_max: 1, per_side: false, seconds: null, open_ended: openEnded, weight_jump: null, base_lift_override: '',
  needs_review: false,
})
const orm = (lift: OneRepMax['lift'], w: number, date: string): OneRepMax => ({
  id: `orm-${lift}-${date}`, lift, weight_lb: w, date: `${date} 00:00:00.000Z`, source: 'manual', session: '',
  note: '', deleted_at: '', dirty: 0, local_updated: '',
})

beforeEach(async () => {
  db = new AppDB(`wk-${Math.random()}`)
  useDatabase(db)
  wk = await import('./workout')
  await db.programs.bulkPut([prog('p1', 'main', 1), prog('p2', 'main', 2), prog('prog-test-max-week', 'test', 1)])
  await db.workouts.bulkPut([
    wo('main-0001', 'p1', 1), wo('main-0002', 'p1', 2), wo('main-0003', 'p2', 3), wo('main-0004', 'p2', 4),
    wo('test-max-week-d1', 'prog-test-max-week', 1), wo('test-max-week-d2', 'prog-test-max-week', 2),
  ])
  await db.exercises.bulkPut([ex('ex-snatch', 'snatch'), ex('ex-front-squat', 'front_squat'), ex('ex-curl', '')])
  await db.workout_items.bulkPut([
    item('main-0001-01', 'main-0001', 'ex-snatch', [70, 80]),
    item('test-max-week-d1-01', 'test-max-week-d1', 'ex-snatch', [90, 101], true),
    item('test-max-week-d1-02', 'test-max-week-d1', 'ex-front-squat', [90, 101], true),
  ])
  await db.one_rep_maxes.bulkPut([orm('snatch', 128, '2026-11-26'), orm('front_squat', 238, '2026-11-26')])
  await setMeta('syncedOnce', 'x')
  await wk.ensureMainTrack()
})

const slot = (it: WorkoutItem, setIndex: number) => ({ item: it, setIndex, side: '' as const, planned: it.planned_sets![0] })

describe('main track', () => {
  it('starts at main-0001, skips and marks skipped, and can be set anywhere', async () => {
    expect(await wk.activeWorkoutId()).toBe('main-0001')
    const r = await wk.skipWorkout('main-0001')
    expect(r.nextId).toBe('main-0002')
    const s = (await db.sessions.toArray())[0]
    expect(s.status).toBe('skipped')
    expect(s.finished_at).not.toBe('')
    await wk.setCurrentMain('main-0004')
    expect(await wk.activeWorkoutId()).toBe('main-0004')
    expect((await db.track_state.get(wk.MAIN_TRACK_ID))!.program).toBe('p2')
  })

  it('knows the program boundary', async () => {
    expect(await wk.atProgramBoundary()).toBe(true) // main-0001 opens p1
    await wk.finishWorkout('main-0001')
    expect(await wk.atProgramBoundary()).toBe(false) // main-0002
    await wk.finishWorkout('main-0002')
    expect(await wk.atProgramBoundary()).toBe(true) // main-0003 opens p2
  })
})

describe('test due', () => {
  it('counts 3 months from the starting maxes, then from the last test', async () => {
    expect(await wk.testBaseline()).toBe('2026-11-26')
    expect((await wk.testDueInfo('2027-02-25')).due).toBe(false)
    expect((await wk.testDueInfo('2027-02-26')).due).toBe(true)
    await wk.skipTest()
    expect(await wk.testBaseline()).toBe(today())
  })

  it('"Not now" hides the card for this program only', async () => {
    // Pretend the clock is due by backdating the maxes.
    await db.one_rep_maxes.clear()
    await db.one_rep_maxes.put(orm('snatch', 128, '2026-01-01'))
    expect(await wk.showTestDueCard()).toBe(true)
    await wk.notNowTest()
    expect(await wk.showTestDueCard()).toBe(false)
    await wk.finishWorkout('main-0001')
    await wk.finishWorkout('main-0002') // now at main-0003, first of p2
    expect(await wk.showTestDueCard()).toBe(true)
  })
})

describe('MAX WEEK', () => {
  it('runs on its own track, leaves main alone, and raises only beaten maxes', async () => {
    await wk.setCurrentMain('main-0002')
    expect(await wk.startTest()).toBe('test-max-week-d1')
    expect(await wk.activeWorkoutId()).toBe('test-max-week-d1')

    const [sn, fs] = await db.workout_items.where('workout').equals('test-max-week-d1').sortBy('id')
    await wk.saveSet('test-max-week-d1', slot(sn, 1), { weight_lb: 120, actual_reps: 1, completed: true })
    await wk.saveSet('test-max-week-d1', slot(sn, 2), { weight_lb: 131, actual_reps: 1, completed: true }) // beats 128
    await wk.saveSet('test-max-week-d1', slot(sn, 3), { weight_lb: 135, actual_reps: 1, completed: false }) // missed
    await wk.saveSet('test-max-week-d1', slot(fs, 1), { weight_lb: 225, actual_reps: 1, completed: true }) // below 238

    const r1 = await wk.finishWorkout('test-max-week-d1')
    expect(r1.nextId).toBe('test-max-week-d2')
    expect(r1.raised).toEqual([{ lift: 'snatch', from: 128, to: 131 }])
    const maxes = await db.one_rep_maxes.toArray()
    const snNow = maxes.filter((m) => m.lift === 'snatch').sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    expect(snNow).toMatchObject({ weight_lb: 131, source: 'test' })
    expect(maxes.filter((m) => m.lift === 'front_squat').map((m) => m.weight_lb)).toEqual([238])

    const r2 = await wk.finishWorkout('test-max-week-d2')
    expect(r2.testComplete).toBe(true)
    expect(await wk.testInProgress()).toBe(false)
    expect(await wk.activeWorkoutId()).toBe('main-0002') // main position untouched
    expect(await wk.testBaseline()).toBe(today())
  })
})

describe('exercise history', () => {
  it('lists sessions newest first with the heaviest set', async () => {
    const it1 = (await db.workout_items.get('main-0001-01'))!
    await wk.saveSet('main-0001', slot(it1, 1), { weight_lb: 90, actual_reps: 1, completed: true })
    await wk.saveSet('main-0001', slot(it1, 2), { weight_lb: 100, actual_reps: 1, completed: true })
    const h = await wk.exerciseHistory('ex-snatch')
    expect(h).toHaveLength(1)
    expect(h[0].top!.weight_lb).toBe(100)
    expect(h[0].sets.map((s) => s.weight_lb)).toEqual([90, 100])
  })
})
