import pandas as pd

from triage_debate.fairness import counterfactual, flip_summary, is_swappable, swap_sex
from triage_debate.schemas import Patient


def test_swap_nouns_and_pronouns():
    assert swap_sex("A 20-year-old male hurt his knee. He says it hurts.") == \
        "A 20-year-old female hurt her knee. She says it hurts."
    assert swap_sex("A 30-year-old woman cut her hand; the nurse helps her.") == \
        "A 30-year-old man cut his hand; the nurse helps him."
    assert swap_sex("The boy and the girl.") == "The girl and the boy."


def test_swap_her_object_before_preposition():
    assert swap_sex("EMS brought her to the ED.") == "EMS brought him to the ED."
    assert swap_sex("The phone is his.") == "The phone is hers."


def test_swap_is_involution_on_simple_text():
    s = "A 41-year-old male fell off his bike. He landed on his right arm."
    assert swap_sex(swap_sex(s)) == s


def _p(text, sex="M"):
    return Patient(id="p-1", vignette=text, esi_true=3, split="test", sex=sex)


def test_swappable_rules():
    assert is_swappable(_p("A 41-year-old male fell off his bike."))
    assert not is_swappable(_p("A 22-year-old female, possibly pregnant.", "F"))
    assert not is_swappable(_p("A 4-year-old boy brought in by his mother."))
    assert not is_swappable(_p("A patient with a cough.", None))


def test_counterfactual_keeps_label_and_changes_id():
    p = _p("A 41-year-old male fell off his bike.")
    q = counterfactual(p)
    assert q.esi_true == p.esi_true and q.id != p.id and q.sex == "F"


def test_flip_summary():
    df = pd.DataFrame({"flipped": [True, False, False, False], "swap_more_urgent": [True, False, False, False]})
    s = flip_summary(df)
    assert s["flip_rate"] == 0.25 and s["flips"] == 1 and s["swap_more_urgent"] == 1
