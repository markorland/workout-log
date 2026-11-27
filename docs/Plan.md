# Workout Log – Development Plan

Nov 23, 2026 · @Mark · updated Nov 26, 2026

## Summary

The app is a personal PWA that replays the TrueCoach workouts from Apr 2021 to Dec 2025 in order, shows each lift with your last logged weight and %-of-1RM targets, and logs every set to PocketBase on TrueNAS. The export has 404 workouts. After dropping 39 reruns, 365 unique workouts remain. TEST WEEK (2 days) is left out, and the other 363 are split three ways:

- **Main timeline (314):** every workout with a main lift (an Olympic lift, squat, pull or deadlift), in date order, in 40 programs.
- **Barbell Accessory (47):** a supplemental program holding the whole days with no main lift, such as bench, dumbbell, bodyweight and conditioning days.
- **Test template (2):** MAX WEEK D1 and D2, taken out of the timeline and run every 3 months or on demand.

These counts come from the Phase 1 importer run on Nov 26, 2026.

Decisions so far:

| Area | Decision |
| --- | --- |
| Delivery | PWA installed to the iPhone home screen. No Apple developer account, no 7-day re-signing. |
| Backend | PocketBase (one Docker container, SQLite) on TrueNAS |
| Remote access | Home network at `http://10.0.0.200:8090`, and away from home over Tailscale (HTTPS). Nothing is open to the internet. Every collection needs a login. |
| Offline | Phone stores everything locally (IndexedDB) and syncs when online |
| Units | lb for every weight. The gym has no kg plates. The unit is shown on every weight. |
| 1RMs | Entered by hand, plus an automatic raise after a test when you beat your current max. Never lowered automatically. |
| Testing | MAX WEEK every 3 months at the next program boundary, or whenever you start one |
| Accessory days | Whole days with no main lift move to a supplemental program called Barbell Accessory |
| Logging | Weight and reps for every set, prefilled from the prescription |
| Templates | The CSV is imported once into PocketBase as read-only templates |

Two later additions are in scope too: supplemental side programs on their own track (starting with Barbell Accessory and the 12-week arm program), and body tracking with measurements, CSV import and progress photos.

Languages: TypeScript for the app (Vite + React), Python 3.12+ for the import scripts run from your computer, and a shell script for deploys. PocketBase needs no server code; optional server hooks would be JavaScript.

## Architecture

There are three parts. A PWA on the phone stores everything locally first. PocketBase on TrueNAS is the source of truth, reachable only over your Tailscale network. A one-time Python importer loads the CSV.

&#91;embedded content: architecture · phone, reverse proxy, TrueNAS, one-time import\]

PocketBase also serves the built PWA files, so the app and API share one HTTPS origin and nothing needs CORS setup.

## Source data

The export has 1,937 exercise rows across 404 workouts and 336 distinct exercise names. The importer has to deal with the quirks below.

Columns: `Workout Date`, `Workout Title`, `View Workout Link`, `Exercise Superset` (A, B, C1, C2…), `Exercise Name`, `Exercise Reps` (free text, often multi-line with coaching notes). The header starts with a UTF-8 BOM.

| Quirk | Example | Handling |
| --- | --- | --- |
| Titles repeat across cycles | "W1D1" is used by about a dozen cycles; "RTF - W1D1" ran in 2021 and 2023 | Group and dedupe by the numeric ID in the link (`/workouts/145151564/edit`), inside the importer only |
| No program name on many titles | "W3D2", "Successories", "Pure Buldge" | Group into programs by date gaps and title prefix; editable after import |
| Dates slightly out of order | 6/26/2025 listed before 6/24/2025 | Sort by date, then by original row order |
| Overlapping programs | Apr 2025 mixes "Beginner's Cycle 2" with a W1–W4 block on the same days | Resolved: that Beginner's Cycle 2 copy is a rerun and gets dropped |
| Mislabeled names | "Back Squat (FSq)", "Back Sqaut", "Snatch From Block Below Knee (SnBlAbvKn)" | Alias table maps raw names to one canonical lift |
| Scheme typos | `^0/4`, `654`, `(75//3)2`, `(65;/3)2`, `(70/32)` | All auto-fixed; each fix is logged for spot-checking |
| Percent of another lift | "RDL 40-45% of back squat", "Start @ 40% 1RM C&J" | Per-exercise base-lift mapping, overridable per row |
| Non-barbell items | Accessory circuits, conditioning ("Row 2500m for time"), DB weights ("25-35#") | Imported as text-only or simple sets×reps items. Whole days of them move to Barbell Accessory. |

A first-pass parser test classified the first line of each scheme as: 998 sets×reps (`4x5`, `3x8-10`), 768 clean percentage schemes, 32 percentage schemes with typos or odd spacing, and 139 free text.

The TrueCoach link and ID are never shown in the app. Before upload, every record gets its own stable ID (e.g. `main-0001`, `acc-0001`, `test-maxweek-d1`).

### Repeated workouts

Five blocks are reruns of earlier blocks, totaling 39 workouts. They're dropped from the master dataset, which leaves 365 workouts. The earlier copy is kept as the template.

| Rerun (dropped) | Copy of | Workouts | Match |
| --- | --- | --- | --- |
| Nov 11 – Dec 4, 2025 (W1D1–W4D2) | Feb 11 – Mar 6, 2025 | 8 | Identical |
| Redo D1–D4, Oct 21–30, 2025 | W1D1/W1D2, Oct 7–9, 2025 | 4 | Identical |
| Beginner's Cycle 2, Mar 19 – Apr 23, 2025 | Beginner's Cycle 2, 2021 | 11 | 10 identical (including "W3D2" on Apr 10, which is really a second W3D1); W6D2 adds Snatch Extension before the heavy singles |
| Beginner's Cycle 3, May 28 – Jun 20, 2024 | Beginner's Cycle 3, 2021 | 8 | 5 identical; W2D2, W3D1 and W3D2 swap back and front squat or reorder Jerk and Back Squat |
| RTF, Jan 31 – Feb 23, 2023 | RTF, Aug 30 – Sep 22, 2021 | 8 | Identical |

Two other kinds of repeats are kept because they're part of how the programs were written:

- **Repeated weeks inside a cycle.** Most 4-week blocks run week 1 = week 2 and week 3 = week 4 at the same percentages (about 140 workouts). Dropping them would turn a 4-week cycle into 2 weeks.
- **The Beginner's cycle test day.** W6D2 (build to a heavy Snatch and C&J single) ends each of Beginner's Cycles 1–3 in 2021. It stays in its cycle and is not part of the test pool.

### Reclassified workouts

After the reruns are dropped, every workout is sorted into one of three places.

**Test templates (out of the main timeline).** See Testing for how they're used.

| Workout | Dates | Content |
| --- | --- | --- |
| MAX WEEK D1 / D2 | Feb 28 and Mar 2, 2023 | D1 Snatch + Front Squat, D2 Clean & Jerk + Back Squat: `60/4, 70/3, 80/2, 85/1, 90/1, 95/1, 101/1`, then keep going until failure or the lift breaks down |

**Left out.** TEST WEEK D1 / D2 (Sep 6 and 8, 2022: "Find 1RM", 5-3-2-1-1-1 by feel) isn't imported. All the tested lifts have 1RMs, so MAX WEEK covers testing (`exclude` in `overrides.yaml`).

**Barbell Accessory (supplemental program).** Any whole day with no main lift moves here, in date order. A main lift is any exercise with a base lift: an Olympic lift, squat, pull or deadlift (`exercises.is_main_lift`). Bench press, rows, curls, dumbbell and kettlebell work don't count, so a barbell bench day is still an accessory day. A workout is never split: it moves whole or not at all. Overrides in `overrides.yaml` (`force_track`) can pin a workout to either track; the Dec 2023 block's W#D3 days are pinned to main so the block stays together. That moves 47 days, kept in 13 groups (stored as the workout's phase):

| Group | Days | Dates |
| --- | --- | --- |
| Crunchy Roll Bukkake Bros Accessory | 3 | Mar 18 – Apr 1, 2023 |
| One Pump Man … Accessory | 3 | Apr 15 – 29, 2023 |
| DragonBall DZ Nutz Accessory | 4 | May 6 – 27, 2023 |
| June Accessory | 4 | Jun 3 – 24, 2023 |
| July 2023 Accessory | 4 | Jul 1 – 22, 2023 |
| August 2023 Accessory | 4 | Jul 29 – Aug 19, 2023 |
| August/September 2023 Accessory | 4 | Aug 26 – Sep 16, 2023 |
| September/October 2023 Accessory | 4 | Sep 20 – Oct 11, 2023 |
| Silverback Cycle Accessory (the W#D3 days) | 4 | Nov 24 – Dec 15, 2023 |
| Successories | 4 | Jul 5 – 26, 2024 |
| Pure Buldge | 4 | Apr 12 – May 3, 2025 |
| Bodyweight Week (May 2025): DAY 1 - LEGS, DAY 2 - ARMS/SHOULDERS, DAY 3 - ABS N' STUFF | 3 | May 26 – 30, 2025 |
| New Toyz | 2 | Jun 7 – 14, 2025 |

Days that have main lifts but no percentages, like the Beginner's Cycles, stay in the main timeline. Accessory items inside a main day stay with that day. The importer lists every moved day in `review.csv` for you to confirm.

**Main timeline.** Everything else.

### Typos by the numbers

**Rep schemes:** 49 of the 800 percentage rows have a typo. All of them are fixed automatically, and each fix is written to `review.csv` so you can spot-check it.

| Typo | Rows | Example → fixed |
| --- | --- | --- |
| Missing comma between groups | 28 | `(65/2)2 70/1, 75/1` → `(65/2)2, 70/1, 75/1` |
| Stray semicolon | 8 | `(65;/3)2` → `(65/3)2` |
| Unbalanced parenthesis | 5 (4 also missing a comma) | `70/3)2, (75/3)2` → `(70/3)2, (75/3)2` |
| Double slash | 4 | `(75//3)2` → `(75/3)2` |
| ^ instead of 6 | 4 | `^0/4` → `60/4` |
| Missing slash | 2 | `654` → `65/4` |
| Parenthesis in the wrong place | 2 | `(70/32)` → `(70/3)2` |

**Exercise names:** 7 names spread across 48 rows are actual errors.

| Name as written | Rows | Problem |
| --- | --- | --- |
| Back Squat (FSq) | 16 | Wrong abbreviation (Aug–Nov 2023) |
| Back Sqaut | 10 | Spelling |
| Parallete (2 exercises) | 8 | Spelling; "Parallette" is also used |
| Snatch From Block Below Knee (SnBlAbvKn) | 4 | Abbreviation says above knee |
| Clean + Hang Clean Above Knee + Hang Snatch Below Knee | 4 | Says Snatch; abbreviation (HClBeKn) says Clean |
| 2 Clean Extension + 1 Clean + 1 Jerk (… J)) | 4 | Extra parenthesis |
| Bicep Curl EZ Bat 21's | 2 | "Bat" for "Bar" |

Beyond those errors, the same lift is often written several ways, e.g. "Back Squat", "Back Squat (BSq)". Simple rules (drop the abbreviation in parentheses, ignore case, hyphens and plurals) collapse 71 spellings into 33 exercises and take the list from 336 names to 298. A short hand-written alias list handles the rest, like "RDL" = "Romanian Deadlift" and "Bent Row" = "Bent Over Row".

Workout titles have a few errors too: "RTF2 - W1D2" on Nov 3, 2021 belongs to RTF3; "September/October 2023 - W21" is W1D2; the Oct 2 and Oct 9, 2023 workouts titled "W1D1" are W3D1 and W4D1; the Jun 5 and Jun 12, 2025 workouts titled "W1D1" and "W2D1" are W1D2 and W2D2; and "Silvberback" is misspelled. The importer gets these from date order, not the title.

## Import pipeline

A Python script runs once on a laptop and turns the CSV into clean JSON. You review that JSON, then push it into PocketBase. Re-running it must be safe, so upserts are keyed by each record's stable ID.

1. **Read** the CSV with `utf-8-sig` encoding. Multi-line quoted cells stay intact.
2. **Group** rows into workouts by the link's workout ID. Keep date, title and the original row order.
3. **Order** workouts by date, then by first row index. Drop the 39 rerun workouts listed under Source data (matched by identical exercise lists against an earlier block).
4. **Classify** each remaining workout as main, accessory or test (see Reclassified workouts). Assign `seq` 1…N within each track. The main `seq` is the cycle-through order.
5. **Group into programs.** Start a new program when the title prefix changes (text before " - W") or there's a gap of more than 10 days. Untitled blocks get names like "Block 2025-07 (W1D1–W4D2)". Barbell Accessory and the two tests are programs of their own.
6. **Split each scheme cell** into the first line (the prescription) and everything after it (notes).
7. **Auto-fix** known typos before parsing: drop `;`, collapse `//` to `/`, `^0` to `60`, add the missing comma in `)2 70/1`, balance parentheses, split a 3-digit token like `654` into `65/4`, and move a misplaced parenthesis like `(70/32)` to `(70/3)2`. Every fix is logged to `review.csv`.
8. **Parse the prescription** into a list of planned sets:
   - `(70/3)2` = 2 sets of 3 reps at 70%
   - `70/3` = 1 set of 3 at 70%
   - `4x5`, `4X5`, `4 x 10` = 4 sets of 5, no % (weight chosen by you)
   - `3x8-10`, `4x12-15` = rep range; store min and max
   - `3x10/leg`, `3x:45` = per side / timed; store as text with set count
   - "Find 1RM", "Build to a heavy single", "keep going until failure" = max-attempt type; open-ended sets
   - Anything else = text-only item with no structured sets
9. **Normalize exercise names** with an alias table (`aliases.yaml`). It strips the abbreviation in parentheses, fixes spelling, and splits complexes on " + " into components.
10. **Map each exercise to a base lift** for percentages (rules in the 1RM section). Notes like "% of back squat" or "@ 40% 1RM C&J" override the default, except RDL, which always uses Back Squat.
11. **Assign stable IDs** and write `templates.json` and `review.csv`. The review file lists every auto-fix, every row the parser wasn't sure about, and every day moved to Barbell Accessory. Fix problems in a small `overrides.yaml` and re-run.
12. **Upload** to PocketBase with its REST API, using an admin token. Seed the starting 1RMs on the first upload.

The importer also builds a list of unique canonical exercises. That list becomes the `exercises` collection, where base lifts, categories and load types can be adjusted in the PocketBase admin UI.

## Data model

The data lives in twelve PocketBase collections: template collections from the importers (main, supplemental and test programs share them, told apart by a track field), an exercise library, workout logs, body measurements and photos, and app state such as your place on each track. All weights are in lb.

| Collection | Key fields | Written by |
| --- | --- | --- |
| `programs` | name, track (main, supplemental or test), seq, rotation (e.g. A-B-A/B-A-B), sessions\_per\_week, phase names, progression (none, double or fixed; supplemental only) | Importer |
| `workouts` | id (stable, e.g. main-0001), program →, seq, kind (regular or test), phase, workout label (A/B), title, week, day, original\_date | Importer |
| `workout_items` | workout →, block (A, C1…), order, exercise →, raw\_name, raw\_scheme, prescription, notes, scheme\_type, planned\_sets (JSON), set\_count, rep\_min, rep\_max, per\_side, seconds, open\_ended, weight\_jump, base\_lift\_override, needs\_review | Importer |
| `exercises` | name (canonical), aliases (JSON), components (JSON, for complexes), base\_lift, is\_main\_lift (has a base lift), category (oly, squat, pull, press, arms, accessory, conditioning, circuit), load\_type (weight, bodyweight, time or text), unilateral, form\_cue, video\_url | Importer, then you |
| `one_rep_maxes` | lift, weight\_lb, date, source (manual or test), session → (for tests), note, deleted\_at | You, and the app after a test |
| `sessions` | workout →, track, status (done or skipped), started\_at, finished\_at, bodyweight\_lb, notes, deleted\_at | App |
| `set_logs` | session →, workout\_item →, exercise →, set\_index, planned\_pct, planned\_reps, side (unilateral only), weight\_lb, actual\_reps, completed, deleted\_at | App |
| `track_state` | program →, current\_workout →, round (1, 2… for restarts), status (active, paused or archived) | App |
| `body_parts` | key (e.g. arm), label, has\_side, unit (in, lb or %), sort\_order, custom | Seeded, then you |
| `body_measurements` | date, body\_part →, side (left, right or blank), value, unit, notes, source (manual or csv), deleted\_at | App and CSV import |
| `progress_photos` | date, pose, image (protected file), thumbnail, notes, deleted\_at | App |
| `settings` | bar weight, fractional plates (JSON: weight → count, lb), test\_interval\_months (3), connect\_shortcut\_name | App |

**Database conventions** (apply to every collection)

- **Relations, not free text.** Exercises, body parts and programs are lookup records referenced by relation. Each name is stored once, so renaming one fixes it everywhere.
- **One attribute per field.** Side and variant never live inside a name. "Right Arm" is body part arm + side right. TrueCoach's "Single Arm DB Row (Left)" becomes exercise Single Arm DB Row + side left.
- **Small fixed sets are select fields.** side (left, right), load\_type, track, kind, 1RM source and photo pose are dropdown values, not typed text.
- **One weight unit.** Every weight is stored and entered in lb, so there's no unit field on sets or maxes. The unit is still shown with every weight on screen. Body measurements are stored in inches and bodyweight in lb.
- **Don't store what can be calculated.** Percent targets, suggested weights, change since start and "last weight" are calculated when shown.
- **Logs keep their own copy of the plan.** Each logged set saves the planned percent and reps it was done against, so editing a template never rewrites history.
- **Unique constraints:**
  - record ids (stable template ids; phone-made UUIDs)
  - exercises.name
  - track\_state.program
  - body\_parts.key
  - one\_rep\_maxes (lift, date)
  - body\_measurements (date, body\_part, side)
  - set\_logs (session, workout\_item, set\_index, side)
- **Sync-safe rows.** Every record has an id, created and updated. Records the phone creates use a UUID made on the phone as their id (ids accept lowercase letters, digits, `-` and `_`, up to 128 characters), so a record has its final id before it ever syncs. Template records use the importer's stable ids (`main-0001`, `ex-back-squat`). App-written collections also have a deleted\_at flag, so deletes sync instead of vanishing.
- **Base lifts are a select field** (snatch, clean\_and\_jerk, back\_squat, front\_squat, deadlift) on `exercises.base_lift`, `workout_items.base_lift_override` and `one_rep_maxes.lift`, not a relation.
- **Naming.** Lowercase snake\_case keys, with a separate label field for display.
- **Indexes** on the common lookups: set\_logs (exercise, created), body\_measurements (body\_part, date), workouts (program, seq).

`planned_sets` example for `60/4, (70/3)2`:

```json
[{"pct":60,"reps":4},{"pct":70,"reps":3},{"pct":70,"reps":3}]
```

The 1RM in effect for a session is the latest `one_rep_maxes` row on or before that session's date. Old sessions keep showing the targets they were planned against.

The "last logged weight" for a lift is the most recent completed `set_logs` row for that canonical exercise. The app shows both the top set and the full set list from that session.

## Features and screens

The core app has five screens; Programs and Body are added in phases 6 and 7. Today is the one you'll use at the gym. The others are for moving around the timeline and keeping maxes current.

Every weight on every screen is shown with its unit, e.g. "90 lb".

**1. Today (home)**

- Shows the current workout: program name, "Week 2 · Day 1", original date, and position ("#187 of 314").
- One card per block (A, B, C1/C2 grouped as a superset).
- Each card shows the exercise, the raw scheme, coach notes (collapsed), and a row per planned set: % · target lb · reps · a checkbox (e.g. "70% · 90 lb × 3").
- Each card also shows the base lift and its 1RM ("of Snatch 1RM 128 lb") and your last logged weight for this exercise and when ("Last: 135 lb × 3, 14 Oct").
- Tapping a set row marks it done with the target values. A long-press opens a weight/reps editor. Weight and reps are typeable number fields: weight opens the decimal keypad and takes any value (e.g. 137.5 lb), reps opens the number keypad. No steppers. What you enter is saved exactly as typed.
- Plate math under each target: plates per side for your bar ("45 lb bar + 25 lb per side").
- A "Finish workout" button closes the session and advances `current_workout` to the next `seq`.
- When a test is due, a "Test due" card appears at the next program boundary, with Start, Skip and Not now (see Testing).

**Connection status (header on every screen)**

- The app pings PocketBase's `/api/health` with a 3-second timeout. There's no steady polling. It checks:
  - when the app opens or comes back to the foreground
  - on the browser's `online` event
  - when you tap "Finish workout", right before that session syncs
  - when you tap the status badge (a manual recheck)
- **If the server can't be reached**, it retries 4 more times, after 30 s, 1 min, 2 min and 5 min, then stops. Sets keep saving on the phone the whole time. Reopening the app, tapping the badge or finishing the workout starts checking again.
- It shows one of three states:
  - **Synced** (green): server reachable and nothing waiting. Shows the time of the last sync.
  - **Not connected** (amber): internet works but the server doesn't answer, which almost always means Tailscale is off. Shows how many sets are waiting to sync.
  - **Offline** (gray): no internet at all (`navigator.onLine` is false).
- In the Not connected state, a **Connect Tailscale** button runs an iOS Shortcut through `shortcuts://run-shortcut?name=Connect%20Tailscale`. The Shortcut uses Tailscale's built-in Connect action, so the VPN turns on without opening the Tailscale app. Swipe back to the workout app and it re-checks and syncs.
- Tailscale doesn't document a URL scheme that opens its app, so the Shortcut is the dependable route. One-time setup: create a Shortcut named "Connect Tailscale" containing the Tailscale → Connect action. The Shortcut name is editable in Settings.
- The check tests whether the server is reachable, not the VPN itself. Since the app's address is the tailnet (.ts.net) name, the server is only reachable with Tailscale on, even at home, so green effectively means Tailscale is connected.

**2. Timeline**

- Every program in order, collapsible to its workouts, with done/skipped/not-started marks.
- Jump anywhere: tap a workout and choose "Set as current". This covers coming back from a break or repeating a block.
- Filters by program name or exercise, e.g. find every workout with Clean Pull to Hold.

**3. Lifts**

- List of base lifts with the current 1RM, the date set, and whether it came from a test or a manual entry.
- Edit a 1RM by hand. Each edit adds a new dated row, so the history is kept.
- A "Start test" button runs a test now (see Testing).
- Per-exercise history: a small chart of top set over time, plus a list of past sessions.

**4. History**

- Past sessions, newest first, with what was logged.

**5. Settings**

- Bar weight (45 lb), fractional plates (each weight and how many), test interval (3 months), and the server URL/login.
- Export all logs as CSV/JSON.

Not in v1: rest timer, RPE, and progression suggestions for the main barbell program. Supplemental programs and body tracking get their own screens (Programs, Body), described below.

## Testing

Tests replace the one-off test and max weeks that used to sit in the timeline.

- **Templates.** MAX WEEK (D1 Snatch + Front Squat, D2 Clean & Jerk + Back Squat; `60/4, 70/3, 80/2, 85/1, 90/1, 95/1, 101/1`, then keep going until failure or the lift breaks down) is the only test. It works from your current 1RMs, and all four of its lifts have one. If one were ever missing, that lift's card shows the % only and links to Lifts, like any other workout.
- **When.** A test is due 3 months after the last test session (`settings.test_interval_months`). Before any test has been done, the clock starts from the earliest 1RM entry, so the first test is due about Feb 26, 2027. It waits for the next program boundary, so a block is never split. Today then shows a "Test due" card before the first workout of the next program. Running the test doesn't move your place in the main timeline.
- **Skipping.** The "Test due" card has two buttons besides Start:
  - **Skip:** passes on this test. It's saved as a skipped test session, which resets the clock, so the next test is due 3 months later.
  - **Not now:** hides the card for this block only. It comes back at the next program boundary, and the 3-month clock isn't reset.
  - Skipped tests show in History, marked skipped. They never change a 1RM.
- **On demand.** "Start test" on the Lifts screen runs one anytime.
- **Logging.** Open-ended sets: keep adding attempts past the written ladder until you stop.
- **1RM update.** When the test is finished, the best completed weight for each tested lift is compared with the current 1RM. If it's higher, the app adds a new dated `one_rep_maxes` row with source test. If it's equal or lower, nothing changes, so a bad day never lowers your percentages. Every attempt is logged either way.

## Supplemental programs

Supplemental programs run on their own track beside the main timeline. Each one keeps its own place, so an arm session never moves your barbell workout forward. The first two are Barbell Accessory and the 12-week arm program from `Arm_Workout_Tracker.xlsx`.

**Barbell Accessory**

- Built by the main importer from the whole non-barbell days in the TrueCoach export (see Reclassified workouts), in their original date order.
- Run straight through the list, any day, separately from the main workout.

**What the arm workbook contains**

- 3 phases of 4 weeks: Foundation, Volume, Heavier. Each phase has Workout A and Workout B with 5 exercises each, 30 exercise rows in total on the Exercise Library tab.
- 3 sessions a week alternating A-B-A, then B-A-B, so 12 sessions per phase and 36 in the full program.
- Each exercise has sets, a rep range, a weight jump (+2.5 lb or +5 lb, or bodyweight), a form cue and a form-video link.
- Weights are in lb per dumbbell.
- After week 12, start over at Phase 1 with heavier weights.
- The log tabs are empty, so there's no history to import.

**How it works in the app**

- **Several at once.** Any number of supplemental programs can be active together, e.g. Barbell Accessory and the arm program. Each keeps its own place. On the Programs screen, each program is active, paused or archived; pausing hides it from Today and keeps its place.
- **Today screen.** Below the main workout, there's one card per active supplemental program, each showing that program's next session, e.g. "Arm Program · Phase 1 · Session 4 (B)" and "Barbell Accessory · June Accessory · W2". You can start any of them on any day, separately from the main workout and from each other. Finishing one advances only that program.
- **Logging.** The same per-set entry as the main workout. Each exercise shows its rep range, form cue, a Watch link, and your last weight and reps for that exercise.
- **Suggested weight.** Each supplemental program picks its own progression rule (`programs.progression`), set when the program is created and changeable later:
  - **None** (the default): no suggestion; the card just shows your last weight × reps for that exercise. Barbell Accessory uses this.
  - **Double progression:** the arm workbook's rule, used only by the arm program. If every set reached the top of the rep range last time, suggest last weight + the exercise's jump; otherwise suggest the same weight. Bodyweight moves show "Top of range: make it harder" instead. The first session of each exercise in a phase is blank so you choose a starting weight.
  - **Fixed increase:** add the exercise's jump every session, whatever the reps.

  More rules can be added later without changing existing programs. Main-program 1RMs change only by hand or from a test.
- **Timeline.** Supplemental programs get their own tab with the same jump-anywhere control, plus a "Restart at Phase 1" button for the second round.
- **Units.** Everything is in lb, shown with the unit. Plate math uses the lb plate set.

The arm program starts at Phase 1, Session 1, since nothing has been logged yet.

**Adding supplemental programs**

New programs can be added from the app's Programs screen in two ways. Both run the same checks before saving.

1. **Upload a program CSV.** One row per exercise slot, with every attribute in its own column. The app reads the file on the phone and shows a preview with any problems flagged. Then you enter the program name, rotation and sessions per week, and save. The arm workbook has been converted to this format as `arm_program.csv` (30 rows).

```csv
phase,phase_name,weeks,workout,order,exercise,sets,rep_min,rep_max,load_type,weight_jump,unilateral,form_cue,video_url
1,Foundation,4,A,1,Standing Dumbbell Curl,3,8,12,weight,2.5,no,"Elbows pinned at sides, no swinging",https://...
1,Foundation,4,A,5,Diamond Push-Up,2,10,20,bodyweight,,no,Kneel if needed,
2,Volume,4,A,4,Single-Arm Overhead Extension,3,10,12,weight,2.5,yes,Elbow still and close to head,
```

- `phase` is a number (1, 2, 3…); `phase_name` and `weeks` describe it and must match on every row of that phase.
- `workout` is the session label (A, B…); `order` is the exercise's position in that workout.
- `exercise` must match the exercise library by name; new names are added to the library after you confirm them.
- `rep_min` and `rep_max` are separate numbers instead of "8-12". For a fixed count, use the same number twice.
- `load_type` is weight, bodyweight or time. For time, the rep columns hold seconds.
- `weight_jump` (lb) applies only to weight; leave it blank for bodyweight.
- `unilateral` = yes means reps are per side, and the app logs left and right as separate sets.
- Required columns: phase, weeks, workout, order, exercise, sets, rep\_min, rep\_max, load\_type.

2. **Build it in the app.** A form for program → phases → workouts → exercises. Exercise names autocomplete from the exercise library so history links up. It's useful for short programs, or for tweaking a copy of an existing one (Duplicate, then edit).

Program settings:

- Rotation: A-B-A/B-A-B, A-B, fixed weekly days, or straight through the list.
- Progression rule for suggested weights: none, double progression or fixed increase.
- Weeks per phase.
- What happens at the end: restart at Phase 1, or stop.

Programs can be archived to hide them without losing history. Editing a program never changes sessions already logged.

## Body measurements and progress photos

A new Body screen logs measurements and photos, charts each body part over time, and imports measurements from CSV. Everything stays on TrueNAS behind Tailscale, like the workout logs.

**Measurements**

- Stored one value per row: date, body part, side, value, unit, notes. That makes any body part or new site easy to add without changing the database.
- Default sites:
  - neck, shoulders, chest, waist, hips
  - arm (left/right)
  - forearm (left/right), thigh (left/right), calf (left/right)
  - bodyweight (lb) and body fat (%)
  - You can add custom sites.
- **Quick entry.** One form lists your usual sites with the last value shown beside each, so a check-in takes about a minute.
- **Charts.** One chart per body part and side, with change since start. Charts are grouped by body part in a set order (head to toe, editable) with left before right. Each chart is titled "Side Body part" (e.g. "Left Arm", "Right Calf"); parts with no side are titled by the part alone ("Waist").
- **Reminder.** A "measure your arms" nudge on the Body screen every 2 weeks while the arm program is active, since the workbook asks for that.

**CSV import**

- Done in the app: pick a file on the phone or computer, see a preview with any problems highlighted, then import. Rows wait on the device and sync like everything else.
- Long format, one measurement per row. Only date, body\_part and value are required:

```csv
date,body_part,side,value,unit,notes
2026-11-24,arm,right,15.25,in,morning
2026-11-24,arm,left,15.0,in,
2026-11-24,waist,,33.5,in,
2026-11-24,bodyweight,,182.4,lb,
```

- Rules:
  - `date` accepts YYYY-MM-DD or M/D/YYYY.
  - `side` is left, right or blank.
  - `unit` defaults to in (lb for bodyweight, % for body fat); cm and kg are converted to in and lb.
  - Unknown body parts become new custom sites after you confirm them.
- Side is never part of the body part name. If a file uses a name like "Right Arm" or right\_arm, the preview splits it into body part arm + side right and asks you to confirm.
- Duplicates (same date, body part and side) are skipped by default, with an option to overwrite.
- An Export button writes the same long CSV.

**Progress photos**

- Taken with the camera or picked from the library. Each photo is tagged with a date and a pose: front, side, back, or flexed arm, plus custom.
- Resized on the phone to about 2,000 px and re-saved as JPEG before upload. That keeps files small, converts iPhone HEIC photos, and strips the location data stored in the photo.
- Photos taken without a connection are held on the phone and uploaded when Tailscale connects.
- **Compare view.** Pick a pose and two dates for side-by-side, or a slider overlay. That day's measurements are shown underneath.

**Privacy for photos**

- Stored in a PocketBase file field marked protected, so each image can only be fetched with your login token, even from inside the tailnet.
- The app does not keep full-size photos in its offline cache. Only small thumbnails of the most recent ones are kept, so a lost phone holds as little as possible.
- Photos live in `pb_data/` with everything else, so PocketBase's scheduled backups and the Backblaze backup of the Docker folder cover them.

## Percentage and 1RM logic

Every % target is a percentage of one of the base-lift maxes. The exercise's base lift decides which one.

```latex
\text{target} = \text{round}\left(\frac{\text{pct}}{100} \times \text{1RM}_{\text{base}}\right)
```

**Plates.** Standard plates (45, 35, 25, 10, 5 and 2.5 lb) are unlimited; the gym has plenty. Only the fractional plates are counted, editable in Settings. Plates go on in pairs, so a fractional plate you have 2 of can be used once per side. Until the real set is confirmed, the default is:

| Fractional plate (lb) | 1 | 0.75 | 0.5 | 0.25 |
| --- | --- | --- | --- | --- |
| Count | 2 | 2 | 2 | 2 |

**Rounding follows the plates.** Targets round to the nearest weight the bar can actually be loaded to. With the fractional plates above (one each of 0.25, 0.5, 0.75 and 1 lb per side), that's every 0.5 lb: 70% of 128 lb = 89.6 → 89.5 lb, i.e. 45 lb bar + 22.25 lb per side. The step is worked out from the fractional plates, not set by hand, so it updates when you change them.

**Plate math** finds the plates per side for the target, using the fewest plates and heaviest first, within the fractional plates available. It finds an exact load whenever one exists, so it searches combinations rather than just grabbing the biggest plate each time. For 89.5 lb it shows "45 lb bar + 10, 10, 1, 0.75, 0.5 lb per side". If a weight can't be made exactly (for example, a typed weight), it shows the closest load and the difference.

Default base-lift rules, applied by keyword in this order. The first match wins, and an `exercises.base_lift` or row override beats every rule:

| Exercise contains | Base lift | Examples from the CSV |
| --- | --- | --- |
| RDL, Romanian Deadlift | Back Squat, always (notes naming another lift are ignored) | RDL 40–45% of back squat |
| "% of back squat" / "1RM C&J" / "of clean" in notes | the lift named in the note | FSq Push Press @ 40% 1RM C&J |
| Back Squat, Pause Back Squat, Good Morning | Back Squat | Pause BSq, Good Morning (20–30% of BSq) |
| Front Squat, Pause Front Squat | Front Squat | Pause FSq |
| Snatch Pull, Snatch Extension, Snatch Deadlift, Snatch Grip Deadlift, Snatch Segment | Snatch | SnPu to Hold (70–100%) |
| Clean Pull, Clean Extension, Clean Deadlift, Clean Grip Deadlift, Clean Segment | Clean & Jerk | ClPu to Knee (80–100%) |
| Snatch Balance, Overhead Squat, Sots Press, Snatch-grip press | Snatch | Heaving SnBal, Pressing SnBal |
| Jerk, Power Jerk, Pause Jerk, Jerk Balance, BTN Jerk, Push Press | Clean & Jerk | Power Jerk, Push Press |
| Complexes that end in a jerk (Clean + Jerk, PCl + Cl + J) | Clean & Jerk | Clean + 2 Jerk |
| Snatch variants: hang, block, power, Snatch + OHS | Snatch | 3 Position Snatch |
| Other clean variants: hang, block, power, Clean + FSq | Clean & Jerk | Tempo Clean + Clean |
| Deadlift (plain) | Deadlift | |
| Bench, rows, strict press, accessories | none (pick a weight) | Bench Press 4x10, Pendlay Row 4x5 |

**Clean and jerk lifts.** There's no separate Clean or Jerk 1RM. Every clean-family and jerk-family lift (cleans, clean pulls and extensions, jerks, push presses) is a percentage of the Clean & Jerk 1RM, and notes such as "Base % off max Power Jerk" don't change that. There are five base lifts: Snatch, Clean & Jerk, Back Squat, Front Squat and Deadlift. If a needed 1RM is missing, the card shows the % only and links to Lifts.

**Starting 1RMs** (entered Nov 26, 2026, source manual; seeded on the first upload):

| Lift | 1RM |
| --- | --- |
| Clean & Jerk | 176 lb |
| Snatch | 128 lb |
| Front Squat | 238 lb |
| Back Squat | 295 lb |
| Deadlift | 345 lb |

Clean and Jerk are never entered separately (see above).

Two things are a little odd but match how the program was written:

- Some pulls and deadlifts go up to 100% of the lift's 1RM (e.g. `(100/2)3`, 12 rows in Aug–Nov 2023), and none go higher. The only sets above 100% are MAX WEEK's 101% singles. The app shows them as written.
- Ranges in notes ("40%–45% of back squat") use the midpoint as the target and show the range beside it.

## Build phases

There are seven phases. Each one ends with something you can use, and you can log real workouts from the end of phase 3.

1. **Import and clean the data**
   - Write the `importer/` package, `aliases.yaml` and `overrides.yaml`. Output `templates.json` and `review.csv`.
   - Status (Nov 26, 2026): built. Run `python -m importer.import_main data/raw/tribe_barbell_workouts.csv`; tests with `python -m pytest importer/tests`. Starting 1RMs live in `data/config/one_rep_maxes.yaml`.
   - Done when: 363 workouts kept (39 reruns dropped, TEST WEEK left out), split into main, Barbell Accessory and test, with counts reported; every percentage row parses or is listed in `review.csv`; and every barbell exercise has a base lift.
2. **Stand up PocketBase**
   - Image: `ghcr.io/muchobien/pocketbase:latest`, a maintained community image that follows official PocketBase releases from the project's new home (the GitHub repo was archived Oct 26, 2026). A commented-out `:0.42.3` line in `compose.yaml` pins a version when wanted.
   - Runs as a **Dockge stack** at `/mnt/HDDs/Docker/DockgeStacks/pocketbase/` (`deploy/pocketbase/` in the repo: `compose.yaml`, `pb_migrations/`). `pb_data/` and `pb_public/` sit next to the compose file, so they survive image updates and are covered by the Backblaze backup of the Docker folder. Deploys copy into `pb_public/` there, never into the container.
   - Reachable on the home network at `http://10.0.0.200:8090`, and on the tailnet through the TrueNAS Tailscale app: `tailscale serve --bg --https=443 http://10.0.0.200:8090` gives `https://<machine>.<tailnet>.ts.net` with a trusted certificate. The phone app always uses the tailnet HTTPS address, at home too, since iOS needs HTTPS for an installed PWA. Never enable Funnel.
   - Backups: PocketBase's scheduled backups (Settings → Backups) write consistent zips into `pb_data/backups/`, which Backblaze picks up.
   - Collections, API rules and default settings come from the migration files and are applied on start. Templates and the starting 1RMs are loaded with `python -m importer.upload` (upserts by id; never overwrites 1RMs already on the server).
   - Step-by-step setup: `deploy/pocketbase/README.md`.
   - Status (Nov 26, 2026): files written and tested against local PocketBase 0.40.6 and 0.42.3. Both migrations apply; the upload loads 289 exercises, 42 programs, 363 workouts, 1,778 items and 5 1RMs, and re-running it only updates. Checked: sign-ups blocked, nothing visible when logged out, templates read-only for the app user, and the app user can create sessions and set logs. **Done (Nov 26, 2026):** deployed on the NAS through Dockge, published on the tailnet with `tailscale serve`, and data uploaded.
   - Done when: `https://<machine>.<tailnet>.ts.net/_/` loads from the phone on cellular with Tailscale on and fails with Tailscale off, and the admin UI shows the 363 workouts.
3. **Minimum usable PWA**
   - Stack: Vite + React + TypeScript, Dexie for IndexedDB, the PocketBase JS SDK, vite-plugin-pwa for the manifest and service worker.
   - Build the Today screen, set logging, Finish/advance, manual 1RM entry, % targets, and last logged weight.
   - Host the built files from PocketBase's `pb_public` folder so there's one origin and no CORS.
   - Done when: added to the home screen, you can log a full workout in airplane mode and it shows up in PocketBase after reconnecting.
   - Status (Nov 26, 2026): built in `app/` (React 19, Vite 8, Dexie 4, PocketBase SDK, vite-plugin-pwa). It has the Today, Lifts, Settings and Login screens; sign-in uses the app login. The main track starts at Beginner's Cycle 1 W1D1, the look follows the phone's light/dark setting, and all server calls are in `src/lib/pb.ts`.
     - **Logging:** a tap logs the set at its target. With no % target, the suggestion is the previous set in this workout, then last time's weight. A long-press opens the weight/reps editor.
     - **Tested:** unit tests cover rounding and 1RM lookup. An end-to-end test against a local PocketBase logs a full workout with the server unreachable, checks the "Not connected" state and waiting count, reconnects, and confirms on the server that the session, every set and the new track position arrived. Phone-size screenshots were checked in light and dark.
     - **Done (Nov 26, 2026):** deployed to `pb_public`, installed on the iPhone as "Workout Log" with the new icon, and the airplane-mode check passed.
4. **Timeline, history and tests**
   - Timeline with jump-to, program grouping, search, exercise history chart, and the History screen.
   - Tests: the "Test due" card at the program boundary with Skip and Not now, "Start test", open-ended attempts, and the automatic 1RM raise.
   - Done when: you can set any main workout as current, see past logs for any lift, and a finished MAX WEEK raises only the 1RMs you beat.
   - Status (Nov 27, 2026): built.
     - **Timeline tab:** programs in order, collapsible, opening on the current one; done / skipped / in-progress marks; search by program or exercise; a workout preview with "Set as current".
     - **History tab:** finished and skipped sessions, newest first.
     - **Exercise history sheet:** a top-set chart (one series; tap a point for its value) plus every session. Opens from an exercise name on Today or History, or a lift on Lifts (which also lists its 1RM history).
     - **Today:** Skip workout.
     - **Tests:** the Test due card (Start / Skip / Not now) and "Start test" on Lifts. MAX WEEK runs on its own track (`track-test`) and leaves the main position alone. After each test day, beaten maxes are raised (source "test"), with a summary shown.
     - **Tested:** unit tests cover skip, set-as-current, the program boundary, the 3-month clock, "Not now", the full MAX WEEK flow (only the beaten Snatch max raised; the missed attempt and the lower Front Squat ignored) and exercise history. The offline-sync end-to-end test still passes. Phone-size screenshots were checked.
     - **Also done in this phase:**
       - Login screen with the app icon.
       - Search clear (×) button.
       - Weight/reps editor that opens under the header with the page locked, so the keyboard no longer scrolls it, and gray current values that typing replaces.
       - One-line header: the app icon, a state-only badge, a corner bubble with the waiting count, and a "Connect" button.
       - `docs/Future-Improvements.md`: percentages for the early workouts, and looping back after the last workout with a round counter.
     - **Done (Nov 27, 2026):** tested on the iPhone.
5. **Polish**
   - Plate math, CSV/JSON export, a check that the scheduled PocketBase backups are landing in `pb_data/backups/` and reaching Backblaze, app icon and splash screen.
   - Optional later: an ntfy reminder on training days, Home Assistant sensor for sessions this week.
   - Status (Nov 27, 2026): built.
     - **Plate math:** under each barbell set, e.g. "Per side: 10 · 10 · 1 · 0.75 · 0.5". It uses the fewest plates, with standard plates unlimited and the fractional plates from Settings, and shows the actual load if a typed weight can't be made exactly. Not shown for dumbbell, kettlebell, machine, cable or EZ-bar lifts.
     - **Export:** Settings → Export CSV (one row per set) or Export JSON (full backup of sessions, sets, 1RMs, positions and settings), through the iOS share sheet.
     - **Launch screens:** the icon on its dark background, for 10 iPhone screen sizes (`app/scripts/make_splash.py`). The app icon itself was done in Phase 3.
     - **Backups:** PocketBase scheduled backups (deploy README step 6) write to `pb_data/backups/`, which Backblaze covers. Check they're landing.
     - **Tested:** unit tests for plate math and export. Phone-size screenshots checked.
     - **Also done in this phase:**
       - The chart's scale never goes below zero.
       - A "The plates can't make X lb" message in the editor for barbell sets, offering the nearest weight below or above, or keeping the typed weight.
     - **Not done:** the optional ntfy and Home Assistant extras.
     - **Done (Nov 27, 2026):** tested on the iPhone.
6. **Supplemental programs**
   - Write `import_supplemental.py` for program CSVs in the format above. Build the Programs screen: sheet upload with preview, the in-app program builder, Duplicate and Archive. Load arm\_program.csv, starting at Phase 1, Session 1, and turn on the Barbell Accessory track. Add a Supplemental card per active program, Pause/Resume, the supplemental timeline tab, per-program progression rules and Restart.
   - Done when: Barbell Accessory and the arm program are both active, each with its own card and place; you can do an arm session on a rest day, neither the main workout nor Barbell Accessory moves; the arm program's next suggested lb follows double progression, and Barbell Accessory shows last weights with no suggestion.
7. **Body measurements and photos**
   - Build the Body screen: quick entry, charts, CSV import with preview and duplicate check, export. Add progress photos with on-phone resize, an offline upload queue, protected file storage and the compare view.
   - Done when: a CSV in the format above imports cleanly, a "Right Arm" style name is split into arm + right in the preview, and a photo taken offline appears on the server after reconnecting.

**Sync design (phase 3).** Every write goes to Dexie first with a client-generated UUID and `updated_at`. A sync runs whenever a connection check succeeds: on app open or return to the foreground, on `online`, on a tap of the status badge, and on "Finish workout". Logging a set doesn't trigger one. It pushes unsynced rows and pulls anything newer than the last sync time. Conflicts are rare with one user, so the newest `updated_at` wins. Templates are pulled once and cached; re-pull only when the importer runs again.

**iOS notes.** Safari only registers a service worker on HTTPS; the Tailscale certificate covers that. Turn on VPN On Demand in the Tailscale iOS app so sync works without remembering to connect. With the VPN off, the app still opens from its cache and logs offline, then syncs on the next connection. Install via Share → Add to Home Screen. Request persistent storage (`navigator.storage.persist()`), and treat the server as the source of truth so a wiped browser cache costs nothing.

**Security.** The server is reachable from the home network and the tailnet, never the internet, so PocketBase's own locks are what keep a guest on the Wi-Fi out: sign-ups off, one user account, API rules on every collection (no data without that login), and a strong, unique superuser password for the admin UI. Home-network access is plain HTTP, so sign in through the tailnet HTTPS address when you can; the phone app always does. Keep the image updated. Optionally, add a Tailscale ACL so only your phone and laptop can reach the server over the tailnet.

**Repository and deploys.** The code lives in a public GitHub repo, and no data goes in it.

- Every data file lives under `data/`, which is ignored by git. That covers the TrueCoach export, `templates.json`, `review.csv`, `aliases.yaml`, `overrides.yaml`, program CSVs (including `arm_program.csv`) and measurement CSVs.
- The only CSVs committed are in `samples/`, with made-up rows that show the formats.
- The server URL and any keys come from `.env`; only an `.env.example` with placeholder values is committed.
- Deploy: `npm run build`, then a script copies `dist/` to `pb_public/` on TrueNAS over Tailscale.

```
# --- Personal data: never commit ---
data/
*.csv
*.xlsx
*.xls
!samples/*.csv
pb_data/
photos/
backups/

# --- Secrets ---
.env
.env.*
!.env.example
*.pem
*.key

# --- Build output and tooling ---
dist/
pb_public/
node_modules/
.venv/
__pycache__/
.DS_Store
```

.gitignore only blocks new files. If a data file was ever committed, remove it from the repo with `git rm --cached <file>`, and treat anything already pushed to a public repo as public.

## Defaults and resolved questions

These defaults are in the plan unless you change them:

- All weights in lb, shown with the unit. Body measurements in inches and bodyweight in lb
- 45 lb bar; standard lb plates plus 2 each of 0.25, 0.5, 0.75 and 1 lb fractional plates (to be confirmed); targets rounded to the nearest loadable weight (0.5 lb with those plates)
- Single user, one PocketBase login
- Finishing a workout advances to the next `seq`; skipping is allowed and marked
- Accessory and conditioning items are logged as free sets×reps or a note, with no % targets
- A test every 3 months, at the next program boundary

Resolved (Nov 26, 2026):

- [x] Which 1RMs do you have? Clean & Jerk 176, Snatch 128, Front Squat 238, Back Squat 295, Deadlift 345 lb. Clean and jerk lifts always use the C&J 1RM.
- [x] Skip one-off weeks? The test and max weeks leave the timeline and become test templates (see Testing). Non-barbell days, including the May 2025 bodyweight block, move to Barbell Accessory. The Beginner's Cycles stay.
- [x] Overlapping April 2025 programs? Moot: the Beginner's Cycle 2 copy is a dropped rerun.
- [x] Front end? React.
- [x] Show the TrueCoach link? No. The ID is used only inside the importer, and records get their own stable IDs.
- [x] RDL rows that say "% of clean"? RDL always uses Back Squat.
- [x] Units? lb only; the gym has no kg plates.
