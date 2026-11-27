# Future Improvements

Ideas and known gaps to come back to after the main build phases. Not scheduled yet.

## ✅ Done: Add percentages to the early workouts (or remove them)

**Problem.** 70 workouts in the main timeline have no percentage targets. Their schemes are plain sets × reps (`3x5`, `2x4, 3x3`), so the app shows no target weights for them. You type the weight, or it reuses your last one. The rest of the program is written in % of a 1RM.

| Program | Dates | Workouts | Timeline # |
| --- | --- | --- | --- |
| Beginner's Cycle 1 | Apr 19 – May 26, 2021 | 12 | 1–12 |
| Beginner's Cycle 2 | May 31 – Jul 7, 2021 | 12 | 13–24 |
| Beginner's Cycle 3 | Jul 20 – Aug 26, 2021 | 12 | 25–36 |
| March 2021 | Feb 28 – Mar 23, 2022 | 8 | 61–68 |
| April 2022 | Apr 5 – 7, 2022 | 2 | 69–70 |
| June 2022 | May 31 – Jun 23, 2022 | 8 | 71–78 |
| July 2022 | Jul 12 – Aug 4, 2022 | 8 | 79–86 |
| August 2022 | Aug 9 – Sep 1, 2022 | 8 | 87–94 |

RTF, RTF2 and RTF3 (Aug – Nov 2021, #37–60) already have percentages, even though they sit in the middle of this stretch. From September/October 2022 (#95) onward, every main workout has them. The only exceptions are the four day-3 bench/dumbbell days in Block 2023-12, which are accessory work, so that's expected.

**When it matters.** The app starts at Beginner's Cycle 1 and runs through to the end of the timeline. The Beginner's Cycles are also what you return to after a break. So these workouts come up at the start, after breaks, and every time the timeline loops back around.

**Options.**

1. **Add percentages (likely choice).** Write a %-of-1RM scheme for each of these workouts, e.g. turn `3x5` into a ladder like the later programs use. This could be done:
   - in `data/config/overrides.yaml` (a per-item override of the scheme), then re-run the importer and the uploader, or
   - **by hand in the PocketBase admin UI** (`/_/` → `workout_items`). Open the item and change three fields:
     - `planned_sets`: the JSON list of sets, each with a `pct`, e.g. `[{"pct":60,"reps":5},{"pct":70,"reps":5},{"pct":75,"reps":5}]`
     - `prescription`: the text shown on the card, e.g. `60/5, 70/5, 75/5`
     - `scheme_type`: set it to `pct`

     Then use **Settings → Re-download workouts** in the app to pick up the change.
**Caveat:** running `importer.upload` again overwrites template records, so hand edits would be lost unless they're also copied into `overrides.yaml`, or the uploader is changed to skip edited items. Good for a few quick fixes; the overrides route is safer for all 70 workouts.
   - later, in the app's program editor (Phase 6), once it exists.

   It needs a rule for picking the percentages, e.g. based on rep count and week, or copied from similar later workouts.
2. **Remove them.** Drop these programs from the main timeline with `exclude` rules in `overrides.yaml`. This would lose the Beginner's Cycles, which are useful for ramping back up after a break.

**Decision:** to be made later; adding percentages is the likely route.

**Status (Nov 27, 2026): done for the five programs; the Beginner's Cycles stay as written (your choice).**

- **Approach:** a `scheme_overrides` section in `data/config/overrides.yaml`, which the importer applies by program, exercise and week. It replaces only the prescription line, keeps the coach's notes, and logs each change in `review.csv` (111 changes).
- **Percentages:** the original sets and reps are kept, and the percentage steps up 2.5% every week, as these programs' notes say to add weight weekly. The levels come from the coach's later percentage programs:

  | Lift type | W1 | W2 | W3 | W4 |
  | --- | --- | --- | --- | --- |
  | Olympic lifts, jerks, Snatch Balance | (60/4)2, (65/3)3 | (62.5/4)2, (67.5/3)3 | (65/4)2, (70/3)3 | (67.5/4)2, (72.5/3)3 |
  | Pulls, extensions, segmented deadlifts | (70/4)2, (80/3)3 | (72.5/4)2, (82.5/3)3 | (75/4)2, (85/3)3 | (77.5/4)2, (87.5/3)3 |
  | Back / Front Squat | (70/5)4 | (72.5/5)4 | (75/5)4 | (77.5/5)4 |
  | April 2022 (one week) | squats (70/5)4, RDL (60/5)4 | | | |

- **Unchanged:** Sots Press, bench, presses, rows and accessories keep plain sets × reps.
- **To apply:** re-run the importer, then `python -m importer.upload`. The app re-downloads templates on its next sync.

## ✅ Done: Loop back to the start after the last workout

**Problem.** The last workout in the main timeline is Block 2025-10, W2D2 (#314). Finishing it has nowhere to go, so the position stays put and Today keeps showing that same workout.

**Wanted.** After #314, start the timeline over automatically, skipping the Beginner's Cycles. The next workout would be RTF, W1D1 (#37). The Beginner's Cycles stay in the timeline for ramping back up after a break, reached with "Set as current".

**How it could work.**

- In `finishWorkout` (`app/src/lib/workout.ts`), when the main track has no next workout, wrap to the restart point.
- Add 1 to the main track's `round` (the field already exists for restarts). The done marks could reset per round so each pass starts clean.
- **Preference: show the round number and keep counting up, never resetting it** (Round 2, Round 3, …), so you can see how many times you've looped through the program. Show it on Today (e.g. "#37 of 314 · Round 2"), in the Timeline header, and on each History session, and record it on each session so past rounds stay labeled.
- Keep the restart point as a setting rather than hard-coding #37, e.g. "restart at the first workout after the Beginner's Cycles", so it still holds if the importer's numbering changes.
- Show a short message when it wraps ("Program complete. Starting round 2 at RTF W1D1."), so it isn't a surprise.

**Related:** starting the loop at RTF skips the Beginner's Cycles, but the rest of the no-percentage block is still in the loop: March 2021 – August 2022, #61–94. See "Add percentages to the early workouts" above.

**Status (Nov 27, 2026): done.**

- **Wrap:** finishing or skipping #314 moves to the first main workout that isn't a Beginner's Cycle (found by program name, so it doesn't depend on #37) and adds 1 to the round. Today shows "Program complete. Starting Round 2 at RTF W1D1."
- **Round shown:** in the Today header ("#37 of 314 · Round 2"), at the top of Timeline → Main, and on each History session. Each session records its round in a new `round` field (migration `1764400000_session_round.js`). Older sessions without it count as Round 1.
- **Done marks:** Timeline counts only sessions from the current round, so each pass starts fresh.
- **Reset after a break:** Timeline → Main → **Back to Beginner's Cycle 1** moves to #1 but keeps the round. If you're halfway through Round 2, you stay in Round 2 and restart from Beginner's Cycle 1. "Set as current" also keeps the round.
- **Tests:** stay outside the rounds; supplemental programs keep their own restart rounds.

## Withings: get weight and body fat automatically

**Problem.** Bodyweight and body fat are typed in by hand on the Body screen, or imported from a CSV. A Withings scale already measures both at every weigh-in.

**Wanted.** Weigh-ins from the Withings scale show up in the app on their own, as Bodyweight (lb) and Body fat (%) measurements, with no typing and no CSV.

**How it could work.**

- **Run it on the server, not the phone.** A PocketBase JS hook (a new `pb_hooks/` folder in the Dockge stack) checks Withings every few hours with `cronAdd` and writes the new weigh-ins into `body_measurements`. The phone picks them up on its next sync like any other change. The app can't do this itself: it's only open while you're using it, and an iPhone web app can't run in the background.
- **Withings developer app.** Register a free app in the Withings developer portal to get a client ID and secret. Its callback URL can be the server's Tailscale HTTPS address: the OAuth redirect goes through your browser, so Withings never has to reach the server.
- **Connect once.** A "Connect Withings" button in Settings opens the Withings sign-in, and the server swaps the returned code for tokens. The access token lasts about 3 hours and the refresh token is renewed on each use, so the hook refreshes it on every run. Tokens go in a new collection only the superuser can read.
- **What to fetch:** the Measure "getmeas" call with measure types 1 (weight, kg) and 6 (fat ratio, %), only for weigh-ins since the last run. Withings sends each value as a number plus a power of ten, so it needs scaling. Weight is converted to lb.
- **Storing it:**
  - Write to the existing `bodyweight` and `body_fat` body parts.
  - Add `withings` to the measurement `source` options, so these readings are easy to tell apart from manual ones.
  - `body_measurements` allows one value per body part per day. So with several weigh-ins in a day, keep the latest, and never overwrite a value you entered by hand that day.
- **Check now, from the app:** besides the schedule, a **Get weigh-ins** button asks the server to call Withings straight away.
  - Where: on the Body screen next to Bodyweight, and in the Withings card in Settings.
  - How: the hook adds a custom route, e.g. `POST /api/withings/sync`, with `routerAdd`. It only answers a signed-in user and runs the same fetch as the schedule.
  - The reply says what happened, e.g. "2 new weigh-ins (latest 182.4 lb, 14.8%, today 7:02 AM)" or "No new weigh-ins". The app then syncs, so the new values show up right away.
  - Repeated taps are harmless: weigh-ins already saved are skipped. The button is disabled while a check is running.
  - Offline or off Tailscale, the button says it can't reach the server, like the other server actions.
- **Settings card:** shows Connected / Not connected, the last weigh-in fetched, when the server last checked, and the Get weigh-ins button.
- **No push from Withings.** Withings can notify a server instantly when you weigh in, but only at a URL it can reach over the internet. The server is only on Tailscale, so it checks on a schedule instead. A few hours' delay is fine for weight.

**To confirm when building:** the measure type numbers, token lifetimes and rate limits against the current Withings API docs. Also check whether the hook needs outbound internet access opened from the NAS.

## In-app program builder and Duplicate

**Deferred from Phase 6.** Supplemental programs come in by CSV upload. The plan also had:

- **A form builder:** program → phases → workouts → exercises, with exercise names autocompleting from the library so history links up. Useful for short programs and small tweaks without editing a CSV.
- **Duplicate:** copy a program, then edit the copy. Only useful once the builder exists.

**For now:** edit the CSV and upload it again (delete the old program first if you don't want both), or change single fields in the PocketBase admin UI (`workout_items` with ids starting `sup-`).
