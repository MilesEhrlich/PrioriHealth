"""One LLM interface with swappable backends, a disk cache, retries and call logging.

Usage:
    client = LLMClient.from_config(cfg)
    data = await client.complete(system, user, json_schema)

`complete` returns the parsed JSON dict. If the model's text is not valid JSON it raises
`LLMParseError` carrying the raw text, so the caller can decide whether to send a repair
prompt. Raw text (not the parsed dict) is what gets cached, so parsing changes never
require re-spending credits.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Protocol

from tenacity import (
    AsyncRetrying,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)

from .config import resolve


class TokenBudgetExceeded(RuntimeError):
    """An uncached call would push this month's token usage past the configured budget."""


class LLMParseError(ValueError):
    """The model returned text that is not a JSON object."""

    def __init__(self, message: str, raw_text: str):
        super().__init__(message)
        self.raw_text = raw_text


@dataclass
class RawCompletion:
    """What a backend returns for one request."""

    text: str
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class CallRecord:
    """One logged request (cache hits included)."""

    ts: float
    provider: str
    model: str
    key: str
    tag: str
    cached: bool
    input_tokens: int
    output_tokens: int
    latency_ms: float
    retries: int
    ok: bool
    error: str | None = None


# ---------------------------------------------------------------- pure helpers

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def extract_json(text: str) -> dict[str, Any]:
    """Parse the first JSON object in `text`, tolerating code fences and prose around it."""
    candidates = [text.strip()]
    candidates += [m.strip() for m in _FENCE.findall(text)]
    start = text.find("{")
    if start != -1:
        depth, in_str, esc = 0, False, False
        for i, ch in enumerate(text[start:], start):
            if in_str:
                esc = (ch == "\\") and not esc
                if ch == '"' and not esc:
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidates.append(text[start : i + 1])
                    break
    for c in candidates:
        try:
            obj = json.loads(c)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(obj, dict):
            return obj
    raise LLMParseError("No JSON object found in model output", text)


def cache_key(provider: str, model: str, system: str, user: str,
              json_schema: dict[str, Any] | None, temperature: float, sample_idx: int,
              variant: str = "") -> str:
    """Deterministic hash of everything that determines a response.

    `variant` names the backend's request format; bump it when that format changes so old
    responses are not reused. Empty variants are left out, keeping existing keys stable.
    """
    fields = {"provider": provider, "model": model, "system": system, "user": user,
              "schema": json_schema, "temperature": round(float(temperature), 4),
              "sample_idx": sample_idx}
    if variant:
        fields["variant"] = variant
    payload = json.dumps(fields, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def strip_unsupported_constraints(schema: dict[str, Any]) -> dict[str, Any]:
    """Drop numeric/length bounds that some structured-output engines reject.

    Bounds are still enforced afterwards by pydantic validation in the agent layer.
    """
    drop = {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
            "minItems", "maxItems", "minLength", "maxLength", "title", "description"}
    if isinstance(schema, dict):
        return {k: strip_unsupported_constraints(v) for k, v in schema.items() if k not in drop}
    if isinstance(schema, list):
        return [strip_unsupported_constraints(v) for v in schema]
    return schema


def is_retryable(exc: BaseException) -> bool:
    """Retry on rate limits, server errors, timeouts and connection problems only."""
    if isinstance(exc, TokenBudgetExceeded):
        return False
    # httpx timeouts/connection errors carry no status and often an empty message.
    if type(exc).__name__ in {"ReadTimeout", "WriteTimeout", "ConnectTimeout", "PoolTimeout",
                              "TimeoutException", "ConnectError", "RemoteProtocolError",
                              "ReadError", "APITimeoutError", "APIConnectionError"}:
        return True
    if isinstance(exc, (LLMParseError, ValueError, KeyError, TypeError)) and not isinstance(
        exc, (TimeoutError, ConnectionError)
    ):
        return False
    status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int):
        return status == 429 or status == 408 or status >= 500
    msg = str(exc).lower()
    return any(s in msg for s in ("429", "rate", "timeout", "timed out", "connection",
                                  "502", "503", "504", "temporarily", "overloaded"))


# ---------------------------------------------------------------- backends

class Backend(Protocol):
    provider: str
    model: str

    async def generate(self, system: str, user: str, json_schema: dict[str, Any] | None,
                       temperature: float, max_tokens: int) -> RawCompletion: ...


class OllamaBackend:
    """Local Ollama server via its HTTP chat API, with schema-constrained output."""

    provider = "ollama"

    def __init__(self, model: str, host: str | None = None, timeout_s: float = 120):
        import httpx

        self.model = model
        self.host = (host or os.getenv("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout_s)

    async def generate(self, system, user, json_schema, temperature, max_tokens):
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": False,
            "format": json_schema if json_schema else "json",
            "options": {"temperature": temperature, "num_predict": max_tokens, "seed": 0 if temperature == 0 else None},
        }
        body["options"] = {k: v for k, v in body["options"].items() if v is not None}
        r = await self._client.post(f"{self.host}/api/chat", json=body)
        r.raise_for_status()
        data = r.json()
        return RawCompletion(
            text=data["message"]["content"],
            input_tokens=int(data.get("prompt_eval_count", 0)),
            output_tokens=int(data.get("eval_count", 0)),
        )


class WatsonxBackend:
    """IBM watsonx.ai chat API with schema-enforced JSON output."""

    provider = "watsonx"
    cache_variant = "response_format-json_schema-v1"

    def __init__(self, model: str, timeout_s: float = 120):
        from ibm_watsonx_ai import Credentials
        from ibm_watsonx_ai.foundation_models import ModelInference

        api_key, url, project = (os.getenv("WATSONX_APIKEY"), os.getenv("WATSONX_URL"),
                                 os.getenv("WATSONX_PROJECT_ID"))
        missing = [n for n, v in [("WATSONX_APIKEY", api_key), ("WATSONX_URL", url),
                                  ("WATSONX_PROJECT_ID", project)] if not v]
        if missing:
            raise RuntimeError(f"watsonx credentials missing in .env: {', '.join(missing)}")
        self.model = model
        self._inference = ModelInference(
            model_id=model,
            credentials=Credentials(url=url, api_key=api_key),
            project_id=project,
            max_retries=0,  # retries are handled by LLMClient
        )

    async def generate(self, system, user, json_schema, temperature, max_tokens):
        params: dict[str, Any] = {"temperature": temperature, "max_tokens": max_tokens}
        if temperature == 0:
            params["seed"] = 0
        if json_schema:
            # `guided_json` is accepted but silently ignored by granite-4-h-small (checked
            # 2026-10-14); OpenAI-style json_schema response_format is enforced.
            params["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "triage_output", "strict": True,
                                "schema": strip_unsupported_constraints(json_schema)},
            }
        else:
            params["response_format"] = {"type": "json_object"}
        resp = await self._inference.achat(
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            params=params,
        )
        usage = resp.get("usage", {}) or {}
        return RawCompletion(
            text=resp["choices"][0]["message"]["content"] or "",
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
        )


class LlamaCppBackend:
    """llama.cpp `llama-server` via its OpenAI-compatible chat API (runs on IBM LinuxONE / s390x).

    JSON output is constrained with a json_schema `response_format`, which llama-server
    compiles to a grammar. Model weights must be big-endian GGUF on s390x.
    """

    provider = "llamacpp"

    def __init__(self, model: str, host: str | None = None, timeout_s: float = 300,
                 transport: Any = None):
        import platform

        import httpx

        self.model = model
        # The host CPU is part of the cache key: answers computed on a Mac must never be
        # replayed as if IBM LinuxONE (s390x) had produced them, and vice versa.
        self.cache_variant = f"chat-json_schema-v1-{platform.machine()}"
        self.host = (host or os.getenv("LLAMACPP_HOST") or "http://127.0.0.1:8080").rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout_s, transport=transport)

    async def generate(self, system, user, json_schema, temperature, max_tokens):
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if temperature == 0:
            body["seed"] = 0
        if json_schema:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "triage_output", "strict": True,
                                "schema": strip_unsupported_constraints(json_schema)},
            }
        else:
            body["response_format"] = {"type": "json_object"}
        r = await self._client.post(f"{self.host}/v1/chat/completions", json=body)
        r.raise_for_status()
        data = r.json()
        usage = data.get("usage") or {}
        return RawCompletion(
            text=data["choices"][0]["message"].get("content") or "",
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
        )


class AnthropicBackend:
    """Anthropic Messages API with structured output (fallback provider).

    Claude Haiku 5.5 rejects non-default temperature, so temperature is not sent; runs that
    need diverse samples (condition B) are therefore less meaningful on this backend.
    """

    provider = "anthropic"

    def __init__(self, model: str, timeout_s: float = 120):
        import anthropic

        self.model = model
        self._client = anthropic.AsyncAnthropic(timeout=timeout_s, max_retries=0)

    async def generate(self, system, user, json_schema, temperature, max_tokens):
        kwargs: dict[str, Any] = {"output_config": {"effort": "low"}}
        if json_schema:
            schema = strip_unsupported_constraints(json_schema)
            kwargs["output_config"]["format"] = {"type": "json_schema", "schema": schema}
        resp = await self._client.messages.create(
            model=self.model,
            max_tokens=max(max_tokens, 2048),  # leave room for adaptive thinking
            system=system,
            messages=[{"role": "user", "content": user}],
            **kwargs,
        )
        text = next((b.text for b in resp.content if b.type == "text"), "")
        return RawCompletion(text=text, input_tokens=resp.usage.input_tokens,
                             output_tokens=resp.usage.output_tokens)


def make_backend(provider: str, model: str, timeout_s: float) -> Backend:
    """Instantiate the backend named in config."""
    if provider == "ollama":
        return OllamaBackend(model, timeout_s=timeout_s)
    if provider == "llamacpp":
        return LlamaCppBackend(model, timeout_s=max(timeout_s, 300))
    if provider == "watsonx":
        return WatsonxBackend(model, timeout_s=timeout_s)
    if provider == "anthropic":
        return AnthropicBackend(model, timeout_s=timeout_s)
    raise ValueError(f"Unknown provider {provider!r}")


# ---------------------------------------------------------------- client


def _per_provider(value: Any, provider: str) -> Any:
    """Config values may be a scalar or a {provider: value, default: value} mapping."""
    if isinstance(value, dict):
        return value.get(provider, value.get("default"))
    return value

@dataclass
class UsageTotals:
    calls: int = 0
    cache_hits: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0
    errors: int = 0


@dataclass
class LLMClient:
    """Cached, rate-limited, retrying front door to one backend."""

    backend: Backend
    temperature: float = 0.0
    max_tokens: int = 400
    max_concurrency: int = 4
    max_retries: int = 5
    cache_dir: Path = field(default_factory=lambda: resolve(".cache/llm"))
    log_path: Path | None = None
    offline: bool = False  # True: never call the backend; cache misses raise
    token_budget: int | None = None  # monthly cap on uncached tokens for this provider
    requests_per_second: float | None = None  # provider rate limit (watsonx Lite: 2/s)
    usage_dir: Path | None = None
    totals: UsageTotals = field(default_factory=UsageTotals)

    def __post_init__(self) -> None:
        self.cache_dir = Path(self.cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.usage_dir = Path(self.usage_dir) if self.usage_dir else self.cache_dir.parent / "usage"
        self._sem: asyncio.Semaphore | None = None
        self._log_lock = threading.Lock()
        self._budget_lock = threading.Lock()
        self._reserved = 0
        self._rate_lock: asyncio.Lock | None = None
        self._next_slot = 0.0

    @classmethod
    def from_config(cls, cfg: dict[str, Any], provider: str | None = None,
                    log_path: Path | None = None, offline: bool = False) -> "LLMClient":
        """Build a client from config.yaml's `llm` section."""
        lc = cfg["llm"]
        provider = provider or lc["provider"]
        model = lc["models"][provider]
        backend = _OfflineBackend(provider, model) if offline else make_backend(
            provider, model, float(_per_provider(lc.get("timeout_s", 120), provider)))
        return cls(
            backend=backend,
            temperature=float(lc["temperature"]),
            max_tokens=int(lc["max_tokens"]),
            max_concurrency=int(_per_provider(lc["max_concurrency"], provider)),
            max_retries=int(lc["max_retries"]),
            cache_dir=resolve(lc["cache_dir"]),
            log_path=log_path,
            offline=offline,
            token_budget=(lc.get("monthly_token_budget") or {}).get(provider),
            requests_per_second=(lc.get("requests_per_second") or {}).get(provider),
        )

    @property
    def provider(self) -> str:
        return self.backend.provider

    @property
    def model(self) -> str:
        return self.backend.model

    def _semaphore(self) -> asyncio.Semaphore:
        if self._sem is None:
            self._sem = asyncio.Semaphore(self.max_concurrency)
        return self._sem

    # ---- monthly token ledger (persists across runs, so the budget spans the month)

    def _ledger_path(self) -> Path:
        return self.usage_dir / f"{self.provider}-{time.strftime('%Y-%m')}.json"

    def tokens_used_this_month(self) -> int:
        """Uncached tokens spent with this provider this calendar month (from the ledger)."""
        path = self._ledger_path()
        return int(json.loads(path.read_text())["tokens"]) if path.exists() else 0

    def _reserve(self, estimate: int) -> None:
        if self.token_budget is None:
            return
        with self._budget_lock:
            used = self.tokens_used_this_month()
            if used + self._reserved + estimate > self.token_budget:
                raise TokenBudgetExceeded(
                    f"{self.provider}: {used:,} tokens used this month + {self._reserved + estimate:,} "
                    f"pending would exceed the budget of {self.token_budget:,} "
                    "(llm.monthly_token_budget in config.yaml). Finished calls are cached; "
                    "rerun later or raise the budget."
                )
            self._reserved += estimate

    def _settle(self, estimate: int, actual: int) -> None:
        if self.token_budget is None and actual == 0:
            return
        with self._budget_lock:
            if self.token_budget is not None:
                self._reserved -= estimate
            if actual:
                path = self._ledger_path()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps({"tokens": self.tokens_used_this_month() + actual}))

    async def _pace(self) -> None:
        """Space request starts so we never exceed `requests_per_second`."""
        if not self.requests_per_second:
            return
        if self._rate_lock is None:
            self._rate_lock = asyncio.Lock()
        async with self._rate_lock:
            now = time.monotonic()
            wait = self._next_slot - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._next_slot = max(now, self._next_slot) + 1.0 / self.requests_per_second

    def _cache_path(self, key: str) -> Path:
        return self.cache_dir / key[:2] / f"{key}.json"

    def _log(self, rec: CallRecord) -> None:
        t = self.totals
        t.calls += 1
        t.cache_hits += rec.cached
        t.input_tokens += rec.input_tokens
        t.output_tokens += rec.output_tokens
        t.latency_ms += rec.latency_ms
        t.errors += not rec.ok
        if self.log_path:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self._log_lock, self.log_path.open("a") as f:
                f.write(json.dumps(asdict(rec)) + "\n")

    async def complete_raw(self, system: str, user: str, json_schema: dict[str, Any] | None = None,
                           *, temperature: float | None = None, sample_idx: int = 0,
                           tag: str = "") -> tuple[str, dict[str, Any]]:
        """Return (raw_text, meta). meta has tokens, latency_ms, cached, key."""
        temp = self.temperature if temperature is None else float(temperature)
        key = cache_key(self.provider, self.model, system, user, json_schema, temp, sample_idx,
                        getattr(self.backend, "cache_variant", ""))
        path = self._cache_path(key)
        if path.exists():
            entry = json.loads(path.read_text())
            meta = {"key": key, "cached": True, "input_tokens": entry["input_tokens"],
                    "output_tokens": entry["output_tokens"], "latency_ms": entry["latency_ms"]}
            self._log(CallRecord(time.time(), self.provider, self.model, key, tag, True,
                                 entry["input_tokens"], entry["output_tokens"], 0.0, 0, True))
            return entry["text"], meta
        if self.offline:
            raise LookupError(f"Cache miss in offline mode ({tag or key[:12]})")

        # Conservative estimate: ~3 chars per input token plus the full output allowance.
        estimate = (len(system) + len(user)) // 3 + self.max_tokens
        self._reserve(estimate)
        attempts = 0
        start = time.perf_counter()
        try:
            async with self._semaphore():
                start = time.perf_counter()  # latency excludes time spent queued for a slot
                async for attempt in AsyncRetrying(
                    stop=stop_after_attempt(self.max_retries),
                    wait=wait_exponential_jitter(initial=1, max=30),
                    retry=retry_if_exception(is_retryable),
                    reraise=True,
                ):
                    with attempt:
                        attempts += 1
                        await self._pace()
                        raw = await self.backend.generate(system, user, json_schema, temp, self.max_tokens)
        except Exception as exc:
            self._settle(estimate, 0)
            latency = (time.perf_counter() - start) * 1000
            self._log(CallRecord(time.time(), self.provider, self.model, key, tag, False,
                                 0, 0, latency, attempts - 1, False, f"{type(exc).__name__}: {exc}"[:500]))
            raise
        self._settle(estimate, raw.input_tokens + raw.output_tokens)
        latency = (time.perf_counter() - start) * 1000
        entry = {"provider": self.provider, "model": self.model, "temperature": temp,
                 "sample_idx": sample_idx, "system": system, "user": user, "text": raw.text,
                 "input_tokens": raw.input_tokens, "output_tokens": raw.output_tokens,
                 "latency_ms": round(latency, 1), "created": time.time()}
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(entry, ensure_ascii=False, indent=1))
        tmp.replace(path)
        self._log(CallRecord(time.time(), self.provider, self.model, key, tag, False,
                             raw.input_tokens, raw.output_tokens, round(latency, 1), attempts - 1, True))
        meta = {"key": key, "cached": False, "input_tokens": raw.input_tokens,
                "output_tokens": raw.output_tokens, "latency_ms": round(latency, 1)}
        return raw.text, meta

    async def complete(self, system: str, user: str, json_schema: dict[str, Any] | None = None,
                       *, temperature: float | None = None, sample_idx: int = 0,
                       tag: str = "") -> dict[str, Any]:
        """Return the model's JSON output as a dict (raises LLMParseError if not JSON)."""
        text, _ = await self.complete_raw(system, user, json_schema, temperature=temperature,
                                          sample_idx=sample_idx, tag=tag)
        return extract_json(text)

    def complete_sync(self, system: str, user: str, json_schema: dict[str, Any] | None = None,
                      **kwargs: Any) -> dict[str, Any]:
        """Blocking convenience wrapper around `complete`."""
        return asyncio.run(self.complete(system, user, json_schema, **kwargs))


class _OfflineBackend:
    """Placeholder backend for cache-only runs (the Streamlit demo)."""

    def __init__(self, provider: str, model: str):
        self.provider, self.model = provider, model

    async def generate(self, *args: Any, **kwargs: Any) -> RawCompletion:
        raise LookupError("offline")

