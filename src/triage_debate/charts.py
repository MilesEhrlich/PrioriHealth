"""Figure builders + one-line takeaways. Used by scripts/make_charts.py (PNG) and the app."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.graph_objects as go

from .theme import ACCENT, CONDITION_LABELS, CONTEXT, CONTEXT_LIGHT, INK, MUTED, condition_color

ORDER = ["A", "B", "D", "C"]  # baselines first, full system last (closest to the reader's eye)


def load_result_set(path: Path) -> dict[str, Any]:
    """Read a results/<provider>/<sample|full>/ folder into memory."""
    path = Path(path)
    out: dict[str, Any] = {"path": path, "summary": json.loads((path / "summary.json").read_text())}
    for name in ["metrics", "coverage_curve", "fairness", "patients"]:
        f = path / f"{name}.csv"
        out[name] = pd.read_csv(f) if f.exists() else pd.DataFrame()
    out["predictions"] = {c: pd.read_csv(f) for c in "ABCD"
                          if (f := path / f"predictions_{c}.csv").exists()}
    return out


def _pct(v: float | None) -> str:
    return "n/a" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{v * 100:.0f}%"


def _conds(metrics: pd.DataFrame) -> list[str]:
    return [c for c in ORDER if c in set(metrics["condition"])]


def _hbar(metrics: pd.DataFrame, col: str, title: str, xtitle: str, text_fmt) -> go.Figure:
    conds = _conds(metrics)
    m = metrics.set_index("condition").loc[conds]
    fig = go.Figure(go.Bar(
        y=[CONDITION_LABELS[c] for c in conds], x=m[col], orientation="h",
        marker=dict(color=[condition_color(c) for c in conds], cornerradius=0),
        text=[text_fmt(v) for v in m[col]], textposition="outside", cliponaxis=False,
        textfont=dict(color=INK), hovertemplate="%{y}: %{text}<extra></extra>",
    ))
    fig.update_layout(template="triage", title=title, xaxis_title=xtitle, height=420, width=900,
                      showlegend=False)
    fig.update_yaxes(showgrid=False)
    return fig


def fig_accuracy(rs: dict[str, Any]) -> go.Figure:
    """Exact accuracy by condition with bootstrap 95% CIs."""
    s = rs["summary"]["conditions"]
    conds = _conds(rs["metrics"])
    fig = _hbar(rs["metrics"], "exact_acc", "Exact ESI accuracy by condition", "Exact accuracy", _pct)
    lo = [s[c]["exact_acc_ci"][0] for c in conds]
    hi = [s[c]["exact_acc_ci"][1] for c in conds]
    acc = [s[c]["exact_acc"] for c in conds]
    fig.update_traces(error_x=dict(type="data", symmetric=False, color=MUTED, thickness=1.5,
                                   array=[h - a for h, a in zip(hi, acc)],
                                   arrayminus=[a - l for a, l in zip(acc, lo)]),
                      textposition="inside", insidetextanchor="start", textfont=dict(color="#FFFFFF"))
    fig.update_xaxes(range=[0, 1], tickformat=".0%")
    return fig


def fig_critical_miss(rs: dict[str, Any]) -> go.Figure:
    """Critical misses overall vs. those that also escaped nurse review."""
    conds = _conds(rs["metrics"])
    m = rs["metrics"].set_index("condition").loc[conds]
    labels = [CONDITION_LABELS[c] for c in conds]
    fig = go.Figure([
        go.Bar(name="Called non-urgent (all)", y=labels, x=m["critical_miss"], orientation="h",
               marker=dict(color=CONTEXT_LIGHT, cornerradius=0),
               text=[_pct(v) for v in m["critical_miss"]], textposition="outside", cliponaxis=False,
               textfont=dict(color=MUTED)),
        go.Bar(name="…and not sent to a nurse", y=labels, x=m["critical_miss_unreviewed"],
               orientation="h", marker=dict(color=[ACCENT if c == "C" else CONTEXT for c in conds],
                                            cornerradius=0),
               text=[_pct(v) for v in m["critical_miss_unreviewed"]], textposition="outside",
               cliponaxis=False, textfont=dict(color=INK)),
    ])
    fig.update_layout(template="triage", barmode="group", height=460, width=900,
                      title="Critical misses: true ESI 1–2 patients called ESI 3 or lower",
                      xaxis_title="Share of critical patients", bargroupgap=0.08)
    fig.update_xaxes(range=[0, max(0.1, float(m["critical_miss"].max()) * 1.25)], tickformat=".0%")
    fig.update_yaxes(showgrid=False, autorange="reversed")
    return fig


def fig_coverage(rs: dict[str, Any], operating_threshold: float = 1.0) -> go.Figure:
    """Accuracy on automatically decided cases vs. share sent to a nurse."""
    cov = rs["coverage_curve"]
    fig = go.Figure()
    for c in [x for x in ORDER if x in set(cov["condition"])]:
        d = cov[cov["condition"] == c].sort_values("escalation_rate")
        d = d.dropna(subset=["acc_auto"])
        is_c = c == "C"
        fig.add_trace(go.Scatter(
            x=d["escalation_rate"], y=d["acc_auto"], mode="lines+markers", name=CONDITION_LABELS[c],
            line=dict(color=condition_color(c), width=2.5 if is_c else 2,
                      dash="solid" if is_c else ("dot" if c == "A" else "dash"), shape="hv"),
            marker=dict(size=8 if is_c else 6), opacity=1 if is_c or c == "A" else 0.6,
            hovertemplate="Sent to nurse: %{x:.0%}<br>Accuracy on the rest: %{y:.0%}<extra>"
                          + CONDITION_LABELS[c] + "</extra>",
        ))
    fig.update_layout(template="triage", height=520, width=900,
                      title="Coverage vs. accuracy: how much nurse review buys",
                      xaxis_title="Share of cases sent to a nurse (review load)",
                      yaxis_title="Accuracy on cases decided automatically")
    fig.update_xaxes(range=[-0.02, 1.02], tickformat=".0%")
    fig.update_yaxes(range=[0, 1.05], tickformat=".0%")
    return fig


def fig_auroc(rs: dict[str, Any]) -> go.Figure:
    """How well each condition's uncertainty signal ranks its own errors."""
    fig = _hbar(rs["metrics"], "auroc_uncertainty", "Does the uncertainty signal predict errors?",
                "AUROC (0.5 = chance, 1.0 = perfect)",
                lambda v: "n/a" if pd.isna(v) else f"{v:.2f}")
    fig.add_vline(x=0.5, line=dict(color=MUTED, dash="dash", width=1.5))
    fig.update_xaxes(range=[0, 1])
    return fig


def fig_fairness(rs: dict[str, Any]) -> go.Figure | None:
    """Share of cases whose aggregate ESI changes when only the patient's sex is swapped."""
    f = rs["summary"].get("fairness") or {}
    if not f:
        return None
    conds = [c for c in ["A", "C"] if c in f]
    fig = go.Figure(go.Bar(
        y=[CONDITION_LABELS[c] for c in conds], x=[f[c]["flip_rate"] for c in conds], orientation="h",
        marker=dict(color=[condition_color(c) for c in conds], cornerradius=0),
        text=[f"{_pct(f[c]['flip_rate'])}  ({f[c]['flips']} of {f[c]['n_pairs']})" for c in conds],
        textposition="outside", cliponaxis=False, textfont=dict(color=INK),
    ))
    fig.update_layout(template="triage", height=320, width=900, showlegend=False,
                      title="Sex-swap test: decisions that change when only sex is flipped",
                      xaxis_title="Flip rate (lower is better)")
    top = max(0.1, max(f[c]["flip_rate"] or 0 for c in conds) * 1.6)
    fig.update_xaxes(range=[0, top], tickformat=".0%")
    fig.update_yaxes(showgrid=False)
    return fig


def fig_cost(rs: dict[str, Any]) -> go.Figure:
    """Tokens per patient, labelled with calls per patient."""
    m = rs["metrics"].set_index("condition")
    fig = _hbar(rs["metrics"], "tokens_per_patient", "Cost per patient", "Tokens per patient",
                lambda v: f"{v:,.0f}")
    conds = _conds(rs["metrics"])
    fig.update_traces(text=[f"{m.loc[c, 'tokens_per_patient']:,.0f} tokens · "
                            f"{m.loc[c, 'calls_per_patient']:.1f} calls" for c in conds])
    fig.update_xaxes(range=[0, float(m["tokens_per_patient"].max()) * 1.75])
    return fig


def takeaways(rs: dict[str, Any]) -> dict[str, str]:
    """One plain-English sentence per chart, computed from the numbers (not hand-written)."""
    s = rs["summary"]["conditions"]
    n = rs["summary"]["n_patients"]
    out: dict[str, str] = {}
    if {"A", "C"} <= set(s):
        a, c = s["A"], s["C"]
        out["accuracy"] = (f"The persona debate got {_pct(c['exact_acc'])} exactly right vs "
                           f"{_pct(a['exact_acc'])} for a single agent (n = {n}; wide intervals).")
        out["critical_miss"] = (f"A single agent called {_pct(a['critical_miss'])} of critical patients "
                                f"non-urgent; with the debate, {_pct(c['critical_miss_unreviewed'])} "
                                "slipped through without a nurse seeing them.")
        out["coverage"] = (f"At the default setting the debate sends {_pct(c['escalation_rate'])} of "
                           f"cases to a nurse and is right on {_pct(c['acc_non_escalated'])} of the rest.")
        au_c, au_a = c.get("auroc_uncertainty"), a.get("auroc_uncertainty")
        if au_c is not None and au_a is not None:
            better = "better" if au_c > au_a else "no better"
            out["auroc"] = (f"Agent disagreement flags errors {better} than a single agent's own "
                            f"confidence (AUROC {au_c:.2f} vs {au_a:.2f}).")
        out["cost"] = (f"The debate costs {c['calls_per_patient']:.1f} calls and "
                       f"{c['tokens_per_patient']:,.0f} tokens per patient, about "
                       f"{c['tokens_per_patient'] / max(a['tokens_per_patient'], 1):.1f}x a single agent.")
    f = rs["summary"].get("fairness") or {}
    if {"A", "C"} <= set(f):
        out["fairness"] = (f"Swapping only the patient's sex changed the decision in "
                           f"{f['A']['flips']} of {f['A']['n_pairs']} cases for a single agent and "
                           f"{f['C']['flips']} of {f['C']['n_pairs']} for the debate.")
    return out


FIGURES = {
    "accuracy": fig_accuracy,
    "critical_miss": fig_critical_miss,
    "coverage": fig_coverage,
    "auroc": fig_auroc,
    "fairness": fig_fairness,
    "cost": fig_cost,
}
