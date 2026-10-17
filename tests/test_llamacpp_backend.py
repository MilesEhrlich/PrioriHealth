"""llama.cpp backend against a mocked llama-server (no model, no network)."""

import json

import httpx
import pytest

from triage_debate.llm import LlamaCppBackend, LLMClient
from triage_debate.prompts import AGENT_SCHEMA

REPLY = {"esi": 2, "confidence": 0.8, "key_findings": ["chest pain"], "rationale": "High risk."}


def make_transport(seen: list, fail_first: int = 0):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] <= fail_first:
            return httpx.Response(503, json={"error": "loading model"})
        seen.append(json.loads(request.content))
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(200, json={
            "choices": [{"message": {"role": "assistant", "content": json.dumps(REPLY)}}],
            "usage": {"prompt_tokens": 600, "completion_tokens": 80},
        })

    return httpx.MockTransport(handler)


async def test_request_shape_and_token_parsing():
    seen: list = []
    be = LlamaCppBackend("granite-test", host="http://llama:8080", transport=make_transport(seen))
    raw = await be.generate("sys", "user", AGENT_SCHEMA, 0.0, 400)
    body = seen[0]
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    assert body["temperature"] == 0.0 and body["max_tokens"] == 400 and body["seed"] == 0
    rf = body["response_format"]
    assert rf["type"] == "json_schema"
    schema = rf["json_schema"]["schema"]
    assert schema["required"] == AGENT_SCHEMA["required"]
    assert "maximum" not in schema["properties"]["esi"]  # bounds stripped, validated later
    assert json.loads(raw.text) == REPLY
    assert (raw.input_tokens, raw.output_tokens) == (600, 80)


async def test_sampling_temperature_has_no_fixed_seed():
    seen: list = []
    be = LlamaCppBackend("granite-test", host="http://llama:8080", transport=make_transport(seen))
    await be.generate("s", "u", AGENT_SCHEMA, 0.7, 400)
    assert "seed" not in seen[0] and seen[0]["temperature"] == 0.7


async def test_client_retries_503_then_caches(tmp_path, monkeypatch):
    import asyncio

    async def no_sleep(*_a, **_k):
        return None

    monkeypatch.setattr(asyncio, "sleep", no_sleep)
    seen: list = []
    be = LlamaCppBackend("granite-test", host="http://llama:8080", transport=make_transport(seen, fail_first=2))
    c = LLMClient(backend=be, cache_dir=tmp_path, max_retries=5)
    assert await c.complete("s", "u", AGENT_SCHEMA) == REPLY
    assert await c.complete("s", "u", AGENT_SCHEMA) == REPLY  # cache hit
    assert len(seen) == 1 and c.totals.cache_hits == 1


def test_env_provider_override(monkeypatch):
    from triage_debate.config import load_config

    monkeypatch.setenv("PRIORIHEALTH_PROVIDER", "llamacpp")
    assert load_config()["llm"]["provider"] == "llamacpp"


@pytest.mark.parametrize("provider", ["llamacpp"])
def test_make_backend_registers(provider):
    from triage_debate.llm import make_backend

    assert make_backend(provider, "m", 10).provider == provider


def test_cache_variant_includes_host_cpu():
    import platform

    be = LlamaCppBackend("m", host="http://x")
    assert be.cache_variant.endswith(platform.machine())
