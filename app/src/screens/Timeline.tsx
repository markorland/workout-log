import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import SupplementalPrograms from '../components/SupplementalPrograms'
import { db } from '../lib/db'
import type { Program, Workout } from '../lib/types'
import { useScrollLock } from '../lib/useScrollLock'
import { MAIN_TRACK_ID, setCurrentMain } from '../lib/workout'

type Status = 'done' | 'skipped' | 'in_progress' | 'not_started'
const MARK: Record<Status, string> = { done: '✓', skipped: '–', in_progress: '•', not_started: '' }
const LABEL: Record<Status, string> = { done: 'Done', skipped: 'Skipped', in_progress: 'In progress', not_started: '' }

/** Timeline tab: Main (the TrueCoach timeline) | Supplemental (side programs). */
export default function Timeline({
  onOpenToday,
  onOpenSupplemental,
}: {
  onOpenToday: () => void
  onOpenSupplemental: (workoutId: string) => void
}) {
  const [view, setView] = useState<'main' | 'supplemental'>('main')
  return (
    <div className="timeline">
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={view === 'main'} className={view === 'main' ? 'on' : ''} onClick={() => setView('main')}>
          Main
        </button>
        <button
          role="tab"
          aria-selected={view === 'supplemental'}
          className={view === 'supplemental' ? 'on' : ''}
          onClick={() => setView('supplemental')}
        >
          Supplemental
        </button>
      </div>
      {view === 'main' ? <MainTimeline onOpenToday={onOpenToday} /> : <SupplementalPrograms onOpenSupplemental={onOpenSupplemental} />}
    </div>
  )
}

function MainTimeline({ onOpenToday }: { onOpenToday: () => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Workout | null>(null)

  const data = useLiveQuery(async () => {
    const programs = (await db.programs.where('track').equals('main').toArray()).sort((a, b) => a.seq - b.seq)
    const workouts = (await db.workouts.toArray()).filter((w) => w.id.startsWith('main-')).sort((a, b) => a.seq - b.seq)
    const items = (await db.workout_items.toArray()).sort((a, b) => a.order - b.order)
    const exercises = new Map((await db.exercises.toArray()).map((e) => [e.id, e.name]))
    const names = new Map<string, string[]>()
    for (const it of items) {
      const list = names.get(it.workout) ?? []
      list.push(exercises.get(it.exercise) ?? it.raw_name)
      names.set(it.workout, list)
    }
    const status = new Map<string, Status>()
    for (const s of await db.sessions.toArray()) {
      if (s.deleted_at) continue
      const cur = status.get(s.workout)
      const st: Status = s.status === 'done' ? 'done' : s.status === 'skipped' ? 'skipped' : 'in_progress'
      // done beats skipped beats in progress
      const rank = { done: 3, skipped: 2, in_progress: 1, not_started: 0 }
      if (!cur || rank[st] > rank[cur]) status.set(s.workout, st)
    }
    const current = (await db.track_state.get(MAIN_TRACK_ID))?.current_workout
    return { programs, workouts, names, status, current }
  })

  const view = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.programs
      .map((p) => {
        const ws = data.workouts.filter((w) => w.program === p.id)
        const programHit = !q || p.name.toLowerCase().includes(q)
        const shown = programHit ? ws : ws.filter((w) => (data.names.get(w.id) ?? []).some((n) => n.toLowerCase().includes(q)))
        return { program: p, all: ws, shown }
      })
      .filter((g) => g.shown.length > 0)
  }, [data, query])

  // Open on the current program the first time the screen shows.
  const scrolled = useRef(false)
  useEffect(() => {
    if (!data || scrolled.current) return
    scrolled.current = true
    requestAnimationFrame(() => document.querySelector('.program-card.current')?.scrollIntoView({ block: 'start' }))
  }, [data])

  if (!data) return null
  const { names, status, current } = data
  const searching = query.trim() !== ''

  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpen(next)
  }

  const label = (w: Workout) => (w.week && w.day ? `W${w.week}D${w.day}` : w.title)
  const date = (w: Workout) => new Date(w.original_date.slice(0, 10) + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div>
      <div className="search-wrap">
        <input
          className="search"
          type="search"
          placeholder="Search programs or exercises"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
            ×
          </button>
        )}
      </div>
      {view.length === 0 && <p className="muted">No workouts match “{query}”.</p>}

      {view.map(({ program, all, shown }) => {
        const doneCount = all.filter((w) => status.get(w.id) === 'done').length
        const hasCurrent = all.some((w) => w.id === current)
        const isOpen = searching || open.has(program.id) || (open.size === 0 && hasCurrent)
        return (
          <article key={program.id} className={hasCurrent ? 'card program-card current' : 'card program-card'}>
            <button className="program-head" onClick={() => toggle(program.id)}>
              <div>
                <h2>{program.name}</h2>
                <div className="muted">
                  #{all[0].seq}–{all[all.length - 1].seq} · {all.length} workouts · {doneCount} done
                  {hasCurrent && ' · current'}
                </div>
              </div>
              <span className="chev">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <ul className="workout-list">
                {shown.map((w) => {
                  const st = status.get(w.id) ?? 'not_started'
                  return (
                    <li key={w.id}>
                      <button className={w.id === current ? 'workout-row is-current' : 'workout-row'} onClick={() => setPreview(w)}>
                        <span className={`mark ${st}`} title={LABEL[st]}>
                          {MARK[st]}
                        </span>
                        <span className="w-label">{label(w)}</span>
                        <span className="w-names muted">{(names.get(w.id) ?? []).slice(0, 3).join(' · ')}</span>
                        <span className="w-seq muted">#{w.seq}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </article>
        )
      })}

      {preview && (
        <WorkoutPreview
          workout={preview}
          program={data.programs.find((p) => p.id === preview.program)}
          status={status.get(preview.id) ?? 'not_started'}
          isCurrent={preview.id === current}
          date={date(preview)}
          label={label(preview)}
          onClose={() => setPreview(null)}
          onSetCurrent={async () => {
            await setCurrentMain(preview.id)
            setPreview(null)
            onOpenToday()
          }}
        />
      )}
    </div>
  )
}

function WorkoutPreview(props: {
  workout: Workout
  program: Program | undefined
  status: Status
  isCurrent: boolean
  date: string
  label: string
  onClose: () => void
  onSetCurrent: () => Promise<void>
}) {
  const { workout, program, status, isCurrent, date, label, onClose, onSetCurrent } = props
  useScrollLock()
  const items = useLiveQuery(async () => {
    const rows = (await db.workout_items.where('workout').equals(workout.id).toArray()).sort((a, b) => a.order - b.order)
    const names = new Map((await db.exercises.bulkGet(rows.map((r) => r.exercise))).filter(Boolean).map((e) => [e!.id, e!.name]))
    return rows.map((r) => ({ ...r, name: names.get(r.exercise) ?? r.raw_name }))
  }, [workout.id])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          <h3>
            {program?.name} · {label}
          </h3>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted">
          #{workout.seq} · originally {date}
          {status !== 'not_started' && ` · ${LABEL[status]}`}
        </p>
        <ul className="preview-items">
          {(items ?? []).map((it) => (
            <li key={it.id}>
              <span className="block-tag">{it.block}</span> <b>{it.name}</b>
              <div className="scheme">{it.prescription || it.raw_scheme.split('\n')[0]}</div>
            </li>
          ))}
        </ul>
        {isCurrent ? (
          <p className="muted">This is your current workout.</p>
        ) : (
          <button className="primary finish" onClick={() => void onSetCurrent()}>
            Set as current
          </button>
        )}
      </div>
    </div>
  )
}
