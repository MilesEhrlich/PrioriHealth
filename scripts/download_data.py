"""Download the TriageAgent benchmark at the pinned commit into data/raw/."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from triage_debate.config import load_config, resolve
from triage_debate.data import load_dataset


def main() -> None:
    cfg = load_config()
    dest = resolve(cfg["data"]["raw_dir"])
    commit = cfg["data"]["repo_commit"]
    if not (dest / ".git").exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", cfg["data"]["repo_url"], str(dest)], check=True)
    subprocess.run(["git", "-C", str(dest), "checkout", "--quiet", commit], check=True)
    print(f"TriageAgent data at {dest} (commit {commit[:7]})")

    test, train, report = load_dataset(cfg)
    print(json.dumps(report.to_dict(), indent=2, default=str))
    if not test:
        sys.exit("No test patients loaded.")


if __name__ == "__main__":
    main()
