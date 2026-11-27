import { useState } from 'react'
import { importMeasurements, previewMeasurementCsv, type ImportPreview } from '../lib/body'
import { fmtDay } from '../lib/dates'
import { fmtLb } from '../lib/targets'
import { useScrollLock } from '../lib/useScrollLock'

/** Measurement CSV import: pick a file, check the preview, confirm, import. */
export default function MeasurementImport({ onClose }: { onClose: () => void }) {
  useScrollLock()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [done, setDone] = useState('')

  const rows = preview?.rows ?? []
  const newParts = [...new Set(rows.filter((r) => r.newPart).map((r) => r.partLabel))]
  const splits = rows.filter((r) => r.splitFrom)
  const converted = rows.filter((r) => r.converted)
  const dupes = rows.filter((r) => r.duplicate)
  const days = rows.map((r) => r.day).sort()
  const firstDay = days[0] ?? ''
  const lastDay = days[days.length - 1] ?? ''

  async function run() {
    const r = await importMeasurements(rows, overwrite)
    setDone(`Imported ${r.added} measurement${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} already logged` : ''}.`)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          <h3>Import measurements</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <label className="file-pick">
          Measurements CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              setDone('')
              setPreview(f ? await previewMeasurementCsv(await f.text()) : null)
            }}
          />
        </label>
        <p className="muted small">One measurement per row: date, body_part, side, value, unit, notes. Only date, body_part and value are required.</p>

        {preview && preview.errors.length > 0 && (
          <div className="problems">
            <b>Fix these in the file and pick it again:</b>
            <ul>
              {preview.errors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {preview && preview.errors.length === 0 && rows.length > 0 && !done && (
          <>
            <p>
              <b>{rows.length}</b> measurement{rows.length > 1 ? 's' : ''}{' '}
              {firstDay === lastDay ? `on ${fmtDay(firstDay)}` : `from ${fmtDay(firstDay)} to ${fmtDay(lastDay)}`}.
            </p>
            {newParts.length > 0 && (
              <div className="confirm-box">
                <b>New sites</b> (added as custom sites): {newParts.join(', ')}
              </div>
            )}
            {splits.length > 0 && (
              <div className="confirm-box">
                <b>Side split out of the name:</b>
                <ul>
                  {[...new Set(splits.map((r) => `${r.splitFrom} → ${r.partLabel} + ${r.side}`))].map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {converted.length > 0 && (
              <div className="muted small">
                Converted: {converted.slice(0, 3).map((r) => r.converted).join('; ')}
                {converted.length > 3 ? ` and ${converted.length - 3} more` : ''}
              </div>
            )}
            {dupes.length > 0 && (
              <label className="check-label">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                {dupes.length} already logged for the same day and site. Overwrite them (otherwise they're skipped)
              </label>
            )}
            <ul className="import-preview">
              {rows.slice(0, 8).map((r) => (
                <li key={r.line}>
                  {fmtDay(r.day)} · {r.side ? `${r.side[0].toUpperCase()}${r.side.slice(1)} ` : ''}
                  {r.partLabel}: <b>{fmtLb(r.value)} {r.unit}</b>
                  {r.duplicate && <span className="muted"> (already logged)</span>}
                </li>
              ))}
              {rows.length > 8 && <li className="muted">…and {rows.length - 8} more</li>}
            </ul>
            <button className="primary finish" onClick={() => void run()}>
              Import {rows.length - (overwrite ? 0 : dupes.length)} measurement{rows.length - (overwrite ? 0 : dupes.length) === 1 ? '' : 's'}
            </button>
          </>
        )}
        {done && <p className="saved">{done}</p>}
      </div>
    </div>
  )
}
