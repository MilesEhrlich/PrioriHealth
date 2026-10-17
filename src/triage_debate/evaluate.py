"""Experiment condition runners and metric tables."""

from __future__ import annotations

import asyncio
from typing import Any

import pandas as pd

from . import metrics as M
from .agents import result_row, run_agent
from .debate import DebateResult, debate_row, round1_only, run_debate
from .llm import LLMClient
from .prompts import PANEL
from .schemas import Patient

def panel_temperature(cfg: dict[str, Any]) -> float:
    """Sampling temperature for multi-agent panels (B and C alike, so they stay comparable).

    At temperature 0 every member of a single-model panel tends to give the identical answer,
    which makes the discussion empty; sampling lets independent opinions actually differ.
    """
    return float(cfg.get("debate", {}).get("temperature", cfg["llm"]["temperature_sampling"]))


def consensus_threshold(cfg: dict[str, Any]) -> float:
    """Share of the panel that must agree to stop discussing (config debate.consensus_threshold)."""
    return float(cfg.get("debate", {}).get("consensus_threshold", 1.0))


def panel_from_config(cfg: dict[str, Any]) -> list[str]:
    """Trait personas for the consensus panel (config debate.panel, default all ten)."""
    return list(cfg.get("debate", {}).get("panel") or PANEL)


async def run_condition_a(client: LLMClient, patients: list[Patient],
                          few_shot: list[Patient] | None = None) -> pd.DataFrame:
    """Condition A: one neutral agent per patient. A failed call is escalated."""

    async def one(p: Patient) -> dict[str, Any]:
        r = await run_agent(client, "neutral", p.view(), few_shot=few_shot)
        row = {"patient_id": p.id, "esi_true": p.esi_true, "condition": "A",
               "pred": r.esi, "escalated": not r.ok,
               "escalation_reasons": "agent_failure" if not r.ok else "",
               "disagreement_range": 0, "mean_confidence": r.output.confidence if r.ok else None,
               "calls": r.calls, "input_tokens": r.input_tokens,
               "output_tokens": r.output_tokens, "latency_ms": r.latency_ms}
        row.update({f"a_{k}": v for k, v in result_row(r).items() if k not in {"agent", "round"}})
        return row

    rows = await asyncio.gather(*(one(p) for p in patients))
    return pd.DataFrame(rows)


async def run_debates(client: LLMClient, patients: list[Patient], cfg: dict[str, Any], *,
                      condition: str, few_shot: list[Patient] | None = None) -> list[DebateResult]:
    """Run the consensus discussion (until unanimous, capped) for every patient.

    C: the trait panel. B: the same number of neutral agents. Same protocol, aggregation and
    sampling temperature, so the only difference is the reasoning-style prompts.
    """
    panel = panel_from_config(cfg)
    temp = panel_temperature(cfg)
    if condition == "C":
        personas, labels = panel, None
    elif condition == "B":
        personas = ["neutral"] * len(panel)
        labels = [f"Agent {i}" for i in range(1, len(panel) + 1)]
    else:
        raise ValueError(condition)
    return list(await asyncio.gather(*(
        run_debate(client, p, condition=condition, personas=personas, labels=labels,
                   max_rounds=int(cfg["debate"].get("max_rounds", 5)),
                   consensus_threshold=consensus_threshold(cfg),
                   early_stop=bool(cfg["debate"]["early_stop"]), temperature=temp,
                   few_shot=few_shot, escalation_cfg=cfg["escalation"])
        for p in patients
    )))


def debates_to_frame(debates: list[DebateResult], patients: list[Patient]) -> pd.DataFrame:
    """One row per patient for a debate condition."""
    truth = {p.id: p.esi_true for p in patients}
    return pd.DataFrame([debate_row(d, truth[d.patient_id]) for d in debates])


def derive_round1_only(debates: list[DebateResult], cfg: dict[str, Any]) -> list[DebateResult]:
    """Condition D from condition C's round-1 answers (no extra calls)."""
    return [round1_only(d, "D", cfg["escalation"]) for d in debates]


def add_uncertainty(df: pd.DataFrame) -> pd.DataFrame:
    """Add the columns the escalation analysis needs.

    uncertainty: the score used to rank cases for review. For debate conditions this is
      the disagreement score; for the single agent (A) it is 1 - self-reported confidence,
      the only signal a lone agent offers. Failures get +inf (always reviewed).
    forced_review: safety override or agent failure (escalated regardless of threshold).
    """
    df = df.copy()
    if "disagreement_score" in df:
        u = df["disagreement_score"].astype(float)
    else:
        u = 1 - df["mean_confidence"].astype(float)
    df["uncertainty"] = u.fillna(float("inf"))
    reasons = df["escalation_reasons"].fillna("").astype(str)
    df["forced_review"] = reasons.str.contains("safety_override|agent_failure") | df["pred"].isna()
    df["correct"] = df["pred"] == df["esi_true"]
    return df


def condition_metrics(df: pd.DataFrame, n_boot: int = 1000) -> dict[str, Any]:
    """All headline metrics for one condition's prediction table."""
    df = add_uncertainty(df)
    t = df["esi_true"].astype(int).tolist()
    q = [None if pd.isna(x) else int(x) for x in df["pred"]]
    esc = df["escalated"].astype(bool).tolist()
    auto = [not e for e in esc]
    wrong = [not c for c in df["correct"]]
    t_auto = [x for x, a in zip(t, auto) if a]
    q_auto = [x for x, a in zip(q, auto) if a]
    t_esc = [x for x, a in zip(t, auto) if not a]
    q_esc = [x for x, a in zip(q, auto) if not a]
    finite = [u if u != float("inf") else 1e9 for u in df["uncertainty"]]
    out: dict[str, Any] = {
        "n": len(df),
        "exact_acc": M.exact_accuracy(t, q),
        "within1_acc": M.within1_accuracy(t, q),
        "under_triage": M.under_triage_rate(t, q),
        "over_triage": M.over_triage_rate(t, q),
        "critical_miss": M.critical_miss_rate(t, q),
        "critical_miss_unreviewed": M.critical_miss_rate(t, q, mask=auto),
        "escalation_rate": sum(esc) / len(esc) if esc else float("nan"),
        "acc_non_escalated": M.exact_accuracy(t_auto, q_auto) if t_auto else float("nan"),
        "acc_escalated": M.exact_accuracy(t_esc, q_esc) if t_esc else float("nan"),
        "auroc_uncertainty": M.auroc(finite, wrong),
        "auroc_range": (M.auroc(df["disagreement_range"].astype(float).tolist(), wrong)
                        if "disagreement_score" in df else float("nan")),
        "failures": int(sum(x is None for x in q)),
        "calls_per_patient": float(df["calls"].mean()),
        "tokens_per_patient": float((df["input_tokens"] + df["output_tokens"]).mean()),
        "latency_s_per_patient": float(df["latency_ms"].mean() / 1000),
    }
    for name, fn in [("exact_acc", M.exact_accuracy), ("critical_miss", M.critical_miss_rate)]:
        out[f"{name}_ci"] = M.bootstrap_ci(fn, t, q, n_boot=n_boot)
    return out


def coverage_table(df: pd.DataFrame, condition: str) -> pd.DataFrame:
    """Coverage vs accuracy as the escalation threshold sweeps (safety override always on)."""
    df = add_uncertainty(df)
    rows = M.coverage_curve(df["esi_true"].astype(int).tolist(),
                            [None if pd.isna(x) else int(x) for x in df["pred"]],
                            df["uncertainty"].tolist(), df["forced_review"].tolist())
    out = pd.DataFrame(rows)
    out.insert(0, "condition", condition)
    return out


def paired_tests(frames: dict[str, pd.DataFrame], pairs: list[tuple[str, str]]) -> dict[str, Any]:
    """Exact McNemar on correctness for each (a, b) pair present in `frames`."""
    out = {}
    for a, b in pairs:
        if a in frames and b in frames:
            fa = frames[a].set_index("patient_id")
            fb = frames[b].set_index("patient_id").loc[fa.index]
            out[f"{b}_vs_{a}"] = M.mcnemar_exact((fa["pred"] == fa["esi_true"]).tolist(),
                                                 (fb["pred"] == fb["esi_true"]).tolist())
    return out


def core_metrics(df: pd.DataFrame) -> dict[str, Any]:
    """Backward-compatible alias used by the experiment script."""
    return condition_metrics(df)
