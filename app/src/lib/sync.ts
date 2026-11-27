// Connection checks and sync (docs/Plan.md, "Connection status" and "Sync design").
//
// No steady polling. A check runs when the app opens or returns to the
// foreground, on the browser's `online` event, when the status badge is
// tapped, and on "Finish workout". If the server can't be reached it retries
// after 30 s, 1 min, 2 min and 5 min, then stops. Every successful check syncs:
// upload dirty rows, then download anything changed on the server.
import { db, getMeta, pendingCount, setMeta, SYNCED_TABLES, TEMPLATE_TABLES } from './db'
import { countRecords, fetchAll, healthCheck, isSignedIn, latestUpdated, refreshAuth, upsert } from './pb'
import { uploadQueuedPhotos } from './photos'

export type ConnState = 'checking' | 'syncing' | 'synced' | 'not_connected' | 'offline' | 'signed_out' | 'error'

export interface SyncStatus {
  state: ConnState
  lastSync: string // ISO, '' if never
  pending: number
  message: string
}

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000]

let status: SyncStatus = { state: 'checking', lastSync: '', pending: 0, message: '' }
const listeners = new Set<(s: SyncStatus) => void>()
let running: Promise<void> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryIndex = 0

export function getStatus(): SyncStatus {
  return status
}

export function subscribe(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn)
  fn(status)
  return () => listeners.delete(fn)
}

function set(next: Partial<SyncStatus>) {
  status = { ...status, ...next }
  for (const fn of listeners) fn(status)
}

const LOCAL_FIELDS = ['dirty', 'local_updated', 'updated', 'created', 'collectionId', 'collectionName', 'expand']

function toServer(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (!LOCAL_FIELDS.includes(k) && k !== 'id') out[k] = v
  return out
}

function fromServer(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rec, dirty: 0, local_updated: '' }
  delete out.collectionId
  delete out.collectionName
  delete out.expand
  return out
}

/** Upload every dirty row, parents first. */
async function push(): Promise<void> {
  for (const table of SYNCED_TABLES) {
    const rows = await db.table(table).where('dirty').equals(1).toArray()
    for (const row of rows) {
      const saved = await upsert(table, row.id, toServer(row))
      // Only clear the flag if nothing changed locally while uploading.
      await db.transaction('rw', db.table(table), async () => {
        const cur = await db.table(table).get(row.id)
        if (cur && cur.local_updated === row.local_updated) {
          await db.table(table).update(row.id, { dirty: 0, updated: saved.updated })
        }
      })
    }
  }
}

/** Download app rows changed on the server since the last pull. Local unsent edits win. */
async function pull(): Promise<void> {
  for (const table of SYNCED_TABLES) {
    const key = `pull:${table}`
    const since = (await getMeta(key)) ?? ''
    const recs = await fetchAll<Record<string, unknown>>(table, since ? `updated > "${since}"` : '')
    let newest = since
    await db.transaction('rw', db.table(table), async () => {
      for (const rec of recs) {
        const cur = await db.table(table).get(rec.id as string)
        if (!cur || cur.dirty !== 1) await db.table(table).put(fromServer(rec))
        if ((rec.updated as string) > newest) newest = rec.updated as string
      }
    })
    if (newest !== since) await setMeta(key, newest)
  }
}

/** Download all templates (programs, workouts, items, exercises). */
export async function pullTemplates(): Promise<void> {
  let newest = ''
  for (const table of TEMPLATE_TABLES) {
    const recs = await fetchAll<Record<string, unknown>>(table)
    for (const r of recs) if ((r.updated as string) > newest) newest = r.updated as string
    await db.transaction('rw', db.table(table), async () => {
      await db.table(table).clear()
      await db.table(table).bulkPut(recs.map(fromServer))
    })
  }
  await setMeta('templatesAt', new Date().toISOString())
  await setMeta('templatesNewest', newest)
}

/** Re-download templates if the server's changed (e.g. a program uploaded or deleted elsewhere). */
async function templatesChanged(): Promise<boolean> {
  const known = (await getMeta('templatesNewest')) ?? ''
  for (const table of TEMPLATE_TABLES) if ((await latestUpdated(table)) > known) return true
  return (await countRecords('programs')) !== (await db.programs.count())
}

async function runCheck(): Promise<void> {
  set({ pending: await pendingCount() })
  if (!isSignedIn()) {
    set({ state: 'signed_out', message: '' })
    return
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    set({ state: 'offline', message: '' })
    return
  }
  set({ state: 'checking' })
  if (!(await healthCheck())) {
    set({ state: 'not_connected', message: '' })
    scheduleRetry()
    return
  }
  clearRetry()
  set({ state: 'syncing' })
  try {
    if (!(await refreshAuth())) {
      set({ state: 'signed_out', message: 'Sign in again to sync.' })
      return
    }
    if (!(await getMeta('templatesAt')) || (await templatesChanged())) await pullTemplates()
    await push()
    await uploadQueuedPhotos()
    await pull()
    await setMeta('syncedOnce', new Date().toISOString())
    set({ state: 'synced', lastSync: new Date().toISOString(), pending: await pendingCount(), message: '' })
  } catch (e) {
    set({ state: 'error', pending: await pendingCount(), message: e instanceof Error ? e.message : String(e) })
  }
}

/** Check the connection and sync. Concurrent calls share one run. */
export function checkAndSync(opts: { resetRetries?: boolean } = {}): Promise<void> {
  if (opts.resetRetries) retryIndex = 0
  if (!running) {
    running = runCheck().finally(() => {
      running = null
    })
  }
  return running
}

function scheduleRetry() {
  clearRetry()
  if (retryIndex >= RETRY_DELAYS_MS.length) return
  const delay = RETRY_DELAYS_MS[retryIndex++]
  retryTimer = setTimeout(() => void checkAndSync(), delay)
}

function clearRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
}

/** Call after a local write so the badge's waiting count stays current. */
export async function refreshPending(): Promise<void> {
  set({ pending: await pendingCount() })
}

/** Wire up the app-level triggers. Returns a cleanup function. */
export function startSyncTriggers(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') void checkAndSync({ resetRetries: true })
  }
  const onOnline = () => void checkAndSync({ resetRetries: true })
  const onOffline = () => set({ state: 'offline' })
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  void checkAndSync({ resetRetries: true })
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    clearRetry()
  }
}
