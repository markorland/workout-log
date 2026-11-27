import { useLiveQuery } from 'dexie-react-hooks'
import { scrollToTop } from '../lib/scroll'
import { useEffect, useState } from 'react'
import { useSyncStatus } from '../lib/useSyncStatus'
import History from './History'
import { db, getMeta } from '../lib/db'
import { pb, signedInEmail, signOut } from '../lib/pb'
import { checkAndSync, pullTemplates } from '../lib/sync'
import { buildCsv, buildJson, exportName, shareOrDownload } from '../lib/exportData'
import { fmtLb } from '../lib/targets'

export default function SettingsScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const s = useSyncStatus()
  const settings = useLiveQuery(() => db.settings.get('settings'))
  const templatesAt = useLiveQuery(() => getMeta('templatesAt'))
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted)
  }, [])

  async function refreshTemplates() {
    setBusy('templates')
    try {
      await pullTemplates()
    } catch (e) {
      window.alert(`Couldn't download workouts: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy('')
    }
  }

  async function doExport(kind: 'csv' | 'json') {
    setBusy(kind)
    try {
      if (kind === 'csv') await shareOrDownload(await buildCsv(), exportName('csv'), 'text/csv')
      else await shareOrDownload(await buildJson(), exportName('json'), 'application/json')
    } catch (e) {
      window.alert(`Export failed: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy('')
    }
  }

  function doSignOut() {
    if (s.pending > 0 && !window.confirm(`${s.pending} change(s) haven't synced yet and stay on this phone. Sign out anyway?`)) return
    signOut()
    onSignedOut()
  }

  const plates = settings
    ? Object.entries(settings.fractional_plates)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([w, n]) => `${n} × ${w} lb`)
        .join(', ')
    : ''

  if (showHistory) {
    return (
      <div>
        <button
          className="back-link"
          onClick={() => {
            setShowHistory(false)
            scrollToTop()
          }}
        >
          ‹ Settings
        </button>
        <History />
      </div>
    )
  }

  return (
    <div className="settings">
      <h1>Settings</h1>

      <button
        className="card nav-row"
        onClick={() => {
          setShowHistory(true)
          scrollToTop()
        }}
      >
        <span>
          <b>Workout history</b>
          <span className="muted small"> · past sessions and what you logged</span>
        </span>
        <span className="chev">›</span>
      </button>

      <article className="card">
        <h2>Sync</h2>
        <dl>
          <dt>Signed in as</dt>
          <dd>{signedInEmail()}</dd>
          <dt>Server</dt>
          <dd className="mono">{pb().baseURL}</dd>
          <dt>Last sync</dt>
          <dd>{s.lastSync ? new Date(s.lastSync).toLocaleString() : 'Not yet this session'}</dd>
          <dt>Waiting to sync</dt>
          <dd>{s.pending}</dd>
          {s.message && (
            <>
              <dt>Last error</dt>
              <dd className="error">{s.message}</dd>
            </>
          )}
          <dt>Workouts downloaded</dt>
          <dd>{templatesAt ? new Date(templatesAt).toLocaleString() : 'Not yet'}</dd>
          <dt>Offline storage</dt>
          <dd>{persisted === null ? '…' : persisted ? 'Kept (won’t be cleared by iOS)' : 'Best effort'}</dd>
        </dl>
        <div className="row-actions">
          <button onClick={() => void checkAndSync({ resetRetries: true })}>Sync now</button>
          <button disabled={busy === 'templates'} onClick={() => void refreshTemplates()}>
            {busy === 'templates' ? 'Downloading…' : 'Re-download workouts'}
          </button>
        </div>
      </article>

      <article className="card">
        <h2>Bar and plates</h2>
        <dl>
          <dt>Bar</dt>
          <dd>{settings ? `${fmtLb(settings.bar_weight_lb)} lb` : '—'}</dd>
          <dt>Fractional plates</dt>
          <dd>{plates || '—'}</dd>
          <dt>Test every</dt>
          <dd>{settings ? `${settings.test_interval_months} months` : '—'}</dd>
        </dl>
        <p className="muted">Targets round to the nearest weight these plates can make. Editing comes in a later phase.</p>
      </article>

      <article className="card">
        <h2>Export</h2>
        <p className="muted">
          A copy of everything logged on this phone. CSV opens in Excel or Numbers (one row per set); JSON is a full backup
          of sessions, sets, 1RMs and settings.
        </p>
        <div className="row-actions">
          <button disabled={busy === 'csv'} onClick={() => void doExport('csv')}>
            {busy === 'csv' ? 'Preparing…' : 'Export CSV'}
          </button>
          <button disabled={busy === 'json'} onClick={() => void doExport('json')}>
            {busy === 'json' ? 'Preparing…' : 'Export JSON'}
          </button>
        </div>
      </article>

      <article className="card">
        <h2>About</h2>
        <dl>
          <dt>Version</dt>
          <dd>{__APP_VERSION__}</dd>
          <dt>Built</dt>
          <dd>{new Date(__BUILD_TIME__).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</dd>
          <dt>Commit</dt>
          <dd className="mono">{__GIT_COMMIT__}</dd>
        </dl>
      </article>

      <button className="danger" onClick={doSignOut}>
        Sign out
      </button>
    </div>
  )
}
