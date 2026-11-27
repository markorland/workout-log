import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { checkAndSync, type SyncStatus } from '../lib/sync'
import { useSyncStatus } from '../lib/useSyncStatus'

/**
 * Header badge: the connection state on one line, plus a small corner bubble
 * with the number of changes waiting to sync (it takes no extra width).
 */
export default function ConnectionBadge() {
  const s = useSyncStatus()
  const shortcut = useLiveQuery(() => db.settings.get('settings'))?.connect_shortcut_name || 'Connect Tailscale'

  const label: Record<SyncStatus['state'], [string, string]> = {
    checking: ['Checking…', 'gray'],
    syncing: ['Syncing…', 'gray'],
    // Sets are saved on the phone and sent on Finish (or the next check).
    synced: [s.pending > 0 ? 'Connected' : 'Synced', 'green'],
    not_connected: ['Not connected', 'amber'],
    offline: ['Offline', 'gray'],
    signed_out: ['Sign in to sync', 'amber'],
    error: ['Sync error', 'amber'],
  }
  const [text, color] = label[s.state]

  return (
    <div className="badge-wrap">
      <button
        className={`badge ${color}`}
        title={s.message || 'Tap to check again'}
        onClick={() => void checkAndSync({ resetRetries: true })}
      >
        <span className="dot" />
        {text}
        {s.pending > 0 && (
          <span className="pending-count" aria-label={`${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync`}>
            {s.pending > 99 ? '99+' : s.pending}
          </span>
        )}
      </button>
      {s.state === 'not_connected' && (
        <a className="connect" href={`shortcuts://run-shortcut?name=${encodeURIComponent(shortcut)}`}>
          Connect
        </a>
      )}
    </div>
  )
}
