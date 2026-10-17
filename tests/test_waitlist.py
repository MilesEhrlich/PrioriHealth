"""Waiting room ordering, persistence and worker (fake triage, no LLM)."""

import asyncio

import pytest

from triage_debate.schemas import Patient
from triage_debate.waitlist import (
    EngineUnavailable,
    WaitEntry,
    WaitingList,
    effective_esi,
    pick_demo_vignettes,
    priority_view,
)

T0 = 1_000_000.0


def entry(i, esi, minutes_ago, **kw):
    return WaitEntry(id=f"e{i}", label=f"P{i}", vignette="v", arrived_at=T0 - minutes_ago * 60,
                     status=kw.pop("status", "triaged"), esi=esi, **kw)


def order(entries, now=T0):
    return [r["id"] for r in priority_view(entries, now)["waiting"]]


def test_esi_weighted_wait_ordering():
    es = [
        entry(1, 3, 5),    # 5 min into a 30 min target  -> -25
        entry(2, 4, 70),   # 70 min into a 60 min target -> +10 (overdue)
        entry(3, 2, 1),    # 1 min into a 10 min target  -> -9
        entry(4, 5, 10),   # -110
    ]
    assert order(es) == ["e2", "e3", "e1", "e4"]
    view = priority_view(es, T0)["waiting"]
    assert view[0]["overdue_min"] == pytest.approx(10) and view[0]["position"] == 1


def test_esi1_always_first_and_ties_by_arrival():
    es = [entry(1, 4, 500), entry(2, 1, 0), entry(3, 3, 10), entry(4, 3, 10.5)]
    # ESI 1 first; then the ESI 4 who waited 500 min (440 past target); the ESI 3 who waited
    # longer (10.5 min) edges out the one who waited 10.
    assert order(es) == ["e2", "e1", "e4", "e3"]


def test_nurse_override_and_escalated_safety_level():
    e = entry(1, 4, 0, escalated=True, safety_esi=2)
    assert effective_esi(e) == 2          # unconfirmed escalation ranks by most urgent proposal
    e.nurse_esi = 4
    assert effective_esi(e) == 4          # nurse decision wins
    assert effective_esi(entry(2, 3, 0, escalated=False, safety_esi=1)) == 3


def test_sections_and_failed_never_buried():
    es = [entry(1, None, 2, status="failed"), entry(2, 5, 30), entry(3, None, 1, status="triaging"),
          entry(4, 3, 3, status="seen", seen_at=T0)]
    v = priority_view(es, T0)
    assert [r["id"] for r in v["waiting"]] == ["e1", "e2"]   # failed treated as ESI 2
    assert [r["id"] for r in v["triaging"]] == ["e3"] and [r["id"] for r in v["seen"]] == ["e4"]


def test_demo_vignettes_come_from_train_only():
    train = [Patient(id=f"t{i}", vignette="x", esi_true=3, split="train") for i in range(5)]
    test = [Patient(id="z", vignette="y", esi_true=3, split="test")]
    picks = pick_demo_vignettes(train + test, 10, seed=1)
    assert len(picks) == 5 and all(p.split == "train" for p in picks)


class FakeResult:
    aggregate, escalated, escalation_reasons, consensus_reached, rounds_used = 3, True, ["no_consensus"], False, 5

    def vote_matrix(self):
        return [[2, 3], [3, 3]]

    def model_dump_json(self):
        return '{"agents": ["A", "B"]}'


async def test_worker_triages_and_persists(tmp_path):
    calls = []

    async def triage(e, on_event):
        calls.append(e.id)
        return FakeResult()

    path = tmp_path / "wl.json"
    wl = WaitingList(path, triage=triage)
    wl.start()
    a = await wl.add("A 50-year-old with chest pain and sweating.", label="Bed 1")
    for _ in range(50):
        if wl.entries[a.id].status == "triaged":
            break
        await asyncio.sleep(0.01)
    e = wl.entries[a.id]
    assert e.status == "triaged" and e.esi == 3 and e.safety_esi == 2 and e.escalated
    assert effective_esi(e) == 2
    await wl.confirm(a.id, 3)
    await wl.stop()
    # Reload from disk: state survives a restart.
    wl2 = WaitingList(path)
    assert wl2.entries[a.id].nurse_esi == 3 and wl2.entries[a.id].debate == {"agents": ["A", "B"]}
    await wl2.mark_seen(a.id)
    assert wl2.snapshot()["seen"][0]["id"] == a.id


async def test_failed_triage_is_flagged_not_lost(tmp_path):
    async def boom(e, on_event):
        raise ValueError("bad output")

    wl = WaitingList(tmp_path / "wl.json", triage=boom)
    wl.start()
    a = await wl.add("Short note about abdominal pain for testing.")
    for _ in range(50):
        if wl.entries[a.id].status == "failed":
            break
        await asyncio.sleep(0.01)
    assert wl.entries[a.id].escalated and wl.entries[a.id].reasons == ["triage_failed"]
    await wl.stop()


async def test_engine_unavailable_keeps_patient_queued(tmp_path, monkeypatch):
    import triage_debate.waitlist as W

    monkeypatch.setattr(W, "RETRY_S", 0.01)
    attempts = []

    async def flaky(e, on_event):
        attempts.append(1)
        if len(attempts) == 1:
            raise EngineUnavailable("no engine")
        return FakeResult()

    wl = WaitingList(tmp_path / "wl.json", triage=flaky)
    wl.start()
    a = await wl.add("Patient with a cough for three days, otherwise well.")
    for _ in range(100):
        if wl.entries[a.id].status == "triaged":
            break
        await asyncio.sleep(0.01)
    assert wl.entries[a.id].status == "triaged" and len(attempts) == 2
    await wl.stop()


async def test_interrupted_triage_restarts_on_load(tmp_path):
    path = tmp_path / "wl.json"
    wl = WaitingList(path)
    e = await wl.add("Interrupted case: ankle sprain after a fall.")
    wl.entries[e.id].status = "triaging"
    wl._save()
    assert WaitingList(path).entries[e.id].status == "queued"
