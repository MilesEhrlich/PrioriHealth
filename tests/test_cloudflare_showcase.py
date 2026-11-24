"""Cloudflare Workers AI backend and the online demo's showcase mode (no network calls)."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from triage_debate import api as api_mod
from triage_debate.llm import CloudflareBackend, TokenBudgetExceeded

SCHEMA = {"type": "object", "properties": {"esi": {"type": "integer", "minimum": 1}}, "required": ["esi"]}


@pytest.fixture()
def cf_env(monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acct123")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok")


def _ok(text='{"esi": 2}'):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}],
                                     "usage": {"prompt_tokens": 11, "completion_tokens": 5}})


async def test_cloudflare_sends_openai_style_request(cf_env):
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return _ok()

    b = CloudflareBackend("@cf/ibm-granite/granite-4.0-h-micro", transport=httpx.MockTransport(handler))
    out = await b.generate("sys", "user", SCHEMA, 0.0, 300)
    assert out.text == '{"esi": 2}' and out.input_tokens == 11 and out.output_tokens == 5
    req = seen[0]
    assert str(req.url) == "https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1/chat/completions"
    assert req.headers["authorization"] == "Bearer tok"
    body = json.loads(req.content)
    assert body["model"] == "@cf/ibm-granite/granite-4.0-h-micro"
    assert body["response_format"]["type"] == "json_schema"


async def test_cloudflare_falls_back_when_json_schema_is_rejected(cf_env):
    formats = []

    def handler(req: httpx.Request) -> httpx.Response:
        fmt = json.loads(req.content).get("response_format", {}).get("type")
        formats.append(fmt)
        return httpx.Response(400, json={"errors": ["bad format"]}) if fmt == "json_schema" else _ok()

    b = CloudflareBackend("m", transport=httpx.MockTransport(handler))
    await b.generate("s", "u", SCHEMA, 0.0, 100)
    await b.generate("s", "u", SCHEMA, 0.0, 100)  # remembers: skips json_schema next time
    assert formats == ["json_schema", "json_object", "json_object"]


async def test_cloudflare_daily_allowance_is_not_retried(cf_env):
    b = CloudflareBackend("m", transport=httpx.MockTransport(
        lambda r: httpx.Response(429, text="you have used up your daily free allocation of 10,000 neurons")))
    with pytest.raises(TokenBudgetExceeded):
        await b.generate("s", "u", SCHEMA, 0.0, 100)


def test_cloudflare_requires_credentials(monkeypatch):
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)
    with pytest.raises(RuntimeError):
        CloudflareBackend("m")


# ---------------------------------------------------------------- showcase mode


@pytest.fixture()
def showcase(monkeypatch, cf_env):
    monkeypatch.setattr(api_mod, "SHOWCASE", True)
    monkeypatch.setattr(api_mod, "_LIVE_RUNS", {})
    monkeypatch.setattr(api_mod, "LIVE_PER_IP_DAY", 2)

    def no_db():
        raise AssertionError("showcase mode must not touch the SQLite account store")

    monkeypatch.setattr(api_mod, "auth_store", no_db)
    return TestClient(api_mod.app)


def test_showcase_demo_session_is_stateless(showcase):
    assert showcase.get("/api/auth/me").status_code == 401
    r = showcase.post("/api/auth/demo")
    assert r.status_code == 200 and r.json()["user"]["demo"] is True
    me = showcase.get("/api/auth/me").json()["user"]
    assert me["hospital"]["id"] == "riverbend"
    assert showcase.get("/api/sets").status_code == 200


def test_showcase_rejects_forged_session(showcase):
    showcase.cookies.set("ph_session", "demo.9999999999.deadbeef")
    assert showcase.get("/api/sets").status_code == 401


def test_showcase_turns_off_accounts_and_waiting_room(showcase):
    body = {"name": "A", "email": "a@b.co", "password": "longenough", "hospital_id": "riverbend",
            "role": "Triage Nurse"}
    assert showcase.post("/api/auth/signup", json=body).status_code == 403
    assert showcase.post("/api/auth/signin", json={"email": "a@b.co", "password": "x"}).status_code == 403
    showcase.post("/api/auth/demo")
    r = showcase.get("/api/waitlist")
    assert r.status_code == 503 and "waiting room" in r.json()["detail"]
    assert showcase.get("/api/public/status/ABC123").status_code == 404


def test_showcase_live_status_offers_only_cloudflare(showcase):
    showcase.post("/api/auth/demo")
    providers = showcase.get("/api/live/status").json()["providers"]
    assert [p["id"] for p in providers] == ["cloudflare"] and providers[0]["available"]


def test_showcase_examples_fall_back_to_fictional_cases(showcase, monkeypatch):
    def missing(cfg):
        raise FileNotFoundError("data/raw not deployed")

    monkeypatch.setattr(api_mod, "load_dataset", missing)
    showcase.post("/api/auth/demo")
    ex = showcase.get("/api/examples?n=3").json()
    assert len(ex) == 3 and all(e["id"].startswith("demo-") for e in ex)


def test_showcase_live_is_rate_limited_per_ip(showcase, monkeypatch):
    async def fake_debate(*args, **kwargs):
        return None

    monkeypatch.setattr(api_mod, "run_debate", fake_debate)
    showcase.post("/api/auth/demo")
    case = {"vignette": "45-year-old with mild abdominal pain for one day, vitals normal.", "provider": "ollama"}
    assert showcase.post("/api/live", json=case).status_code == 200
    assert showcase.post("/api/live", json=case).status_code == 200
    r = showcase.post("/api/live", json=case)
    assert r.status_code == 429 and "live cases today" in r.json()["detail"]
