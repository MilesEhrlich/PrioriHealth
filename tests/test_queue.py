from triage_debate.queue_sim import arrival_times, simulate


def test_arrivals_seeded_and_increasing():
    a = arrival_times(10, 4.0, seed=1)
    assert a == arrival_times(10, 4.0, seed=1)
    assert a[0] == 0.0 and all(x <= y for x, y in zip(a, a[1:]))


def test_queue_reorders_by_esi_then_arrival_and_pins_review():
    decisions = [
        {"patient_id": "a", "esi": 4, "escalated": False},
        {"patient_id": "b", "esi": 2, "escalated": False},
        {"patient_id": "c", "esi": 4, "escalated": True, "escalation_reasons": ["disagreement"]},
        {"patient_id": "d", "esi": None, "escalated": True},
    ]
    steps = simulate(decisions, mean_gap_min=5, seed=0)
    assert [e.patient_id for e in steps[1].queue] == ["b", "a"]
    assert steps[1].queue[1].moved == -1  # "a" was pushed down one place
    last = steps[-1]
    assert [e.patient_id for e in last.queue] == ["d", "b", "a", "c"]  # failure first, ties by arrival
    assert last.review == ["d", "c"]
    assert last.queue[2].wait_min == last.clock_min  # "a" arrived at t=0
