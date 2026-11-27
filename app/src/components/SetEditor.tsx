import { useEffect, useRef, useState } from 'react'
import { isLoadable, loadableNeighbors } from '../lib/plates'
import { fmtLb } from '../lib/targets'
import type { Settings } from '../lib/types'
import { useScrollLock } from '../lib/useScrollLock'

interface Props {
  title: string
  initialWeight: number | null
  initialReps: number | null
  onSave: (weight: number | null, reps: number | null, completed: boolean) => Promise<void>
  onCancel: () => void
  /** Plate settings for barbell lifts; null means don't check loadability. */
  plateSettings?: Pick<Settings, 'bar_weight_lb' | 'fractional_plates'> | null
}

const toNum = (s: string): number | null => {
  const n = Number(s.replace(',', '.'))
  return s.trim() === '' || Number.isNaN(n) ? null : n
}

/**
 * Weight/reps editor. Opens near the top so the keyboard never covers it.
 * Fields start empty with the current value shown in gray: typing replaces
 * it, and leaving a field empty keeps the gray value.
 */
export default function SetEditor({ title, initialWeight, initialReps, onSave, onCancel, plateSettings }: Props) {
  useScrollLock()
  const weightRef = useRef<HTMLInputElement>(null)
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<{ typed: number; below: number | null; above: number | null } | null>(null)

  useEffect(() => {
    // Focus without letting the browser scroll the page.
    weightRef.current?.focus({ preventScroll: true })
  }, [])

  async function save(completed: boolean, weightOverride?: number) {
    const w = weightOverride ?? toNum(weight) ?? initialWeight
    // A barbell weight the plates can't make: ask before saving.
    if (completed && weightOverride === undefined && plateSettings && w !== null && w > plateSettings.bar_weight_lb && !isLoadable(w, plateSettings)) {
      setWarn({ typed: w, ...loadableNeighbors(w, plateSettings) })
      return
    }
    setBusy(true)
    try {
      await onSave(w, toNum(reps) ?? initialReps, completed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop top" onClick={onCancel}>
      <div className="sheet dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save(true)
          }}
        >
          <div className="fields">
            <label>
              Weight (lb)
              <input
                ref={weightRef}
                inputMode="decimal"
                enterKeyHint="next"
                placeholder={initialWeight === null ? '—' : fmtLb(initialWeight)}
                value={weight}
                onChange={(e) => {
                  setWeight(e.target.value)
                  setWarn(null)
                }}
              />
            </label>
            <label>
              Reps
              <input
                inputMode="numeric"
                enterKeyHint="done"
                placeholder={initialReps === null ? '—' : String(initialReps)}
                value={reps}
                onChange={(e) => setReps(e.target.value)}
              />
            </label>
          </div>
          {warn ? (
            <div className="plate-warn" role="alert">
              <b>The plates can’t make {fmtLb(warn.typed)} lb.</b>
              <div className="plate-warn-actions">
                {warn.below !== null && (
                  <button type="button" onClick={() => void save(true, warn.below!)}>
                    Use {fmtLb(warn.below)} lb
                  </button>
                )}
                {warn.above !== null && (
                  <button type="button" onClick={() => void save(true, warn.above!)}>
                    Use {fmtLb(warn.above)} lb
                  </button>
                )}
                <button type="button" onClick={() => void save(true, warn.typed)}>
                  Keep {fmtLb(warn.typed)} lb
                </button>
              </div>
            </div>
          ) : (
            <p className="hint muted">Type to replace the gray value, or leave it to keep it.</p>
          )}
          <div className="sheet-actions">
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" onClick={() => void save(false)} disabled={busy}>
              Not done
            </button>
            <button type="submit" className="primary" disabled={busy}>
              Done
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
