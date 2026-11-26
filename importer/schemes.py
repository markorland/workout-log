"""Rep-scheme parsing for TrueCoach "Exercise Reps" cells.

A cell's first non-empty line is the prescription; everything after it is
coach notes. The prescription is one of:

* percentage scheme   ``60/4, (70/3)2``      -> sets at % of a base lift's 1RM
* sets x reps         ``4x5``, ``3x8-10``    -> sets with no % (pick a weight)
* max attempt         ``Find 1RM.``          -> open-ended build to a max
* text                anything else          -> shown as written

Percentage schemes are auto-fixed for the typos found in the export before
parsing; every fix is reported so it can be spot-checked.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Result type
# --------------------------------------------------------------------------


@dataclass
class Scheme:
    type: str  # "pct" | "sets_reps" | "sets_only" | "max_attempt" | "text"
    prescription: str  # first line as written
    notes: str = ""  # remaining lines (plus any trailing text on line one)
    fixed: str | None = None  # prescription after typo fixes (pct only)
    fixes: list[str] = field(default_factory=list)  # names of fixes applied
    planned_sets: list[dict] = field(default_factory=list)
    set_count: int | None = None
    rep_min: int | None = None
    rep_max: int | None = None
    per_side: bool = False
    seconds: int | None = None
    open_ended: bool = False
    note_pct_min: float | None = None
    note_pct_max: float | None = None
    note_base_lift: str | None = None
    needs_review: bool = False
    review_reason: str = ""


# --------------------------------------------------------------------------
# Splitting
# --------------------------------------------------------------------------


def split_cell(cell: str) -> tuple[str, str]:
    """Return (first non-empty line, remaining lines joined by newlines)."""
    lines = [ln.rstrip() for ln in cell.replace("\r", "").split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return "", ""
    first = lines[0].strip()
    rest = "\n".join(ln for ln in lines[1:]).strip()
    return first, rest


# --------------------------------------------------------------------------
# Percentage schemes
# --------------------------------------------------------------------------

PCT_LIKE = re.compile(r"^[\d(^]")  # starts like a % scheme
HAS_PAIR = re.compile(r"\d\s*/\s*\d")

# (name, pattern, replacement) applied in order.
FIXES: list[tuple[str, re.Pattern, str]] = [
    ("stray_semicolon", re.compile(r"(\d);/"), r"\1/"),
    ("double_slash", re.compile(r"(\d)//(\d)"), r"\1/\2"),
    ("caret_for_6", re.compile(r"\^(\d)"), r"6\1"),
    # 654 -> 65/4 (a bare 3-digit list element)
    ("missing_slash", re.compile(r"(?:(?<=^)|(?<=, ))(\d{2})(\d)(?=,|$)"), r"\1/\2"),
    # (70/32) -> (70/3)2
    ("misplaced_paren", re.compile(r"\((\d+)/(\d)(\d)\)(?!\d)"), r"(\1/\2)\3"),
    # 70/3)2 at the start -> (70/3)2
    ("unbalanced_paren", re.compile(r"^(\d+/\d+)\)(\d)"), r"(\1)\2"),
    # (75/3, 80/2 -> 75/3, 80/2 (an opening paren that never closes)
    ("unbalanced_paren", re.compile(r"\((\d+/\d+)(?=\s*,|\s+\d|\s+\()"), r"\1"),
    # (65/2)2 70/1 -> (65/2)2, 70/1   |   65/4 70/3 -> 65/4, 70/3
    ("missing_comma", re.compile(r"(\)\d+|\d/\d+)\s+(?=[(\d])"), r"\1, "),
]

GROUP = re.compile(r"\((\d+(?:\.\d+)?)/(\d+)\)(\d+)")
SINGLE = re.compile(r"(\d+(?:\.\d+)?)/(\d+)")
OPEN_ENDED = re.compile(r"keep going|until failure|becomes compromised", re.I)


def fix_pct(text: str) -> tuple[str, list[str]]:
    """Apply the known typo fixes; return (fixed text, fix names applied)."""
    applied: list[str] = []
    out = text.strip()
    for name, pat, repl in FIXES:
        new = pat.sub(repl, out)
        if new != out:
            if name not in applied:
                applied.append(name)
            out = new
    return out, applied


def parse_pct(text: str) -> tuple[list[dict], str] | None:
    """Strictly parse a fixed % scheme.

    Returns (planned_sets, trailing_text) or None if any element is not a
    ``pct/reps`` or ``(pct/reps)sets`` token. Trailing free text after the
    last token (e.g. "keep going until failure") is returned separately.
    """
    sets: list[dict] = []
    parts = [p.strip() for p in text.split(",")]
    trailing: list[str] = []
    for i, part in enumerate(parts):
        if not part:
            continue
        m = GROUP.fullmatch(part)
        if m:
            pct, reps, n = float(m.group(1)), int(m.group(2)), int(m.group(3))
            sets.extend({"pct": _num(pct), "reps": reps} for _ in range(n))
            continue
        m = SINGLE.fullmatch(part)
        if m:
            sets.append({"pct": _num(float(m.group(1))), "reps": int(m.group(2))})
            continue
        # Free text is only allowed after at least one token, to the end.
        if sets and not any(GROUP.search(p) or SINGLE.search(p) for p in parts[i:]):
            trailing = parts[i:]
            break
        return None
    if not sets:
        return None
    return sets, ", ".join(trailing)


def _num(x: float) -> float | int:
    return int(x) if x == int(x) else x


# --------------------------------------------------------------------------
# Sets x reps
# --------------------------------------------------------------------------

SETS_REPS = re.compile(
    r"""^(?P<sets>\d+)\s*[xX]\s*
        (?:
            (?P<mm>\d+)?:(?P<ss>\d{2})                  # :45 | 1:00
          | (?P<min>\d+)(?:\s*-\s*(?P<max>\d+))?        # 5 | 8-10
        )
        (?P<unit>\s*sec\b)?
        (?P<side>\s*(?:/\s*(?:each\s+)?(?:leg|arm|side)|\s+each\s+(?:leg|arm|side)))?
        (?P<reps>\s*reps\b)?
    """,
    re.X,
)
SETS_ONLY = re.compile(r"^(\d+)\s*(?:[xX]\s+\D|sets?\b|SETS\b|rounds?\b)", re.I)


def parse_sets_reps(text: str) -> dict | None:
    """Parse one or more comma-separated ``SxR`` groups (e.g. ``2x4, 3x3``).

    Returns a dict with planned_sets and summary fields, or None. Any text
    after the last group is returned as ``suffix``.
    """
    rest = text.strip()
    groups: list[re.Match] = []
    while True:
        m = SETS_REPS.match(rest)
        if not m:
            break
        groups.append(m)
        rest = rest[m.end():]
        nxt = re.match(r"\s*,\s*(?=\d+\s*[xX])", rest)
        if not nxt:
            break
        rest = rest[nxt.end():]
    if not groups:
        return None

    planned: list[dict] = []
    rep_mins, rep_maxs, per_side, seconds = [], [], False, None
    for m in groups:
        n = int(m.group("sets"))
        if m.group("ss") is not None:
            secs = int(m.group("mm") or 0) * 60 + int(m.group("ss"))
            seconds = secs
            planned.extend({"seconds": secs} for _ in range(n))
            continue
        lo = int(m.group("min"))
        hi = int(m.group("max")) if m.group("max") else lo
        rep_mins.append(lo)
        rep_maxs.append(hi)
        side = bool(m.group("side"))
        per_side = per_side or side
        s: dict = {"reps": lo}
        if hi != lo:
            s["rep_max"] = hi
        if side:
            s["per_side"] = True
        planned.extend(dict(s) for _ in range(n))

    suffix = rest.strip().lstrip("-,").strip()
    return {
        "planned_sets": planned,
        "set_count": len(planned),
        "rep_min": min(rep_mins) if rep_mins else None,
        "rep_max": max(rep_maxs) if rep_maxs else None,
        "per_side": per_side,
        "seconds": seconds,
        "suffix": suffix,
    }


# --------------------------------------------------------------------------
# Max attempts and percentages written in the notes
# --------------------------------------------------------------------------

MAX_ATTEMPT = re.compile(r"find\s+1\s*rm|build to a .{0,12}single|build to a heavy", re.I)
REP_LADDER = re.compile(r"^\s*(\d+(?:\s*-\s*\d+)+)\s*$", re.M)

# Lift names as they appear in notes -> base lift key.
NOTE_LIFTS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"back\s*squat|\bbsq\b", re.I), "back_squat"),
    (re.compile(r"front\s*squat|\bfsq\b", re.I), "front_squat"),
    (re.compile(r"c\s*&\s*j|clean\s*(?:&|and)\s*jerk", re.I), "clean_and_jerk"),
    (re.compile(r"\bsnatch\b", re.I), "snatch"),
    (re.compile(r"\bclean\b", re.I), "clean"),
    (re.compile(r"\bjerk\b", re.I), "jerk"),
    (re.compile(r"\bdeadlift\b", re.I), "deadlift"),
]
NOTE_PCT_RANGE = re.compile(
    r"(\d+(?:\.\d+)?)\s*%?\s*[-–]\s*(\d+(?:\.\d+)?)\s*%\s*of\s+(?:your\s+)?(?:1\s*RM\s+)?(?P<lift>[A-Za-z& ]+)",
    re.I,
)
NOTE_PCT_AT = re.compile(
    r"@\s*(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:your\s+)?1\s*RM\s+(?P<lift>[A-Za-z& ]+)", re.I
)
NOTE_BASE = re.compile(r"(?:%\s*off|%\s*of)\s+(?:your\s+)?(?:max|1\s*RM)\s+(?P<lift>[A-Za-z& ]+)", re.I)


def _lift_in(text: str) -> str | None:
    best: tuple[int, str] | None = None
    for pat, key in NOTE_LIFTS:
        m = pat.search(text)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), key)
    return best[1] if best else None


def parse_note_pct(notes: str) -> tuple[float | None, float | None, str | None]:
    """Find a % range / start % and the lift it refers to in coach notes.

    "40-45% of back squat"        -> (40, 45, "back_squat")
    "Start @ 40% 1RM C&J"         -> (40, 40, "clean_and_jerk")
    "Base % off max Snatch"       -> (None, None, "snatch")
    """
    m = NOTE_PCT_RANGE.search(notes)
    if m:
        return float(m.group(1)), float(m.group(2)), _lift_in(m.group("lift"))
    m = NOTE_PCT_AT.search(notes)
    if m:
        v = float(m.group(1))
        return v, v, _lift_in(m.group("lift"))
    m = NOTE_BASE.search(notes)
    if m:
        return None, None, _lift_in(m.group("lift"))
    return None, None, None


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def parse_cell(cell: str) -> Scheme:
    first, rest = split_cell(cell)
    s = Scheme(type="text", prescription=first, notes=rest)
    lo, hi, lift = parse_note_pct(rest)
    s.note_pct_min, s.note_pct_max, s.note_base_lift = (
        _num(lo) if lo is not None else None,
        _num(hi) if hi is not None else None,
        lift,
    )

    if not first:
        return s

    # Percentage scheme
    if PCT_LIKE.match(first) and HAS_PAIR.search(first) and not re.match(r"^\d+\s*[xX]", first):
        fixed, fixes = fix_pct(first)
        parsed = parse_pct(fixed)
        s.type = "pct"
        s.fixed = fixed
        s.fixes = fixes
        if parsed is None:
            s.needs_review = True
            s.review_reason = "percentage scheme did not parse after auto-fix"
            return s
        sets, trailing = parsed
        s.planned_sets = sets
        s.set_count = len(sets)
        reps = [x["reps"] for x in sets]
        s.rep_min, s.rep_max = min(reps), max(reps)
        if trailing:
            s.notes = (trailing + ("\n" + s.notes if s.notes else "")).strip()
        s.open_ended = bool(OPEN_ENDED.search(trailing or "") or OPEN_ENDED.search(rest))
        return s

    # Max attempt ("Find 1RM", "Build to a heavy single")
    if MAX_ATTEMPT.search(first):
        s.type = "max_attempt"
        s.open_ended = True
        m = REP_LADDER.search(rest)
        if m:
            reps = [int(x) for x in re.split(r"\s*-\s*", m.group(1))]
            s.planned_sets = [{"reps": r} for r in reps]
            s.set_count = len(reps)
            s.rep_min, s.rep_max = min(reps), max(reps)
        return s

    # Sets x reps
    sr = parse_sets_reps(first)
    if sr:
        s.type = "sets_reps"
        s.planned_sets = sr["planned_sets"]
        s.set_count = sr["set_count"]
        s.rep_min, s.rep_max = sr["rep_min"], sr["rep_max"]
        s.per_side = sr["per_side"]
        s.seconds = sr["seconds"]
        if sr["suffix"]:
            s.notes = (sr["suffix"] + ("\n" + s.notes if s.notes else "")).strip()
        if s.note_pct_min is not None:
            mid = _num((s.note_pct_min + s.note_pct_max) / 2)
            for p in s.planned_sets:
                p["pct"] = mid
                if s.note_pct_min != s.note_pct_max:
                    p["pct_range"] = [s.note_pct_min, s.note_pct_max]
        return s

    m = SETS_ONLY.match(first)
    if m:
        s.type = "sets_only"
        s.set_count = int(m.group(1))
        return s

    return s
