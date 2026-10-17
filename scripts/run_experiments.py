"""Run experiment conditions A-D, fairness and queue simulation; write results/.

    uv run python scripts/run_experiments.py                     # 20-patient sample, config provider
    uv run python scripts/run_experiments.py --full              # every test patient
    uv run python scripts/run_experiments.py --provider ollama   # local Granite

Outputs go to results/<provider>/<sample|full>/ so runs on different models never mix.
Every LLM response is cached, so re-running is free.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import platform
import random
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd

from triage_debate.config import load_config, resolve
from triage_debate.data import few_shot_examples, load_dataset, select_patients
from triage_debate.evaluate import (
    condition_metrics,
    coverage_table,
    debates_to_frame,
    derive_round1_only,
    paired_tests,
    run_condition_a,
    run_debates,
)
from triage_debate.fairness import flip_summary, run_fairness, select_cases
from triage_debate.llm import LLMClient, TokenBudgetExceeded
from triage_debate.queue_sim import simulate

CONDITION_NAMES = {
    "A": "Single agent",
    "B": "Neutral panel, discussion to consensus",
    "C": "Trait panel, discussion to consensus",
    "D": "Trait panel, independent votes only",
}


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--full", action="store_true", help="run every test patient (default: seeded sample)")
    ap.add_argument("--conditions", default="A,B,C,D", help="comma-separated subset of A,B,C,D")
    ap.add_argument("--provider", default=None, help="override llm.provider from config.yaml")
    ap.add_argument("--limit", type=int, default=None, help="cap the number of patients (debugging)")
    ap.add_argument("--no-fairness", action="store_true", help="skip the sex-swap check")
    ap.add_argument("--results-dir", default=None, help="write here instead of config results_dir (e.g. for test runs)")
    return ap.parse_args()


def save_debates(debates, out_dir: Path, cond: str) -> None:
    """Write one JSON transcript per patient for the Case Debate page."""
    d = out_dir / "debates" / cond
    d.mkdir(parents=True, exist_ok=True)
    for res in debates:
        (d / f"{res.patient_id}.json").write_text(res.model_dump_json(indent=1))


def jsonable(v: Any) -> Any:
    """Make metric values JSON-safe (tuples -> lists, NaN -> None)."""
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def fmt(v: object) -> str:
    if isinstance(v, float):
        return f"{v:.3f}"
    if isinstance(v, tuple):
        return "[" + ", ".join(f"{x:.2f}" for x in v) + "]"
    return str(v)


def git_hash() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:
        return "uncommitted"


async def main() -> None:
    args = parse_args()
    cfg = load_config()
    test, train, report = load_dataset(cfg)
    patients = select_patients(test, cfg, full=args.full)
    if args.limit:
        patients = patients[: args.limit]
    shots = few_shot_examples(train, int(cfg["debate"]["few_shot_k"]), int(cfg["seed"]))
    by_id = {p.id: p for p in patients}

    run_id = time.strftime("%Y%m%d-%H%M%S")
    provider = args.provider or cfg["llm"]["provider"]
    results_root = resolve(args.results_dir or cfg["results_dir"])
    out_dir = results_root / provider / ("full" if args.full else "sample")
    out_dir.mkdir(parents=True, exist_ok=True)
    run_dir = results_root / "runs" / run_id
    client = LLMClient.from_config(cfg, provider=provider, log_path=run_dir / "calls.jsonl")
    print(f"{len(patients)} patients | {client.provider}:{client.model} | run {run_id} -> {out_dir}")
    if client.token_budget:
        print(f"Token budget: {client.tokens_used_this_month():,} of {client.token_budget:,} used this month")

    conds = [c.strip().upper() for c in args.conditions.split(",") if c.strip()]
    frames: dict[str, pd.DataFrame] = {}
    metrics: dict[str, dict] = {}
    c_debates = None
    for cond in ["A", "B", "C", "D"]:
        if cond not in conds:
            continue
        t0 = time.perf_counter()
        if cond == "A":
            df = await run_condition_a(client, patients, shots)
        elif cond in ("B", "C"):
            debates = await run_debates(client, patients, cfg, condition=cond, few_shot=shots)
            if cond == "C":
                c_debates = debates
            save_debates(debates, out_dir, cond)
            df = debates_to_frame(debates, patients)
        else:  # D reuses C's round 1 (cached, so free if C already ran)
            if c_debates is None:
                c_debates = await run_debates(client, patients, cfg, condition="C", few_shot=shots)
            df = debates_to_frame(derive_round1_only(c_debates, cfg), patients)
        wall = time.perf_counter() - t0
        df.to_csv(out_dir / f"predictions_{cond}.csv", index=False)
        frames[cond] = df
        m = condition_metrics(df)
        m["wall_s_per_patient"] = wall / max(len(df), 1)
        metrics[cond] = m
        print(f"\nCondition {cond}: {CONDITION_NAMES[cond]}  ({wall:.0f}s)")
        for k in ["exact_acc", "within1_acc", "under_triage", "critical_miss",
                  "critical_miss_unreviewed", "escalation_rate", "acc_non_escalated",
                  "auroc_uncertainty", "calls_per_patient", "tokens_per_patient"]:
            print(f"  {k:26s} {fmt(m[k])}")

    # Comparison table, coverage curves, paired tests
    table = pd.DataFrame([{"condition": c, "name": CONDITION_NAMES[c],
                           **{k: v for k, v in m.items() if not isinstance(v, tuple)}}
                          for c, m in metrics.items()])
    table.to_csv(out_dir / "metrics.csv", index=False)
    pd.concat([coverage_table(df, c) for c, df in frames.items()]).to_csv(
        out_dir / "coverage_curve.csv", index=False)
    tests = paired_tests(frames, [("A", "C"), ("B", "C"), ("D", "C"), ("A", "B")])

    # Fairness: sex swap, single agent vs persona debate
    fairness: dict[str, Any] = {}
    if not args.no_fairness and {"A", "C"} <= set(conds):
        pool = patients if not args.full else test
        cases = select_cases(pool, int(cfg["fairness"]["n_cases"]), int(cfg["seed"]))

        async def run_a(ps):
            return await run_condition_a(client, ps, shots)

        async def run_c(ps):
            return debates_to_frame(await run_debates(client, ps, cfg, condition="C", few_shot=shots), ps)

        fa, fc = await asyncio.gather(run_fairness(run_a, cases), run_fairness(run_c, cases))
        fa.insert(0, "condition", "A")
        fc.insert(0, "condition", "C")
        pd.concat([fa, fc]).to_csv(out_dir / "fairness.csv", index=False)
        fairness = {"A": flip_summary(fa), "C": flip_summary(fc)}
        print(f"\nFairness (sex swap, {len(cases)} cases): "
              f"A flips {fairness['A']['flips']}, C flips {fairness['C']['flips']}")

    # Queue simulation on the persona-debate decisions
    if "C" in frames:
        qn = min(int(cfg["queue"]["n_patients"]), len(patients))
        order = sorted(patients, key=lambda p: p.id)
        random.Random(int(cfg["seed"]) + 3).shuffle(order)
        rows = frames["C"].set_index("patient_id")
        decisions = [{"patient_id": p.id,
                      "esi": None if pd.isna(rows.loc[p.id, "pred"]) else int(rows.loc[p.id, "pred"]),
                      "escalated": bool(rows.loc[p.id, "escalated"]),
                      "escalation_reasons": [r for r in str(rows.loc[p.id, "escalation_reasons"]).split(",")
                                             if r and r != "nan"],
                      "chief_complaint": by_id[p.id].chief_complaint} for p in order[:qn]]
        steps = simulate(decisions, float(cfg["queue"]["mean_interarrival_min"]), int(cfg["seed"]))
        with (out_dir / "queue_steps.jsonl").open("w") as f:
            for s in steps:
                f.write(s.model_dump_json() + "\n")

    # Patient table for the app (ground truth included; the app hides it behind a toggle)
    pd.DataFrame([{"patient_id": p.id, "esi_true": p.esi_true, "vignette": p.vignette,
                   "age_years": p.age_years, "sex": p.sex, "chief_complaint": p.chief_complaint,
                   **{f"vital_{k}": v for k, v in p.vitals.model_dump().items()}}
                  for p in patients]).to_csv(out_dir / "patients.csv", index=False)

    summary = {
        "run_id": run_id, "git": git_hash(), "provider": client.provider, "model": client.model,
        "platform": {"machine": platform.machine(), "system": platform.system(), "node": platform.node()},
        "n_patients": len(patients), "full": args.full, "seed": cfg["seed"],
        "protocol": cfg["debate"].get("protocol", "v2-trait-consensus"),
        "panel": cfg["debate"].get("panel"), "max_rounds": cfg["debate"].get("max_rounds"),
        "escalation": cfg["escalation"], "temperature": cfg["llm"]["temperature"],
        "temperature_sampling_B": cfg["llm"]["temperature_sampling"],
        "dataset": {k: v for k, v in report.to_dict().items() if k not in
                    {"dropped_bad_label", "dropped_conflicting_label"}},
        "conditions": metrics, "paired_tests": tests, "fairness": fairness,
        "llm_totals": client.totals.__dict__,
    }
    (out_dir / "summary.json").write_text(json.dumps(jsonable(summary), indent=2, default=str))
    print(f"\nPaired tests: { {k: round(v['p_value'], 3) for k, v in tests.items()} }")
    print(f"LLM totals: {client.totals}")
    if client.token_budget:
        print(f"Token budget: {client.tokens_used_this_month():,} of {client.token_budget:,} used this month")
    print(f"Wrote {out_dir}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except TokenBudgetExceeded as exc:
        sys.exit(f"\nStopped: {exc}")
