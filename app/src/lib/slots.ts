// Turn a workout item's plan into the rows shown on the Today screen.
import type { SetSlot } from './workout'
import type { PlannedSet, WorkoutItem } from './types'

/** One row per planned set; unilateral sets get a left and a right row. */
export function plannedSlots(item: WorkoutItem, extra = 0): SetSlot[] {
  const planned = item.planned_sets ?? []
  const base: PlannedSet[] =
    planned.length > 0
      ? planned
      : item.scheme_type === 'sets_only' && item.set_count
        ? Array.from({ length: item.set_count }, () => ({}))
        : []
  const slots: SetSlot[] = []
  const push = (planned: SetSlot['planned'], setIndex: number) => {
    if (item.per_side || planned?.per_side) {
      slots.push({ item, setIndex, side: 'left', planned }, { item, setIndex, side: 'right', planned })
    } else {
      slots.push({ item, setIndex, side: '', planned })
    }
  }
  base.forEach((p, i) => push(p, i + 1))
  // Extra attempts (open-ended max attempts, or sets added by hand).
  const last = base[base.length - 1] ?? null
  // Attempts past a % ladder have no %: you pick the weight.
  for (let i = 0; i < extra; i++) push(last && last.pct !== undefined ? { reps: last.reps } : last, base.length + i + 1)
  return slots
}

/** Superset blocks (C1, C2…) share a card; A, B… get their own. */
export function blockGroup(block: string): string {
  const m = block.match(/^([A-Za-z]+)\d+$/)
  return m ? m[1].toUpperCase() : block.toUpperCase() || '?'
}

export function repsLabel(p: SetSlot['planned']): string {
  if (!p) return ''
  if (p.seconds) return p.seconds >= 60 ? `${Math.floor(p.seconds / 60)}:${String(p.seconds % 60).padStart(2, '0')}` : `:${p.seconds}`
  if (p.reps === undefined) return ''
  return p.rep_max && p.rep_max !== p.reps ? `${p.reps}–${p.rep_max}` : String(p.reps)
}
