import json

import pytest

from triage_debate.llm import (
    LLMClient,
    LLMParseError,
    TokenBudgetExceeded,
    RawCompletion,
    cache_key,
    extract_json,
    is_retryable,
    strip_unsupported_constraints,
)


def test_extract_json_plain_fenced_and_prose():
    assert extract_json('{"esi": 2}') == {"esi": 2}
    assert extract_json('```json\n{"esi": 3}\n```') == {"esi": 3}
    assert extract_json('Sure! Here it is: {"esi": 4, "r": "a {b} c"} hope that helps') == {
        "esi": 4, "r": "a {b} c"}
    with pytest.raises(LLMParseError) as e:
        extract_json("ESI 2 because chest pain")
    assert "chest pain" in e.value.raw_text
    with pytest.raises(LLMParseError):
        extract_json("[1, 2]")


def test_cache_key_sensitivity():
    base = dict(provider="ollama", model="m", system="s", user="u",
                json_schema={"type": "object"}, temperature=0.0, sample_idx=0)
    k = cache_key(**base)
    assert k == cache_key(**base)
    for field, val in [("provider", "watsonx"), ("model", "m2"), ("system", "s2"),
                       ("user", "u2"), ("temperature", 0.7), ("sample_idx", 1)]:
        assert cache_key(**{**base, field: val}) != k
    assert cache_key(**base, variant="") == k  # empty variant keeps old keys valid
    assert cache_key(**base, variant="v2") != k


def test_strip_constraints():
    s = {"type": "object", "properties": {"esi": {"type": "integer", "minimum": 1, "maximum": 5},
                                          "kf": {"type": "array", "maxItems": 3}}}
    out = strip_unsupported_constraints(s)
    assert out["properties"]["esi"] == {"type": "integer"}
    assert out["properties"]["kf"] == {"type": "array"}


class _Status(Exception):
    def __init__(self, code):
        super().__init__(f"HTTP {code}")
        self.status_code = code


def test_is_retryable():
    assert is_retryable(_Status(429))
    assert is_retryable(_Status(503))
    assert not is_retryable(_Status(400))
    assert not is_retryable(_Status(401))
    assert is_retryable(TimeoutError("timed out"))
    assert not is_retryable(LLMParseError("bad", "x"))


class FakeBackend:
    provider = "fake"
    model = "fake-1"

    def __init__(self, fail_times=0, text='{"esi": 2}'):
        self.calls = 0
        self.fail_times = fail_times
        self.text = text

    async def generate(self, system, user, json_schema, temperature, max_tokens):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise _Status(429)
        return RawCompletion(self.text, input_tokens=10, output_tokens=5)


async def test_client_caches_and_logs(tmp_path):
    be = FakeBackend()
    log = tmp_path / "calls.jsonl"
    c = LLMClient(backend=be, cache_dir=tmp_path / "cache", log_path=log)
    assert await c.complete("s", "u", {"type": "object"}) == {"esi": 2}
    assert await c.complete("s", "u", {"type": "object"}) == {"esi": 2}
    assert be.calls == 1
    await c.complete("s", "u", {"type": "object"}, sample_idx=1)
    assert be.calls == 2
    recs = [json.loads(l) for l in log.read_text().splitlines()]
    assert [r["cached"] for r in recs] == [False, True, False]
    assert c.totals.cache_hits == 1 and c.totals.input_tokens == 30


async def test_client_retries_then_succeeds(tmp_path, monkeypatch):
    import tenacity
    monkeypatch.setattr(tenacity.nap, "sleep", lambda s: None)
    be = FakeBackend(fail_times=2)
    c = LLMClient(backend=be, cache_dir=tmp_path, max_retries=5)
    c_wait = await c.complete_raw("s", "u")
    assert be.calls == 3 and c_wait[0] == '{"esi": 2}'


async def test_offline_cache_miss_raises(tmp_path):
    c = LLMClient(backend=FakeBackend(), cache_dir=tmp_path, offline=True)
    with pytest.raises(LookupError):
        await c.complete("s", "u")


async def test_budget_guard_blocks_uncached_calls_and_persists(tmp_path):
    # Each call: estimate = len("s"+"uN")//3 + max_tokens = 11; actual = 15 tokens.
    be = FakeBackend()
    make = lambda: LLMClient(backend=be, cache_dir=tmp_path / "cache", max_tokens=10, token_budget=60)
    c = make()
    for u in ("u1", "u2", "u3", "u4"):
        await c.complete("s", u)
    assert c.tokens_used_this_month() == 60
    await c.complete("s", "u1")  # cache hit: allowed even at the cap
    with pytest.raises(TokenBudgetExceeded):
        await c.complete("s", "u5")
    assert be.calls == 4
    # The ledger persists, so the next run is blocked too.
    with pytest.raises(TokenBudgetExceeded):
        await make().complete("s", "u6")


async def test_rate_limit_spaces_requests(tmp_path):
    import time as _t
    c = LLMClient(backend=FakeBackend(), cache_dir=tmp_path, requests_per_second=20)
    t0 = _t.monotonic()
    import asyncio as _a
    await _a.gather(*(c.complete("s", f"u{i}") for i in range(5)))
    assert _t.monotonic() - t0 >= 4 / 20 - 0.01  # 5 starts need at least 4 gaps of 50 ms


def test_httpx_timeouts_are_retryable():
    import httpx

    assert is_retryable(httpx.ReadTimeout(""))
    assert is_retryable(httpx.ConnectError(""))


def test_per_provider_settings():
    from triage_debate.llm import _per_provider

    assert _per_provider({"default": 4, "ollama": 1}, "ollama") == 1
    assert _per_provider({"default": 4, "ollama": 1}, "watsonx") == 4
    assert _per_provider(3, "anything") == 3
