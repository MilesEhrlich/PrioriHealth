"""Live, readable view of an experiment run: one line per AI call as it happens.

    .venv/bin/python scripts/watch_run.py            # follow the newest run
    .venv/bin/python scripts/watch_run.py --from-start

Reads the run's calls.jsonl and the LLM cache (to show each answer's ESI). Read-only.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from triage_debate.config import load_config, resolve  # noqa: E402
from triage_debate.data import load_dataset  # noqa: E402

G, Y, R, D, B, X = "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"


def newest_calls(runs: Path) -> Path:
    files = sorted(runs.glob("2*/calls.jsonl"), key=lambda p: p.stat().st_mtime)
    if not files:
        sys.exit(f"No run logs found in {runs}")
    return files[-1]


def answer_esi(cache_dir: Path, key: str) -> int | None:
    f = cache_dir / key[:2] / f"{key}.json"
    try:
        text = json.loads(f.read_text())["text"]
        start, end = text.find("{"), text.rfind("}")
        return int(json.loads(text[start : end + 1])["esi"])
    except Exception:
        return None


def label(persona: str, sample: int) -> str:
    if persona == "neutral":
        return "A  single nurse" if sample == 0 else f"B  self-consistency #{sample + 1}"
    return f"C  panel: {persona.capitalize()}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-start", action="store_true", help="replay the whole run, then follow")
    args = ap.parse_args()

    cfg = load_config()
    test, _, _ = load_dataset(cfg)
    patients = {p.id: p for p in test}
    cache_dir = resolve(cfg["llm"].get("cache_dir", ".cache/llm"))
    path = newest_calls(resolve(cfg.get("results_dir", "results")) / "runs")

    lines = path.read_text().splitlines()
    seen_patients: list[str] = []
    for line in lines:
        pid = json.loads(line).get("tag", "").split(":")[0]
        if pid and pid not in seen_patients:
            seen_patients.append(pid)
    print(f"{B}PrioriHealth experiment on {cfg['llm'].get('provider', '?')} · {path.parent.name}{X}")
    print(f"{D}{len(lines)} calls so far across {len(seen_patients)} patients. Ctrl-C to stop watching (the run keeps going).{X}\n")

    with path.open() as fh:
        if not args.from_start:
            fh.seek(0, 2)
        last_pid = None
        while True:
            line = fh.readline()
            if not line:
                time.sleep(2)
                continue
            try:
                c = json.loads(line)
            except json.JSONDecodeError:
                continue
            pid, persona, rnd, smp = (c.get("tag", "") + ":::").split(":")[:4]
            p = patients.get(pid)
            if pid != last_pid:
                if pid not in seen_patients:
                    seen_patients.append(pid)
                cc = (p.chief_complaint or p.vignette[:70]) if p else ""
                truth = f"answer key ESI {p.esi_true}" if p else ""
                print(f"\n{B}Patient {pid.removeprefix('p-').upper()}{X}  {cc}  {D}{truth}{X}")
                last_pid = pid
            esi = answer_esi(cache_dir, c["key"]) if c.get("ok") else None
            mark = ""
            if esi is not None and p:
                mark = f"{G}✓{X}" if esi == p.esi_true else (f"{R}under{X}" if esi > p.esi_true else f"{Y}over{X}")
            result = f"ESI {esi}" if esi is not None else f"{R}failed: {c.get('error')}{X}"
            stamp = time.strftime("%H:%M:%S", time.localtime(c.get("ts", time.time())))
            sample = int(smp.lstrip("s") or 0)
            print(f"  {D}{stamp}{X}  {label(persona, sample):<32} round {rnd.lstrip('r') or '?'}  "
                  f"{result:<8} {mark:<14} {D}{c.get('latency_ms', 0) / 1000:.0f}s{X}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
