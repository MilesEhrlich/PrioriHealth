"""Pure metric functions. Predictions may be None (system failure): a None prediction counts
as wrong for accuracy, and is not a critical miss because failures always go to a nurse."""

from __future__ import annotations

import random
from collections.abc import Callable, Sequence

Pred = int | None


def _pairs(y_true: Sequence[int], y_pred: Sequence[Pred]) -> list[tuple[int, Pred]]:
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred differ in length")
    return list(zip(y_true, y_pred))


def _rate(num: int, den: int) -> float:
    return num / den if den else float("nan")


def exact_accuracy(y_true: Sequence[int], y_pred: Sequence[Pred]) -> float:
    """Fraction with predicted ESI equal to truth."""
    p = _pairs(y_true, y_pred)
    return _rate(sum(t == q for t, q in p), len(p))


def within1_accuracy(y_true: Sequence[int], y_pred: Sequence[Pred]) -> float:
    """Fraction predicted within one ESI level of truth."""
    p = _pairs(y_true, y_pred)
    return _rate(sum(q is not None and abs(t - q) <= 1 for t, q in p), len(p))


def under_triage_rate(y_true: Sequence[int], y_pred: Sequence[Pred]) -> float:
    """Fraction predicted LESS urgent than truth (higher ESI number)."""
    p = _pairs(y_true, y_pred)
    return _rate(sum(q is not None and q > t for t, q in p), len(p))


def over_triage_rate(y_true: Sequence[int], y_pred: Sequence[Pred]) -> float:
    """Fraction predicted MORE urgent than truth (lower ESI number)."""
    p = _pairs(y_true, y_pred)
    return _rate(sum(q is not None and q < t for t, q in p), len(p))


def critical_miss_rate(y_true: Sequence[int], y_pred: Sequence[Pred],
                       mask: Sequence[bool] | None = None) -> float:
    """Among true ESI 1-2, the fraction predicted ESI 3 or higher.

    With `mask`, only cases where mask is True can count as misses (e.g. non-escalated
    cases), but the denominator is still all true ESI 1-2 cases. That answers: "of all
    critical patients, how many slipped through without a nurse seeing them?"
    """
    p = _pairs(y_true, y_pred)
    m = list(mask) if mask is not None else [True] * len(p)
    crit = [(q, mi) for (t, q), mi in zip(p, m) if t <= 2]
    return _rate(sum(q is not None and q >= 3 and mi for q, mi in crit), len(crit))


def bootstrap_ci(metric: Callable[..., float], *cols: Sequence, n_boot: int = 1000,
                 seed: int = 0, alpha: float = 0.05) -> tuple[float, float]:
    """Percentile bootstrap CI for metric(*cols), resampling rows with replacement."""
    n = len(cols[0])
    if n == 0:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    vals = []
    for _ in range(n_boot):
        idx = [rng.randrange(n) for _ in range(n)]
        v = metric(*[[c[i] for i in idx] for c in cols])
        if v == v:  # skip NaN (e.g. resample with no critical cases)
            vals.append(v)
    if not vals:
        return (float("nan"), float("nan"))
    vals.sort()
    lo = vals[int(alpha / 2 * (len(vals) - 1))]
    hi = vals[int((1 - alpha / 2) * (len(vals) - 1))]
    return (lo, hi)


def auroc(scores: Sequence[float], is_error: Sequence[bool]) -> float:
    """Area under the ROC curve for `scores` ranking errors above correct cases.

    Computed by pairwise comparison (ties count half), so no sklearn dependency here and it
    is exact for small n. NaN when there are no errors or no correct cases.
    """
    pos = [s for s, e in zip(scores, is_error) if e]
    neg = [s for s, e in zip(scores, is_error) if not e]
    if not pos or not neg:
        return float("nan")
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def coverage_curve(y_true: Sequence[int], y_pred: Sequence[Pred], scores: Sequence[float],
                   override: Sequence[bool] | None = None) -> list[dict[str, float]]:
    """Sweep an escalation threshold over the disagreement score.

    A case is escalated if score >= t, or if `override` is True for it (the safety
    override and agent failures always escalate). For each t, report coverage (share
    decided automatically), accuracy on automatic cases, and critical misses that slip
    through without review (as a share of all true ESI 1-2 cases).
    """
    n = len(y_true)
    ov = list(override) if override is not None else [False] * n
    thresholds = sorted(set(scores)) + [float("inf")]
    rows = []
    for t in thresholds:
        auto = [not (s >= t or o) for s, o in zip(scores, ov)]
        k = sum(auto)
        acc = _rate(sum(a and yt == yp for a, yt, yp in zip(auto, y_true, y_pred)), k)
        rows.append({
            "threshold": t,
            "coverage": k / n if n else float("nan"),
            "escalation_rate": 1 - k / n if n else float("nan"),
            "acc_auto": acc,
            "critical_miss_unreviewed": critical_miss_rate(y_true, y_pred, mask=auto),
        })
    return rows


def mcnemar_exact(correct_a: Sequence[bool], correct_b: Sequence[bool]) -> dict[str, float]:
    """Exact two-sided McNemar test on paired correctness (same patients, two systems).

    b = A right & B wrong, c = A wrong & B right. p-value from Binomial(b + c, 0.5).
    """
    from math import comb

    b = sum(x and not y for x, y in zip(correct_a, correct_b))
    c = sum(y and not x for x, y in zip(correct_a, correct_b))
    n = b + c
    if n == 0:
        return {"b": 0, "c": 0, "p_value": 1.0}
    tail = sum(comb(n, i) for i in range(min(b, c) + 1)) / 2 ** n
    return {"b": b, "c": c, "p_value": min(1.0, 2 * tail)}
