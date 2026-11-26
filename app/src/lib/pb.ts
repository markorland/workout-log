// The only module that talks to PocketBase. Everything else goes through Dexie.
import PocketBase, { ClientResponseError } from 'pocketbase'

/** Same origin in production (PocketBase serves the app); VITE_PB_URL in dev. */
export function serverUrl(): string {
  const env = import.meta.env?.VITE_PB_URL as string | undefined
  if (env) return env.replace(/\/$/, '')
  return typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8090'
}

let client: PocketBase | null = null

export function pb(): PocketBase {
  if (!client) {
    client = new PocketBase(serverUrl())
    client.autoCancellation(false)
  }
  return client
}

/** Tests point the client at another server. */
export function setClient(next: PocketBase) {
  client = next
}

/** GET /api/health with a 3-second timeout. True if the server answered. */
export async function healthCheck(timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(`${pb().baseURL}/api/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.ok
  } catch {
    return false
  }
}

export function isSignedIn(): boolean {
  return !!pb().authStore.record
}

export function signedInEmail(): string {
  return (pb().authStore.record?.email as string | undefined) ?? ''
}

export async function signIn(email: string, password: string): Promise<void> {
  await pb().collection('users').authWithPassword(email, password)
}

export function signOut(): void {
  pb().authStore.clear()
}

/** Refresh the login token. Returns false if the server says it's no longer valid. */
export async function refreshAuth(): Promise<boolean> {
  try {
    await pb().collection('users').authRefresh()
    return true
  } catch (e) {
    if (e instanceof ClientResponseError && (e.status === 401 || e.status === 403)) return false
    throw e
  }
}

export async function fetchAll<T>(collection: string, filter = ''): Promise<T[]> {
  return pb().collection(collection).getFullList<T>({ batch: 500, filter, sort: 'updated' })
}

/** Create-or-update by id (records keep the id the phone gave them). */
export async function upsert(collection: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    return await pb().collection(collection).update(id, data)
  } catch (e) {
    if (e instanceof ClientResponseError && e.status === 404) {
      return await pb().collection(collection).create({ ...data, id })
    }
    throw e
  }
}

export { ClientResponseError }
