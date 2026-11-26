import { describe, expect, it } from 'vitest'
import { fmtLb, fractionalSideSums, nearestLoadable, oneRepMaxOn, targetWeight } from './targets'
import type { OneRepMax } from './types'

describe('plate rounding', () => {
  it('fractional plates give every 0.25 lb per side up to 2.5', () => {
    expect(fractionalSideSums({ '1': 2, '0.75': 2, '0.5': 2, '0.25': 2 })).toEqual([
      0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5,
    ])
  })

  it('rounds to the nearest loadable 0.5 lb with the default plates', () => {
    expect(nearestLoadable(89.6)).toBe(89.5) // 70% of 128, from the plan
    expect(nearestLoadable(158.4)).toBe(158.5) // 90% of 176
    expect(nearestLoadable(115.2)).toBe(115)
    expect(nearestLoadable(176)).toBe(176)
  })

  it('never goes below the bar', () => {
    expect(nearestLoadable(30)).toBe(45)
  })

  it('without fractional plates, rounds to 5 lb', () => {
    const s = { bar_weight_lb: 45, fractional_plates: {} }
    expect(nearestLoadable(89.6, s)).toBe(90)
    expect(nearestLoadable(87.4, s)).toBe(85)
  })

  it('target weight from % and 1RM', () => {
    expect(targetWeight(70, 128)).toBe(89.5)
    expect(targetWeight(100, 176)).toBe(176)
  })

  it('formats without trailing zeros', () => {
    expect(fmtLb(89.5)).toBe('89.5')
    expect(fmtLb(90)).toBe('90')
    expect(fmtLb(null)).toBe('')
  })
})

describe('1RM in effect', () => {
  const row = (lift: OneRepMax['lift'], w: number, date: string, deleted = ''): OneRepMax => ({
    id: `${lift}-${date}`, lift, weight_lb: w, date: `${date} 00:00:00.000Z`, source: 'manual',
    session: '', note: '', deleted_at: deleted, dirty: 0, local_updated: '',
  })
  const maxes = [row('snatch', 120, '2026-01-01'), row('snatch', 128, '2026-11-26'), row('snatch', 140, '2026-12-01', 'x')]

  it('uses the latest row on or before the day, ignoring deleted rows', () => {
    expect(oneRepMaxOn(maxes, 'snatch', '2026-11-25')?.weight_lb).toBe(120)
    expect(oneRepMaxOn(maxes, 'snatch', '2026-11-26')?.weight_lb).toBe(128)
    expect(oneRepMaxOn(maxes, 'snatch', '2026-12-05')?.weight_lb).toBe(128)
    expect(oneRepMaxOn(maxes, 'back_squat', '2026-12-05')).toBeUndefined()
  })
})
