"""Run one agent on one patient: build prompt -> call -> validate -> (repair once) -> result."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from .llm import LLMClient, LLMParseError, TokenBudgetExceeded, extract_json
from .prompts import (
    AGENT_SCHEMA,
    PERSONAS,
    ROUND2_SCHEMA,
    repair_user,
    round1_user,
    discussion_user,
    system_prompt,
)
from .schemas import AgentOutput, AgentResult, Patient, PatientView, Round2Output, normalize_raw


def parse_agent_output(text: str, round_no: int = 1) -> tuple[AgentOutput, list[str]]:
    """Parse and validate model text into an AgentOutput (or Round2Output).

    Raises LLMParseError or pydantic.ValidationError when the output is unusable.
    """
    data = extract_json(text)
    data, notes = normalize_raw(data, round2=round_no >= 2)
    model = Round2Output if round_no >= 2 else AgentOutput
    return model.model_validate(data), notes


def _error_summary(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        errs = exc.errors()[:3]
        return "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in errs)
    return str(exc)[:200]


async def run_agent(
    client: LLMClient,
    persona: str,
    view: PatientView,
    *,
    round_no: int = 1,
    own: AgentOutput | None = None,
    others: dict[str, AgentOutput] | None = None,
    few_shot: list[Patient] | None = None,
    temperature: float | None = None,
    sample_idx: int = 0,
    label: str | None = None,
) -> AgentResult:
    """Run one agent turn. Never raises for model-output problems; returns a failure instead."""
    if not isinstance(view, PatientView):
        raise TypeError("run_agent takes a PatientView (label-free), not a Patient")
    label = label or persona
    system = system_prompt(persona, round_no)
    if round_no == 1:
        user = round1_user(view, few_shot)
    else:
        assert own is not None and others is not None
        user = discussion_user(view, round_no, own, others)
    schema = ROUND2_SCHEMA if round_no >= 2 else AGENT_SCHEMA
    tag = f"{view.id}:{label}:r{round_no}:s{sample_idx}"

    result = AgentResult(agent=label, round=round_no)

    async def call(u: str, t: str) -> str:
        text, meta = await client.complete_raw(system, u, schema, temperature=temperature,
                                               sample_idx=sample_idx, tag=t)
        result.calls += 1
        result.input_tokens += meta["input_tokens"]
        result.output_tokens += meta["output_tokens"]
        result.latency_ms += meta["latency_ms"] if not meta["cached"] else 0.0
        return text

    try:
        text = await call(user, tag)
    except TokenBudgetExceeded:
        raise  # stop the run; never record budget stops as agent failures
    except Exception as exc:  # transport failure after retries
        result.failure = f"call_failed: {type(exc).__name__}: {str(exc)[:200]}"
        return result

    try:
        result.output, result.notes = parse_agent_output(text, round_no)
        return result
    except (LLMParseError, ValidationError) as exc:
        first_error = _error_summary(exc)

    try:
        text2 = await call(repair_user(user, text, first_error), tag + ":repair")
        result.output, result.notes = parse_agent_output(text2, round_no)
        result.repaired = True
    except (LLMParseError, ValidationError) as exc:
        result.failure = f"invalid_json: {first_error} | after repair: {_error_summary(exc)}"
    except TokenBudgetExceeded:
        raise
    except Exception as exc:
        result.failure = f"repair_call_failed: {type(exc).__name__}: {str(exc)[:200]}"
    return result


def persona_name(persona: str) -> str:
    """Display name for a persona key."""
    return PERSONAS[persona]["name"]


def result_row(result: AgentResult) -> dict[str, Any]:
    """Flatten an AgentResult for CSV output."""
    o = result.output
    return {
        "agent": result.agent,
        "round": result.round,
        "esi": o.esi if o else None,
        "confidence": o.confidence if o else None,
        "key_findings": " | ".join(o.key_findings) if o else "",
        "rationale": o.rationale if o else "",
        "message": getattr(o, "message", "") if o else "",
        "change_reason": getattr(o, "change_reason", "") if o else "",
        "failure": result.failure or "",
        "repaired": result.repaired,
        "notes": ",".join(result.notes),
    }
