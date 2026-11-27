// Plate math: which plates go on each side for a target weight.
import { DEFAULT_SETTINGS, nearestLoadable, STANDARD_PLATES } from './targets'

export interface PlateLoad {
  /** Plates for ONE side, heaviest first. */
  perSide: number[]
  /** What the bar weighs with those plates. */
  total: number
  /** target − total (0 when the plates make it exactly). */
  diff: number
}

const EPS = 1e-6
const round4 = (x: number) => Math.round(x * 10000) / 10000

/** Fractional plates usable per side (one of each pair), as a flat list. */
function fractionalPerSide(fractional: Record<string, number>): number[] {
  const out: number[] = []
  for (const [w, n] of Object.entries(fractional)) for (let i = 0; i < Math.floor(n / 2); i++) out.push(Number(w))
  return out.sort((a, b) => b - a)
}

/** Standard plates for an amount that is a multiple of 2.5, heaviest first. */
function standardFor(amount: number): number[] {
  const out: number[] = []
  let rest = round4(amount)
  for (const p of STANDARD_PLATES) {
    while (rest >= p - EPS) {
      out.push(p)
      rest = round4(rest - p)
    }
  }
  return rest < EPS ? out : []
}

/**
 * Plates per side for `target`. Searches every combination of fractional
 * plates and fills the rest with standard plates, keeping the exact match with
 * the fewest plates (heaviest first on ties). If the target can't be made
 * exactly, loads the nearest weight that can.
 */
export function platesFor(target: number, settings = DEFAULT_SETTINGS): PlateLoad {
  const bar = settings.bar_weight_lb
  const loadable = nearestLoadable(target, settings)
  if (loadable <= bar) return { perSide: [], total: bar, diff: round4(target - bar) }
  const side = round4((loadable - bar) / 2)
  const fracs = fractionalPerSide(settings.fractional_plates)

  let best: number[] | null = null
  for (let mask = 0; mask < 1 << fracs.length; mask++) {
    const chosen = fracs.filter((_, i) => mask & (1 << i))
    const f = round4(chosen.reduce((a, b) => a + b, 0))
    const rest = round4(side - f)
    if (rest < -EPS) continue
    const std = standardFor(rest)
    if (rest > EPS && std.length === 0) continue
    const plates = [...std, ...chosen].sort((a, b) => b - a)
    if (
      !best ||
      plates.length < best.length ||
      (plates.length === best.length && plates.join(',') > best.join(','))
    ) {
      best = plates
    }
  }
  const perSide = best ?? []
  const total = round4(bar + 2 * perSide.reduce((a, b) => a + b, 0))
  return { perSide, total, diff: round4(target - total) }
}

/** True if the plates can load exactly this weight (or it's the empty bar). */
export function isLoadable(weight: number, settings = DEFAULT_SETTINGS): boolean {
  return Math.abs(nearestLoadable(weight, settings) - weight) < 0.001
}

/** The closest loadable weights just below and just above `weight`. */
export function loadableNeighbors(weight: number, settings = DEFAULT_SETTINGS): { below: number | null; above: number | null } {
  let below: number | null = null
  let above: number | null = null
  for (let k = 0; k <= 40 && (below === null || above === null); k++) {
    const down = nearestLoadable(weight - k * 0.25, settings)
    const up = nearestLoadable(weight + k * 0.25, settings)
    if (below === null && down < weight - 0.001 && down >= settings.bar_weight_lb) below = down
    if (above === null && up > weight + 0.001) above = up
  }
  return { below, above }
}

const NOT_BARBELL = /\b(dumbbell|db|kettlebell|kb|machine|cable|band|banded|goblet|landmine|med ball|ez bar|trap bar|swiss ball|trx|sled|bike|row conditioning)\b/i

/** Does this exercise load a standard barbell (so plate math applies)? */
export function usesBarbell(ex: { name: string; load_type: string } | undefined): boolean {
  return !!ex && ex.load_type === 'weight' && !NOT_BARBELL.test(ex.name)
}

/** "45 · 10 · 1 · 0.75" */
export function fmtPlates(perSide: number[]): string {
  return perSide.map((p) => String(p)).join(' · ')
}
