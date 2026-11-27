import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import LineChart from '../components/LineChart'
import MeasurementImport from '../components/MeasurementImport'
import Photos from '../components/Photos'
import { allSeries, bodyParts, latestValues, measurementCsv, saveMeasurements, addCustomPart, type Entry } from '../lib/body'
import { fmtDay } from '../lib/dates'
import { today } from '../lib/db'
import { shareOrDownload } from '../lib/exportData'
import { fmtLb } from '../lib/targets'
import type { BodyPart, BodyUnit } from '../lib/types'

type View = 'measure' | 'charts' | 'photos'

export default function Body() {
  const [view, setView] = useState<View>('measure')

  return (
    <div className="body-screen">
      <div className="segmented three" role="tablist">
        {(
          [
            ['measure', 'Measure'],
            ['charts', 'Charts'],
            ['photos', 'Photos'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'measure' && <MeasureForm />}
      {view === 'charts' && <BodyCharts />}
      {view === 'photos' && <Photos />}
    </div>
  )
}

/** Quick entry: every site head to toe, last value in gray; fill what you measured. */
function MeasureForm() {
  const parts = useLiveQuery(() => bodyParts()) ?? []
  const latest = useLiveQuery(() => latestValues()) ?? new Map()
  const [day, setDay] = useState(today())
  const [values, setValues] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState('')
  const [importing, setImporting] = useState(false)
  const [adding, setAdding] = useState(false)

  type Field = { part: BodyPart; side: '' | 'left' | 'right' }
  const fields = parts.flatMap<Field>((p) =>
    p.has_side ? [{ part: p, side: 'left' }, { part: p, side: 'right' }] : [{ part: p, side: '' }],
  )
  const keyOf = (p: BodyPart, side: string) => `${p.id}|${side}`
  const filled = fields.filter((f) => (values[keyOf(f.part, f.side)] ?? '').trim() !== '')

  async function save() {
    const entries: Entry[] = []
    for (const f of filled) {
      const v = Number(values[keyOf(f.part, f.side)].replace(',', '.'))
      if (!Number.isNaN(v) && v > 0) entries.push({ part: f.part, side: f.side, value: v })
    }
    if (!entries.length) return
    await saveMeasurements(day, entries, 'manual', notes.trim())
    setValues({})
    setNotes('')
    setSaved(`Saved ${entries.length} measurement${entries.length > 1 ? 's' : ''} for ${fmtDay(day)}.`)
    setTimeout(() => setSaved(''), 4000)
  }

  return (
    <div>
      <article className="card">
        <div className="row-between">
          <h2>Check-in</h2>
          <input type="date" className="date-input" value={day} max={today()} onChange={(e) => setDay(e.target.value || today())} />
        </div>
        <p className="muted small">Fill in what you measured; leave the rest blank. Gray numbers are your last values.</p>
        <div className="measure-list">
          {parts.map((p) => (
            <div key={p.id} className="measure-row">
              <span className="measure-label">{p.label}</span>
              <div className={p.has_side ? 'measure-inputs two' : 'measure-inputs'}>
                {(p.has_side ? (['left', 'right'] as const) : ([''] as const)).map((side) => {
                  const last = latest.get(keyOf(p, side))
                  return (
                    <label key={side} className="measure-input">
                      {side && <span className="side-tag">{side === 'left' ? 'L' : 'R'}</span>}
                      <input
                        inputMode="decimal"
                        placeholder={last ? fmtLb(last.value) : '—'}
                        value={values[keyOf(p, side)] ?? ''}
                        onChange={(e) => setValues({ ...values, [keyOf(p, side)]: e.target.value })}
                      />
                      <span className="unit">{p.unit}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. morning, before eating" />
        </label>
        <button className="primary finish" disabled={!filled.length} onClick={() => void save()}>
          Save {filled.length ? `${filled.length} measurement${filled.length > 1 ? 's' : ''}` : ''}
        </button>
        {saved && <p className="saved">{saved}</p>}
      </article>

      <div className="row-actions">
        <button onClick={() => setAdding(true)}>+ Add a site</button>
        <button onClick={() => setImporting(true)}>Import CSV</button>
        <button onClick={() => void measurementCsv().then((csv) => shareOrDownload(csv, `workout-log-measurements-${today()}.csv`, 'text/csv'))}>
          Export CSV
        </button>
      </div>

      {adding && <AddSite onClose={() => setAdding(false)} />}
      {importing && <MeasurementImport onClose={() => setImporting(false)} />}
    </div>
  )
}

function AddSite({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('')
  const [sided, setSided] = useState(false)
  const [unit, setUnit] = useState<BodyUnit>('in')
  return (
    <div className="sheet-backdrop top" onClick={onClose}>
      <div className="sheet dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Add a site</h3>
        <div className="form-grid">
          <label>
            Name
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Glutes" />
          </label>
          <label className="check-label">
            <input type="checkbox" checked={sided} onChange={(e) => setSided(e.target.checked)} /> Measured on left and right
          </label>
          <label>
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as BodyUnit)}>
              <option value="in">inches</option>
              <option value="lb">pounds</option>
              <option value="%">percent</option>
            </select>
          </label>
        </div>
        <div className="sheet-actions two">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!label.trim()}
            onClick={async () => {
              await addCustomPart(label, sided, unit)
              onClose()
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

/** One chart per part and side, head to toe, with change since the first value. */
function BodyCharts() {
  const series = useLiveQuery(() => allSeries())
  if (!series) return null
  if (!series.length) return <p className="muted">No measurements yet. Add a check-in under Measure.</p>
  return (
    <div>
      {series.map((s) => {
        const first = s.points[0]
        const last = s.points[s.points.length - 1]
        const change = Math.round((last.value - first.value) * 100) / 100
        return (
          <article key={`${s.part.id}|${s.side}`} className="card">
            <div className="row-between">
              <h2>{s.title}</h2>
              <div className="lift-value small-value">
                {fmtLb(last.value)} {last.unit}
              </div>
            </div>
            {s.points.length === 1 ? (
              <div className="change">One measurement so far ({fmtDay(first.date)}). The chart starts with the second.</div>
            ) : (
              <div className={change > 0 ? 'change up' : change < 0 ? 'change down' : 'change'}>
                {change > 0 ? '+' : ''}
                {fmtLb(change)} {last.unit} since {fmtDay(first.date)}
              </div>
            )}
            {s.points.length > 1 && <LineChart
              label={s.title}
              unit={last.unit}
              minSpan={last.unit === 'lb' ? 5 : 1}
              points={s.points.map((m) => ({
                t: Date.parse(m.date.slice(0, 10) + 'T12:00:00'),
                v: m.value,
                readout: `${fmtLb(m.value)} ${m.unit} · ${fmtDay(m.date)}`,
                axisLabel: fmtDay(m.date, { month: 'short', day: 'numeric', year: '2-digit' }),
              }))}
            />}
          </article>
        )
      })}
    </div>
  )
}
