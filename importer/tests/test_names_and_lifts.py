import pytest

from importer.base_lift import base_lift_for_item, default_base_lift
from importer.names import AliasTable, clean_name, components, fold

ALIASES = {
    "spelling": {"Sqaut": "Squat", "Parallete": "Parallette", "EZ Bat": "EZ Bar", "BTN": "Behind the Neck"},
    "exercises": {"Romanian Deadlift": ["RDL"], "Bent Over Row": ["Bent Row", "Bent Over Barbell Row"]},
}


@pytest.mark.parametrize(
    "raw, clean",
    [
        ("Back Squat (FSq)", "Back Squat"),
        ("Back Sqaut", "Back Squat"),
        ("2 Clean Extension + 1 Clean + 1 Jerk (2 ClExt + 1 Cl + 1 J))", "2 Clean Extension + 1 Clean + 1 Jerk"),
        ("Clean Pull to Hip (ClPuToHip) + Clean Pull to Hold", "Clean Pull to Hip + Clean Pull to Hold"),
        ("Snatch Pull to Hip + Hang Power Snatch BELOW Knee", "Snatch Pull to Hip + Hang Power Snatch Below Knee"),
        ("Bicep Curl EZ Bat 21's", "Bicep Curl EZ Bar 21's"),
        ("Superset!", "Superset"),
    ],
)
def test_clean_name(raw, clean):
    assert clean_name(raw, ALIASES["spelling"]) == clean


def test_fold_collapses_spelling_variants():
    assert fold("Behind-the-Neck Jerk") == fold("Behind the Neck Jerk")
    assert fold("Front Squats") == fold("Front Squat")
    assert fold("Clean and Jerk") == fold("Clean & Jerk")
    assert fold("Hanging Knee Raise w/ Sleeves") == fold("Hanging Knee Raise with Sleeves")
    assert fold("Wide Grip Strict Pull Ups") == fold("Wide Grip Strict Pull Up")
    assert fold("Bench Press") != fold("Bench Pres")  # 'ss' words are not singularized


def test_alias_table():
    t = AliasTable.from_dict(ALIASES)
    assert t.canonical("RDL") == "Romanian Deadlift"
    assert t.canonical("Romanian Deadlift (RDL)") == "Romanian Deadlift"
    assert t.canonical("Bent Over Barbell Row") == "Bent Over Row"
    assert t.canonical("Back Squat (BSq)") == "Back Squat"


def test_components_drop_counts():
    assert components("2 Snatch Pull + Dip Snatch") == ["Snatch Pull", "Dip Snatch"]


@pytest.mark.parametrize(
    "name, lift",
    [
        ("Back Squat", "back_squat"),
        ("Pause Back Squat", "back_squat"),
        ("Good Morning", "back_squat"),
        ("Front Squat", "front_squat"),
        ("Snatch Pull to Hold", "snatch"),
        ("Snatch Balance", "snatch"),
        ("Overhead Squat", "snatch"),
        ("Sots Press", "snatch"),
        ("Snatch Grip Deadlift", "snatch"),
        ("Clean Grip Deadlift", "clean_and_jerk"),
        ("Segmented Clean Grip Deadlift", "clean_and_jerk"),
        ("Clean Extension", "clean_and_jerk"),
        ("Hang Power Clean Above Knee", "clean_and_jerk"),
        ("Clean & Jerk", "clean_and_jerk"),
        ("Clean + Front Squat + Jerk", "clean_and_jerk"),
        ("Power Clean + Clean + Jerk", "clean_and_jerk"),
        ("Power Clean + Front Squat", "clean_and_jerk"),
        ("Snatch Pull to Hip + Power Snatch", "snatch"),
        ("Behind the Neck Push Press + Snatch Balance", "snatch"),
        ("Push Press", "clean_and_jerk"),
        ("Push Press + Split Jerk", "clean_and_jerk"),
        ("Power Jerk", "clean_and_jerk"),
        ("Romanian Deadlift", "back_squat"),
        ("Deadlift", "deadlift"),
        ("Bench Press", None),
        ("Strict Press", None),
        ("Pendlay Row", None),
        ("Dumbbell Romanian Deadlift", None),
        ("Single Leg RDL", None),
        ("Dual Kettlebell Front Squat", None),
        ("Trap Bar Deadlift", None),
        ("Goblet Squat", None),
    ],
)
def test_default_base_lift(name, lift):
    assert default_base_lift(name) == lift


def test_rdl_ignores_note_naming_clean():
    assert base_lift_for_item("Romanian Deadlift", "clean") == ("back_squat", None)


def test_note_overrides_default():
    assert base_lift_for_item("Front Squat Push Press", "clean_and_jerk") == ("clean_and_jerk", None)
    assert base_lift_for_item("Front Squat", "clean_and_jerk") == ("front_squat", "clean_and_jerk")
    assert base_lift_for_item("Power Jerk", "jerk") == ("clean_and_jerk", None)


def test_note_matching_default_is_not_an_override():
    assert base_lift_for_item("Snatch Balance", "snatch") == ("snatch", None)
