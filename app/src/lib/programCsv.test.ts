import { describe, expect, it } from 'vitest'
import { buildProgram, parseCsvText, parseProgramCsv, type ProgramOptions } from './programCsv'
import type { Exercise } from './types'

const HEADER = 'phase,phase_name,weeks,workout,order,exercise,sets,rep_min,rep_max,load_type,weight_jump,unilateral,form_cue,video_url'
const ARM_LIKE = [
  HEADER,
  '1,Foundation,4,A,1,Standing Dumbbell Curl,3,8,12,weight,2.5,no,"Elbows pinned at sides, no swinging",https://example.com/a',
  '1,Foundation,4,A,2,Diamond Push-Up,2,10,20,bodyweight,,no,Kneel if needed,',
  '1,Foundation,4,B,1,Hammer Curl,3,10,15,weight,2.5,no,"Palms in",',
  '2,Volume,4,A,1,Dumbbell Drag Curl,3,8,12,weight,2.5,no,,',
  '2,Volume,4,B,1,Plank,3,45,45,time,,no,,',
].join('\n')

const OPTS: ProgramOptions = { name: 'Arm Program', rotation: 'alternate', sessionsPerWeek: 3, endAction: 'restart', progression: 'double' }
const lib = (id: string, name: string): Exercise => ({
  id, name, aliases: [], components: [], base_lift: '', is_main_lift: false, category: 'arms', load_type: 'weight',
  unilateral: false, form_cue: '', video_url: '',
})

describe('CSV text', () => {
  it('handles quotes, doubled quotes, commas and CRLF', () => {
    expect(parseCsvText('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
    expect(parseCsvText('﻿a\n\n1\n')).toEqual([['a'], ['1']])
  })
})

describe('program CSV checks', () => {
  it('accepts the arm format', () => {
    const r = parseProgramCsv(ARM_LIKE)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(5)
    expect(r.rows[0]).toMatchObject({ phase: 1, workout: 'A', sets: 3, rep_min: 8, rep_max: 12, weight_jump: 2.5, unilateral: false })
    expect(r.rows[0].form_cue).toBe('Elbows pinned at sides, no swinging')
  })

  it('reports missing columns and bad rows with line numbers', () => {
    expect(parseProgramCsv('phase,exercise\n1,Curl').errors[0]).toMatch(/Missing columns: weeks, workout, order, sets, rep_min, rep_max, load_type/)
    const bad = parseProgramCsv(
      [HEADER, '1,F,4,A,1,Curl,0,12,8,heavy,abc,maybe,,ftp://x', '1,G,5,A,1,Curl,3,8,12,weight,2.5,no,,'].join('\n'),
    ).errors.join('\n')
    expect(bad).toMatch(/Row 2: sets must be/)
    expect(bad).toMatch(/Row 2: rep_min is bigger than rep_max/)
    expect(bad).toMatch(/Row 2: load_type must be/)
    expect(bad).toMatch(/Row 2: weight_jump must be/)
    expect(bad).toMatch(/Row 2: unilateral must be/)
    expect(bad).toMatch(/Row 2: video_url must start/)
    expect(bad).toMatch(/Phase 1: weeks differs/)
    expect(bad).toMatch(/Phase 1: phase_name differs/)
    expect(bad).toMatch(/Row 3: workout A already has an exercise at order 1/)
  })

  it('wants phases numbered from 1 without gaps', () => {
    const r = parseProgramCsv([HEADER, '1,F,4,A,1,Curl,3,8,12,weight,2.5,no,,', '3,H,4,A,1,Curl,3,8,12,weight,2.5,no,,'].join('\n'))
    expect(r.errors.join(' ')).toMatch(/no gaps/)
  })
})

describe('building the program', () => {
  const rows = parseProgramCsv(ARM_LIKE).rows
  const built = buildProgram(rows, OPTS, { programIds: new Set(), exercises: [lib('ex-hammer-curl', 'Hammer Curl')], nextSeq: 2 })

  it('alternates A-B-A / B-A-B for 4 weeks at 3 a week (12 sessions per phase)', () => {
    const p1 = built.workouts.filter((w) => w.phase === 'Foundation').map((w) => w.label).join('')
    expect(p1).toBe('ABABABABABAB')
    expect(built.workouts).toHaveLength(24)
    expect(built.workouts[0]).toMatchObject({ id: 'sup-arm-program-p1-s01', seq: 1, week: 1, day: 1, title: 'Foundation · Session 1 (A)' })
    expect(built.workouts[3]).toMatchObject({ label: 'B', week: 2, day: 1 }) // week 2 starts with B
    expect(built.workouts[12]).toMatchObject({ id: 'sup-arm-program-p2-s01', phase: 'Volume', seq: 13 })
  })

  it('builds items with ranges, cues, links, jumps and blocks A, B…', () => {
    const items = built.items.filter((i) => i.workout === 'sup-arm-program-p1-s01')
    expect(items.map((i) => i.block)).toEqual(['A', 'B'])
    expect(items[0]).toMatchObject({
      prescription: '3 × 8–12', set_count: 3, rep_min: 8, rep_max: 12, weight_jump: 2.5,
      form_cue: 'Elbows pinned at sides, no swinging', video_url: 'https://example.com/a',
    })
    expect(items[0].planned_sets).toEqual([{ reps: 8, rep_max: 12 }, { reps: 8, rep_max: 12 }, { reps: 8, rep_max: 12 }])
    expect(items[1]).toMatchObject({ prescription: '2 × 10–20', weight_jump: null })
    const plank = built.items.find((i) => i.raw_name === 'Plank')!
    expect(plank).toMatchObject({ prescription: '3 × 45s', seconds: 45, rep_min: null })
  })

  it('reuses library exercises by name and adds new ones', () => {
    const hammer = built.items.find((i) => i.raw_name === 'Hammer Curl')!
    expect(hammer.exercise).toBe('ex-hammer-curl')
    expect(built.newExercises.map((e) => e.name)).toEqual(['Standing Dumbbell Curl', 'Diamond Push-Up', 'Dumbbell Drag Curl', 'Plank'])
    expect(built.newExercises.find((e) => e.name === 'Diamond Push-Up')!.load_type).toBe('bodyweight')
  })

  it('records the options on the program and avoids id clashes', () => {
    expect(built.program).toMatchObject({ id: 'sup-arm-program', track: 'supplemental', progression: 'double', end_action: 'restart', sessions_per_week: 3, seq: 2 })
    expect(built.program.phase_names).toEqual([{ phase: 1, name: 'Foundation', weeks: 4 }, { phase: 2, name: 'Volume', weeks: 4 }])
    const again = buildProgram(rows, OPTS, { programIds: new Set(['sup-arm-program']), exercises: [], nextSeq: 3 })
    expect(again.program.id).toBe('sup-arm-program-2')
  })

  it('straight rotation: each workout once per phase', () => {
    const s = buildProgram(rows, { ...OPTS, rotation: 'straight' }, { programIds: new Set(), exercises: [], nextSeq: 1 })
    expect(s.workouts.map((w) => w.label).join('')).toBe('ABAB')
  })
})
