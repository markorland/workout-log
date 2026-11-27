"""Turn the TrueCoach CSV export into templates.json + review.csv.

Usage:
    python -m importer.import_main data/raw/tribe_barbell_workouts.csv
        [--config data/config] [--out data/out]

Reads data/config/aliases.yaml, overrides.yaml and one_rep_maxes.yaml when
present. Nothing is uploaded; review the output, then run the uploader.
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

from .base_lift import BASE_LIFTS, base_lift_for_item, default_base_lift
from .classify import (
    apply_title_fixes,
    classify,
    drop_excluded,
    drop_reruns,
    group_programs,
    group_workouts,
    program_name,
    read_rows,
    title_prefix,
)
from .exercises import category_for, load_type_for, unilateral_for
from .names import AliasTable, components, fold, slug
from .schemes import parse_cell


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def scheme_rules(overrides: dict) -> list[dict]:
    """Normalize `scheme_overrides` rules: programs, exercises (folded names) and {week: prescription}."""
    out = []
    for rule in overrides.get("scheme_overrides") or []:
        weeks = {int(k): str(v) for k, v in (rule.get("weeks") or {}).items()}
        out.append({
            "programs": set(rule.get("programs") or []),
            "exercises": {fold(e) for e in rule.get("exercises") or []},
            "weeks": weeks,
            "all_weeks": rule.get("all_weeks"),
        })
    return out


def override_for(rules: list[dict], program: str, exercise: str, week: int | None) -> str | None:
    """The replacement prescription for this program/exercise/week, if a rule covers it."""
    for rule in rules:
        if program not in rule["programs"] or fold(exercise) not in rule["exercises"]:
            continue
        if week in rule["weeks"]:
            return rule["weeks"][week]
        if rule["all_weeks"]:
            return str(rule["all_weeks"])
    return None


def build(records: list[dict], aliases: dict, overrides: dict, maxes: dict) -> dict:
    """Run the pipeline in memory. Returns templates, review rows and stats."""
    table = AliasTable.from_dict(aliases)
    review: list[dict] = []

    def note(kind: str, w=None, item=None, detail: str = "", raw: str = ""):
        review.append(
            {
                "kind": kind,
                "date": w.date.isoformat() if w else "",
                "title": w.title if w else "",
                "block": item.block if item else "",
                "exercise": item.name if item else "",
                "raw": raw,
                "detail": detail,
            }
        )

    rows = read_rows(records)
    workouts = group_workouts(rows)
    n_read = len(workouts)

    for fx in apply_title_fixes(workouts, overrides):
        review.append({"kind": "title_fix", "date": fx["date"].isoformat(), "title": fx["to"],
                       "block": "", "exercise": "", "raw": fx["from"], "detail": f"{fx['from']} -> {fx['to']}"})

    workouts, dropped = drop_reruns(workouts, overrides)
    for d in dropped:
        note("rerun_dropped", d["workout"], detail=f"{d['block']} ({d['match']} to original)")

    workouts, excluded = drop_excluded(workouts, overrides)
    for w in excluded:
        note("excluded", w, detail="matches an exclude rule in overrides.yaml")

    # ---- exercises: canonical names, chosen display spelling -------------
    spellings: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    raw_by_key: dict[str, set] = collections.defaultdict(set)
    for w in workouts:
        for r in w.rows:
            canon = table.canonical(r.name)
            key = fold(canon)
            spellings[key][canon] += 1
            raw_by_key[key].add(r.name)
    display = {k: c.most_common(1)[0][0] for k, c in spellings.items()}

    def exercise_key(raw: str) -> str:
        return fold(table.canonical(raw))

    def is_main_day(w) -> bool:
        return any(default_base_lift(display[exercise_key(r.name)]) for r in w.rows)

    split = classify(workouts, overrides, is_main_day)

    # ---- programs and workouts ------------------------------------------
    programs, out_workouts, items = [], [], []
    ex_usage: dict[str, dict] = collections.defaultdict(lambda: {"types": set(), "per_side": False, "timed": False})

    rules = scheme_rules(overrides)

    def add_items(w, wid: str, program: str = ""):
        for order, r in enumerate(w.rows, start=1):
            key = exercise_key(r.name)
            name = display[key]
            s = parse_cell(r.reps)
            # scheme_overrides: replace the prescription line (keep the coach's notes).
            new = override_for(rules, program, name, w.week)
            if new:
                original = s.prescription
                notes = s.notes
                s = parse_cell(new + ("\n" + notes if notes else ""))
                note("scheme_override", w, r, raw=original, detail=f"{original} -> {new}")
            default, override = base_lift_for_item(name, s.note_base_lift)
            if s.fixes:
                note("auto_fix", w, r, raw=s.prescription, detail=f"{s.fixed}  [{', '.join(s.fixes)}]")
            if s.needs_review:
                note("needs_review", w, r, raw=s.prescription, detail=s.review_reason)
            has_pct = any("pct" in p for p in s.planned_sets)
            if has_pct and not (override or default):
                note("needs_review", w, r, raw=s.prescription, detail="percentage scheme but no base lift")
            u = ex_usage[key]
            u["types"].add(s.type)
            u["per_side"] |= s.per_side
            u["timed"] |= s.seconds is not None
            items.append(
                {
                    "id": f"{wid}-{order:02d}",
                    "workout": wid,
                    "block": r.block,
                    "order": order,
                    "exercise": f"ex-{slug(name)}",
                    "raw_name": r.name,
                    "raw_scheme": r.reps,
                    "prescription": s.fixed or s.prescription,
                    "notes": s.notes,
                    "scheme_type": s.type,
                    "planned_sets": s.planned_sets,
                    "set_count": s.set_count,
                    "rep_min": s.rep_min,
                    "rep_max": s.rep_max,
                    "per_side": s.per_side,
                    "seconds": s.seconds,
                    "open_ended": s.open_ended,
                    "base_lift_override": override,
                    "needs_review": s.needs_review,
                }
            )

    def add_workout(w, wid: str, program_id: str, seq: int, kind: str, phase: str | None, program: str = ""):
        out_workouts.append(
            {
                "id": wid,
                "program": program_id,
                "seq": seq,
                "kind": kind,
                "phase": phase,
                "title": w.title,
                "week": w.week,
                "day": w.day,
                "original_date": w.date.isoformat(),
            }
        )
        add_items(w, wid, program)

    # Main timeline
    seq = 0
    for p_index, ws in enumerate(group_programs(split["main"], overrides), start=1):
        pid = f"prog-main-{p_index:03d}"
        pname = program_name(ws, overrides)
        programs.append({"id": pid, "name": pname, "track": "main", "seq": p_index,
                         "rotation": "straight", "workouts": len(ws),
                         "start_date": ws[0].date.isoformat(), "end_date": ws[-1].date.isoformat()})
        for w in ws:
            seq += 1
            add_workout(w, f"main-{seq:04d}", pid, seq, "regular", None, pname)

    # Barbell Accessory: one supplemental program, phases = original groups
    acc = split["accessory"]
    if acc:
        pid = "prog-barbell-accessory"
        programs.append({"id": pid, "name": "Barbell Accessory", "track": "supplemental", "seq": 1,
                         "rotation": "straight", "workouts": len(acc),
                         "start_date": acc[0].date.isoformat(), "end_date": acc[-1].date.isoformat()})
        mains = split["main"]
        aseq = 0
        for ws in group_programs(acc, overrides):
            phase = title_prefix(ws[0].title, overrides)
            if not phase:  # untitled (e.g. "W1D3"): name after the main block it ran beside
                near = min(mains, key=lambda m: abs((m.date - ws[0].date).days)) if mains else None
                prog = next((p for p in programs if near and p["track"] == "main"
                             and p["start_date"] <= near.date.isoformat() <= p["end_date"]), None)
                phase = prog["name"] if prog else f"Block {ws[0].date:%Y-%m}"
            is_main_name = any(p["track"] == "main" and p["name"] == phase for p in programs)
            if (is_main_name or "accessory" in ws[0].title.lower() or not title_prefix(ws[0].title, overrides)) \
                    and "accessory" not in phase.lower():
                phase = f"{phase} Accessory"
            for w in ws:
                aseq += 1
                add_workout(w, f"acc-{aseq:04d}", pid, aseq, "regular", phase)
                note("accessory_day", w, detail=f"moved to Barbell Accessory ({phase})")

    # Tests
    test_cfg = {t["template"]: t for t in overrides.get("tests") or []}
    by_template: dict[str, list] = collections.defaultdict(list)
    for w in split["test"]:
        by_template[w.program_key].append(w)
    for t_index, (template, ws) in enumerate(by_template.items(), start=1):
        pid = f"prog-test-{slug(template)}"
        cfg = test_cfg.get(template, {})
        programs.append({"id": pid, "name": template, "track": "test", "seq": t_index,
                         "role": cfg.get("role", "standard"), "rotation": "straight", "workouts": len(ws),
                         "start_date": ws[0].date.isoformat(), "end_date": ws[-1].date.isoformat()})
        for i, w in enumerate(ws, start=1):
            add_workout(w, f"test-{slug(template)}-d{i}", pid, i, "test", None)
            note("test_template", w, detail=f"{template} ({cfg.get('role', 'standard')})")

    # ---- exercise library -----------------------------------------------
    used = {it["exercise"] for it in items}
    exercises = []
    for key, name in sorted(display.items(), key=lambda kv: kv[1].lower()):
        eid = f"ex-{slug(name)}"
        if eid not in used:
            continue
        base = default_base_lift(name)
        cat = category_for(name, base)
        u = ex_usage[key]
        parts = components(name)
        exercises.append(
            {
                "id": eid,
                "name": name,
                "aliases": sorted(raw_by_key[key] - {name}),
                "components": [table.canonical_component(p) for p in parts] if len(parts) > 1 else [],
                "base_lift": base,
                "is_main_lift": base is not None,
                "category": cat,
                "load_type": load_type_for(name, cat, u["types"], u["timed"]),
                "unilateral": unilateral_for(name, u["per_side"]),
            }
        )
        if len(raw_by_key[key]) > 1:
            review.append({"kind": "name_merge", "date": "", "title": "", "block": "", "exercise": name,
                           "raw": " | ".join(sorted(raw_by_key[key])), "detail": f"{len(raw_by_key[key])} spellings"})

    # ---- seeded 1RMs ------------------------------------------------------
    seeds = []
    for m in maxes.get("one_rep_maxes") or []:
        lift = m["lift"]
        if lift not in BASE_LIFTS:
            raise ValueError(f"one_rep_maxes.yaml: unknown lift {lift!r} (use one of {sorted(BASE_LIFTS)})")
        seeds.append({"lift": lift, "weight_lb": m["weight_lb"], "date": str(m["date"]),
                      "source": m.get("source", "manual"), "note": m.get("note", "")})

    counts = {
        "workouts_read": n_read,
        "reruns_dropped": len(dropped),
        "excluded": len(excluded),
        "kept": len(split["main"]) + len(split["accessory"]) + len(split["test"]),
        "main": len(split["main"]),
        "accessory": len(split["accessory"]),
        "test": len(split["test"]),
        "programs_main": sum(p["track"] == "main" for p in programs),
        "items": len(items),
        "exercises": len(exercises),
        "raw_exercise_names": len({r.name for r in rows}),
        "auto_fixes": sum(r["kind"] == "auto_fix" for r in review),
        "scheme_overrides": sum(r["kind"] == "scheme_override" for r in review),
        "needs_review": sum(r["kind"] == "needs_review" for r in review),
    }
    templates = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "units": "lb",
        "counts": counts,
        "base_lifts": [{"id": k, "name": v} for k, v in BASE_LIFTS.items()],
        "programs": programs,
        "workouts": out_workouts,
        "workout_items": items,
        "exercises": exercises,
        "one_rep_maxes": seeds,
    }
    return {"templates": templates, "review": review, "counts": counts, "dropped": dropped}


def write_outputs(result: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "templates.json").open("w", encoding="utf-8") as f:
        json.dump(result["templates"], f, indent=2, ensure_ascii=False, default=str)
    order = ["needs_review", "scheme_override", "auto_fix", "accessory_day", "test_template", "excluded", "rerun_dropped",
             "title_fix", "name_merge"]
    rows = sorted(result["review"], key=lambda r: (order.index(r["kind"]) if r["kind"] in order else 99, r["date"]))
    with (out_dir / "review.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["kind", "date", "title", "block", "exercise", "raw", "detail"])
        w.writeheader()
        w.writerows(rows)


def print_summary(result: dict) -> None:
    c = result["counts"]
    t = result["templates"]
    print(f"Workouts read:         {c['workouts_read']}")
    print(f"Reruns dropped:        {c['reruns_dropped']}")
    by_block = collections.Counter((d["block"], d["match"]) for d in result["dropped"])
    for (block, match), n in sorted(by_block.items()):
        print(f"    {block:<45} {n:>3}  {match}")
    print(f"Excluded:              {c['excluded']}")
    print(f"Kept:                  {c['kept']}")
    print(f"  Main timeline:       {c['main']}  in {c['programs_main']} programs")
    print(f"  Barbell Accessory:   {c['accessory']}")
    print(f"  Test templates:      {c['test']}")
    print(f"Workout items:         {c['items']}")
    print(f"Exercises:             {c['exercises']}  (from {c['raw_exercise_names']} raw names)")
    print(f"Auto-fixed schemes:    {c['auto_fixes']}")
    print(f"Scheme overrides:      {c['scheme_overrides']}")
    print(f"Needs review:          {c['needs_review']}")
    print(f"Seeded 1RMs:           {len(t['one_rep_maxes'])}")
    acc = [w for w in t["workouts"] if w["id"].startswith("acc-")]
    if acc:
        print("Moved to Barbell Accessory:")
        for phase in dict.fromkeys(w["phase"] for w in acc):
            ws = [w for w in acc if w["phase"] == phase]
            print(f"    {phase:<45} {len(ws):>3}  {ws[0]['original_date']} .. {ws[-1]['original_date']}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path)
    ap.add_argument("--config", type=Path, default=Path("data/config"))
    ap.add_argument("--out", type=Path, default=Path("data/out"))
    args = ap.parse_args(argv)

    result = build(
        read_csv(args.csv),
        load_yaml(args.config / "aliases.yaml"),
        load_yaml(args.config / "overrides.yaml"),
        load_yaml(args.config / "one_rep_maxes.yaml"),
    )
    write_outputs(result, args.out)
    print_summary(result)
    print(f"\nWrote {args.out / 'templates.json'} and {args.out / 'review.csv'}")
    return 1 if result["counts"]["needs_review"] else 0


if __name__ == "__main__":
    sys.exit(main())
