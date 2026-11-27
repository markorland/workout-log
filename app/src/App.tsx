import { useEffect, useState } from 'react'
import ConnectionBadge from './components/ConnectionBadge'
import ScrollToTop from './components/ScrollToTop'
import { isSignedIn } from './lib/pb'
import { startSyncTriggers } from './lib/sync'
import History from './screens/History'
import Lifts from './screens/Lifts'
import Login from './screens/Login'
import SettingsScreen from './screens/Settings'
import Timeline from './screens/Timeline'
import Today from './screens/Today'

type Tab = 'today' | 'timeline' | 'history' | 'lifts' | 'settings'

export default function App() {
  const [signedIn, setSignedIn] = useState(isSignedIn())
  const [tab, setTab] = useState<Tab>('today')
  // A supplemental session opened on Today (null = the main workout).
  const [supWorkout, setSupWorkout] = useState<string | null>(null)

  useEffect(() => {
    if (!signedIn) return
    return startSyncTriggers()
  }, [signedIn])

  const go = (t: Tab) => {
    setTab(t)
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    // Ask iOS not to evict the offline data (best effort).
    void navigator.storage?.persist?.()
  }, [])

  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <img src="/favicon-64.png" alt="" width={26} height={26} className="brand-icon" />
          <span className="brand-name">Workout Log</span>
        </span>
        <ConnectionBadge />
      </header>
      <main className="content">
        {tab === 'today' && (
          <Today
            onGoToLifts={() => go('lifts')}
            supWorkoutId={supWorkout}
            onOpenSupplemental={setSupWorkout}
            onCloseSupplemental={() => setSupWorkout(null)}
          />
        )}
        {tab === 'timeline' && (
          <Timeline
            onOpenToday={() => {
              setSupWorkout(null)
              go('today')
            }}
            onOpenSupplemental={(id) => {
              setSupWorkout(id)
              go('today')
            }}
          />
        )}
        {tab === 'history' && <History />}
        {tab === 'lifts' && <Lifts onOpenToday={() => go('today')} />}
        {tab === 'settings' && <SettingsScreen onSignedOut={() => setSignedIn(false)} />}
      </main>
      {tab !== 'today' && <ScrollToTop />}
      <nav className="tabbar">
        {(
          [
            ['today', 'Today'],
            ['timeline', 'Timeline'],
            ['history', 'History'],
            ['lifts', 'Lifts'],
            ['settings', 'Settings'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? 'tab active' : 'tab'}
            onClick={() => go(id)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
