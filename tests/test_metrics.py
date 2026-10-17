import math

from triage_debate import metrics as M

T = [1, 2, 2, 3, 4, 5]
P = [1, 3, 2, 2, None, 5]


def test_accuracy():
    assert M.exact_accuracy(T, P) == 3 / 6
    assert M.within1_accuracy(T, P) == 5 / 6  # None never counts as within 1


def test_under_over_triage():
    assert M.under_triage_rate(T, P) == 1 / 6  # 2 -> 3
    assert M.over_triage_rate(T, P) == 1 / 6   # 3 -> 2


def test_critical_miss():
    assert M.critical_miss_rate(T, P) == 1 / 3  # one of three ESI 1-2 predicted >= 3
    # If that case had been escalated, it is not a miss that slipped through.
    assert M.critical_miss_rate(T, P, mask=[True, False, True, True, True, True]) == 0.0
    assert math.isnan(M.critical_miss_rate([3, 4], [3, 4]))


def test_failure_is_not_a_critical_miss():
    assert M.critical_miss_rate([1], [None]) == 0.0


def test_bootstrap_ci_brackets_point_estimate():
    t = [1, 2, 3, 4, 5] * 10
    p = [1, 2, 3, 4, 4] * 10
    lo, hi = M.bootstrap_ci(M.exact_accuracy, t, p, n_boot=300)
    assert lo <= 0.8 <= hi


def test_auroc():
    assert M.auroc([0.9, 0.8, 0.1, 0.2], [True, True, False, False]) == 1.0
    assert M.auroc([0.1, 0.2, 0.9, 0.8], [True, True, False, False]) == 0.0
    assert M.auroc([0.5, 0.5], [True, False]) == 0.5
    assert math.isnan(M.auroc([0.1, 0.2], [False, False]))


def test_coverage_curve_endpoints_and_override():
    t, p = [1, 2, 3, 4], [2, 2, 3, 5]
    scores = [2.0, 0.0, 0.0, 1.0]
    rows = M.coverage_curve(t, p, scores, override=[False, False, False, False])
    # Lowest threshold escalates everything; infinite threshold escalates nothing.
    assert rows[0]["coverage"] == 0.0
    assert rows[-1]["coverage"] == 1.0 and rows[-1]["acc_auto"] == 0.5
    # Escalating score >= 1 keeps the two correct cases automatic.
    mid = next(r for r in rows if r["threshold"] == 1.0)
    assert mid["coverage"] == 0.5 and mid["acc_auto"] == 1.0
    assert mid["critical_miss_unreviewed"] == 0.0
    # Override forces escalation regardless of threshold.
    rows = M.coverage_curve(t, p, scores, override=[True, False, False, False])
    assert rows[-1]["coverage"] == 0.75


def test_mcnemar():
    r = M.mcnemar_exact([True] * 10, [False] * 10)
    assert r["b"] == 10 and r["c"] == 0 and r["p_value"] < 0.01
    assert M.mcnemar_exact([True, False], [True, False])["p_value"] == 1.0
