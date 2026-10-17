"""Consensus protocol: independent round -> discussion rounds until unanimous (or a cap) ->
aggregate -> disagreement -> escalation.

Aggregation, disagreement and escalation are plain functions (no LLM) so they are testable.
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, Field, model_validator

from .agents import result_row, run_agent
from .llm import LLMClient
from .prompts import PANEL, PERSONAS
from .schemas import AgentOutput, AgentResult, Patient, PatientView

MIN_WEIGHT = 0.05

# ---------------------------------------------------------------- pure functions


def weighted_median(values: list[int], weights: list[float]) -> int:
    """Confidence-weighted median ESI; exact 50/50 splits resolve to the more urgent level.

    Values are sorted ascending (most urgent first) and the first value whose cumulative
    weight reaches half the total is returned, so a tie lands on the lower ESI number.
    Weights are floored at MIN_WEIGHT so a 0.0 confidence never silences an agent.
    """
    if not values:
        raise ValueError("no values to aggregate")
    pairs = sorted(zip(values, [max(float(w), MIN_WEIGHT) for w in weights]))
    total = sum(w for _, w in pairs)
    cum = 0.0
    for v, w in pairs:
        cum += w
        if cum >= total / 2 - 1e-12:
            return int(v)
    return int(pairs[-1][0])


def majority_vote(values: list[int]) -> int:
    """Most common ESI; ties go to the more urgent (lower) level."""
    counts = Counter(values)
    best = max(counts.values())
    return min(v for v, c in counts.items() if c == best)


def disagreement(esis: list[int], confidences: list[float]) -> dict[str, float]:
    """Range of ESI levels (primary), mean confidence (secondary), and a combined score.

    score = range + (1 - mean_confidence): range dominates, confidence breaks ties.
    """
    rng = max(esis) - min(esis) if esis else 0
    mean_conf = sum(confidences) / len(confidences) if confidences else 0.0
    return {"range": rng, "mean_confidence": mean_conf, "score": rng + (1 - mean_conf)}


def is_unanimous(esis: list[int]) -> bool:
    return bool(esis) and len(set(esis)) == 1


def consensus_level(esis: list[int], n_members: int) -> tuple[int | None, float]:
    """Most common ESI among current votes and its share of the WHOLE panel (missing = no vote).

    Ties between equally common levels resolve to the more urgent one.
    """
    if not esis or not n_members:
        return None, 0.0
    top = majority_vote(esis)
    return top, esis.count(top) / n_members


def has_consensus(esis: list[int], n_members: int, threshold: float = 1.0) -> bool:
    """True when at least `threshold` of the panel (e.g. 0.9 = 9 of 10) agree on one level."""
    _, share = consensus_level(esis, n_members)
    return share >= threshold - 1e-9


def escalation_decision(final_esis: list[int], aggregate: int, *, range_threshold: int = 1,
                        safety_override: bool = True, missing_agents: int = 0,
                        consensus_protocol: bool = False, consensus_reached: bool = False,
                        first_round_esis: list[int] | None = None) -> tuple[bool, list[str]]:
    """Should a nurse review this case? Returns (escalate, reasons).

    Consensus panels (discuss until unanimous):
      no_consensus: agreement still below the threshold after the round cap.
      urgent_dissent_overruled: a member said ESI 1-2 (on independent assessment, or as the
        remaining holdout) but the panel settled on ESI 3 or lower. A nurse should look.
    Single-pass panels (e.g. round-1-only): safety_override (some final vote is ESI 1-2 while
      the aggregate is 3+) and disagreement (final range >= threshold).
    Both: agent_failure when an agent never gave a usable answer.
    """
    reasons: list[str] = []
    if missing_agents:
        reasons.append("agent_failure")
    if consensus_protocol:
        if not consensus_reached:
            reasons.append("no_consensus")
        urgent = [*(first_round_esis or []), *final_esis]
        if safety_override and aggregate >= 3 and any(e <= 2 for e in urgent):
            reasons.append("urgent_dissent_overruled")
    else:
        if safety_override and aggregate >= 3 and any(e <= 2 for e in final_esis):
            reasons.append("safety_override")
        if final_esis and max(final_esis) - min(final_esis) >= range_threshold:
            reasons.append("disagreement")
    return bool(reasons), reasons


def uncertainty_score(initial_range: int, rounds_used: int, mean_conf: float, missing: int) -> float:
    """Ranks cases for review: early disagreement first, then how long the panel needed."""
    return initial_range + 0.5 * max(0, rounds_used - 1) + (1 - mean_conf) + missing


# ---------------------------------------------------------------- result model


class DebateResult(BaseModel):
    """Everything about one patient's discussion, enough to render the Case Review page."""

    patient_id: str
    condition: str
    agents: list[str]
    rounds: list[list[AgentResult]] = Field(default_factory=list)
    consensus_protocol: bool = True
    consensus_threshold: float = 1.0
    consensus_reached: bool = False
    consensus_share: float = 0.0
    rounds_used: int = 0
    first_round_esis: dict[str, int] = Field(default_factory=dict)
    initial_range: int = 0
    early_stopped: bool = False  # unanimous on independent assessment (no discussion needed)
    final_esis: dict[str, int] = Field(default_factory=dict)
    final_confidences: dict[str, float] = Field(default_factory=dict)
    aggregate: int | None = None
    majority: int | None = None
    disagreement_range: int = 0
    mean_confidence: float = 0.0
    disagreement_score: float = 0.0
    escalated: bool = True
    escalation_reasons: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _legacy_rounds(cls, data: Any) -> Any:
        """Read v1 transcripts that stored round1/round2 instead of rounds."""
        if isinstance(data, dict) and "rounds" not in data and "round1" in data:
            data = dict(data)
            data["rounds"] = [r for r in (data.pop("round1"), data.pop("round2", [])) if r]
            data.setdefault("consensus_protocol", False)
        return data

    @property
    def round1(self) -> list[AgentResult]:
        return self.rounds[0] if self.rounds else []

    @property
    def round2(self) -> list[AgentResult]:
        return self.rounds[1] if len(self.rounds) > 1 else []

    @property
    def all_results(self) -> list[AgentResult]:
        return [r for rnd in self.rounds for r in rnd]

    def vote_matrix(self) -> list[list[int | None]]:
        """rounds x agents grid of ESI votes (None = no answer that round)."""
        out = []
        for rnd in self.rounds:
            by = {r.agent: r.esi for r in rnd}
            out.append([by.get(a) for a in self.agents])
        return out

    def cost(self) -> dict[str, float]:
        rs = self.all_results
        return {"calls": sum(r.calls for r in rs),
                "input_tokens": sum(r.input_tokens for r in rs),
                "output_tokens": sum(r.output_tokens for r in rs),
                "latency_ms": sum(r.latency_ms for r in rs)}


def finalize(result: DebateResult, final: dict[str, AgentOutput], n_agents: int,
             escalation_cfg: dict[str, Any]) -> DebateResult:
    """Fill aggregate, disagreement and escalation fields from the latest answers."""
    result.final_esis = {k: o.esi for k, o in final.items()}
    result.final_confidences = {k: o.confidence for k, o in final.items()}
    esis, confs = list(result.final_esis.values()), list(result.final_confidences.values())
    missing = n_agents - len(final)
    first = [e for e in result.first_round_esis.values()]
    result.initial_range = (max(first) - min(first)) if first else 0
    result.rounds_used = len(result.rounds)
    top, share = consensus_level(esis, n_agents)
    result.consensus_share = round(share, 4)
    agreed = share >= result.consensus_threshold - 1e-9
    result.early_stopped = result.consensus_protocol and result.rounds_used == 1 and agreed
    if not esis:
        result.aggregate, result.majority = None, None
        result.escalated, result.escalation_reasons = True, ["agent_failure"]
        return result
    result.consensus_reached = agreed
    result.aggregate = top if result.consensus_reached else weighted_median(esis, confs)
    result.majority = majority_vote(esis)
    d = disagreement(esis, confs)
    result.disagreement_range = int(d["range"])
    result.mean_confidence = d["mean_confidence"]
    result.disagreement_score = (
        uncertainty_score(result.initial_range, result.rounds_used, result.mean_confidence, missing)
        if result.consensus_protocol else d["score"] + missing
    )
    result.escalated, result.escalation_reasons = escalation_decision(
        esis, result.aggregate,
        range_threshold=int(escalation_cfg.get("range_threshold", 1)),
        safety_override=bool(escalation_cfg.get("safety_override", True)),
        missing_agents=missing,
        consensus_protocol=result.consensus_protocol,
        consensus_reached=result.consensus_reached,
        first_round_esis=first,
    )
    return result


# ---------------------------------------------------------------- engine


async def run_debate(
    client: LLMClient,
    patient: Patient | PatientView,
    *,
    condition: str = "C",
    personas: list[str] | None = None,
    labels: list[str] | None = None,
    max_rounds: int = 5,
    early_stop: bool = True,
    temperature: float | None = None,
    few_shot: list[Patient] | None = None,
    escalation_cfg: dict[str, Any] | None = None,
    on_event: Callable[[str, Any], Awaitable[None] | None] | None = None,
    rounds: int | None = None,
    consensus_threshold: float = 1.0,
) -> DebateResult:
    """Run the panel on one patient until it reaches consensus or hits `max_rounds`.

    Consensus = at least `consensus_threshold` of the panel on one ESI level (1.0 means
    unanimous; 0.9 means 9 of 10).

    Round 1 is independent. Each later round, every member sees all other members' latest
    position and message, replies, and may revise. A member whose answer fails keeps its
    previous valid position. `personas` may repeat (e.g. ten "neutral" agents for condition
    B); each slot has its own sample index so repeats draw independent samples.

    `on_event(kind, payload)` receives ("agent", AgentResult) as each turn finishes,
    ("round_end", {"round", "votes"}) after each round, ("early_stop", None) when round 1 is
    already unanimous, and ("final", DebateResult).
    """
    if rounds is not None:  # backward-compatible keyword
        max_rounds = rounds
    personas = personas or PANEL
    labels = labels or [PERSONAS[p]["name"] for p in personas]
    escalation_cfg = escalation_cfg or {}
    view = patient.view() if isinstance(patient, Patient) else patient  # live cases have no label
    n = len(personas)

    async def emit(kind: str, payload: Any) -> None:
        if on_event is not None:
            out = on_event(kind, payload)
            if asyncio.iscoroutine(out):
                await out

    async def turn(coro):
        res = await coro
        await emit("agent", res)
        return res

    r1 = await asyncio.gather(*(
        turn(run_agent(client, p, view, round_no=1, few_shot=few_shot, temperature=temperature,
                       sample_idx=i, label=lab))
        for i, (p, lab) in enumerate(zip(personas, labels))
    ))
    result = DebateResult(patient_id=view.id, condition=condition, agents=labels, rounds=[list(r1)],
                          consensus_protocol=max_rounds > 1, consensus_threshold=consensus_threshold)
    latest: dict[str, AgentOutput] = {r.agent: r.output for r in r1 if r.ok}
    result.first_round_esis = {k: o.esi for k, o in latest.items()}
    await emit("round_end", {"round": 1, "votes": {k: o.esi for k, o in latest.items()}})

    for rnd in range(2, max_rounds + 1):
        votes = [o.esi for o in latest.values()]
        if early_stop and has_consensus(votes, n, consensus_threshold):
            if rnd == 2:
                await emit("early_stop", None)
            break
        if len(latest) < 2:
            break
        jobs = []
        for i, (p, lab) in enumerate(zip(personas, labels)):
            if lab not in latest:
                continue  # never answered: sits out the discussion
            others = {k: v for k, v in latest.items() if k != lab}
            jobs.append(turn(run_agent(client, p, view, round_no=rnd, own=latest[lab], others=others,
                                       temperature=temperature, sample_idx=i, label=lab)))
        rn = await asyncio.gather(*jobs)
        result.rounds.append(list(rn))
        for r in rn:
            if r.ok:
                latest[r.agent] = r.output  # a failed turn keeps the member's previous position
        await emit("round_end", {"round": rnd, "votes": {k: o.esi for k, o in latest.items()}})

    done = finalize(result, latest, n, escalation_cfg)
    await emit("final", done)
    return done


def round1_only(result: DebateResult, condition: str, escalation_cfg: dict[str, Any]) -> DebateResult:
    """Condition D: re-aggregate a panel using only its independent (round-1) answers."""
    d = DebateResult(patient_id=result.patient_id, condition=condition, agents=result.agents,
                     rounds=[result.round1], consensus_protocol=False,
                     first_round_esis={r.agent: r.esi for r in result.round1 if r.ok})
    final = {r.agent: r.output for r in result.round1 if r.ok}
    return finalize(d, final, len(result.agents), escalation_cfg)


def debate_row(res: DebateResult, esi_true: int) -> dict[str, Any]:
    """Flatten a DebateResult into one CSV row (vote matrix stored as JSON)."""
    return {
        "patient_id": res.patient_id, "esi_true": esi_true, "condition": res.condition,
        "pred": res.aggregate, "majority": res.majority,
        "escalated": res.escalated, "escalation_reasons": ",".join(res.escalation_reasons),
        "consensus_reached": res.consensus_reached, "rounds_used": res.rounds_used,
        "initial_range": res.initial_range,
        "disagreement_range": res.disagreement_range,
        "mean_confidence": round(res.mean_confidence, 4),
        "disagreement_score": round(res.disagreement_score, 4),
        "early_stopped": res.early_stopped,
        "n_agents": len(res.agents),
        "vote_matrix": json.dumps({"agents": res.agents, "rounds": res.vote_matrix()}),
        "failures": sum(not r.ok for r in res.all_results),
        "repairs": sum(r.repaired for r in res.all_results),
        **res.cost(),
    }


def agent_rows(res: DebateResult) -> list[dict[str, Any]]:
    """Long-format per-agent rows (useful for analysis)."""
    return [{"patient_id": res.patient_id, "condition": res.condition, **result_row(r)}
            for r in res.all_results]
