"""Consensus engine with a scripted fake panel (no LLM)."""

import json
import re

from triage_debate.debate import round1_only, run_debate
from triage_debate.llm import LLMClient, RawCompletion
from triage_debate.schemas import Patient

P = Patient(id="p-t", vignette="Chest pain, HR 110.", esi_true=2, split="test")
ESC = {"range_threshold": 1, "safety_override": True}
THREE = ["empath", "logician", "skeptic"]


class ScriptedPanel:
    """script: member name -> ESI per round (last value repeats). fail: {(name, round)}."""

    provider, model = "fake", "fake-1"

    def __init__(self, script: dict[str, list[int]], fail: set | None = None):
        self.script, self.fail, self.calls = script, fail or set(), 0
        self.users: list[str] = []

    async def generate(self, system, user, json_schema, temperature, max_tokens):
        self.calls += 1
        self.users.append(user)
        name = re.search(r"You are the (\w+)", system).group(1)
        m = re.search(r"DISCUSSION ROUND (\d+)", user)
        rnd = int(m.group(1)) if m else 1
        if (name, rnd) in self.fail:
            return RawCompletion("not json", 1, 1)
        seq = self.script[name]
        body = {"esi": seq[min(rnd, len(seq)) - 1], "confidence": 0.8, "key_findings": ["x"],
                "rationale": "r"}
        if rnd >= 2:
            body |= {"message": f"{name} replying in round {rnd}.", "change_reason": "Held."}
        return RawCompletion(json.dumps(body), 10, 10)


async def run(tmp_path, script, fail=None, max_rounds=5):
    be = ScriptedPanel(script, fail)
    res = await run_debate(LLMClient(backend=be, cache_dir=tmp_path, max_retries=1), P,
                           personas=THREE, max_rounds=max_rounds, escalation_cfg=ESC)
    return res, be


async def test_unanimous_in_round_one_stops(tmp_path):
    res, be = await run(tmp_path, {"Empath": [3], "Logician": [3], "Skeptic": [3]})
    assert res.rounds_used == 1 and res.consensus_reached and res.early_stopped
    assert be.calls == 3 and res.aggregate == 3 and not res.escalated


async def test_converges_in_round_three(tmp_path):
    res, be = await run(tmp_path, {"Empath": [2, 2, 2], "Logician": [3, 3, 2], "Skeptic": [4, 3, 2]})
    assert res.rounds_used == 3 and res.consensus_reached and res.aggregate == 2
    assert res.initial_range == 2 and be.calls == 9
    assert res.vote_matrix() == [[2, 3, 4], [2, 3, 3], [2, 2, 2]]
    assert not res.escalated  # converged to urgent: nobody was talked out of it
    assert any("[Empath] ESI 2" in u and "Empath replying in round 2" in u for u in be.users)


async def test_no_consensus_hits_cap_and_escalates(tmp_path):
    res, be = await run(tmp_path, {"Empath": [2], "Logician": [3], "Skeptic": [3]}, max_rounds=5)
    assert res.rounds_used == 5 and not res.consensus_reached and be.calls == 15
    assert "no_consensus" in res.escalation_reasons
    assert "urgent_dissent_overruled" in res.escalation_reasons  # Empath said 2, panel says 3


async def test_urgent_dissent_talked_down_escalates_even_with_consensus(tmp_path):
    res, _ = await run(tmp_path, {"Empath": [2, 3], "Logician": [3], "Skeptic": [3]})
    assert res.consensus_reached and res.aggregate == 3
    assert res.escalation_reasons == ["urgent_dissent_overruled"]


async def test_failed_turn_keeps_previous_position(tmp_path):
    res, _ = await run(tmp_path, {"Empath": [2, 2], "Logician": [3, 2], "Skeptic": [3, 2]},
                       fail={("Logician", 2)})
    # Logician's round-2 turn failed (twice, incl. repair) -> still counts its round-1 ESI 3.
    assert res.rounds[1][1].failure and res.final_esis["Logician"] in (2, 3)
    assert res.rounds_used >= 2


async def test_events_stream_rounds(tmp_path):
    events = []
    be = ScriptedPanel({"Empath": [2, 2], "Logician": [3, 2], "Skeptic": [3, 2]})
    await run_debate(LLMClient(backend=be, cache_dir=tmp_path), P, personas=THREE, escalation_cfg=ESC,
                     on_event=lambda k, p: events.append(k))
    assert events == ["agent"] * 3 + ["round_end"] + ["agent"] * 3 + ["round_end", "final"]


async def test_round1_only_is_condition_d(tmp_path):
    res, _ = await run(tmp_path, {"Empath": [2, 2], "Logician": [3, 2], "Skeptic": [3, 2]})
    d = round1_only(res, "D", ESC)
    assert d.rounds_used == 1 and d.aggregate == 3 and "safety_override" in d.escalation_reasons
    assert d.cost()["calls"] == 3


def test_legacy_v1_transcript_loads():
    from triage_debate.debate import DebateResult

    legacy = {"patient_id": "p", "condition": "C", "agents": ["A"],
              "round1": [{"agent": "A", "round": 1}], "round2": []}
    d = DebateResult.model_validate(legacy)
    assert len(d.rounds) == 1 and d.consensus_protocol is False


TEN = ["empath", "logician", "skeptic", "observer", "synthesizer",
       "pragmatist", "vigilant", "impartial", "mediator", "reflective"]
NAMES = ["Empath", "Logician", "Skeptic", "Observer", "Synthesizer",
         "Pragmatist", "Vigilant", "Impartial", "Mediator", "Reflective"]


async def run10(tmp_path, script, threshold):
    be = ScriptedPanel(script)
    res = await run_debate(LLMClient(backend=be, cache_dir=tmp_path), P, personas=TEN,
                           max_rounds=5, escalation_cfg=ESC, consensus_threshold=threshold)
    return res, be


async def test_ninety_percent_stops_with_one_holdout(tmp_path):
    script = {n: [3] for n in NAMES} | {"Mediator": [4]}
    res, be = await run10(tmp_path, script, 0.9)
    assert res.consensus_reached and res.rounds_used == 1 and be.calls == 10
    assert res.aggregate == 3 and res.consensus_share == 0.9 and not res.escalated


async def test_eighty_percent_keeps_discussing(tmp_path):
    script = {n: [3] for n in NAMES} | {"Mediator": [4, 3], "Skeptic": [4, 4]}
    res, be = await run10(tmp_path, script, 0.9)
    assert res.rounds_used == 2 and res.consensus_reached and res.consensus_share == 0.9
    assert be.calls == 20


async def test_urgent_holdout_still_goes_to_nurse(tmp_path):
    script = {n: [3] for n in NAMES} | {"Vigilant": [2]}
    res, _ = await run10(tmp_path, script, 0.9)
    assert res.consensus_reached and res.aggregate == 3
    assert res.escalation_reasons == ["urgent_dissent_overruled"]


async def test_unanimous_threshold_needs_everyone(tmp_path):
    script = {n: [3] for n in NAMES} | {"Mediator": [4]}
    res, _ = await run10(tmp_path, script, 1.0)
    assert res.rounds_used == 5 and not res.consensus_reached
