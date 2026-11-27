import { useState } from 'react'
import { db } from '../lib/db'
import { buildProgram, optionWarnings, parseProgramCsv, type ParseResult, type ProgramOptions } from '../lib/programCsv'
import { saveProgram } from '../lib/programs'
import { useScrollLock } from '../lib/useScrollLock'

const titleFromFile = (name: string) =>
  name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()

/** Upload a program CSV: pick a file, check it, choose options, save. */
export default function ProgramUpload({ onClose, onSaved }: { onClose: () => void; onSaved: (programId: string) => void }) {
  useScrollLock()
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [opts, setOpts] = useState<ProgramOptions>({ name: '', rotation: 'alternate', sessionsPerWeek: 3, endAction: 'restart', progression: 'double' })
  const [saving, setSaving] = useState<string>('')
  const [error, setError] = useState('')

  async function onFile(file: File | undefined) {
    setError('')
    if (!file) return
    const text = await file.text()
    const result = parseProgramCsv(text)
    setParsed(result)
    const labels = new Set(result.rows.map((r) => r.workout))
    setOpts((o) => ({ ...o, name: o.name || titleFromFile(file.name), rotation: labels.size > 1 ? 'alternate' : 'straight' }))
  }

  const rows = parsed?.rows ?? []
  const phases = [...new Set(rows.map((r) => r.phase))].sort((a, b) => a - b)
  const sessionsPerPhase = phases.map((p) => {
    const rs = rows.filter((r) => r.phase === p)
    const labels = new Set(rs.map((r) => r.workout)).size
    return opts.rotation === 'straight' ? labels : rs[0].weeks * opts.sessionsPerWeek
  })
  const totalSessions = sessionsPerPhase.reduce((a, b) => a + b, 0)
  const canSave = parsed && parsed.errors.length === 0 && rows.length > 0 && opts.name.trim() !== '' && !saving

  async function save() {
    if (!parsed) return
    setError('')
    try {
      const programs = await db.programs.toArray()
      const built = buildProgram(parsed.rows, { ...opts, name: opts.name.trim() }, {
        programIds: new Set(programs.map((p) => p.id)),
        exercises: await db.exercises.toArray(),
        nextSeq: Math.max(0, ...programs.filter((p) => p.track === 'supplemental').map((p) => p.seq)) + 1,
      })
      if (built.newExercises.length &&
        !window.confirm(`Add ${built.newExercises.length} new exercise${built.newExercises.length > 1 ? 's' : ''} to the library?\n\n${built.newExercises.map((e) => e.name).join('\n')}`)) {
        return
      }
      setSaving('Saving…')
      await saveProgram(built, (done, total) => setSaving(`Saving… ${Math.round((done / total) * 100)}%`))
      onSaved(built.program.id)
    } catch (e) {
      const status = (e as { status?: number }).status
      setError(
        status === 0 || status === undefined
          ? 'Couldn’t reach the server. Saving a program needs a connection; check Tailscale and try again.'
          : `The server refused the program (${status}). If you just updated the server, make sure the Phase 6 migration file was copied over.`,
      )
    } finally {
      setSaving('')
    }
  }

  const warnings = parsed ? [...parsed.warnings, ...optionWarnings(rows, opts)] : []

  return (
    <div className="sheet-backdrop" onClick={saving ? undefined : onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          <h3>Add a program</h3>
          <button onClick={onClose} disabled={!!saving}>
            Close
          </button>
        </div>

        <label className="file-pick">
          Program CSV
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <p className="muted small">
          One row per exercise: phase, phase_name, weeks, workout, order, exercise, sets, rep_min, rep_max, load_type,
          weight_jump, unilateral, form_cue, video_url.
        </p>

        {parsed && parsed.errors.length > 0 && (
          <div className="problems">
            <b>Fix these in the file and pick it again:</b>
            <ul>
              {parsed.errors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {parsed.errors.length > 20 && <li>…and {parsed.errors.length - 20} more</li>}
            </ul>
          </div>
        )}

        {parsed && parsed.errors.length === 0 && rows.length > 0 && (
          <>
            <div className="form-grid">
              <label>
                Name
                <input value={opts.name} onChange={(e) => setOpts({ ...opts, name: e.target.value })} />
              </label>
              <label>
                Rotation
                <select value={opts.rotation} onChange={(e) => setOpts({ ...opts, rotation: e.target.value as ProgramOptions['rotation'] })}>
                  <option value="alternate">Alternate workouts (A-B-A, B-A-B…)</option>
                  <option value="straight">Each workout once per phase</option>
                </select>
              </label>
              {opts.rotation === 'alternate' && (
                <label>
                  Sessions per week
                  <input
                    inputMode="numeric"
                    value={opts.sessionsPerWeek}
                    onChange={(e) => setOpts({ ...opts, sessionsPerWeek: Math.max(1, Math.min(7, Number(e.target.value) || 1)) })}
                  />
                </label>
              )}
              <label>
                At the end
                <select value={opts.endAction} onChange={(e) => setOpts({ ...opts, endAction: e.target.value as ProgramOptions['endAction'] })}>
                  <option value="restart">Restart at Phase 1</option>
                  <option value="stop">Stop</option>
                </select>
              </label>
              <label>
                Suggested weights
                <select value={opts.progression} onChange={(e) => setOpts({ ...opts, progression: e.target.value as ProgramOptions['progression'] })}>
                  <option value="double">Double progression (go up after hitting the top of the range)</option>
                  <option value="fixed">Fixed increase every session</option>
                  <option value="none">None (show last weight)</option>
                </select>
              </label>
            </div>

            <h4>Preview</h4>
            <ul className="preview-phases">
              {phases.map((p, i) => {
                const rs = rows.filter((r) => r.phase === p)
                const labels = [...new Set(rs.map((r) => r.workout))]
                return (
                  <li key={p}>
                    <b>
                      Phase {p}
                      {rs[0].phase_name ? `: ${rs[0].phase_name}` : ''}
                    </b>{' '}
                    <span className="muted">
                      · {rs[0].weeks} weeks · {sessionsPerPhase[i]} sessions
                    </span>
                    {labels.map((l) => (
                      <div key={l} className="muted small">
                        {l}: {rs.filter((r) => r.workout === l).sort((a, b) => a.order - b.order).map((r) => r.exercise).join(' · ')}
                      </div>
                    ))}
                  </li>
                )
              })}
            </ul>
            <p className="muted">
              {totalSessions} sessions in total, {rows.length} exercise slots.
            </p>
          </>
        )}

        {warnings.length > 0 && (
          <ul className="warnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {error && <p className="error">{error}</p>}

        <button className="primary finish" disabled={!canSave} onClick={() => void save()}>
          {saving || 'Save program'}
        </button>
      </div>
    </div>
  )
}
