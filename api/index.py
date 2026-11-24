"""Vercel entry point: the FastAPI app as one Python function.

vercel.json rewrites /api/* here; the built React app (web/dist) is served as static files.
On Vercel the app runs in showcase mode (see triage_debate.config.is_showcase).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from triage_debate.api import app  # noqa: E402

__all__ = ["app"]
