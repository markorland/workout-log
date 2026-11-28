import { useCallback, useEffect, useState } from 'react'
import {
  ClientResponseError,
  withingsDisconnect,
  withingsStart,
  withingsStatus,
  withingsSync,
  type WithingsStatus,
  type WithingsWeighIn,
} from '../lib/pb'
import { checkAndSync } from '../lib/sync'
import { fmtLb } from '../lib/targets'

function errorText(e: unknown): string {
  if (e instanceof ClientResponseError) {
    if (e.status === 0) return "Can't reach the server. Check that Tailscale is connected."
    return e.response?.message || e.message
  }
  return e instanceof Error ? e.message : String(e)
}

const whenText = (w: WithingsWeighIn) =>
  new Date(w.time * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function weighInText(w: WithingsWeighIn | null): string {
  if (!w) return 'None yet'
  const parts = [w.weight !== null ? `${fmtLb(w.weight)} lb` : '', w.fat !== null ? `${fmtLb(w.fat)}%` : ''].filter(Boolean)
  return `${parts.join(', ')} · ${whenText(w)}`
}

/** The server's Withings state, refreshed on demand. null while loading or unreachable. */
function useWithings() {
  const [status, setStatus] = useState<WithingsStatus | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(
    () =>
      withingsStatus().then(
        (s) => {
          setStatus(s)
          setError('')
        },
        (e: unknown) => setError(errorText(e)),
      ),
    [],
  )
  useEffect(() => {
    void load()
    // Coming back from the Withings sign-in: show the new state.
    const onShow = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [load])
  const refresh = load
  return { status, error, refresh }
}

/** Ask the server to fetch new weigh-ins now, then pull them onto the phone. */
function useGetWeighIns(after: () => void) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function run() {
    setBusy(true)
    setMessage('')
    try {
      const r = await withingsSync()
      setMessage(r.added + r.updated > 0 ? `Got new weigh-ins. Latest: ${weighInText(r.latest)}.` : 'No new weigh-ins.')
      await checkAndSync({ resetRetries: true })
    } catch (e) {
      setMessage(errorText(e))
    } finally {
      setBusy(false)
      after()
    }
  }
  return { busy, message, run }
}

/** Settings card: connect, check now, disconnect. */
export function WithingsCard() {
  const { status, error, refresh } = useWithings()
  const get = useGetWeighIns(() => void refresh())
  const [connecting, setConnecting] = useState(false)

  async function connect() {
    setConnecting(true)
    try {
      const { url } = await withingsStart()
      window.location.href = url
    } catch (e) {
      window.alert(errorText(e))
      setConnecting(false)
    }
  }

  return (
    <article className="card">
      <h2>Withings</h2>
      {!status ? (
        <p className="muted">{error || 'Checking…'}</p>
      ) : !status.configured ? (
        <p className="muted">
          Not set up on the server yet: add the Withings client ID and secret to the PocketBase stack (see the deploy README).
        </p>
      ) : !status.connected ? (
        <>
          <p className="muted">Bring in weight and body fat from your Withings scale automatically.</p>
          <div className="row-actions">
            <button className="primary" disabled={connecting} onClick={() => void connect()}>
              {connecting ? 'Opening Withings…' : 'Connect Withings'}
            </button>
          </div>
        </>
      ) : (
        <>
          <dl>
            <dt>Status</dt>
            <dd>Connected</dd>
            <dt>Latest weigh-in</dt>
            <dd>{weighInText(status.latest)}</dd>
            <dt>Last checked</dt>
            <dd>{status.lastCheck ? new Date(status.lastCheck).toLocaleString() : 'Not yet'}</dd>
            {status.lastError && (
              <>
                <dt>Last error</dt>
                <dd className="error">{status.lastError}</dd>
              </>
            )}
          </dl>
          <p className="muted small">The server checks every 4 hours. Values you type yourself are never replaced.</p>
          <div className="row-actions">
            <button disabled={get.busy} onClick={() => void get.run()}>
              {get.busy ? 'Checking…' : 'Get weigh-ins'}
            </button>
            <button
              onClick={async () => {
                if (!window.confirm('Disconnect Withings? Weigh-ins already saved stay.')) return
                await withingsDisconnect()
                await refresh()
              }}
            >
              Disconnect
            </button>
          </div>
          {get.message && <p className="saved">{get.message}</p>}
        </>
      )}
    </article>
  )
}

/** Body screen: one-tap fetch under Bodyweight, shown only once Withings is connected. */
export function GetWeighInsRow() {
  const { status, refresh } = useWithings()
  const get = useGetWeighIns(() => void refresh())
  if (!status?.connected) return null
  return (
    <div className="withings-row">
      <span className="muted small">Withings{status.latest ? ` · last weigh-in ${whenText(status.latest)}` : ''}</span>
      <button disabled={get.busy} onClick={() => void get.run()}>
        {get.busy ? 'Checking…' : 'Get weigh-ins'}
      </button>
      {get.message && <span className="saved small">{get.message}</span>}
    </div>
  )
}
