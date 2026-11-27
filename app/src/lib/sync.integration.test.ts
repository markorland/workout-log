// End-to-end: log a workout with the server unreachable ("airplane mode"),
// then reconnect and check everything reached PocketBase.
//
// Runs only against a real PocketBase with the templates uploaded:
//   PB_TEST_URL=http://127.0.0.1:8099 PB_TEST_USER=me@example.com PB_TEST_PASS=... \
//   PB_TEST_ADMIN=... PB_TEST_ADMIN_PASS=... npx vitest run sync.integration
import 'fake-indexeddb/auto'
import PocketBase from 'pocketbase'
import { describe, expect, it } from 'vitest'

const URL = process.env.PB_TEST_URL
const suite = URL ? describe : describe.skip

suite('offline logging, then sync', () => {
  it('logs a full workout offline and uploads it on reconnect', async () => {
    const { AppDB, useDatabase, pendingCount } = await import('./db')
    useDatabase(new AppDB(`test-${Date.now()}`))
    const pbmod = await import('./pb')
    const client = new PocketBase(URL)
    client.autoCancellation(false)
    pbmod.setClient(client)
    const sync = await import('./sync')
    const wk = await import('./workout')
    const { plannedSlots } = await import('./slots')

    // Online: sign in and do the first sync (downloads the templates).
    await pbmod.signIn(process.env.PB_TEST_USER!, process.env.PB_TEST_PASS!)
    await sync.checkAndSync()
    expect(sync.getStatus().state).toBe('synced')
    const { db: d } = await import('./db')
    expect(await d.workouts.count()).toBe(363)
    const track = await wk.ensureMainTrack()
    const workoutId = track!.current_workout

    // Airplane mode: the server can't be reached.
    client.baseURL = 'http://127.0.0.1:9'
    const items = (await d.workout_items.where('workout').equals(workoutId).toArray()).sort((a, b) => a.order - b.order)
    let logged = 0
    for (const item of items) {
      for (const slot of plannedSlots(item)) {
        await wk.saveSet(workoutId, slot, { weight_lb: 95, actual_reps: slot.planned?.reps ?? 5, completed: true })
        logged++
      }
    }
    await wk.saveOneRepMax('snatch', 130)
    const next = await wk.finishWorkout(workoutId)
    await sync.checkAndSync({ resetRetries: true })
    expect(sync.getStatus().state).toBe('not_connected')
    const waiting = await pendingCount()
    expect(waiting).toBe(logged + 1 /* session */ + 1 /* 1RM */ + 1 /* track */)

    // Back online: everything uploads.
    client.baseURL = URL!
    await sync.checkAndSync({ resetRetries: true })
    expect(sync.getStatus().state).toBe('synced')
    expect(await pendingCount()).toBe(0)

    // Check on the server as the admin.
    const admin = new PocketBase(URL)
    await admin.collection('_superusers').authWithPassword(process.env.PB_TEST_ADMIN!, process.env.PB_TEST_ADMIN_PASS!)
    const session = (await d.sessions.toArray()).find((s) => s.workout === workoutId)!
    const srvSession = await admin.collection('sessions').getOne(session.id)
    expect(srvSession.status).toBe('done')
    expect(srvSession.finished_at).not.toBe('')
    const srvSets = await admin.collection('set_logs').getFullList({ filter: `session = "${session.id}"` })
    expect(srvSets.length).toBe(logged)
    expect(srvSets.every((s) => s.completed && s.weight_lb === 95)).toBe(true)
    const srvTrack = await admin.collection('track_state').getOne(wk.MAIN_TRACK_ID)
    expect(srvTrack.current_workout).toBe(next.nextId)
    console.log(`logged ${logged} sets offline on ${workoutId}; synced; track now at ${next.nextId}`)
  }, 120_000)
})
