"""Render slide-ready PNG charts (+ takeaways.json) for a result set.

    uv run python scripts/make_charts.py                          # every result set found
    uv run python scripts/make_charts.py results/watsonx/sample   # one set
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from triage_debate.charts import FIGURES, load_result_set, takeaways
from triage_debate.config import load_config, resolve


def render(path: Path) -> None:
    rs = load_result_set(path)
    out = path / "charts"
    out.mkdir(exist_ok=True)
    for name, build in FIGURES.items():
        fig = build(rs)
        if fig is None:
            continue
        fig.write_image(out / f"{name}.png", scale=2)
    notes = takeaways(rs)
    (out / "takeaways.json").write_text(json.dumps(notes, indent=2))
    print(f"{path}: {len(list(out.glob('*.png')))} charts")
    for k, v in notes.items():
        print(f"  {k}: {v}")


def main() -> None:
    cfg = load_config()
    targets = [Path(a) for a in sys.argv[1:]] or sorted(
        p.parent for p in resolve(cfg["results_dir"]).glob("*/*/summary.json"))
    if not targets:
        sys.exit("No result sets found. Run scripts/run_experiments.py first.")
    for t in targets:
        render(resolve(t))


if __name__ == "__main__":
    main()
