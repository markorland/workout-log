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

## Icons and launch screens

- App icons live in `public/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon-64.png`); the 1024 px master is `assets/icon-1024.png`.
- iOS launch screens are generated from the master: `python app/scripts/make_splash.py` (from the repo root, needs Pillow). It writes `public/splash/` and prints the `<link>` tags used in `index.html`.

## Deploy to the NAS

PocketBase serves the app from its `pb_public` folder, so the app and the API
share one HTTPS address.

1. Build: `npm run build` (output in `app/dist/`).
2. Copy the `app/dist` folder to your SMB share as is (it lands at `/mnt/HDDs/nas/dist/`; no renaming needed).
3. In a TrueNAS shell, replace what's in `pb_public`. The copy puts the folder's contents straight into `pb_public`:

   ```sh
   sudo rm -rf /mnt/HDDs/Docker/DockgeStacks/pocketbase/pb_public/*
   sudo cp -r --no-preserve=mode,ownership /mnt/HDDs/nas/dist/. /mnt/HDDs/Docker/DockgeStacks/pocketbase/pb_public/
   ```

No restart needed. An installed app picks up the new version the next time
it's opened (it may take one more open to switch over).

To check which build the phone is running, open **Settings → About**. It shows
the version from `package.json`, when the build was made, and the git commit
(with "+ local changes" if it was built from uncommitted code).

### Version numbers

Every change that needs a new `dist` gets its own version, so each deploy can
be checked against Settings → About:

- **Last number (patch):** add 1 for every rebuild of `dist` that changes the
  app, e.g. 1.0.0 → 1.0.1 → 1.0.2. Change `version` in `package.json`
  before building.
- **Middle and first numbers:** bumped only when we decide a set of changes
  deserves it, e.g. 1.0.5 → 1.1.0 for a new feature, or 2.0.0 for a big
  change. The patch number goes back to 0.
- 1.0.0 is v1: everything up to the About card (commit tagged `v1.0.0`).

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
