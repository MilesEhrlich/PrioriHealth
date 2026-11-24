"""Which free local inference engines are reachable right now."""

from __future__ import annotations

import os
from typing import Any

# Free engines, in order of preference: on-box llama.cpp (LinuxONE), local Ollama, then IBM Granite
# on Cloudflare Workers AI's free daily allowance.
FREE_ENGINES = ("llamacpp", "ollama", "cloudflare")


async def llamacpp_ready() -> bool:
    """llama.cpp llama-server answers /health (used on IBM LinuxONE)."""
    import httpx

    host = (os.getenv("LLAMACPP_HOST") or "http://127.0.0.1:8080").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=1.5) as c:
            return (await c.get(f"{host}/health")).status_code == 200
    except Exception:
        return False


async def ollama_ready(cfg: dict[str, Any]) -> bool:
    """Ollama is up and has the configured model pulled."""
    import httpx

    host = (os.getenv("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=1.5) as c:
            r = await c.get(f"{host}/api/tags")
            names = {m["name"] for m in r.json().get("models", [])}
            return cfg["llm"]["models"]["ollama"] in names
    except Exception:
        return False


def cloudflare_ready() -> bool:
    """Cloudflare Workers AI credentials are configured (no network call; the free tier is daily)."""
    return bool(os.getenv("CLOUDFLARE_ACCOUNT_ID") and os.getenv("CLOUDFLARE_API_TOKEN"))


async def engine_status(cfg: dict[str, Any]) -> dict[str, bool]:
    from .config import is_showcase

    if is_showcase():  # no local engines exist on a serverless host; skip the probes
        return {"llamacpp": False, "ollama": False, "cloudflare": cloudflare_ready()}
    return {"llamacpp": await llamacpp_ready(), "ollama": await ollama_ready(cfg),
            "cloudflare": cloudflare_ready()}


async def pick_free_engine(cfg: dict[str, Any]) -> str | None:
    """The configured provider if it is a free engine and online, else any free engine online."""
    status = await engine_status(cfg)
    preferred = cfg["llm"]["provider"]
    if preferred in FREE_ENGINES and status.get(preferred):
        return preferred
    return next((e for e in FREE_ENGINES if status.get(e)), None)
