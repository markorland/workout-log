import { useEffect, useState } from 'react'
import ConnectionBadge from './components/ConnectionBadge'
import { isSignedIn } from './lib/pb'
import { startSyncTriggers } from './lib/sync'
import Lifts from './screens/Lifts'
import Login from './screens/Login'
import SettingsScreen from './screens/Settings'
import Today from './screens/Today'

type Tab = 'today' | 'lifts' | 'settings'

export default function App() {
  const [signedIn, setSignedIn] = useState(isSignedIn())
  const [tab, setTab] = useState<Tab>('today')

  useEffect(() => {
    if (!signedIn) return
    return startSyncTriggers()
  }, [signedIn])

  useEffect(() => {
    // Ask iOS not to evict the offline data (best effort).
    void navigator.storage?.persist?.()
  }, [])

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Workout Log</span>
        <ConnectionBadge />
      </header>
      <main className="content">
        {tab === 'today' && <Today onGoToLifts={() => setTab('lifts')} />}
        {tab === 'lifts' && <Lifts />}
        {tab === 'settings' && <SettingsScreen onSignedOut={() => setSignedIn(false)} />}
      </main>
      <nav className="tabbar">
        {(
          [
            ['today', 'Today'],
            ['lifts', 'Lifts'],
            ['settings', 'Settings'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? 'tab active' : 'tab'}
            onClick={() => {
              setTab(id)
              window.scrollTo({ top: 0 })
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
