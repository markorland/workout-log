import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useSyncStatus } from '../lib/useSyncStatus'
import { db, getMeta } from '../lib/db'
import { pb, signedInEmail, signOut } from '../lib/pb'
import { checkAndSync, pullTemplates } from '../lib/sync'
import { fmtLb } from '../lib/targets'

export default function SettingsScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const s = useSyncStatus()
  const settings = useLiveQuery(() => db.settings.get('settings'))
  const templatesAt = useLiveQuery(() => getMeta('templatesAt'))
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState('')

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

  return (
    <div className="settings">
      <h1>Settings</h1>

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

      <button className="danger" onClick={doSignOut}>
        Sign out
      </button>
    </div>
  )
}
