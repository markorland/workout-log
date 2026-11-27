import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { plannedSlots, repsLabel } from '../lib/slots'
import { fmtWhen } from '../lib/dates'
import { fmtLb, oneRepMaxOn, targetWeight } from '../lib/targets'
import { today } from '../lib/db'
import { liftName, type Exercise, type OneRepMax, type SetLog, type Settings, type WorkoutItem } from '../lib/types'
import { lastLogged, saveSet, type SetSlot } from '../lib/workout'
import ExerciseHistory from './ExerciseHistory'
import SetEditor from './SetEditor'

type PlateSettings = Pick<Settings, 'bar_weight_lb' | 'fractional_plates'>

interface Props {
  item: WorkoutItem
  exercise: Exercise | undefined
  workoutId: string
  sessionId: string | undefined
  logs: SetLog[]
  maxes: OneRepMax[]
  settings: PlateSettings
  onGoToLifts: () => void
}

export default function ExerciseCard({ item, exercise, workoutId, sessionId, logs, maxes, settings, onGoToLifts }: Props) {
  const [showNotes, setShowNotes] = useState(false)
  const [added, setAdded] = useState(0)
  const [editing, setEditing] = useState<SetSlot | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const last = useLiveQuery(() => lastLogged(item.exercise, sessionId), [item.exercise, sessionId])

  const lift = item.base_lift_override || exercise?.base_lift || ''
  const orm = lift ? oneRepMaxOn(maxes, lift, today()) : undefined
  const usesPct = (item.planned_sets ?? []).some((p) => p.pct !== undefined)

  const plannedCount = plannedSlots(item).length
  const loggedBeyond = Math.max(0, ...logs.map((l) => l.set_index)) - (item.planned_sets?.length || item.set_count || 0)
  const extra = Math.max(added, loggedBeyond)
  const slots = plannedSlots(item, extra)
  const canAdd = item.open_ended || item.scheme_type === 'max_attempt' || item.scheme_type === 'text' || plannedCount === 0

  const logFor = (s: SetSlot) => logs.find((l) => l.set_index === s.setIndex && l.side === s.side)

  /**
   * Suggested weight for a slot: % of the 1RM; otherwise the set you just did
   * in this workout; otherwise last time's weight for that set.
   */
  function suggested(s: SetSlot): { weight: number | null; fromPct: boolean } {
    if (s.planned?.pct !== undefined && orm) return { weight: targetWeight(s.planned.pct, orm.weight_lb, settings), fromPct: true }
    const earlier = logs
      .filter((l) => l.completed && l.weight_lb !== null && (l.set_index < s.setIndex || (l.set_index === s.setIndex && l.side !== s.side)))
      .sort((a, b) => b.set_index - a.set_index || (a.local_updated < b.local_updated ? 1 : -1))[0]
    if (earlier) return { weight: earlier.weight_lb, fromPct: false }
    const prev = last?.sets.find((x) => x.set_index === s.setIndex && x.side === s.side) ?? last?.sets[last.sets.length - 1]
    return { weight: prev?.weight_lb ?? null, fromPct: false }
  }

  async function tap(s: SetSlot) {
    const existing = logFor(s)
    if (existing?.completed) {
      await saveSet(workoutId, s, { weight_lb: existing.weight_lb, actual_reps: existing.actual_reps, completed: false })
      return
    }
    const { weight } = suggested(s)
    const reps = existing?.actual_reps ?? s.planned?.reps ?? s.planned?.seconds ?? null
    const w = existing?.weight_lb ?? weight
    const needsWeight = exercise?.load_type === 'weight' || exercise?.load_type === undefined
    if ((w === null && needsWeight) || reps === null) {
      setEditing(s)
      return
    }
    await saveSet(workoutId, s, { weight_lb: w, actual_reps: reps, completed: true })
  }

  const top = last?.sets.reduce<SetLog | null>((a, b) => (!a || (b.weight_lb ?? 0) > (a.weight_lb ?? 0) ? b : a), null)

  return (
    <article className="card">
      <header className="card-head">
        <span className="block-tag">{item.block}</span>
        <h2>
          <button className="name-link" onClick={() => setShowHistory(true)}>
            {exercise?.name ?? item.raw_name}
          </button>
        </h2>
      </header>
      <div className="scheme">{item.prescription || item.raw_scheme}</div>

      {lift && usesPct && (
        <div className="meta">
          {orm ? (
            <>
              of {liftName(lift)} 1RM <b>{fmtLb(orm.weight_lb)} lb</b>
            </>
          ) : (
            <button className="link" onClick={onGoToLifts}>
              Set a {liftName(lift)} 1RM for targets
            </button>
          )}
        </div>
      )}
      {top && (
        <div className="meta">
          Last: {top.weight_lb === null ? 'BW' : `${fmtLb(top.weight_lb)} lb`} × {top.actual_reps},{' '}
          {fmtWhen(last!.date, { day: 'numeric', month: 'short' })}
          {last!.sets.length > 1 && (
            <span className="muted"> ({last!.sets.map((x) => `${x.weight_lb === null ? 'BW' : fmtLb(x.weight_lb)}×${x.actual_reps}`).join(', ')})</span>
          )}
        </div>
      )}

      {item.notes && (
        <button className="notes-toggle" onClick={() => setShowNotes(!showNotes)}>
          {showNotes ? 'Hide notes' : 'Coach notes'}
        </button>
      )}
      {showNotes && <pre className="notes">{item.notes}</pre>}

      {slots.length > 0 && (
        <ul className="sets">
          {slots.map((s) => (
            <SetRow
              key={`${s.setIndex}-${s.side}`}
              slot={s}
              log={logFor(s)}
              suggestion={suggested(s)}
              bodyweight={exercise?.load_type === 'bodyweight'}
              onTap={() => void tap(s)}
              onLongPress={() => setEditing(s)}
            />
          ))}
        </ul>
      )}
      {canAdd && (
        <button className="add-set" onClick={() => setAdded(extra + 1)}>
          + {item.scheme_type === 'max_attempt' || item.open_ended ? 'Attempt' : 'Set'}
        </button>
      )}

      {showHistory && (
        <ExerciseHistory
          exerciseId={item.exercise}
          title={exercise?.name ?? item.raw_name}
          lift={lift || undefined}
          onClose={() => setShowHistory(false)}
        />
      )}
      {editing && (
        <SetEditor
          title={`${exercise?.name ?? item.raw_name} · set ${editing.setIndex}${editing.side ? ` (${editing.side})` : ''}`}
          initialWeight={logFor(editing)?.weight_lb ?? suggested(editing).weight}
          initialReps={logFor(editing)?.actual_reps ?? editing.planned?.reps ?? editing.planned?.seconds ?? null}
          onCancel={() => setEditing(null)}
          onSave={async (weight, reps, completed) => {
            await saveSet(workoutId, editing, { weight_lb: weight, actual_reps: reps, completed })
            setEditing(null)
          }}
        />
      )}
    </article>
  )
}

function SetRow({
  slot,
  log,
  suggestion,
  bodyweight,
  onTap,
  onLongPress,
}: {
  slot: SetSlot
  log: SetLog | undefined
  suggestion: { weight: number | null; fromPct: boolean }
  bodyweight: boolean
  onTap: () => void
  onLongPress: () => void
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const start = () => {
    longPressed.current = false
    timer.current = setTimeout(() => {
      longPressed.current = true
      onLongPress()
    }, 500)
  }
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const done = !!log?.completed
  const weight = done ? log!.weight_lb : (log?.weight_lb ?? suggestion.weight)
  const reps = done ? String(log!.actual_reps ?? '') : repsLabel(slot.planned)
  const pct = slot.planned?.pct

  return (
    <li>
      <button
        className={done ? 'set done' : 'set'}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (!longPressed.current) onTap()
        }}
      >
        <span className="set-n">
          {slot.setIndex}
          {slot.side && <small>{slot.side === 'left' ? 'L' : 'R'}</small>}
        </span>
        <span className="set-pct">{pct !== undefined ? `${pct}%` : ''}</span>
        <span className={done || suggestion.fromPct ? 'set-w' : 'set-w muted'}>
          {weight !== null && weight !== undefined ? `${fmtLb(weight)} lb` : bodyweight ? 'BW' : '—'}
        </span>
        <span className="set-r">{reps ? `× ${reps}` : ''}</span>
        <span className="check" aria-label={done ? 'done' : 'not done'}>
          {done ? '✓' : ''}
        </span>
      </button>
    </li>
  )
}
