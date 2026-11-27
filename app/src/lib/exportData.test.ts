import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { AppDB, useDatabase } from './db'

describe('export', () => {
  it('writes one CSV row per set in workout order, and JSON without local bookkeeping', async () => {
    const db = new AppDB(`exp-${Math.random()}`)
    useDatabase(db)
    const { buildCsv, buildJson } = await import('./exportData')
    await db.programs.put({ id: 'p1', name: 'Hong Kong, Special', track: 'main', seq: 1, role: '', rotation: '', progression: '', start_date: '', end_date: '' })
    await db.workouts.put({ id: 'main-0001', program: 'p1', seq: 1, kind: 'regular', phase: '', label: '', title: 'W1D1', week: 1, day: 1, original_date: '' })
    const item = (id: string, order: number, block: string, exercise: string) => ({
      id, workout: 'main-0001', block, order, exercise, raw_name: '', raw_scheme: '', prescription: '', notes: '',
      scheme_type: 'pct' as const, planned_sets: [], set_count: 1, rep_min: 1, rep_max: 1, per_side: false, seconds: null,
      open_ended: false, weight_jump: null, base_lift_override: '' as const, needs_review: false,
    })
    await db.workout_items.bulkPut([item('i-b', 2, 'B', 'ex-fs'), item('i-a', 1, 'A', 'ex-sn')])
    const ex = (id: string, name: string) => ({ id, name, aliases: [], components: [], base_lift: '' as const, is_main_lift: true, category: 'oly', load_type: 'weight' as const, unilateral: false, form_cue: '', video_url: '' })
    await db.exercises.bulkPut([ex('ex-sn', 'Snatch'), ex('ex-fs', 'Front Squat')])
    await db.sessions.put({ id: 's1', workout: 'main-0001', track: 'main', status: 'done', started_at: '2026-11-27 15:00:00.000Z', finished_at: '2026-11-27 16:00:00.000Z', bodyweight_lb: null, notes: '', deleted_at: '', dirty: 1, local_updated: 'x' })
    const log = (id: string, wi: string, exercise: string, set: number, w: number) => ({
      id, session: 's1', workout_item: wi, exercise, set_index: set, planned_pct: 70, planned_reps: 3, side: '' as const,
      weight_lb: w, actual_reps: 3, completed: true, deleted_at: '', dirty: 1 as const, local_updated: 'x',
    })
    await db.set_logs.bulkPut([log('l3', 'i-b', 'ex-fs', 1, 165), log('l2', 'i-a', 'ex-sn', 2, 92), log('l1', 'i-a', 'ex-sn', 1, 89.5)])

    const lines = (await buildCsv()).trim().split('\n')
    expect(lines[0]).toBe('date,session_status,track,program,workout,timeline_no,block,exercise,set,side,planned_pct,planned_reps,weight_lb,reps,completed')
    // block, exercise, set, side, planned_pct are the 7th-11th columns counted from the end.
    const tail = (l: string) => l.split(',').slice(-9, -4).join('|')
    expect(lines.slice(1).map(tail)).toEqual(['A|Snatch|1||70', 'A|Snatch|2||70', 'B|Front Squat|1||70'])
    expect(lines[1]).toContain('"Hong Kong, Special"') // commas are quoted
    expect(lines[1]).toContain('89.5,3,yes')

    const json = JSON.parse(await buildJson())
    expect(json.units).toBe('lb')
    expect(json.set_logs).toHaveLength(3)
    expect(json.set_logs[0]).not.toHaveProperty('dirty')
    expect(json.sessions[0]).not.toHaveProperty('local_updated')
  })
})
