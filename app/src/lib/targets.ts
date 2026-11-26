// Percentage targets and plate-based rounding (docs/Plan.md, "Percentage and 1RM logic").
import type { Lift, OneRepMax, Settings } from './types'

/** Standard plates (lb). The gym has plenty, so these are unlimited. */
export const STANDARD_PLATES = [45, 35, 25, 10, 5, 2.5]

export const DEFAULT_SETTINGS: Pick<Settings, 'bar_weight_lb' | 'fractional_plates'> = {
  bar_weight_lb: 45,
  fractional_plates: { '1': 2, '0.75': 2, '0.5': 2, '0.25': 2 },
}

/** Every per-side load the fractional plates can add (one plate of each pair per side). */
export function fractionalSideSums(fractional: Record<string, number>): number[] {
  const perSide: number[] = []
  for (const [w, count] of Object.entries(fractional)) {
    const weight = Number(w)
    for (let i = 0; i < Math.floor(count / 2); i++) perSide.push(weight)
  }
  let sums = new Set<number>([0])
  for (const p of perSide) {
    const next = new Set(sums)
    for (const s of sums) next.add(round4(s + p))
    sums = next
  }
  return [...sums].sort((a, b) => a - b)
}

const round4 = (x: number) => Math.round(x * 10000) / 10000

/**
 * Nearest weight the bar can actually be loaded to. Standard plates make any
 * multiple of 2.5 lb per side; fractional plates add their subset sums.
 * Never below the empty bar.
 */
export function nearestLoadable(target: number, settings = DEFAULT_SETTINGS): number {
  const bar = settings.bar_weight_lb
  if (target <= bar) return bar
  const side = (target - bar) / 2
  const step = Math.min(...STANDARD_PLATES)
  let best = 0
  let bestDiff = Infinity
  for (const f of fractionalSideSums(settings.fractional_plates)) {
    const k = Math.max(0, Math.round((side - f) / step))
    for (const kk of [k - 1, k, k + 1]) {
      if (kk < 0) continue
      const cand = round4(kk * step + f)
      const diff = Math.abs(cand - side)
      if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) < 1e-9 && cand < best)) {
        best = cand
        bestDiff = diff
      }
    }
  }
  return round4(bar + 2 * best)
}

/** The 1RM in effect on a day: latest non-deleted row on or before it. */
export function oneRepMaxOn(maxes: OneRepMax[], lift: Lift, day: string): OneRepMax | undefined {
  return maxes
    .filter((m) => m.lift === lift && !m.deleted_at && m.date.slice(0, 10) <= day)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0]
}

export function targetWeight(pct: number, oneRm: number, settings = DEFAULT_SETTINGS): number {
  return nearestLoadable((pct / 100) * oneRm, settings)
}

/** "89.5", "90", "176" — no trailing zeros. */
export function fmtLb(w: number | null | undefined): string {
  if (w === null || w === undefined || Number.isNaN(w)) return ''
  return String(round4(w))
}
