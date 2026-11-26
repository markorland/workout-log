import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { checkAndSync, type SyncStatus } from '../lib/sync'
import { useSyncStatus } from '../lib/useSyncStatus'

function ago(iso: string): string {
  if (!iso) return ''
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString()
}

export default function ConnectionBadge() {
  const s = useSyncStatus()
  const shortcut = useLiveQuery(() => db.settings.get('settings'))?.connect_shortcut_name || 'Connect Tailscale'
  const waiting = s.pending > 0 ? ` · ${s.pending} waiting` : ''

  const label: Record<SyncStatus['state'], [string, string]> = {
    checking: ['Checking…', 'gray'],
    syncing: ['Syncing…', 'gray'],
    // Sets are saved on the phone and sent on Finish (or the next check).
    synced: s.pending > 0 ? [`Connected · ${s.pending} to sync`, 'green'] : [`Synced ${ago(s.lastSync)}`, 'green'],
    not_connected: [`Not connected${waiting}`, 'amber'],
    offline: [`Offline${waiting}`, 'gray'],
    signed_out: [`Sign in to sync${waiting}`, 'amber'],
    error: [`Sync error${waiting}`, 'amber'],
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
      </button>
      {s.state === 'not_connected' && (
        <a className="connect" href={`shortcuts://run-shortcut?name=${encodeURIComponent(shortcut)}`}>
          Connect Tailscale
        </a>
      )}
    </div>
  )
}
