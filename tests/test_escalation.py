from triage_debate.debate import escalation_decision


def test_no_escalation_when_unanimous():
    assert escalation_decision([3, 3, 3], 3) == (False, [])


def test_disagreement_threshold():
    assert escalation_decision([3, 4, 3], 3, range_threshold=1) == (True, ["disagreement"])
    assert escalation_decision([3, 4, 3], 3, range_threshold=2) == (False, [])


def test_safety_override_beats_threshold():
    esc, reasons = escalation_decision([2, 3, 3], 3, range_threshold=5)
    assert esc and reasons == ["safety_override"]
    # Override does not fire when the aggregate is already urgent.
    assert escalation_decision([2, 2, 3], 2, range_threshold=5) == (False, [])
    # It can be switched off (ablation only).
    assert escalation_decision([2, 3, 3], 3, range_threshold=5, safety_override=False) == (False, [])


def test_missing_agent_escalates():
    esc, reasons = escalation_decision([3, 3], 3, missing_agents=1)
    assert esc and "agent_failure" in reasons


def test_consensus_protocol_reasons():
    # Unanimous, nobody urgent at the start: no review.
    assert escalation_decision([3, 3], 3, consensus_protocol=True, consensus_reached=True,
                               first_round_esis=[3, 4]) == (False, [])
    # Split after the cap.
    assert escalation_decision([3, 4], 3, consensus_protocol=True, consensus_reached=False,
                               first_round_esis=[3, 3])[1] == ["no_consensus"]
    # A remaining holdout at ESI 1-2 is flagged too, even if the panel reached consensus.
    assert escalation_decision([2, 3, 3], 3, consensus_protocol=True, consensus_reached=True,
                               first_round_esis=[3, 3, 3])[1] == ["urgent_dissent_overruled"]
    # Someone said ESI 2 independently but was talked down to 3: nurse sees it.
    esc, reasons = escalation_decision([3, 3], 3, consensus_protocol=True, consensus_reached=True,
                                       first_round_esis=[2, 3])
    assert esc and reasons == ["urgent_dissent_overruled"]

