"""Accounts, sessions and per-hospital waiting rooms (no LLM calls)."""

import pytest
from fastapi.testclient import TestClient

from triage_debate import api as api_mod
from triage_debate import auth
from triage_debate.waitlist import WaitingList

SIGNUP = {"name": "Alex Rivera", "email": "Alex@Example.org", "password": "correct horse",
          "hospital_id": "northgate", "role": "Triage Nurse"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api_mod, "_AUTH", auth.AuthStore(tmp_path / "auth.db"))
    monkeypatch.setattr(api_mod, "_WAITLISTS", {
        h: WaitingList(tmp_path / f"{h}.json") for h in ("riverbend", "northgate")})
    return TestClient(api_mod.app)


def test_password_hash_roundtrip():
    h = auth.hash_password("s3cret-pass")
    assert h.startswith("scrypt$") and "s3cret-pass" not in h
    assert auth.verify_password("s3cret-pass", h)
    assert not auth.verify_password("wrong", h)
    assert not auth.verify_password("x", "garbage")


def test_hospitals_are_listed_and_public(client):
    r = client.get("/api/auth/hospitals").json()
    assert len(r["hospitals"]) >= 6 and "Triage Nurse" in r["roles"]


def test_protected_routes_need_a_session(client):
    assert client.get("/api/waitlist").status_code == 401
    assert client.get("/api/sets").status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/system").status_code == 200  # public status


def test_signup_me_signout(client):
    r = client.post("/api/auth/signup", json=SIGNUP)
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    me = client.get("/api/auth/me").json()["user"]
    assert me["email"] == "alex@example.org" and me["hospital"]["id"] == "northgate"
    assert "password" not in str(me)
    client.post("/api/auth/signout")
    assert client.get("/api/auth/me").status_code == 401


def test_signup_validation_and_duplicates(client):
    assert client.post("/api/auth/signup", json={**SIGNUP, "password": "short"}).status_code == 422
    assert client.post("/api/auth/signup", json={**SIGNUP, "hospital_id": "real-hospital"}).status_code == 422
    assert client.post("/api/auth/signup", json={**SIGNUP, "email": "nope"}).status_code == 422
    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 200
    assert client.post("/api/auth/signup", json=SIGNUP).status_code == 409


def test_signin_wrong_password_and_throttle(client):
    client.post("/api/auth/signup", json=SIGNUP)
    client.post("/api/auth/signout")
    bad = client.post("/api/auth/signin", json={"email": SIGNUP["email"], "password": "wrong-pass"})
    assert bad.status_code == 401 and bad.json()["detail"] == "Invalid email or password."
    unknown = client.post("/api/auth/signin", json={"email": "who@x.org", "password": "whatever1"})
    assert unknown.json()["detail"] == bad.json()["detail"]  # no account enumeration
    ok = client.post("/api/auth/signin", json={"email": "alex@example.org", "password": SIGNUP["password"]})
    assert ok.status_code == 200
    for _ in range(auth.MAX_FAILURES):
        client.post("/api/auth/signin", json={"email": SIGNUP["email"], "password": "wrong-pass"})
    locked = client.post("/api/auth/signin", json={"email": SIGNUP["email"], "password": SIGNUP["password"]})
    assert locked.status_code == 429


def test_demo_account(client):
    u = client.post("/api/auth/demo").json()["user"]
    assert u["demo"] and u["hospital"]["id"] == auth.DEMO_HOSPITAL
    # the demo account cannot be signed into with a password
    r = client.post("/api/auth/signin", json={"email": auth.DEMO_EMAIL, "password": "disabled"})
    assert r.status_code == 401


def test_secure_cookie_behind_https_proxy(client):
    r = client.post("/api/auth/demo", headers={"x-forwarded-proto": "https"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_waiting_rooms_are_separate_per_hospital(client):
    client.post("/api/auth/demo")  # Riverbend
    client.post("/api/waitlist", json={"vignette": "A 40-year-old with a laceration to the palm."})
    assert len(client.get("/api/waitlist").json()["waiting"]) == 1
    client.post("/api/auth/signout")

    client.post("/api/auth/signup", json=SIGNUP)  # Northgate
    assert client.get("/api/waitlist").json()["waiting"] == []
