import { useState } from 'react'
import { fmtLb } from '../lib/targets'

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

/** Long-press editor: type the weight (any value, decimal keypad) and reps. */
export default function SetEditor({ title, initialWeight, initialReps, onSave, onCancel }: Props) {
  const [weight, setWeight] = useState(fmtLb(initialWeight))
  const [reps, setReps] = useState(initialReps === null ? '' : String(initialReps))
  const [busy, setBusy] = useState(false)

  async function save(completed: boolean) {
    setBusy(true)
    try {
      await onSave(toNum(weight), toNum(reps), completed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="fields">
          <label>
            Weight (lb)
            <input inputMode="decimal" autoFocus value={weight} onChange={(e) => setWeight(e.target.value)} />
          </label>
          <label>
            Reps
            <input inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
          </label>
        </div>
        <div className="sheet-actions">
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button onClick={() => void save(false)} disabled={busy}>
            Not done
          </button>
          <button className="primary" onClick={() => void save(true)} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
