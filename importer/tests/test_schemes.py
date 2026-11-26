import pytest

from importer.schemes import fix_pct, parse_cell, parse_pct


@pytest.mark.parametrize(
    "raw, fixed, fix",
    [
        ("(65/2)2 70/1, 75/1", "(65/2)2, 70/1, 75/1", "missing_comma"),
        ("65/4 70/3 (80/3)2, (85/2)2", "65/4, 70/3, (80/3)2, (85/2)2", "missing_comma"),
        ("(65;/3)2", "(65/3)2", "stray_semicolon"),
        ("70/3)2, (75/3)2", "(70/3)2, (75/3)2", "unbalanced_paren"),
        ("(70/3)2, (75/3, 80/2 (85/2)2", "(70/3)2, 75/3, 80/2, (85/2)2", "unbalanced_paren"),
        ("(75//3)2", "(75/3)2", "double_slash"),
        ("^0/4, 65/4", "60/4, 65/4", "caret_for_6"),
        ("654, 70/3", "65/4, 70/3", "missing_slash"),
        ("(70/32), (75/3)2", "(70/3)2, (75/3)2", "misplaced_paren"),
    ],
)
def test_typo_fixes(raw, fixed, fix):
    out, fixes = fix_pct(raw)
    assert out == fixed
    assert fix in fixes
    assert parse_pct(out) is not None


def test_clean_scheme_needs_no_fix():
    out, fixes = fix_pct("60/4, (70/3)2, (100/2)3")
    assert fixes == []
    sets, trailing = parse_pct(out)
    assert [s["pct"] for s in sets] == [60, 70, 70, 100, 100, 100]
    assert trailing == ""


def test_pct_expands_sets():
    s = parse_cell("60/4, (70/3)2")
    assert s.type == "pct"
    assert s.planned_sets == [{"pct": 60, "reps": 4}, {"pct": 70, "reps": 3}, {"pct": 70, "reps": 3}]
    assert (s.rep_min, s.rep_max, s.set_count) == (3, 4, 3)


def test_max_week_ladder_is_open_ended():
    s = parse_cell("60/4, 70/3, 80/2, 85/1, 90/1, 95/1, 101/1, keep going until failure or becomes compromised.")
    assert s.type == "pct"
    assert s.open_ended
    assert s.planned_sets[-1] == {"pct": 101, "reps": 1}
    assert "keep going" in s.notes


def test_notes_are_split_from_prescription():
    s = parse_cell("(75/4)2, (80/4)2\n*hold at knee for 2-3 seconds*")
    assert s.prescription == "(75/4)2, (80/4)2"
    assert s.notes == "*hold at knee for 2-3 seconds*"


@pytest.mark.parametrize(
    "cell, sets, lo, hi",
    [
        ("4x5", 4, 5, 5),
        ("4X5", 4, 5, 5),
        ("4 x 10", 4, 10, 10),
        ("3x8-10", 3, 8, 10),
        ("4x12-15 (3-0-x-1 tempo)", 4, 12, 15),
        ("2x4, 3x3", 5, 3, 4),
        ("3 x 12-15 reps", 3, 12, 15),
    ],
)
def test_sets_reps(cell, sets, lo, hi):
    s = parse_cell(cell)
    assert s.type == "sets_reps"
    assert (s.set_count, s.rep_min, s.rep_max) == (sets, lo, hi)
    assert not any("pct" in p for p in s.planned_sets)


def test_per_side_and_timed():
    s = parse_cell("3x10/leg")
    assert s.per_side and s.planned_sets[0] == {"reps": 10, "per_side": True}
    s = parse_cell("3x:45")
    assert s.seconds == 45 and s.set_count == 3
    s = parse_cell("3x1:00")
    assert s.seconds == 60


def test_suffix_text_moves_to_notes():
    s = parse_cell("3x12-15 - Increase weight each week")
    assert s.notes == "Increase weight each week"


def test_max_attempts():
    s = parse_cell("Find 1RM.\n5-3-2-1-1-1")
    assert s.type == "max_attempt" and s.open_ended
    assert [p["reps"] for p in s.planned_sets] == [5, 3, 2, 1, 1, 1]
    s = parse_cell("Build to a 'heavy' single without compromising proper technique and position.")
    assert s.type == "max_attempt" and s.planned_sets == []


def test_note_percent_range_uses_midpoint():
    s = parse_cell("4x6 \n40-45% of back squat")
    assert s.note_base_lift == "back_squat"
    assert s.planned_sets[0]["pct"] == 42.5
    assert s.planned_sets[0]["pct_range"] == [40, 45]


def test_note_start_percent():
    s = parse_cell("4x5  \nHold at peak for 2 seconds. Increase by 2-3kg/week, Start @ 40% 1RM C&J.")
    assert s.note_base_lift == "clean_and_jerk"
    assert s.planned_sets[0]["pct"] == 40


def test_note_base_without_percent():
    s = parse_cell("60/3, (70/3)2\nBase % off max Snatch. Hold position overhead.")
    assert s.note_base_lift == "snatch"


def test_text_and_sets_only():
    assert parse_cell("Row 2500m for time").type == "text"
    assert parse_cell("a then b then c then d").type == "text"
    s = parse_cell("3 Rounds for Quality")
    assert s.type == "sets_only" and s.set_count == 3
    assert parse_cell("").type == "text"
