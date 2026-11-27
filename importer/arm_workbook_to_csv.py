"""Convert Arm_Workout_Tracker.xlsx (Exercise Library tab) to a program CSV.

Usage:
    python -m importer.arm_workbook_to_csv data/raw/Arm_Workout_Tracker.xlsx data/programs/arm_program.csv

Output columns (docs/Plan.md, "Adding supplemental programs"):
    phase,phase_name,weeks,workout,order,exercise,sets,rep_min,rep_max,load_type,weight_jump,unilateral,form_cue,video_url
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

import openpyxl

COLUMNS = ["phase", "phase_name", "weeks", "workout", "order", "exercise", "sets", "rep_min", "rep_max",
           "load_type", "weight_jump", "unilateral", "form_cue", "video_url"]


def video_url(cell) -> str:
    """A cell link: either a real hyperlink or a =HYPERLINK("url","label") formula."""
    if cell.hyperlink and cell.hyperlink.target:
        return cell.hyperlink.target
    m = re.match(r'=HYPERLINK\("([^"]+)"', str(cell.value or ""), re.I)
    return m.group(1) if m else ""


def convert(xlsx: Path) -> list[dict]:
    wb = openpyxl.load_workbook(xlsx)  # not data_only: hyperlinks live on the cells
    ws = wb["Exercise Library"]
    header = [c.value for c in ws[1]]
    col = {name: i for i, name in enumerate(header)}
    rows, phases, order = [], {}, {}
    for r in ws.iter_rows(min_row=2):
        name = r[col["Exercise"]].value
        if not name:
            continue
        phase_label = str(r[col["Phase"]].value)  # "Weeks 1-4: Foundation"
        m = re.match(r"Weeks\s+(\d+)\s*-\s*(\d+):\s*(.+)", phase_label)
        if not m:
            raise ValueError(f"unrecognized phase {phase_label!r}")
        first, last, phase_name = int(m.group(1)), int(m.group(2)), m.group(3).strip()
        phase = phases.setdefault(phase_label, len(phases) + 1)
        workout = str(r[col["Workout"]].value).strip()
        order[(phase, workout)] = order.get((phase, workout), 0) + 1
        reps = str(r[col["Reps"]].value)
        lo, _, hi = reps.partition("-")
        jump = str(r[col["Weight Jump"]].value).strip()
        bodyweight = jump.lower().startswith("bodyweight")
        video_cell = r[col["Video"]]
        rows.append({
            "phase": phase,
            "phase_name": phase_name,
            "weeks": last - first + 1,
            "workout": workout,
            "order": order[(phase, workout)],
            "exercise": str(name).strip(),
            "sets": int(float(r[col["Sets"]].value)),
            "rep_min": int(lo),
            "rep_max": int(hi or lo),
            "load_type": "bodyweight" if bodyweight else "weight",
            "weight_jump": "" if bodyweight else re.sub(r"[^\d.]", "", jump),
            "unilateral": "no",
            "form_cue": str(r[col["Form Cue"]].value or "").strip(),
            "video_url": video_url(video_cell),
        })
    return rows


def main(argv: list[str]) -> int:
    src, dst = Path(argv[0]), Path(argv[1])
    rows = convert(src)
    dst.parent.mkdir(parents=True, exist_ok=True)
    with dst.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows to {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
