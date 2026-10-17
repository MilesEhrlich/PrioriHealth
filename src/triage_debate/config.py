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
    return cfg


def resolve(path: str | Path) -> Path:
    """Resolve a config-relative path against the project root."""
    p = Path(path)
    return p if p.is_absolute() else PROJECT_ROOT / p
