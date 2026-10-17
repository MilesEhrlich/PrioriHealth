"""Serve the PrioriHealth web app (API + built frontend) on http://localhost:8000.

    uv run python scripts/serve.py            # demo (reads cached results; offline)
    uv run python scripts/serve.py --reload   # backend development
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import uvicorn


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.getenv("PRIORIHEALTH_PORT", "8000")))
    ap.add_argument("--host", default=os.getenv("PRIORIHEALTH_HOST", "127.0.0.1"),
                    help="0.0.0.0 to accept connections from other machines (LinuxONE deployment)")
    ap.add_argument("--reload", action="store_true")
    a = ap.parse_args()
    print(f"PrioriHealth on http://{a.host}:{a.port}  (Decision support prototype. Not for clinical use.)")
    uvicorn.run("triage_debate.api:app", host=a.host, port=a.port, reload=a.reload,
                reload_dirs=[str(ROOT / "src")] if a.reload else None, log_level="warning")


if __name__ == "__main__":
    main()
