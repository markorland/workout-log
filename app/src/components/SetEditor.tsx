import { useEffect, useRef, useState } from 'react'
import { fmtLb } from '../lib/targets'
import { useScrollLock } from '../lib/useScrollLock'

interface Props {
  title: string
  initialWeight: number | null
  initialReps: number | null
  onSave: (weight: number | null, reps: number | null, completed: boolean) => Promise<void>
  onCancel: () => void
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
export default function SetEditor({ title, initialWeight, initialReps, onSave, onCancel }: Props) {
  useScrollLock()
  const weightRef = useRef<HTMLInputElement>(null)
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Focus without letting the browser scroll the page.
    weightRef.current?.focus({ preventScroll: true })
  }, [])

  async function save(completed: boolean) {
    setBusy(true)
    try {
      await onSave(toNum(weight) ?? initialWeight, toNum(reps) ?? initialReps, completed)
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
                onChange={(e) => setWeight(e.target.value)}
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
          <p className="hint muted">Type to replace the gray value, or leave it to keep it.</p>
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
