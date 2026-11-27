import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { measurementsOn } from '../lib/body'
import { fmtDay } from '../lib/dates'
import { today } from '../lib/db'
import { addPhoto, deletePhoto, listPhotos, photoUrl, POSES, thumbSrc } from '../lib/photos'
import { checkAndSync } from '../lib/sync'
import { fmtLb } from '../lib/targets'
import type { ProgressPhoto, QueuedPhoto } from '../lib/types'
import { useScrollLock } from '../lib/useScrollLock'

type AnyPhoto = ProgressPhoto | (QueuedPhoto & { queued: true })
const isQueued = (p: AnyPhoto): p is QueuedPhoto & { queued: true } => 'queued' in p

/** Photos tab: add, browse by pose, view full size, compare two dates. */
export default function Photos() {
  const photos = useLiveQuery(() => listPhotos()) ?? []
  const [pose, setPose] = useState<string>('all')
  const [adding, setAdding] = useState<File | null>(null)
  const [viewing, setViewing] = useState<AnyPhoto | null>(null)
  const [comparing, setComparing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const poses = [...new Set([...POSES, ...photos.map((p) => p.pose)])]
  const shown = pose === 'all' ? photos : photos.filter((p) => p.pose === pose)
  const waiting = photos.filter(isQueued).length

  return (
    <div>
      <div className="row-actions">
        <button className="primary" onClick={() => fileRef.current?.click()}>
          + Add photo
        </button>
        <button disabled={photos.length < 2} onClick={() => setComparing(true)}>
          Compare
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) setAdding(f)
            e.target.value = ''
          }}
        />
      </div>
      {waiting > 0 && (
        <p className="muted small">
          {waiting} photo{waiting > 1 ? 's' : ''} waiting to upload; they go up the next time the server is reachable.
        </p>
      )}

      <div className="chip-filter">
        {['all', ...poses].map((p) => (
          <button key={p} className={pose === p ? 'filter on' : 'filter'} onClick={() => setPose(p)}>
            {p === 'all' ? 'All' : p}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">No photos yet.</p>
      ) : (
        <div className="photo-grid">
          {shown.map((p) => (
            <button key={p.id} className="photo-cell" onClick={() => setViewing(p)}>
              <Thumb photo={p} />
              <span className="photo-caption">
                {fmtDay(p.date, { month: 'short', day: 'numeric', year: '2-digit' })} · {p.pose}
                {isQueued(p) ? ' · waiting' : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {adding && <AddPhoto file={adding} onClose={() => setAdding(null)} />}
      {viewing && <PhotoView photo={viewing} onClose={() => setViewing(null)} />}
      {comparing && <Compare photos={photos} poses={poses} onClose={() => setComparing(false)} />}
    </div>
  )
}

function Thumb({ photo }: { photo: AnyPhoto }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let alive = true
    void thumbSrc(photo).then((u) => {
      url = u
      if (alive) setSrc(u)
    })
    return () => {
      alive = false
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id])
  return src ? <img src={src} alt="" className="thumb" /> : <div className="thumb placeholder">Offline</div>
}

/** Full image (needs a connection; never cached). Waiting photos show from the phone. */
function FullImage({ photo }: { photo: AnyPhoto }) {
  // A waiting photo is still on the phone: show it straight from there.
  const local = useMemo(() => (isQueued(photo) ? URL.createObjectURL(photo.image) : null), [photo])
  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local)
  }, [local])
  const [remote, setRemote] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!isQueued(photo)) photoUrl(photo, 'image').then(setRemote, () => setFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id])
  const src = local ?? remote
  if (failed) return <div className="full placeholder">Full-size photos need a connection to the server.</div>
  return src ? <img src={src} alt="" className="full" onError={() => setFailed(true)} /> : <div className="full placeholder">Loading…</div>
}

function DayMeasurements({ day }: { day: string }) {
  const rows = useLiveQuery(() => measurementsOn(day), [day]) ?? []
  if (!rows.length) return <p className="muted small">No measurements that day.</p>
  return (
    <ul className="day-measures">
      {rows.map((r) => (
        <li key={r.title}>
          {r.title}: <b>{fmtLb(r.value)} {r.unit}</b>
        </li>
      ))}
    </ul>
  )
}

function AddPhoto({ file, onClose }: { file: File; onClose: () => void }) {
  useScrollLock()
  const [day, setDay] = useState(today())
  const [pose, setPose] = useState<string>('front')
  const [custom, setCustom] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview] = useState(() => URL.createObjectURL(file))
  useEffect(() => () => URL.revokeObjectURL(preview), [preview])

  async function save() {
    setBusy(true)
    try {
      await addPhoto(file, day, pose === 'custom' ? custom.trim() || 'other' : pose, notes.trim())
      void checkAndSync({ resetRetries: true })
      onClose()
    } catch (e) {
      window.alert(`Couldn't add the photo: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          <h3>Add photo</h3>
          <button onClick={onClose}>Cancel</button>
        </div>
        <img src={preview} alt="" className="full" />
        <div className="form-grid">
          <label>
            Date
            <input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value || today())} />
          </label>
          <label>
            Pose
            <select value={pose} onChange={(e) => setPose(e.target.value)}>
              {POSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="custom">other…</option>
            </select>
          </label>
          {pose === 'custom' && (
            <label>
              Pose name
              <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. lat spread" />
            </label>
          )}
          <label>
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <p className="muted small">Resized to about 2,000 px and re-saved as JPEG on the phone, which also removes location data.</p>
        <button className="primary finish" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save photo'}
        </button>
      </div>
    </div>
  )
}

function PhotoView({ photo, onClose }: { photo: AnyPhoto; onClose: () => void }) {
  useScrollLock()
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          <h3>
            {fmtDay(photo.date)} · {photo.pose}
          </h3>
          <button onClick={onClose}>Close</button>
        </div>
        <FullImage photo={photo} />
        {photo.notes && <p>{photo.notes}</p>}
        <DayMeasurements day={photo.date.slice(0, 10)} />
        <button
          className="danger"
          onClick={async () => {
            if (!window.confirm('Delete this photo?')) return
            await deletePhoto(photo.id)
            void checkAndSync({ resetRetries: true })
            onClose()
          }}
        >
          Delete photo
        </button>
      </div>
    </div>
  )
}

/** Pick a pose and two dates: side by side (default) or a slider overlay. */
function Compare({ photos, poses, onClose }: { photos: AnyPhoto[]; poses: string[]; onClose: () => void }) {
  useScrollLock()
  const withPhotos = poses.filter((p) => photos.filter((x) => x.pose === p).length >= 1)
  const [pose, setPose] = useState(withPhotos.find((p) => photos.filter((x) => x.pose === p).length >= 2) ?? withPhotos[0] ?? 'front')
  const list = photos.filter((p) => p.pose === pose) // newest first
  const [aId, setA] = useState<string>('')
  const [bId, setB] = useState<string>('')
  const [mode, setMode] = useState<'side' | 'slider'>('side')
  const [split, setSplit] = useState(50)
  const before = list.find((p) => p.id === aId) ?? list[list.length - 1]
  const after = list.find((p) => p.id === bId) ?? list[0]

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet tall" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          <h3>Compare</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="form-grid compare-pick">
          <label>
            Pose
            <select
              value={pose}
              onChange={(e) => {
                setPose(e.target.value)
                setA('')
                setB('')
              }}
            >
              {withPhotos.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Before
            <select value={before?.id ?? ''} onChange={(e) => setA(e.target.value)}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {fmtDay(p.date, { month: 'short', day: 'numeric', year: '2-digit' })}
                </option>
              ))}
            </select>
          </label>
          <label>
            After
            <select value={after?.id ?? ''} onChange={(e) => setB(e.target.value)}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {fmtDay(p.date, { month: 'short', day: 'numeric', year: '2-digit' })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="segmented">
          <button className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}>
            Side by side
          </button>
          <button className={mode === 'slider' ? 'on' : ''} onClick={() => setMode('slider')}>
            Slider
          </button>
        </div>

        {!before || !after ? (
          <p className="muted">Need at least one photo of this pose.</p>
        ) : mode === 'side' ? (
          <div className="compare-side">
            {[before, after].map((p, i) => (
              <div key={i}>
                <FullImage photo={p} />
                <div className="small">
                  <b>{fmtDay(p.date)}</b>
                </div>
                <DayMeasurements day={p.date.slice(0, 10)} />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className="compare-slider">
              <FullImage photo={before} />
              <div className="compare-top" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
                <FullImage photo={after} />
              </div>
              <div className="compare-divider" style={{ left: `${split}%` }} />
            </div>
            <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="compare-range" />
            <div className="row-between small">
              <span>{fmtDay(before.date)}</span>
              <span>{fmtDay(after.date)}</span>
            </div>
            <div className="compare-side">
              <DayMeasurements day={before.date.slice(0, 10)} />
              <DayMeasurements day={after.date.slice(0, 10)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
