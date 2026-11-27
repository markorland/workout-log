import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { deleteProgram, ensureSupplementalTracks, restartProgram, setCurrentSupplemental, setProgramStatus, trackIdFor } from '../lib/programs'
import type { TrackState } from '../lib/types'
import ProgramUpload from './ProgramUpload'

const STATUS_LABEL: Record<TrackState['status'], string> = { active: 'Active', paused: 'Paused', archived: 'Archived' }
const RULE_LABEL: Record<string, string> = { double: 'Double progression', fixed: 'Fixed increase', none: 'No suggestions', '': 'No suggestions' }

/** Timeline → Supplemental: every supplemental program, its status and sessions. */
export default function SupplementalPrograms({ onOpenSupplemental }: { onOpenSupplemental: (workoutId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState('')

  // Writes can't happen inside a live query, so make missing tracks first.
  useEffect(() => {
    void ensureSupplementalTracks()
  }, [])

  const data = useLiveQuery(async () => {
    const programs = (await db.programs.where('track').equals('supplemental').toArray()).sort((a, b) => a.seq - b.seq)
    const out = []
    for (const p of programs) {
      const track = await db.track_state.get(trackIdFor(p.id))
      const workouts = (await db.workouts.where('program').equals(p.id).toArray()).sort((a, b) => a.seq - b.seq)
      const ids = new Set(workouts.map((w) => w.id))
      const done = new Set(
        (await db.sessions.toArray()).filter((s) => ids.has(s.workout) && s.status === 'done' && !s.deleted_at).map((s) => s.workout),
      )
      out.push({ program: p, track, workouts, done })
    }
    return out
  })

  const run = (key: string, fn: () => Promise<unknown>) => async () => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  if (!data) return null

  return (
    <div className="supplemental-list">
      <button className="primary finish" onClick={() => setUploading(true)}>
        + Add a program (CSV)
      </button>
      {data.length === 0 && <p className="muted">No supplemental programs yet.</p>}

      {data.map(({ program: p, track, workouts, done }) => {
        const status = track?.status ?? 'paused'
        const current = workouts.find((w) => w.id === track?.current_workout)
        const isOpen = open === p.id
        return (
          <article key={p.id} className={status === 'active' ? 'card program-card current' : 'card program-card'}>
            <button className="program-head" onClick={() => setOpen(isOpen ? null : p.id)}>
              <div>
                <h2>{p.name}</h2>
                <div className="muted">
                  {STATUS_LABEL[status]} · {workouts.length} sessions · {done.size} done
                  {track && track.round > 1 ? ` · Round ${track.round}` : ''}
                </div>
                {current && status !== 'archived' && <div className="small">Next: {current.title}</div>}
              </div>
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen && (
              <div className="program-body">
                <div className="muted small">
                  {RULE_LABEL[p.progression ?? ''] ?? p.progression}
                  {p.end_action === 'stop' ? ' · stops at the end' : ' · restarts at Phase 1 at the end'}
                </div>
                <div className="row-actions">
                  {status === 'active' && current && (
                    <button className="primary" onClick={() => onOpenSupplemental(current.id)}>
                      Open next session
                    </button>
                  )}
                  {status !== 'active' && (
                    <button disabled={!!busy} onClick={run('on', () => setProgramStatus(p.id, 'active'))}>
                      {status === 'archived' ? 'Unarchive' : 'Make active'}
                    </button>
                  )}
                  {status === 'active' && (
                    <button disabled={!!busy} onClick={run('pause', () => setProgramStatus(p.id, 'paused'))}>
                      Pause
                    </button>
                  )}
                  {status !== 'archived' && (
                    <button disabled={!!busy} onClick={run('arch', () => setProgramStatus(p.id, 'archived'))}>
                      Archive
                    </button>
                  )}
                  <button
                    disabled={!!busy}
                    onClick={run('restart', async () => {
                      if (window.confirm(`Restart ${p.name} at Phase 1? This starts round ${(track?.round ?? 1) + 1}.`)) await restartProgram(p.id)
                    })}
                  >
                    Restart at Phase 1
                  </button>
                  {p.id.startsWith('sup-') && (
                    <button
                      className="danger-text"
                      disabled={!!busy}
                      onClick={run('del', async () => {
                        if (!window.confirm(`Delete ${p.name}? Its sessions are removed from the server. Logged sets stay in History.`)) return
                        await deleteProgram(p.id)
                      })}
                    >
                      Delete
                    </button>
                  )}
                </div>

                <ul className="workout-list">
                  {workouts.map((w) => (
                    <li key={w.id}>
                      <button
                        className={w.id === track?.current_workout ? 'workout-row is-current' : 'workout-row'}
                        onClick={async () => {
                          if (w.id === track?.current_workout) return
                          if (window.confirm(`Set "${w.title}" as the next session?`)) await setCurrentSupplemental(w.id)
                        }}
                      >
                        <span className={`mark ${done.has(w.id) ? 'done' : 'not_started'}`}>{done.has(w.id) ? '✓' : ''}</span>
                        <span className="w-label">{w.label || w.seq}</span>
                        <span className="w-names muted">{w.title}</span>
                        <span className="w-seq muted">#{w.seq}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        )
      })}

      {uploading && (
        <ProgramUpload
          onClose={() => setUploading(false)}
          onSaved={(id) => {
            setUploading(false)
            setOpen(id)
          }}
        />
      )}
    </div>
  )
}
