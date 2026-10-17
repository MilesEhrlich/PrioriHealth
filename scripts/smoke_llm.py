"""Check that a provider is reachable: one structured call (cached) plus, for watsonx,
confirm the configured model ID is actually served in your region.

    uv run python scripts/smoke_llm.py --provider ollama
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from triage_debate.config import load_config
from triage_debate.llm import LLMClient

SCHEMA = {
    "type": "object",
    "properties": {"esi": {"type": "integer"}, "reason": {"type": "string"}},
    "required": ["esi", "reason"],
    "additionalProperties": False,
}


def check_watsonx_model(model_id: str) -> None:
    """Fail loudly if the configured Granite model is not offered in this region."""
    from ibm_watsonx_ai import APIClient, Credentials

    missing = [k for k in ("WATSONX_APIKEY", "WATSONX_URL", "WATSONX_PROJECT_ID") if not os.getenv(k)]
    if missing:
        sys.exit(f"Missing in .env: {', '.join(missing)} (copy .env.example to .env and fill it in)")
    client = APIClient(Credentials(url=os.environ["WATSONX_URL"], api_key=os.environ["WATSONX_APIKEY"]),
                       project_id=os.environ["WATSONX_PROJECT_ID"])
    try:
        specs = client.foundation_models.get_model_specs().get("resources", [])
    except Exception as exc:
        if "no_associated_service_instance" in str(exc):
            sys.exit(
                "Credentials OK, but the watsonx project has no watsonx.ai Runtime attached.\n"
                "Fix: dataplatform.cloud.ibm.com -> your project -> Manage -> Services & integrations\n"
                "     -> Associate service -> pick a watsonx.ai Runtime in the SAME region as\n"
                f"     WATSONX_URL ({os.environ['WATSONX_URL']}). Also check WATSONX_PROJECT_ID matches\n"
                "     the project you associated (Manage -> General -> Project ID)."
            )
        raise
    granite = sorted(s["model_id"] for s in specs if "granite" in s["model_id"])
    print("Granite models in this region:", ", ".join(granite))
    if model_id not in {s["model_id"] for s in specs}:
        sys.exit(f"Configured model {model_id!r} is not available here. Update config.yaml llm.models.watsonx.")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default=None)
    args = ap.parse_args()
    cfg = load_config()
    provider = args.provider or cfg["llm"]["provider"]
    if provider == "watsonx":
        check_watsonx_model(cfg["llm"]["models"]["watsonx"])
    client = LLMClient.from_config(cfg, provider=provider)
    out = await client.complete(
        "You are an emergency triage nurse. Reply with JSON only.",
        "Assign an ESI level (1-5) to: 45-year-old with crushing chest pain and diaphoresis, HR 118.",
        SCHEMA, tag="smoke",
    )
    print(json.dumps(out, indent=1))
    print(f"{client.provider}:{client.model}", client.totals)


if __name__ == "__main__":
    asyncio.run(main())
