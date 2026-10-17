"""Ground truth must never reach a prompt."""

import pytest

from triage_debate.prompts import PANEL, PERSONAS, few_shot_block, round1_user, round2_user, system_prompt
from triage_debate.schemas import AgentOutput, Patient

EXPLANATION = "ESI level 2: High risk. SECRET-HANDBOOK-REASONING"


def _patient(split="test"):
    return Patient(id="p-1", vignette="A 60-year-old with chest pain.", esi_true=2, split=split,
                   explanation=EXPLANATION)


def test_view_has_no_label_fields():
    v = _patient().view()
    assert set(v.model_dump()) == {"id", "vignette"}


def test_prompts_contain_no_label_or_explanation():
    p = _patient()
    out = AgentOutput(esi=3, confidence=0.5, key_findings=[], rationale="r")
    texts = [round1_user(p.view()), round2_user(p.view(), out, {"Resource Manager": out})]
    texts += [system_prompt(k, r) for k in PERSONAS for r in (1, 2)]
    for t in texts:
        assert "SECRET-HANDBOOK-REASONING" not in t
        assert "esi_true" not in t


def test_few_shot_rejects_test_patients():
    with pytest.raises(AssertionError):
        few_shot_block([_patient("test")])
    assert "ESI 2" in few_shot_block([_patient("train")])


def test_panel_is_ten_distinct_traits_with_bias_guard():
    prompts = {system_prompt(k) for k in PANEL}
    assert len(PANEL) == 10 and len(prompts) == 10
    assert all("ESI v4" in s and "never which direction you lean" in s for s in prompts)
    # Directional clinical roles were removed on purpose.
    assert not {"cautious", "resource"} & set(PERSONAS)


def test_discussion_prompt_has_anti_herding_and_no_label():
    from triage_debate.prompts import discussion_user
    from triage_debate.schemas import Round2Output

    p = _patient()
    own = AgentOutput(esi=3, confidence=0.5, key_findings=[], rationale="r")
    other = Round2Output(esi=2, confidence=0.8, key_findings=[], rationale="r", message="Logician, look at the HR.")
    text = discussion_user(p.view(), 3, own, {"Skeptic": other})
    assert "DISCUSSION ROUND 3" in text and "[Skeptic] ESI 2" in text and "look at the HR" in text
    assert "Do not change because others outnumber you" in text
    assert "SECRET-HANDBOOK-REASONING" not in text
