"""End-to-end run of the pipeline over samples/truecoach_export_sample.csv."""

from pathlib import Path

import pytest

from importer.import_main import build, read_csv

SAMPLE = Path(__file__).resolve().parents[2] / "samples" / "truecoach_export_sample.csv"

ALIASES = {"spelling": {"Sqaut": "Squat"}, "exercises": {"Romanian Deadlift": ["RDL"]}}
OVERRIDES = {
    "reruns": [{"name": "Sample rerun", "from": "2021-03-01", "to": "2021-03-01",
                "title_prefix": "Sample Cycle", "copy_of": ["2021-01-04", "2021-01-04"]}],
    "tests": [{"title_regex": "MAX WEEK", "template": "MAX WEEK", "role": "standard"}],
    "title_fixes": [{"date": "2021-01-08", "from": "Sample Cycle - W1D2", "to": "Sample Cycle - W1D3"}],
}
MAXES = {"one_rep_maxes": [{"lift": "snatch", "weight_lb": 128, "date": "2026-11-26"}]}


@pytest.fixture(scope="module")
def result():
    return build(read_csv(SAMPLE), ALIASES, OVERRIDES, MAXES)


def test_counts(result):
    c = result["counts"]
    assert c["workouts_read"] == 6
    assert c["reruns_dropped"] == 1
    assert (c["main"], c["accessory"], c["test"]) == (3, 1, 1)
    assert c["needs_review"] == 0


def test_rerun_is_identical_to_original(result):
    assert [d["match"] for d in result["dropped"]] == ["identical"]


def test_tracks_and_ids(result):
    t = result["templates"]
    ws = {w["id"]: w for w in t["workouts"]}
    assert set(ws) == {"main-0001", "main-0002", "main-0003", "acc-0001", "test-max-week-d1"}
    # Sorted by date, not CSV row order (the 1/8 workout is written after 1/9).
    assert [ws[f"main-000{i}"]["original_date"] for i in (1, 2, 3)] == ["2021-01-04", "2021-01-06", "2021-01-08"]
    assert ws["acc-0001"]["program"] == "prog-barbell-accessory"
    assert ws["test-max-week-d1"]["kind"] == "test"


def test_non_percent_barbell_day_stays_main(result):
    t = result["templates"]
    w = next(w for w in t["workouts"] if w["original_date"] == "2021-01-08")
    assert w["id"].startswith("main-")
    assert w["title"] == "Sample Cycle - W1D3"  # title fix applied


def test_items(result):
    items = {(i["workout"], i["block"]): i for i in result["templates"]["workout_items"]}
    squat = items[("main-0001", "B")]
    assert squat["exercise"] == "ex-back-squat"
    assert squat["prescription"] == "(65/3)2, 70/3"
    rdl = items[("main-0001", "C")]
    assert rdl["exercise"] == "ex-romanian-deadlift"
    assert rdl["base_lift_override"] is None  # RDL stays on Back Squat
    assert rdl["planned_sets"][0]["pct"] == 65
    fsq_pp = items[("main-0002", "B")]
    assert fsq_pp["base_lift_override"] is None  # jerk-family lifts already use C&J
    hang = items[("main-0003", "A")]
    assert hang["set_count"] == 5  # "2x4, 3x3"


def test_exercise_library(result):
    ex = {e["id"]: e for e in result["templates"]["exercises"]}
    assert ex["ex-romanian-deadlift"]["base_lift"] == "back_squat"
    assert ex["ex-bench-press"]["is_main_lift"] is False
    assert ex["ex-box-jump"]["load_type"] == "bodyweight"


def test_review_logs_fixes_and_moves(result):
    kinds = [r["kind"] for r in result["review"]]
    assert kinds.count("auto_fix") == 2  # (65;/3)2 and 654 (the rerun's copy is dropped)
    assert "accessory_day" in kinds and "test_template" in kinds and "rerun_dropped" in kinds


def test_scheme_overrides_add_percentages_by_week():
    overrides = {
        **OVERRIDES,
        "scheme_overrides": [
            {"programs": ["Sample Cycle"], "exercises": ["Front Squat"], "weeks": {1: "(70/5)4"}},
        ],
    }
    r = build(read_csv(SAMPLE), ALIASES, overrides, MAXES)
    items = {(i["workout"], i["block"]): i for i in r["templates"]["workout_items"]}
    fsq = items[("main-0003", "B")]  # "4x5" in the export
    assert fsq["scheme_type"] == "pct"
    assert fsq["prescription"] == "(70/5)4"
    assert fsq["planned_sets"] == [{"pct": 70, "reps": 5}] * 4
    # Other exercises in the program are untouched.
    assert items[("main-0003", "A")]["prescription"] == "2x4, 3x3"
    assert r["counts"]["scheme_overrides"] == 1
    assert any(x["kind"] == "scheme_override" and x["raw"] == "4x5" for x in r["review"])


def test_seeded_maxes(result):
    assert result["templates"]["one_rep_maxes"] == [
        {"lift": "snatch", "weight_lb": 128, "date": "2026-11-26", "source": "manual", "note": ""}
    ]
    assert result["templates"]["units"] == "lb"
