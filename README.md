# PrioriHealth

A ten-member panel of small AI agents with different reasoning styles discusses emergency department triage (ESI) decisions until at least 9 of 10 agree; when they can't, or when an urgent dissent is overruled, the case goes to a human nurse. Decision support prototype, not for clinical use.

**How it works**
- **Panel:** Empath, Logician, Skeptic, Observer, Synthesizer, Pragmatist, Vigilant, Impartial, Mediator, Reflective. Each is a reasoning *style*; none leans toward more or less urgent levels. All share one ESI v4 reference.
- **Discussion:** round 1 is independent; then each member reads everyone's position and argument, replies to specific members by name, and may revise (only for a named clinical reason). It stops at 90% agreement, or after 5 rounds.
- **Escalation:** no consensus, or any member at ESI 1–2 being outvoted to 3+, goes to a nurse.
- **Waiting Room:** live arrivals are triaged in the background and ordered by ESI-weighted wait. Each level has a target time to be seen (ESI 1 now, 2 ≤10 min, 3 ≤30, 4 ≤60, 5 ≤120), and whoever is furthest past target goes first.
- **Accounts:** a public landing page, sign up / sign in, and a one-click **Try the demo** account. Each user belongs to one of eight fictional hospitals, and each hospital has its own waiting room. Users and sessions live in SQLite (`data/priorihealth.db`, scrypt password hashes, HttpOnly session cookie); every `/api` route except sign-in and system status requires a session.

## Run the app

All hospitals in the demo are fictional.


```bash
uv sync                                  # Python 3.11 + dependencies
cd web && npm install && npm run build   # build the web interface once
cd .. && uv run python scripts/serve.py  # http://localhost:8000
```

The app reads cached results in `results/`, so it works offline. "Triage new case" runs live on a free local engine: llama.cpp (on LinuxONE) or Ollama (on a Mac/PC). watsonx is locked unless `llm.monthly_token_budget.watsonx` in `config.yaml` is raised.

## Run on IBM LinuxONE

The whole system (web app, Granite agents via llama.cpp, experiments) runs on an IBM LinuxONE (s390x) server. See [deploy/linuxone/DEPLOY.md](deploy/linuxone/DEPLOY.md):

```bash
bash deploy/linuxone/setup.sh && bash deploy/linuxone/install_services.sh
```

## Reproduce the experiments

```bash
uv run python scripts/download_data.py                        # TriageAgent benchmark (pinned commit)
uv run python scripts/run_experiments.py --provider ollama    # 20-patient sample; add --full for all 75
uv run --extra charts python scripts/make_charts.py           # slide PNGs (needs Chrome; Mac/PC only)
uv run pytest
```

Credentials (watsonx only) go in `.env`; see `.env.example`. Full write-up: in progress (see PLAN.md).
