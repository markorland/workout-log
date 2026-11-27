import { describe, expect, it } from 'vitest'
import { fmtPlates, isLoadable, loadableNeighbors, platesFor } from './plates'

describe('plate math', () => {
  it('matches the plan example: 89.5 lb = bar + 10, 10, 1, 0.75, 0.5 per side', () => {
    const p = platesFor(89.5)
    expect(p.perSide.reduce((a, b) => a + b, 0)).toBe(22.25)
    expect(p.total).toBe(89.5)
    expect(p.diff).toBe(0)
    expect(fmtPlates(p.perSide)).toBe('10 · 10 · 1 · 0.75 · 0.5')
  })

  it('uses the fewest plates', () => {
    expect(platesFor(135).perSide).toEqual([45]) // classic plate
    expect(platesFor(225).perSide).toEqual([45, 45])
    expect(platesFor(185).perSide).toEqual([45, 25])
    expect(platesFor(115).perSide).toEqual([35])
  })

  it('bar only, and below the bar', () => {
    expect(platesFor(45)).toEqual({ perSide: [], total: 45, diff: 0 })
    expect(platesFor(30).perSide).toEqual([])
  })

  it('uses each fractional pair at most once per side', () => {
    // 47.5 = bar + 1.25 per side: 1 + 0.25 (not 0.75 + 0.5, which is more plates? same count -> heavier first)
    expect(platesFor(47.5).perSide).toEqual([1, 0.25])
    const p = platesFor(50) // 2.5 per side: one 2.5 plate beats 1+0.75+0.5+0.25
    expect(p.perSide).toEqual([2.5])
  })

  it('a typed weight the plates cannot make loads the nearest one and reports the difference', () => {
    const p = platesFor(100.3)
    expect(p.total).toBe(100.5)
    expect(p.diff).toBeCloseTo(-0.2, 5)
  })

  it('spots weights the plates cannot make and offers the nearest ones', () => {
    expect(isLoadable(89.5)).toBe(true)
    expect(isLoadable(100.3)).toBe(false)
    expect(loadableNeighbors(100.3)).toEqual({ below: 100, above: 100.5 })
    const none = { bar_weight_lb: 45, fractional_plates: {} }
    expect(isLoadable(92, none)).toBe(false)
    expect(loadableNeighbors(92, none)).toEqual({ below: 90, above: 95 })
  })

  it('without fractional plates, falls back to 2.5 lb steps', () => {
    const p = platesFor(89.6, { bar_weight_lb: 45, fractional_plates: {} })
    expect(p.total).toBe(90)
    expect(p.perSide).toEqual([10, 10, 2.5])
  })
})
