# Workout Log

Workout Log is a personal, offline-first workout logger for Olympic
weightlifting. It replays four and a half years of coached programming in order,
shows each lift's target weight from your 1RM, and logs every set to a
self-hosted PocketBase server.

It's built for one lifter and one iPhone. It runs as a PWA from the Home Screen,
so there's no App Store and no Apple developer account, and it's only reachable
over your home network or Tailscale.

## What it does

- **Today:** the next workout in the timeline, with each set's percentage and
  target weight in lb, rounded to what your plates can load. It also shows your
  last weight for each exercise. Tapping a set logs the weight and reps, and
  finishing the workout moves on to the next one.
- **Timeline:** 314 main workouts in 40 programs, starting with three Beginner's
  Cycles. The Timeline screen lists them by program and lets you jump to any
  workout. When the last workout is done, the app starts again at the first
  program after the Beginner's Cycles and adds one to the round number. To come
  back after a break, there's a button that goes to Beginner's Cycle 1 without
  changing the round.
- **Testing:** a MAX WEEK test comes due every 3 months. It waits for the start
  of the next program so a block is never split and any lift where you beat your 1RM
  gets the new max recorded automatically.
- **Supplemental programs:** side tracks that run alongside the main timeline.
  One example is Barbell Accessory, designed to help build muscle mass,
  fix weak points, etc. Additionaly other cusom programs can be uploaded as a CSV.
- **Lifts:** 1RM history per lift, and the full log for any exercise.
- **Body:** measurements with charts, CSV import, and progress photos.
- **Extras:** plate math for any weight, CSV export of your logs, and History.

The phone keeps a full copy of the data in IndexedDB, so the app works with no
connection and syncs once it can reach the server again.

## How it fits together

```
Workout CSV ──► Python importer ──► templates.json ──► uploader ──► PocketBase (Docker on a NAS)
                                                                          ▲
                              iPhone PWA (React, IndexedDB) ◄── sync ─────┘
                              over the home network or Tailscale
```

- **Importer** (`importer/`, Python): turns the workout CSV into templates.
  Along the way it drops repeated workouts, fixes typos in the rep schemes,
  matches up different spellings of the same exercise, and decides which 1RM
  each lift is based on. It also sorts the workouts into the main timeline,
  Barbell Accessory, and the test templates. Every change it makes is written to
  a review file so it can be checked.
- **Server** (`deploy/pocketbase/`): PocketBase in Docker, with migrations that
  create the collections and access rules. It also serves the built app, so the
  app and API share one address.
- **App** (`app/`): uses React 19 with TypeScript and Vite. Dexie handles the
  offline database and vite-plugin-pwa handles installing and caching.

## Repo layout

| Path | What |
| --- | --- |
| [`app/`](app/) | The PWA. See [app/README.md](app/README.md) to develop, deploy and install it. |
| [`importer/`](importer/) | CSV importer, uploader, and reset script, with pytest tests |
| [`deploy/pocketbase/`](deploy/pocketbase/) | Docker setup and migrations. See [its README](deploy/pocketbase/README.md) for setup, updates, and starting fresh. |
| [`docs/`](docs/) | [Plan.md](docs/Plan.md) (the design and build plan) and [Future-Improvements.md](docs/Future-Improvements.md) |
| [`samples/`](samples/) | Small made-up CSVs in the workout and program formats, used by tests |
| `data/` | Your real workout CSV, config overrides and importer output. Git-ignored. |

## Quick start

1. **Server:** set up PocketBase with the migrations
   ([deploy/pocketbase/README.md](deploy/pocketbase/README.md)).
2. **Import:** from the repo root, with Python 3.12+:

   ```sh
   python3 -m venv .venv && . .venv/bin/activate
   pip install -r requirements.txt
   python3 -m importer.import_main data/raw/tribe_barbell_workouts.csv
   python3 -m importer.upload          # needs PB_URL and superuser login in .env
   ```

3. **Build the app:** with `cd app && npm install && npm run build`, copy `dist/`
   into PocketBase's `pb_public/`, then open it in Safari and Add to Home Screen
   ([app/README.md](app/README.md)).

## Tests

```sh
pytest importer/tests      # importer
cd app && npm test         # app (vitest)
```

## License

GPL-3.0. See [LICENSE](LICENSE).
