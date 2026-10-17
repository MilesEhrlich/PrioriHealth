"""Pydantic schemas shared across the pipeline."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Vitals(BaseModel):
    """Vital signs extracted from vignette text; None when not stated."""

    hr: int | None = None
    rr: int | None = None
    sbp: int | None = None
    dbp: int | None = None
    spo2: int | None = None
    temp_f: float | None = None

    def any_present(self) -> bool:
        return any(v is not None for v in self.model_dump().values())


class Patient(BaseModel):
    """One triage case. `esi_true` must never reach a prompt; use `view()` for that."""

    id: str
    vignette: str
    vitals: Vitals = Field(default_factory=Vitals)
    age_years: float | None = None
    sex: Literal["M", "F"] | None = None
    race: str | None = None
    esi_true: int = Field(ge=1, le=5)
    split: Literal["train", "test"]
    chief_complaint: str = ""
    source: str = ""
    explanation: str | None = None  # handbook explanation (train only); never shown to agents

    def view(self) -> "PatientView":
        """Return the label-free view that prompt builders are allowed to see."""
        return PatientView(id=self.id, vignette=self.vignette)


class PatientView(BaseModel):
    """Everything an agent may see about a patient."""

    id: str
    vignette: str


# ---------------------------------------------------------------- agent outputs

def _clip_words(text: str, n: int) -> str:
    words = text.split()
    return text.strip() if len(words) <= n else " ".join(words[:n]) + "…"


class AgentOutput(BaseModel):
    """Strict agent answer. Light, documented normalization happens in `normalize_raw`."""

    esi: int = Field(ge=1, le=5)
    confidence: float = Field(ge=0.0, le=1.0)
    key_findings: list[str] = Field(default_factory=list, max_length=3)
    rationale: str = Field(max_length=600)


class Round2Output(AgentOutput):
    """A discussion-round answer: adds the message to the panel and the reason for any change."""

    message: str = Field(default="", max_length=600)
    change_reason: str = Field(default="", max_length=400)


DiscussionOutput = Round2Output


def normalize_raw(data: dict, round2: bool = False) -> tuple[dict, list[str]]:
    """Fix harmless formatting slips before validation; returns (data, notes).

    Fixes: confidence given on a 0-100 scale, ESI as a numeric string, more than three
    findings, over-long findings/rationale. Anything else (e.g. ESI 7) is left for
    validation to reject so the repair path handles it.
    """
    d = dict(data)
    notes: list[str] = []
    if isinstance(d.get("esi"), str) and d["esi"].strip().isdigit():
        d["esi"] = int(d["esi"].strip())
        notes.append("esi_str")
    if isinstance(d.get("esi"), float) and d["esi"].is_integer():
        d["esi"] = int(d["esi"])
    c = d.get("confidence")
    if isinstance(c, str):
        try:
            c = float(c.strip().rstrip("%"))
            notes.append("confidence_str")
        except ValueError:
            pass
    if isinstance(c, (int, float)) and 1.0 < c <= 100.0:
        c = c / 100.0
        notes.append("confidence_pct")
    d["confidence"] = c
    kf = d.get("key_findings")
    if isinstance(kf, str):
        kf = [kf]
    if isinstance(kf, list):
        if len(kf) > 3:
            notes.append("findings_trimmed")
        kf = [_clip_words(str(x).splitlines()[0] if str(x).strip() else "", 12) for x in kf[:3]]
        d["key_findings"] = [x for x in kf if x]
    if isinstance(d.get("rationale"), str) and len(d["rationale"].split()) > 60:
        d["rationale"] = _clip_words(d["rationale"], 60)
        notes.append("rationale_clipped")
    if round2 and isinstance(d.get("change_reason"), str):
        d["change_reason"] = _clip_words(d["change_reason"], 40)
    if round2 and isinstance(d.get("message"), str) and len(d["message"].split()) > 60:
        d["message"] = _clip_words(d["message"], 60)
        notes.append("message_clipped")
    return d, notes


class AgentResult(BaseModel):
    """One agent's turn on one patient, including failures and cost."""

    agent: str
    round: int
    output: Round2Output | AgentOutput | None = None
    failure: str | None = None
    repaired: bool = False
    notes: list[str] = Field(default_factory=list)
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0

    @property
    def ok(self) -> bool:
        return self.output is not None

    @property
    def esi(self) -> int | None:
        return self.output.esi if self.output else None
