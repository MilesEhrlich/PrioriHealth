"""Patient-facing status page: codes, place-in-line math, and the public endpoint (no LLM calls)."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from triage_debate import api as api_mod
from triage_debate import auth
from triage_debate.waitlist import (
    CODE_ALPHABET,
    WaitEntry,
    WaitingList,
    new_code,
    normalize_code,
    patient_status,
    priority_view,
    throughput_minutes,
)

CLINICAL = {"label", "chief_complaint", "esi", "safety_esi", "nurse_esi", "vignette", "reasons", "debate", "escalated"}


def entry(i, **kw):
    base = dict(id=f"e{i}", code=f"C{i:05d}", label=f"P{i}", vignette="x" * 30, arrived_at=0.0, status="triaged", esi=3)
    return WaitEntry(**{**base, **kw})


def test_codes_are_unique_and_readable():
    codes = set()
    for _ in range(500):
        c = new_code(codes)
        assert len(c) == 6 and set(c) <= set(CODE_ALPHABET)
        assert c not in codes
        codes.add(c)
    assert not set("01OIL") & set(CODE_ALPHABET)
    assert normalize_code(" k7p-4mx ") == "K7P4MX"


def test_legacy_entries_get_codes(tmp_path):
    path = tmp_path / "wl.json"
    path.write_text(json.dumps({"entries": [entry(1, code="").model_dump(), entry(2, code="").model_dump()]}))
    wl = WaitingList(path)
    codes = [e.code for e in wl.entries.values()]
    assert all(len(c) == 6 for c in codes) and len(set(codes)) == 2


def test_status_states_and_estimate():
    now = 3600.0
    es = [entry(1, esi=2, arrived_at=0), entry(2, esi=3, arrived_at=600), entry(3, esi=4, arrived_at=1200),
          entry(4, status="triaging", arrived_at=3500), entry(5, status="seen", arrived_at=0, seen_at=1800)]
    waiting = priority_view(es, now)["waiting"]
    first = patient_status(es[0], waiting, now, 10)
    assert first["state"] == "next" and first["position"] == 1 and first["ahead"] == 0
    assert first["estimate_min"] == [0, 5]
    third = patient_status(es[2], waiting, now, 10)
    assert third["state"] == "waiting" and third["ahead"] == 2
    assert third["estimate_min"] == [15, 25]  # 20 min ± 30 %, rounded to 5
    assert patient_status(es[3], waiting, now, 10)["state"] == "assessing"
    called = patient_status(es[4], waiting, now, 10)
    assert called["state"] == "called" and called["waited_min"] == 30.0
    assert not CLINICAL & set(third)


def test_throughput_minutes():
    now = 10_000.0
    few = [entry(i, status="seen", seen_at=now - 600 * i) for i in range(1, 3)]
    assert throughput_minutes(few, now, default=12) == 12
    many = [entry(i, status="seen", seen_at=now - 480 * i) for i in range(1, 6)]
    assert throughput_minutes(many, now) == 8.0
    fast = [entry(i, status="seen", seen_at=now - 30 * i) for i in range(1, 6)]
    assert throughput_minutes(fast, now) == 3.0  # clamped


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api_mod, "_AUTH", auth.AuthStore(tmp_path / "auth.db"))
    monkeypatch.setattr(api_mod, "waitlist_dir", lambda: tmp_path / "waitlists")
    stores = {h: WaitingList(tmp_path / "waitlists" / f"{h}.json") for h in ("riverbend", "northgate")}
    monkeypatch.setattr(api_mod, "_WAITLISTS", stores)
    monkeypatch.setattr(api_mod, "_LOOKUPS", {})
    monkeypatch.setattr(api_mod, "_MISSES", {})
    return TestClient(api_mod.app), stores


def test_public_status_without_session(client):
    c, stores = client
    e = asyncio.run(stores["northgate"].add("A 40-year-old with a laceration to the palm.", label="Bed 4"))
    r = c.get(f"/api/public/status/{e.code.lower()[:3]}-{e.code.lower()[3:]}")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["hospital"]["name"] == "Northgate Community Hospital"
    assert body["state"] == "assessing"
    assert not CLINICAL & set(body)
    assert "laceration" not in r.text and "Bed 4" not in r.text


def test_public_status_unknown_and_throttled(client):
    c, _ = client
    assert c.get("/api/public/status/ZZZZZZ").status_code == 404
    for _ in range(25):
        r = c.get("/api/public/status/ZZZZZZ")
    assert r.status_code == 429
