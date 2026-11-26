"""Exercise-name normalization.

Raw TrueCoach names carry abbreviations in parentheses, spelling slips and
several spellings of the same lift. ``clean_name`` turns a raw name into a
display name; ``fold`` turns a display name into a comparison key so that
variants collapse to one exercise. An alias table (``aliases.yaml``) maps the
remaining variants to one canonical name.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

PARENS = re.compile(r"\s*\((?:[^()]|\([^()]*\))*\)\)?")
LEADING_COUNT = re.compile(r"^\d+\s+(?=[A-Za-z])")
WORD_FIXES_DEFAULT = {"BELOW": "Below", "ABOVE": "Above"}


def clean_name(raw: str, spelling: dict[str, str] | None = None) -> str:
    """Strip abbreviations in parentheses, fix spelling, tidy spacing.

    "Back Squat (FSq)"                              -> "Back Squat"
    "2 Clean Extension + 1 Clean + 1 Jerk (… J))"   -> "2 Clean Extension + 1 Clean + 1 Jerk"
    "Clean Pull to Hip (ClPuToHip) + Clean Pull to Hold" -> "Clean Pull to Hip + Clean Pull to Hold"
    """
    name = PARENS.sub("", raw).strip()
    name = name.rstrip("!").strip()
    for wrong, right in {**WORD_FIXES_DEFAULT, **(spelling or {})}.items():
        name = re.sub(rf"(?<![A-Za-z]){re.escape(wrong)}(?![A-Za-z])", right, name)
    name = re.sub(r"\s*\+\s*", " + ", name)
    name = re.sub(r"\s+", " ", name)
    return name


def fold(name: str) -> str:
    """Comparison key: case, hyphens, '&'/'and', plurals and 'w/' ignored."""
    s = name.lower()
    s = s.replace("&", " and ").replace("w/", "with ")
    s = re.sub(r"[-_']", " ", s)
    s = re.sub(r"[^a-z0-9+:/ ]", "", s)
    words = []
    for w in s.split():
        if len(w) >= 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        words.append(w)
    return " ".join(words)


def components(name: str) -> list[str]:
    """Split a complex on ' + ' and drop rep counts ("2 Snatch Pull" -> "Snatch Pull")."""
    parts = [p.strip() for p in name.split(" + ") if p.strip()]
    return [LEADING_COUNT.sub("", p) for p in parts]


@dataclass
class AliasTable:
    """Maps folded variant keys to a canonical display name."""

    spelling: dict[str, str] = field(default_factory=dict)
    by_key: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict | None) -> "AliasTable":
        data = data or {}
        table = cls(spelling=dict(data.get("spelling") or {}))
        for canonical, variants in (data.get("exercises") or {}).items():
            table.by_key[fold(canonical)] = canonical
            for v in variants or []:
                table.by_key[fold(clean_name(v, table.spelling))] = canonical
        return table

    def canonical(self, raw: str) -> str:
        """Display name for a raw name: alias target, else the cleaned name."""
        cleaned = clean_name(raw, self.spelling)
        return self.by_key.get(fold(cleaned), cleaned)

    def canonical_component(self, part: str) -> str:
        cleaned = clean_name(part, self.spelling)
        return self.by_key.get(fold(cleaned), cleaned)


def slug(name: str) -> str:
    s = fold(name).replace("+", " plus ").replace("/", " ").replace(":", " ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")
