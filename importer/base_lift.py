"""Base-lift rules: which 1RM a percentage is taken from.

Rules follow the "Percentage and 1RM logic" section of docs/Plan.md:

1. RDL / Romanian Deadlift always uses Back Squat (notes are ignored).
2. A note naming a lift ("40-45% of back squat", "@ 40% 1RM C&J",
   "Base % off max Snatch") overrides the default.
3. Default by keyword on the exercise name, complexes judged by their parts.

Dumbbell, kettlebell, goblet, landmine, trap-bar and single-leg variants never
get a base lift. An exercise with a base lift is a "main lift"; a workout with
no main lift is an accessory day.
"""

from __future__ import annotations

import re

from .names import components, fold

BASE_LIFTS = {
    "snatch": "Snatch",
    "clean_and_jerk": "Clean & Jerk",
    "back_squat": "Back Squat",
    "front_squat": "Front Squat",
    "deadlift": "Deadlift",
}

# Clean-family and jerk-family lifts are always taken off the Clean & Jerk 1RM.
COLLAPSE = {"clean": "clean_and_jerk", "jerk": "clean_and_jerk"}


def to_base(lift: str | None) -> str | None:
    return COLLAPSE.get(lift, lift) if lift else None

NOT_BARBELL = re.compile(
    r"\b(dumbbell|db|kettlebell|kb|goblet|landmine|trap bar|single leg|single arm|"
    r"machine|cable|band|banded|med ball|swis ball|swiss ball)\b"
)
RDL = re.compile(r"\b(rdl|romanian deadlift)\b")


def _is_snatch(c: str) -> bool:
    return bool(
        re.search(r"\bsnatch\b|\boverhead squat\b|\boh squat\b|\bohs\b|\bsot\b|\bsots\b", c)
    )


def _is_clean(c: str) -> bool:
    return "clean" in c and not _is_cj(c)


def _is_cj(c: str) -> bool:
    return bool(re.search(r"clean and jerk", c))


def _is_jerk(c: str) -> bool:
    return bool(
        re.search(r"\bjerk\b|push press|press from split|jump to split", c)
    )


def _single(c: str) -> str | None:
    if _is_cj(c):
        return "clean_and_jerk"
    if re.search(r"\bback squat\b|\bgood morning\b", c):
        return "back_squat"
    if re.search(r"\bfront squat\b", c) and not _is_jerk(c):
        return "front_squat"
    if _is_snatch(c):
        return "snatch"
    if _is_clean(c):
        return "clean"
    if _is_jerk(c):
        return "jerk"
    if re.fullmatch(r"(?:deficit |halting |pause )?deadlift", c):
        return "deadlift"
    return None


def default_base_lift(name: str) -> str | None:
    """Base lift from the exercise name alone (one of BASE_LIFTS, or None)."""
    return to_base(lift_family(name))


def lift_family(name: str) -> str | None:
    """Lift family from the name: snatch, clean, clean_and_jerk, jerk, squats, deadlift."""
    key = fold(name)
    if NOT_BARBELL.search(key):
        return None
    if RDL.search(key):
        return "back_squat"
    parts = [fold(p) for p in components(name)]
    if len(parts) == 1:
        return _single(parts[0])
    if any(_is_snatch(p) for p in parts):
        return "snatch"
    has_clean = any(_is_clean(p) or _is_cj(p) for p in parts)
    if has_clean and _is_jerk(parts[-1]):
        return "clean_and_jerk"
    if has_clean:
        return "clean"
    if any(_is_jerk(p) for p in parts):
        return "jerk"
    for p in parts:
        lift = _single(p)
        if lift:
            return lift
    return None


def base_lift_for_item(exercise_name: str, note_lift: str | None) -> tuple[str | None, str | None]:
    """Return (exercise default, row override) for one workout item.

    The override is set only when a note names a lift different from the
    default, and never for RDL.
    """
    default = default_base_lift(exercise_name)
    note_lift = to_base(note_lift)
    if RDL.search(fold(exercise_name)) and default:
        return default, None
    if note_lift and note_lift != default:
        return default, note_lift
    return default, None
