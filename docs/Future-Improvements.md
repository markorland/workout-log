# Future Improvements

Ideas and known gaps to come back to after the main build phases. Not scheduled yet.

## Add percentages to the early workouts (or remove them)

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

## Loop back to the start after the last workout

**Problem.** The last workout in the main timeline is Block 2025-10, W2D2 (#314). Finishing it has nowhere to go, so the position stays put and Today keeps showing that same workout.

**Wanted.** After #314, start the timeline over automatically, skipping the Beginner's Cycles. The next workout would be RTF, W1D1 (#37). The Beginner's Cycles stay in the timeline for ramping back up after a break, reached with "Set as current".

**How it could work.**

- In `finishWorkout` (`app/src/lib/workout.ts`), when the main track has no next workout, wrap to the restart point.
- Add 1 to the main track's `round` (the field already exists for restarts). The done marks could reset per round so each pass starts clean.
- **Preference: show the round number and keep counting up, never resetting it** (Round 2, Round 3, …), so you can see how many times you've looped through the program. Show it on Today (e.g. "#37 of 314 · Round 2"), in the Timeline header, and on each History session, and record it on each session so past rounds stay labeled.
- Keep the restart point as a setting rather than hard-coding #37, e.g. "restart at the first workout after the Beginner's Cycles", so it still holds if the importer's numbering changes.
- Show a short message when it wraps ("Program complete. Starting round 2 at RTF W1D1."), so it isn't a surprise.

**Related:** starting the loop at RTF skips the Beginner's Cycles, but the rest of the no-percentage block is still in the loop: March 2021 – August 2022, #61–94. See "Add percentages to the early workouts" above.

## In-app program builder and Duplicate

**Deferred from Phase 6.** Supplemental programs come in by CSV upload. The plan also had:

- **A form builder:** program → phases → workouts → exercises, with exercise names autocompleting from the library so history links up. Useful for short programs and small tweaks without editing a CSV.
- **Duplicate:** copy a program, then edit the copy. Only useful once the builder exists.

**For now:** edit the CSV and upload it again (delete the old program first if you don't want both), or change single fields in the PocketBase admin UI (`workout_items` with ids starting `sup-`).
