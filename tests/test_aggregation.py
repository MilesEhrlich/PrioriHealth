import pytest

from triage_debate.debate import disagreement, majority_vote, weighted_median


def test_weighted_median_unanimous_and_majority():
    assert weighted_median([3, 3, 3], [0.9, 0.5, 0.1]) == 3
    assert weighted_median([2, 3, 3], [0.6, 0.6, 0.6]) == 3


def test_weighted_median_confidence_shifts_result():
    # One very confident ESI 2 outweighs two unsure ESI 4s.
    assert weighted_median([2, 4, 4], [0.9, 0.2, 0.2]) == 2
    assert weighted_median([2, 4, 4], [0.3, 0.6, 0.6]) == 4


def test_weighted_median_tie_goes_more_urgent():
    assert weighted_median([2, 3], [0.5, 0.5]) == 2
    assert weighted_median([4, 1], [0.7, 0.7]) == 1


def test_weighted_median_zero_confidence_floor():
    # Zero weights are floored, so the result is still defined and urgent-leaning on ties.
    assert weighted_median([1, 5], [0.0, 0.0]) == 1


def test_weighted_median_empty_raises():
    with pytest.raises(ValueError):
        weighted_median([], [])


def test_majority_vote():
    assert majority_vote([3, 3, 2]) == 3
    assert majority_vote([2, 3, 4]) == 2  # no majority: most urgent
    assert majority_vote([4, 4, 2, 2]) == 2


def test_disagreement():
    d = disagreement([2, 3, 4], [0.9, 0.6, 0.3])
    assert d["range"] == 2
    assert d["mean_confidence"] == pytest.approx(0.6)
    assert d["score"] == pytest.approx(2.4)
    assert disagreement([3, 3, 3], [1, 1, 1])["score"] == 0
