import { useEffect, useState } from 'react'
import { subscribe, type SyncStatus } from './sync'

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>({ state: 'checking', lastSync: '', pending: 0, message: '' })
  useEffect(() => subscribe(setS), [])
  return s
}
