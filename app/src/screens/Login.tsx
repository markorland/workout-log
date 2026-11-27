import { useState } from 'react'
import { signIn } from '../lib/pb'

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(email.trim(), password)
      onSignedIn()
    } catch (err) {
      const status = (err as { status?: number }).status
      setError(
        status === 400
          ? 'Wrong email or password.'
          : 'Can’t reach the server. Check that Tailscale is connected, then try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <header className="login-head">
        <img src="/icon-192.png" alt="" width={96} height={96} className="login-icon" />
        <h1>Workout Log</h1>
      </header>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
