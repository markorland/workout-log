import { useState } from 'react'
import { notNowTest, skipTest, startTest } from '../lib/workout'

/** Shown at a program boundary when a test is due (docs/Plan.md, "Testing"). */
export default function TestDueCard({ dueDate }: { dueDate: string | null }) {
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card test-due">
      <h2>Test due</h2>
      <p className="muted">
        It’s been 3 months{dueDate ? ` (due ${new Date(dueDate + 'T12:00').toLocaleDateString()})` : ''}. MAX WEEK is two
        days: Snatch + Front Squat, then Clean &amp; Jerk + Back Squat. Any max you beat is updated automatically; your
        place in the program stays put.
      </p>
      <div className="row-actions">
        <button className="primary" disabled={busy} onClick={run(startTest)}>
          Start test
        </button>
        <button
          disabled={busy}
          onClick={run(async () => {
            if (window.confirm('Skip this test? The next one will be due in 3 months.')) await skipTest()
          })}
        >
          Skip
        </button>
        <button disabled={busy} onClick={run(notNowTest)}>
          Not now
        </button>
      </div>
    </article>
  )
}
