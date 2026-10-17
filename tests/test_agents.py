import json

import pytest
from pydantic import ValidationError

from triage_debate.agents import parse_agent_output, run_agent
from triage_debate.llm import LLMClient, LLMParseError, RawCompletion
from triage_debate.schemas import Patient


def test_parse_valid_output():
    out, notes = parse_agent_output(
        '{"esi": 2, "confidence": 0.8, "key_findings": ["chest pain"], "rationale": "High risk."}'
    )
    assert out.esi == 2 and out.confidence == 0.8 and notes == []


def test_parse_normalizes_harmless_slips():
    raw = json.dumps({"esi": "3", "confidence": 85, "key_findings": ["a", "b", "c", "d"],
                      "rationale": " ".join(["word"] * 80)})
    out, notes = parse_agent_output(raw)
    assert out.esi == 3 and out.confidence == 0.85
    assert len(out.key_findings) == 3
    assert len(out.rationale.split()) == 60
    assert {"esi_str", "confidence_pct", "findings_trimmed", "rationale_clipped"} <= set(notes)


def test_parse_rejects_bad_esi_and_missing_fields():
    with pytest.raises(ValidationError):
        parse_agent_output('{"esi": 7, "confidence": 0.5, "key_findings": [], "rationale": "x"}')
    with pytest.raises(ValidationError):
        parse_agent_output('{"esi": 2}')
    with pytest.raises(LLMParseError):
        parse_agent_output("ESI 2")


def test_parse_round2_requires_change_reason_field_type():
    out, _ = parse_agent_output(
        '{"esi": 2, "confidence": 0.7, "key_findings": [], "rationale": "r", "change_reason": "Held."}',
        round_no=2,
    )
    assert out.change_reason == "Held."


class ScriptedBackend:
    """Returns canned texts in order (no real LLM)."""

    provider, model = "fake", "fake-1"

    def __init__(self, texts):
        self.texts = list(texts)
        self.users = []

    async def generate(self, system, user, json_schema, temperature, max_tokens):
        self.users.append(user)
        return RawCompletion(self.texts.pop(0), 5, 5)


PATIENT = Patient(id="p-x", vignette="A 40-year-old with a sprained ankle.", esi_true=4, split="test")
GOOD = '{"esi": 4, "confidence": 0.9, "key_findings": ["ankle"], "rationale": "One x-ray."}'


async def test_run_agent_repairs_once(tmp_path):
    be = ScriptedBackend(["not json at all", GOOD])
    r = await run_agent(LLMClient(backend=be, cache_dir=tmp_path), "neutral", PATIENT.view())
    assert r.ok and r.repaired and r.calls == 2 and r.esi == 4
    assert "could not be used" in be.users[1]


async def test_run_agent_logs_failure_after_one_repair(tmp_path):
    be = ScriptedBackend(["nope", '{"esi": 9}'])
    r = await run_agent(LLMClient(backend=be, cache_dir=tmp_path), "neutral", PATIENT.view())
    assert not r.ok and r.failure.startswith("invalid_json") and r.calls == 2


async def test_run_agent_refuses_full_patient(tmp_path):
    with pytest.raises(TypeError):
        await run_agent(LLMClient(backend=ScriptedBackend([GOOD]), cache_dir=tmp_path),
                        "neutral", PATIENT)
