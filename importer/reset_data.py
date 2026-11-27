"""Erase everything logged in the app, keeping the workout templates.

Usage:
    python3 -m importer.reset_data            # dry run: shows what would be deleted
    python3 -m importer.reset_data --yes      # delete it
    python3 -m importer.reset_data --yes --programs   # also delete uploaded supplemental programs (sup-*)

Deletes: set logs, sessions, positions (track_state) and body measurements.
Keeps: 1RMs, progress photos, the main timeline, Barbell Accessory, the test
templates, exercises, body parts, settings and your login. Add --maxes or
--photos to delete those too.

Reset the phone as well: its offline copy doesn't pick up deletions (see the
deploy README, "Starting fresh").

Uses the same .env as importer.upload.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from importer.upload import PocketBase, load_env

# Children before parents, so relations never point at a deleted record.
LOG_COLLECTIONS = ["set_logs", "body_measurements", "sessions", "track_state"]
PROGRAM_COLLECTIONS = ["workout_items", "workouts", "programs"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="really delete (otherwise a dry run)")
    ap.add_argument("--programs", action="store_true", help="also delete uploaded supplemental programs (sup-*)")
    ap.add_argument("--maxes", action="store_true", help="also delete 1RMs")
    ap.add_argument("--photos", action="store_true", help="also delete progress photos")
    args = ap.parse_args()

    load_env(Path(__file__).resolve().parent.parent / ".env")
    url, email, pw = (os.environ.get(k) for k in ("PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"))
    if not (url and email and pw):
        sys.exit("Set PB_URL, PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD (in .env).")
    pb = PocketBase(url)
    pb.login(email, pw)

    collections = (["one_rep_maxes"] if args.maxes else []) + (["progress_photos"] if args.photos else []) + LOG_COLLECTIONS
    plan: list[tuple[str, list[str]]] = [(c, sorted(pb.ids(c))) for c in collections]
    # Kept 1RMs from a test point at its session; unlink them so the sessions can go.
    unlink = [] if args.maxes else sorted(pb.ids("one_rep_maxes"))
    if args.programs:
        plan += [(c, sorted(i for i in pb.ids(c) if i.startswith("sup-"))) for c in PROGRAM_COLLECTIONS]

    print(f"Server: {url}")
    for c, ids in plan:
        print(f"  {c:<18} {len(ids):>5} to delete")
    kept = [c for c, flag in (("one_rep_maxes", args.maxes), ("progress_photos", args.photos)) if not flag]
    print(f"  kept: {', '.join(kept + ['templates', 'settings', 'login'])}")
    if not args.yes:
        print("Dry run. Add --yes to delete.")
        return

    for rid in unlink:
        pb.update("one_rep_maxes", {"id": rid, "session": ""})
    for c, ids in plan:
        for rid in ids:
            pb.delete(c, rid)
        print(f"  {c:<18} deleted {len(ids)}")
    print("Done. Now reset the phone and reinstall the app.")


if __name__ == "__main__":
    main()
