"""Exercise-library attributes guessed from the name: category, load type,
unilateral. All of them can be corrected later in the PocketBase admin UI."""

from __future__ import annotations

import re

from .names import fold

CIRCUIT = re.compile(r"^(accessory|accessory work|superset|ab circuit|cool down|conditioning)$")
CONDITIONING = re.compile(
    r"\b(row conditioning|conditioning|run|echo bike|ski erg|erg|emom|amrap|murph ish|burpee|1 000m row|1000m row|400m run)\b"
)
ARMS = re.compile(r"\b(curl|skull ?crusher|tricep|bicep|zottman)\b")
PRESS = re.compile(r"\b(bench press|dip|push up|pushup|arnold press|shoulder press|swimmer press|landmine press|strict press|handstand)\b")
BODYWEIGHT = re.compile(
    r"\b(push up|pushup|pull up|strict dip|sit up|crunch|leg raise|knee raise|plank|v up|box jump|"
    r"jumping lunge|squat jump|nordic|inverted row|handstand|ab roll out|body saw|dead bug|leg tuck|"
    r"double leg stretch|heel tap|side plank|russian twist|ring row|back extension|glute bridge|trx row)\b"
)
TIME = re.compile(r"\b(plank hold|weighted plank)\b")
UNILATERAL = re.compile(r"\b(single arm|single leg|unilateral)\b")


def category_for(name: str, base_lift: str | None) -> str:
    key = fold(name)
    if CIRCUIT.match(key):
        return "circuit"
    if CONDITIONING.search(key):
        return "conditioning"
    single = "+" not in key
    if base_lift and re.search(r"\b(rdl|romanian|good morning)\b", key):
        return "pull"
    if base_lift in ("back_squat", "front_squat"):
        return "squat"
    if base_lift and single and re.search(r"\b(pull|extension|deadlift|segment|shrug)\b", key):
        return "pull"
    if base_lift and re.search(r"\b(push press|press from split|sot|strict press)\b", key) and "+" not in key:
        return "press"
    if base_lift == "deadlift":
        return "pull"
    if base_lift:
        return "oly"
    if ARMS.search(key) and "leg curl" not in key:
        return "arms"
    if PRESS.search(key):
        return "press"
    return "accessory"


def load_type_for(name: str, category: str, scheme_types: set[str], timed: bool) -> str:
    key = fold(name)
    if category == "circuit":
        return "text"
    if category == "conditioning":
        return "time"
    if timed or TIME.search(key):
        return "time"
    if BODYWEIGHT.search(key) and not re.search(r"\bweighted\b|dumbbell|kettlebell|\bdb\b|\bkb\b", key):
        return "bodyweight"
    return "weight"


def unilateral_for(name: str, any_per_side: bool) -> bool:
    return bool(UNILATERAL.search(fold(name))) or any_per_side
