# Workout Log app (PWA)

Vite + React + TypeScript. Data lives on the phone in IndexedDB (Dexie) and
syncs with PocketBase. All server calls are in `src/lib/pb.ts`.

| Path | What |
| --- | --- |
| `src/lib/db.ts` | On-phone database (tables mirror the PocketBase collections) |
| `src/lib/sync.ts` | Connection checks (no polling; retries 30 s / 1 / 2 / 5 min, then stops) and sync |
| `src/lib/workout.ts` | Sessions, set logging, Finish/advance, 1RM saves |
| `src/lib/targets.ts` | 1RM in effect, % targets, rounding to what the plates can load |
| `src/screens/` | Today, Lifts, Settings, Login |

## Develop

```sh
npm install
VITE_PB_URL=http://10.0.0.200:8090 npm run dev     # PowerShell: $env:VITE_PB_URL="http://10.0.0.200:8090"; npm run dev
npm test                                           # unit tests
```

The end-to-end sync test (log a workout offline, reconnect, check the server)
runs against a PocketBase with the templates uploaded:

```sh
PB_TEST_URL=http://127.0.0.1:8090 PB_TEST_USER=... PB_TEST_PASS=... \
PB_TEST_ADMIN=... PB_TEST_ADMIN_PASS=... npx vitest run sync.integration
```

It writes test data, so point it at a throwaway PocketBase, not the real one.

## Deploy to the NAS

PocketBase serves the app from its `pb_public` folder, so the app and the API
share one HTTPS address.

1. Build: `npm run build` (output in `app/dist/`).
2. Copy the **contents** of `app/dist/` to your SMB share as `/mnt/HDDs/nas/barbell-dist/`.
3. In a TrueNAS shell, replace what's in `pb_public`:

   ```sh
   sudo rm -rf /mnt/HDDs/Docker/DockgeStacks/pocketbase/pb_public/*
   sudo cp -r --no-preserve=mode,ownership /mnt/HDDs/nas/barbell-dist/. /mnt/HDDs/Docker/DockgeStacks/pocketbase/pb_public/
   ```

No restart needed. An installed app picks up the new version the next time
it's opened (it may take one more open to switch over).

## Install on the iPhone

1. With Tailscale on, open `https://<machine>.<tailnet>.ts.net/` in **Safari**
   (the HTTPS tailnet address; the `http://10.0.0.200` one can't install).
2. Sign in with your **app login** (the users-collection account, not the admin).
3. Share → **Add to Home Screen**.
4. One-time: create an iOS Shortcut named **Connect Tailscale** with the
   Tailscale → Connect action, so the "Connect Tailscale" button works.
5. Recommended: in the Tailscale iOS app, turn on **VPN On Demand**.

## Phase 3 check

Put the phone in airplane mode, log a whole workout and tap Finish (the badge
shows Offline and how many changes are waiting). Turn airplane mode off and
open the app: the badge goes green, and the session and sets show up in the
admin UI (`sessions`, `set_logs`).
