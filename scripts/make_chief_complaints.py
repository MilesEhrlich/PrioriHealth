"""Write short, chart-style chief complaints for display (queue table, patient list).

Runs on LOCAL Granite via Ollama only (free) and is cached. The output is display text;
it is never shown to the triage agents. Writes data/chief_complaints.json.

    uv run python scripts/make_chief_complaints.py
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from triage_debate.config import load_config, resolve
from triage_debate.data import example_cases, load_dataset
from triage_debate.llm import LLMClient

SYSTEM = (
    "You are an emergency department triage nurse writing the chief complaint field of a chart. "
    "Write it the way it appears on a tracking board: 2 to 6 words, sentence case, no age, no sex, "
    "no names, no diagnosis guesses, no trailing period. Examples: 'Chest pain, diaphoresis', "
    "'Fall from bicycle, head injury', 'Rash in groin', 'Prescription refill'. Reply with JSON only."
)
SCHEMA = {
    "type": "object",
    "properties": {"chief_complaint": {"type": "string"}},
    "required": ["chief_complaint"],
    "additionalProperties": False,
}


def tidy(s: str, limit: int = 48) -> str:
    """Board-style text: at most three comma-separated parts, cut on a clean boundary."""
    s = re.sub(r"\s+", " ", s).strip().strip(".\"'“”")
    demographic = re.compile(r"\b(\d+[- ]?(year|month|week|day)|old|teen\w*|girl|boy|male|female|man|woman|infant|toddler)\b", re.I)
    parts = [x.strip() for x in s.split(",") if x.strip() and not demographic.search(x)] or [s]
    out = ""
    for part in parts[:3]:
        cand = f"{out}, {part}" if out else part
        if len(cand) > limit:
            break
        out = cand
    if not out:  # first part alone is too long: cut on a word boundary
        out = parts[0][:limit].rsplit(" ", 1)[0]
    return out[:1].upper() + out[1:]


async def main() -> None:
    cfg = load_config()
    test, train, _ = load_dataset(cfg)
    client = LLMClient.from_config(cfg, provider="ollama")  # never a paid provider
    # Test cases (evaluation pages) + training cases (examples and simulated waiting-room arrivals).
    patients = test + (train if "--all-train" in sys.argv else example_cases(train))
    out_path = resolve("data/chief_complaints.json")
    existing: dict[str, str] = {}  # always rebuilt from the (cached) model answers

    async def one(p):
        data = await client.complete(SYSTEM, f"Triage note:\n{p.vignette}", SCHEMA, tag=f"{p.id}:cc")
        return p.id, tidy(str(data.get("chief_complaint", "")))

    results = await asyncio.gather(*(one(p) for p in patients if p.id not in existing))
    existing.update({pid: cc for pid, cc in results if cc})
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(dict(sorted(existing.items())), indent=1, ensure_ascii=False))
    print(f"{len(existing)} chief complaints -> {out_path} ({client.totals})")


if __name__ == "__main__":
    asyncio.run(main())
