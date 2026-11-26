"""Workout-level steps: grouping rows, title fixes, reruns, track
classification and program grouping."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

WORKOUT_ID = re.compile(r"/workouts/(\d+)")
WEEK_DAY = re.compile(r"\bW(\d+)\s*D(\d+)\b", re.I)
WEEK_ONLY = re.compile(r"\bW(\d+)\b(?!\s*D)", re.I)
DAY_ONLY = re.compile(r"\bD(?:AY)?\s*(\d+)\b", re.I)


@dataclass
class Row:
    index: int
    date: date
    title: str
    link: str
    block: str
    name: str
    reps: str


@dataclass
class Workout:
    source_id: str  # TrueCoach workout ID; importer-internal only
    date: date
    first_index: int
    original_title: str
    title: str
    rows: list[Row] = field(default_factory=list)
    track: str = "main"  # main | supplemental | test
    week: int | None = None
    day: int | None = None
    program_key: str = ""
    notes: list[str] = field(default_factory=list)

    def signature(self) -> tuple:
        """Exercise names + schemes, used to compare reruns with originals."""
        return tuple((r.name.strip().lower(), r.reps.split("\n")[0].strip()) for r in self.rows)


def parse_date(s: str) -> date:
    s = s.strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"unrecognized date: {s!r}")


def read_rows(records: list[dict]) -> list[Row]:
    out = []
    for i, r in enumerate(records):
        out.append(
            Row(
                index=i,
                date=parse_date(r["Workout Date"]),
                title=r["Workout Title"].strip(),
                link=r["View Workout Link"].strip(),
                block=r["Exercise Superset"].strip(),
                name=r["Exercise Name"].strip(),
                reps=r["Exercise Reps"] or "",
            )
        )
    return out


def group_workouts(rows: list[Row]) -> list[Workout]:
    """Group rows by TrueCoach workout ID, ordered by date then first row."""
    by_id: dict[str, Workout] = {}
    for r in rows:
        m = WORKOUT_ID.search(r.link)
        if not m:
            raise ValueError(f"row {r.index}: no workout ID in link {r.link!r}")
        wid = m.group(1)
        w = by_id.get(wid)
        if w is None:
            w = by_id[wid] = Workout(wid, r.date, r.index, r.title, r.title)
        w.rows.append(r)
    return sorted(by_id.values(), key=lambda w: (w.date, w.first_index))


def apply_title_fixes(workouts: list[Workout], overrides: dict) -> list[dict]:
    """Apply ``title_replace`` (substring) and ``title_fixes`` (by date)."""
    log = []
    for w in workouts:
        new = w.title
        for rep in overrides.get("title_replace") or []:
            new = new.replace(rep["from"], rep["to"])
        for fx in overrides.get("title_fixes") or []:
            if parse_date(str(fx["date"])) == w.date and fx["from"] == w.original_title:
                new = fx["to"]
        if new != w.title:
            log.append({"date": w.date, "from": w.title, "to": new})
            w.title = new
        wd = WEEK_DAY.search(w.title)
        if wd:
            w.week, w.day = int(wd.group(1)), int(wd.group(2))
        else:
            wk = WEEK_ONLY.search(w.title)
            dy = DAY_ONLY.search(w.title)
            w.week = int(wk.group(1)) if wk else None
            w.day = int(dy.group(1)) if dy else None
    return log


def drop_reruns(workouts: list[Workout], overrides: dict) -> tuple[list[Workout], list[dict]]:
    """Remove the rerun blocks listed in overrides.yaml.

    Each block gives a date range, an optional title prefix, and the date
    range of the original it copies. For the log, each dropped workout is
    compared with the original block: "identical" if some original workout
    has the same exercises and schemes.
    """
    kept, log = [], []
    blocks = overrides.get("reruns") or []
    for w in workouts:
        hit = None
        for b in blocks:
            lo, hi = parse_date(str(b["from"])), parse_date(str(b["to"]))
            if lo <= w.date <= hi and w.original_title.startswith(b.get("title_prefix", "")):
                hit = b
                break
        if hit is None:
            kept.append(w)
            continue
        match = "different"
        if hit.get("copy_of"):
            lo, hi = (parse_date(str(x)) for x in hit["copy_of"])
            originals = [o for o in workouts if lo <= o.date <= hi]
            if any(o.signature() == w.signature() for o in originals):
                match = "identical"
        log.append({"workout": w, "block": hit.get("name", ""), "match": match})
    return kept, log


def drop_excluded(workouts: list[Workout], overrides: dict) -> tuple[list[Workout], list[Workout]]:
    """Remove workouts whose title matches an ``exclude`` entry's title_regex."""
    rules = overrides.get("exclude") or []
    kept, dropped = [], []
    for w in workouts:
        if any(re.search(r["title_regex"], w.original_title) for r in rules):
            dropped.append(w)
        else:
            kept.append(w)
    return kept, dropped


def classify(workouts: list[Workout], overrides: dict, is_main_day) -> dict[str, list[Workout]]:
    """Split workouts into main / test / accessory.

    ``is_main_day(workout) -> bool`` says whether a workout has a main lift.
    """
    tests = overrides.get("tests") or []
    forced = overrides.get("force_track") or []
    out: dict[str, list[Workout]] = {"main": [], "test": [], "accessory": []}
    for w in workouts:
        t = next((t for t in tests if re.search(t["title_regex"], w.original_title)), None)
        f = next((f for f in forced
                  if parse_date(str(f["from"])) <= w.date <= parse_date(str(f["to"]))
                  and re.search(f.get("title_regex", ""), w.title)), None)
        if f and not t:
            key = "main" if f["track"] == "main" else "accessory"
            w.track = "main" if key == "main" else "supplemental"
            out[key].append(w)
        elif t:
            w.track = "test"
            w.program_key = t["template"]
            out["test"].append(w)
        elif is_main_day(w):
            w.track = "main"
            out["main"].append(w)
        else:
            w.track = "supplemental"
            out["accessory"].append(w)
    return out


def title_prefix(title: str, overrides: dict) -> str:
    """Program part of a title: text before the week/day label."""
    for rule in overrides.get("program_prefix") or []:
        if re.search(rule["match"], title):
            return rule["prefix"]
    t = re.sub(r"^Mark - ", "", title)
    t = re.split(r"\s+-\s+(?:Accessory\b.*|W\d+.*|D\d+.*)$|\s+(?:Accessory\s+)?W\d+.*$", t)[0]
    if WEEK_DAY.fullmatch(t.strip()) or re.fullmatch(r"W\d+(?:D\d+)?|D\d+", t.strip()):
        return ""
    return t.strip()


def group_programs(workouts: list[Workout], overrides: dict, gap_days: int = 10) -> list[list[Workout]]:
    """Consecutive runs of workouts with the same title prefix.

    A new program starts when the prefix changes, the gap since the previous
    workout exceeds ``gap_days``, or the week number goes back (W1 after W4).
    """
    programs: list[list[Workout]] = []
    prev: Workout | None = None
    prev_prefix = None
    for w in workouts:
        prefix = title_prefix(w.title, overrides)
        new = (
            prev is None
            or prefix != prev_prefix
            or (w.date - prev.date).days > gap_days
            or (w.week is not None and prev.week is not None and w.week < prev.week)
        )
        if new:
            programs.append([])
        programs[-1].append(w)
        prev, prev_prefix = w, prefix
    return programs


def program_name(ws: list[Workout], overrides: dict) -> str:
    prefix = title_prefix(ws[0].title, overrides)
    if prefix:
        return prefix
    first, last = ws[0], ws[-1]
    label = lambda w: f"W{w.week}D{w.day}" if w.week and w.day else w.title
    return f"Block {first.date:%Y-%m} ({label(first)}–{label(last)})"
