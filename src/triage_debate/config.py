"""Load config.yaml and .env into one settings object."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Read config.yaml (default: project root) and load .env into the environment."""
    load_dotenv(PROJECT_ROOT / ".env")
    cfg_path = Path(path) if path else PROJECT_ROOT / "config.yaml"
    with cfg_path.open() as f:
        cfg = yaml.safe_load(f)
    # Deployment override (e.g. PRIORIHEALTH_PROVIDER=llamacpp on IBM LinuxONE).
    if provider := os.getenv("PRIORIHEALTH_PROVIDER"):
        cfg["llm"]["provider"] = provider
    # Serverless hosts (Vercel) only allow writes under /tmp: keep the LLM cache there.
    if is_showcase():
        cfg["llm"]["cache_dir"] = str(writable_dir() / "llm-cache")
    return cfg


def is_showcase() -> bool:
    """The online demo (Vercel): demo account only, no waiting room, live triage on Cloudflare."""
    return os.getenv("PRIORIHEALTH_SHOWCASE") == "1" or bool(os.getenv("VERCEL"))


def writable_dir() -> Path:
    """Where the app may write logs and caches: /tmp on serverless hosts, the project otherwise."""
    return Path("/tmp/priorihealth") if is_showcase() else PROJECT_ROOT / "results"


def resolve(path: str | Path) -> Path:
    """Resolve a config-relative path against the project root."""
    p = Path(path)
    return p if p.is_absolute() else PROJECT_ROOT / p
