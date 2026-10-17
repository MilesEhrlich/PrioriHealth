"""All prompt text lives here. Builders only accept `PatientView`, never `Patient`,
so ground truth cannot reach a prompt."""

from __future__ import annotations

import json
from typing import Any

from .schemas import AgentOutput, Patient, PatientView

# ---------------------------------------------------------------- shared reference

ESI_REFERENCE = """\
ESI v4 (1 = most urgent). Apply A-D in order; stop at the first that fits.
A. Needs immediate life-saving intervention? -> ESI 1. (Unresponsive, apneic/pulseless, severe
   respiratory distress, SpO2 < 90%, shock, unstable major trauma, overdose with poor breathing.)
B. Should not wait? -> ESI 2 if high-risk situation (e.g. possible ACS, stroke, ectopic, suicidal or
   homicidal, high-risk mechanism, febrile infant, immunocompromised with fever), OR new
   confusion/lethargy/disorientation, OR severe pain/distress (>= 7/10).
C. Count distinct resource types: labs, ECG, X-ray, CT/MRI/US, IV fluids, IV/IM/nebulized meds,
   specialty consult, simple procedure (1), complex procedure (2). Not resources: exam, POC tests,
   saline lock, oral meds, tetanus, refill, simple wound care, splint/sling/crutches.
   0 -> ESI 5; 1 -> ESI 4; 2+ -> go to D.
D. Danger-zone vitals -> consider ESI 2, else ESI 3. HR/RR limits: <3 mo >180/>50; 3 mo-3 y
   >160/>40; 3-8 y >140/>30; >8 y >100/>20. Any age SpO2 < 92%. Fever >= 38.0 C: age 1-28 days
   is at least ESI 2; 1-3 months consider ESI 2.
"""

OUTPUT_CONTRACT = """\
Use only clinical information from the vignette. Reply with JSON only:
{"esi": 1-5, "confidence": 0.0-1.0, "key_findings": [<=3 phrases, <10 words each], "rationale": "<=60 words"}"""

DISCUSS_CONTRACT = """\
Use only clinical information from the vignette. Reply with JSON only:
{"esi": 1-5, "confidence": 0.0-1.0, "key_findings": [<=3 phrases, <10 words each], "rationale": "<=40 words",
 "message": "<=40 words to the panel; respond to specific members by name",
 "change_reason": "<one sentence: why you changed or held your ESI>"}"""

ROUND2_CONTRACT = DISCUSS_CONTRACT  # backward-compatible name

# ---------------------------------------------------------------- personas

# Every panel member is a reasoning STYLE, not a clinical role or a direction. The guard below
# is appended to each so no trait pushes the panel toward more or less urgent levels.
TRAIT_GUARD = (
    "Your trait shapes HOW you reason, never which direction you lean. Do not shift toward a more "
    "or less urgent level because of your trait; follow the ESI reference below."
)


def _trait(name: str, style: str) -> dict[str, str]:
    return {"name": name,
            "role": f"You are the {name} on a ten-member emergency triage panel. {style} {TRAIT_GUARD}"}


PERSONAS: dict[str, dict[str, str]] = {
    "neutral": {
        "name": "Triage Nurse",
        "role": "You are an experienced emergency department triage nurse. Assign an ESI level "
                "using the reference below.",
    },
    "empath": _trait("Empath", "You pay close attention to the patient's own words, their distress, "
                     "and how severe their pain or fear is, and you make sure the panel hears it."),
    "logician": _trait("Logician", "You walk ESI decision points A, B, C and D strictly in order and "
                       "state which step decides the level."),
    "skeptic": _trait("Skeptic", "You challenge claims that are not supported by the vignette, "
                      "including other members' claims, and ask what the evidence is."),
    "observer": _trait("Observer", "You are detail-first: vital signs, exact numbers, time course and "
                       "small clues others might miss."),
    "synthesizer": _trait("Synthesizer", "You integrate all findings into the single most likely "
                          "clinical picture and say how the pieces fit together."),
    "pragmatist": _trait("Pragmatist", "You focus on what this patient will actually need in the ED: "
                         "which resources and interventions, counted concretely."),
    "vigilant": _trait("Vigilant", "You name dangerous possibilities that fit the presentation, but "
                       "you only raise acuity when a concrete finding supports it."),
    "impartial": _trait("Impartial", "You decide on clinical features only and point out any reasoning "
                        "that leans on sex, race, age stereotypes, insurance, demeanor, or who came "
                        "with the patient, unless it is clinically relevant."),
    "mediator": _trait("Mediator", "You pinpoint exactly where the panel disagrees and which single "
                       "fact or ESI step would settle it."),
    "reflective": _trait("Reflective", "You calibrate your confidence honestly, state what is "
                         "uncertain, and say what new information would change your mind."),
}

PANEL = ["empath", "logician", "skeptic", "observer", "synthesizer",
         "pragmatist", "vigilant", "impartial", "mediator", "reflective"]

# ---------------------------------------------------------------- JSON schemas

AGENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "esi": {"type": "integer", "minimum": 1, "maximum": 5},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "key_findings": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
        "rationale": {"type": "string"},
    },
    "required": ["esi", "confidence", "key_findings", "rationale"],
    "additionalProperties": False,
}

DISCUSS_SCHEMA: dict[str, Any] = {
    **AGENT_SCHEMA,
    "properties": {**AGENT_SCHEMA["properties"], "message": {"type": "string"},
                   "change_reason": {"type": "string"}},
    "required": AGENT_SCHEMA["required"] + ["message", "change_reason"],
}
ROUND2_SCHEMA = DISCUSS_SCHEMA  # backward-compatible name

# ---------------------------------------------------------------- builders


def system_prompt(persona: str, round_no: int = 1) -> str:
    """Persona role + shared ESI reference + output contract (discussion contract from round 2)."""
    contract = DISCUSS_CONTRACT if round_no >= 2 else OUTPUT_CONTRACT
    return f"{PERSONAS[persona]['role']}\n\n{ESI_REFERENCE}\n{contract}"


def few_shot_block(examples: list[Patient]) -> str:
    """Worked examples from the TRAIN split (label + handbook reasoning are allowed here)."""
    if not examples:
        return ""
    assert all(p.split == "train" for p in examples), "few-shot examples must come from train"
    parts = ["WORKED EXAMPLES (from training cases)"]
    for i, p in enumerate(examples, 1):
        reason = (p.explanation or "").split(". ", 1)[-1][:240]
        parts.append(f"Example {i}: {p.vignette}\n-> ESI {p.esi_true}. {reason}")
    return "\n\n".join(parts) + "\n\n"


def round1_user(view: PatientView, few_shot: list[Patient] | None = None) -> str:
    """Independent first-round prompt."""
    return (f"{few_shot_block(few_shot or [])}PATIENT VIGNETTE\n{view.vignette}\n\n"
            "Assign the ESI level.")


def _clip(text: str, words: int = 40) -> str:
    parts = text.split()
    return " ".join(parts[:words]) + ("…" if len(parts) > words else "")


def _statement(out: AgentOutput) -> str:
    """What other members see: level, confidence, and the member's message (or rationale)."""
    said = getattr(out, "message", "") or out.rationale
    return f"ESI {out.esi} (confidence {out.confidence:.2f}): {_clip(said)}"


def discussion_user(view: PatientView, round_no: int, own: AgentOutput,
                    others: dict[str, AgentOutput]) -> str:
    """Discussion prompt: the member sees every other member's latest position and argument."""
    lines = [f"PATIENT VIGNETTE\n{view.vignette}\n",
             f"DISCUSSION ROUND {round_no}. YOUR LAST POSITION\n{_statement(own)}\n",
             "THE OTHER PANEL MEMBERS SAID"]
    for name, out in others.items():
        lines.append(f"[{name}] {_statement(out)}")
    lines.append(
        "\nReply to the panel. Address specific members by name where you agree or disagree. "
        "Then give your ESI. Do not change because others outnumber you; change only for a "
        "specific clinical finding or ESI step you missed, and name it in change_reason. The "
        "panel's goal is one shared level everyone can justify."
    )
    return "\n".join(lines)


def round2_user(view: PatientView, own: AgentOutput, others: dict[str, AgentOutput]) -> str:
    """Backward-compatible wrapper: discussion round 2."""
    return discussion_user(view, 2, own, others)


def repair_user(original_user: str, bad_text: str, error: str) -> str:
    """One-shot repair prompt after invalid output."""
    return (f"{original_user}\n\nYour previous reply could not be used: {error}\n"
            f"Previous reply:\n{bad_text[:1500]}\n\n"
            "Return ONLY the corrected JSON object with exactly the required fields.")
