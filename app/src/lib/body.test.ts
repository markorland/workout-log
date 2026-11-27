import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB, setDatabase } from './db'
import type { BodyPart } from './types'

let db: AppDB
let body: typeof import('./body')

const part = (key: string, label: string, has_side: boolean, unit: BodyPart['unit'], order: number): BodyPart => ({
  id: `bp-${key.replace(/_/g, '-')}`, key, label, has_side, unit, sort_order: order, custom: false, dirty: 0, local_updated: '',
})

beforeEach(async () => {
  db = new AppDB(`body-${Math.random()}`)
  setDatabase(db)
  body = await import('./body')
  await db.body_parts.bulkPut([
    part('neck', 'Neck', false, 'in', 10), part('arm', 'Arm', true, 'in', 40), part('waist', 'Waist', false, 'in', 60),
    part('calf', 'Calf', true, 'in', 90), part('bodyweight', 'Bodyweight', false, 'lb', 100), part('body_fat', 'Body fat', false, '%', 110),
  ])
})

describe('saving and reading', () => {
  it('one row per day, part and side; a second save the same day replaces it', async () => {
    const arm = (await db.body_parts.get('bp-arm'))!
    await body.saveMeasurements('2026-11-24', [{ part: arm, side: 'right', value: 15.25 }, { part: arm, side: 'left', value: 15 }])
    await body.saveMeasurements('2026-11-24', [{ part: arm, side: 'right', value: 15.5 }])
    const rows = await db.body_measurements.toArray()
    expect(rows).toHaveLength(2)
    expect((await db.body_measurements.get('bm-2026-11-24-arm-right'))!.value).toBe(15.5)
    const latest = await body.latestValues()
    expect(latest.get('bp-arm|left')!.value).toBe(15)
  })

  it('series are head to toe, left before right, titled "Left Arm"', async () => {
    const [arm, waist] = [(await db.body_parts.get('bp-arm'))!, (await db.body_parts.get('bp-waist'))!]
    await body.saveMeasurements('2026-11-10', [{ part: waist, side: '', value: 34 }, { part: arm, side: 'right', value: 15 }, { part: arm, side: 'left', value: 14.75 }])
    await body.saveMeasurements('2026-11-24', [{ part: arm, side: 'right', value: 15.25 }])
    const s = await body.allSeries()
    expect(s.map((x) => x.title)).toEqual(['Left Arm', 'Right Arm', 'Waist'])
    expect(s[1].points.map((p) => p.value)).toEqual([15, 15.25])
  })
})

describe('CSV import', () => {
  it('reads the plan example, converts units and splits "Right Arm"', async () => {
    const csv = [
      'date,body_part,side,value,unit,notes',
      '2026-11-24,arm,right,15.25,in,morning',
      '11/24/2026,Left Arm,,38.1,cm,',
      '2026-11-24,waist,,33.5,,',
      '2026-11-24,bodyweight,,82.7,kg,',
      '2026-11-24,glutes,,40,in,',
    ].join('\n')
    const p = await body.previewMeasurementCsv(csv)
    expect(p.errors).toEqual([])
    expect(p.rows.map((r) => [r.partKey, r.side, r.value, r.unit])).toEqual([
      ['arm', 'right', 15.25, 'in'], ['arm', 'left', 15, 'in'], ['waist', '', 33.5, 'in'], ['bodyweight', '', 182.32, 'lb'], ['glutes', '', 40, 'in'],
    ])
    expect(p.rows[1]).toMatchObject({ splitFrom: 'Left Arm', converted: '38.1 cm → 15 in' })
    expect(p.rows[4].newPart).toBe(true)
  })

  it('reports bad rows with line numbers', async () => {
    const p = await body.previewMeasurementCsv(
      ['date,body_part,side,value', '2026-13-40x,arm,right,15', '2026-11-24,arm,,15', '2026-11-24,waist,left,30', '2026-11-24,neck,,abc', '2026-11-24,calf,up,14'].join('\n'),
    )
    expect(p.errors).toEqual([
      'Row 2: date must be YYYY-MM-DD or M/D/YYYY.',
      'Row 3: Arm needs a side (left or right).',
      "Row 4: Waist doesn't have sides.",
      'Row 5: value must be a number.',
      'Row 6: side must be left, right or blank.',
    ])
  })

  it('skips duplicates by default, overwrites when asked, and creates new parts', async () => {
    const arm = (await db.body_parts.get('bp-arm'))!
    await body.saveMeasurements('2026-11-24', [{ part: arm, side: 'right', value: 15 }])
    const csv = 'date,body_part,side,value\n2026-11-24,arm,right,15.5\n2026-11-24,glutes,,40\n'
    const p = await body.previewMeasurementCsv(csv)
    expect(p.rows[0].duplicate).toBe(true)
    expect(await body.importMeasurements(p.rows, false)).toEqual({ added: 1, skipped: 1 })
    expect((await db.body_measurements.get('bm-2026-11-24-arm-right'))!.value).toBe(15)
    expect((await db.body_parts.toArray()).find((x) => x.key === 'glutes')).toMatchObject({ custom: true, has_side: false })
    await body.importMeasurements((await body.previewMeasurementCsv(csv)).rows, true)
    expect((await db.body_measurements.get('bm-2026-11-24-arm-right'))!.value).toBe(15.5)
  })

  it('exports the same long format', async () => {
    const arm = (await db.body_parts.get('bp-arm'))!
    await body.saveMeasurements('2026-11-24', [{ part: arm, side: 'left', value: 15 }])
    expect(await body.measurementCsv()).toBe('date,body_part,side,value,unit,notes\n2026-11-24,arm,left,15,in,\n')
  })
})

describe('split names', () => {
  it.each([
    ['Right Arm', 'arm', 'right'], ['right_arm', 'arm', 'right'], ['arm (L)', 'arm', 'left'], ['Waist', 'waist', ''], ['body fat', 'body_fat', ''],
  ])('%s', (raw, key, side) => {
    expect(body.splitPartName(raw)).toEqual({ key, side })
  })
})
