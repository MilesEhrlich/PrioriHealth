# TriageDebate — PLAN

> A team of small AI agents with different priorities debates emergency department triage (ESI) decisions; when they disagree, the case goes to a human nurse. Decision support only.

Status: **approved 2026-10-14.** Decisions:
- Data: repo `datasets/` only. The Google Drive folder needs a Google sign-in, and the repo's other files are just figures.
- Split: the paper's own split. Test = de-duplicated union of Test-1/2/3, with near-duplicates (difflib ratio ≥ 0.9) merged. The result is **75 test cases** (ESI 1–5 = 14/22/12/12/15). Train = Train_scenario minus anything matching a test case: **164 cases**.
- Condition B: option (c), three neutral agents running the same two-round protocol.
- LLM cache is committed. Tooling: uv + Python 3.11; Ollama with `granite3.3:8b` for development.

---

## 1. Research claims → what proves each

| Claim | Evidence we produce |
|---|---|
| 1. Persona debate beats a single agent and persona-free agents at the same call budget | Condition C vs A and vs B: exact and within-1 accuracy, critical-miss rate, with 95% bootstrap CIs and a paired McNemar test (C vs A, C vs B) |
| 2. Disagreement predicts error, so escalating only high-disagreement cases cuts review load while keeping safety high | AUROC of disagreement score for "aggregate is wrong"; coverage vs accuracy curve; critical misses among *non-escalated* cases |
| 3. It works with small, cheap models | All headline numbers on IBM Granite (~8B), plus cost per patient (calls, tokens, seconds) |

Positioning: TriageAgent (Lu et al., EMNLP Findings 2024) showed multi-agent discussion improves ESI accuracy using GPT-class models and RAG over the ESI handbook. We add (a) disagreement-based human escalation, (b) small open models, (c) queue-level prioritization, and (d) a compute-matched persona-free baseline.

---

## 2. Data — what I found

**Source:** official repo `github.com/Lucanyc/TriageAgent`, commit `5577df8` (2024-10-16). The files under `datasets/` are what the paper released. The README also points to a Google Drive folder; I have not pulled that (see open question Q1).

| File | Format | Rows | Columns | Notes |
|---|---|---|---|---|
| `Test-1` | TSV, no extension | 72 | vignette, ESI | one label is `"4 or 5"` |
| `Test-2` | TSV | 72 | vignette, ESI | |
| `Test-3` | TSV | 72 | vignette, ESI | |
| `Train_scenario` | TSV | 174 | category, vignette, handbook explanation, ESI | category mostly blank; label skew: ESI 2 = 79, 3 = 41, 1/4/5 = 18 each |

What the schema actually contains, and how I'll handle it:

- **The three test sets overlap heavily** (Test-1∩Test-2 = 67 vignettes, Test-2∩Test-3 = 69). After normalizing whitespace/punctuation, there are **79 exact-unique test vignettes**. After also merging near-duplicates and dropping one case with conflicting labels across files, there are **75** (see status above).
- **9 test vignettes also appear in `Train_scenario`.** I'll drop those from train so few-shot examples can never leak a test case.
- **Parsing is messy:** vignettes open with curly quotes that break the default CSV quoting, and 5–6 rows have the label glued to the end of the vignette (`"... no vomiting. 2"`). Loader uses `quoting=QUOTE_NONE` and a regex rescue for trailing `\s[1-5]$`. Rows with ambiguous labels (`"4 or 5"`) are dropped and counted in a load report.
- **No structured fields.** Vitals, age and sex live in free text. The loader extracts them with regex (`BP 118/72`, `HR 76`, `RR 14`, `SpO2 93%`, `T 98.6°F`, `14-year-old`, `8-month-old`, `male/female/boy/girl/man/woman`). The `Patient` fields are `None` when absent. About 40% of vignettes have vitals and about half state sex.
- **No race anywhere** (0 test vignettes mention it). The `race` field stays `None`, and the fairness check is sex-swap only.
- **Test label distribution** (unique, approximate): ESI 1 ≈ 12, 2 ≈ 20, 3 ≈ 11, 4 ≈ 11, 5 ≈ 15, so about 32 ESI 1–2 cases for the critical-miss metric.
- The data is **text-only, from the ESI v4 handbook, and partly synthetic** (some cases are LLM-style rewrites). This goes in the limitations section.

**Proposed split (needs your OK, see Q2):** test = 79 deduped test vignettes; train = `Train_scenario` minus overlaps (~165). This is the paper's own split, so our numbers stay comparable. The fixed seed (`seed: 42`) controls the 20-patient default sample, few-shot selection, queue arrival times, and the fairness subset.

**Data acquisition:** `scripts/download_data.py` clones the repo at the pinned commit into `data/raw/` (gitignored, so we don't redistribute their data).

`Patient` schema (pydantic):
```python
class Vitals(BaseModel):
    hr: int | None; rr: int | None; sbp: int | None; dbp: int | None
    spo2: int | None; temp_f: float | None

class Patient(BaseModel):
    id: str                 # stable hash of normalized vignette, e.g. "t-3f9a1c"
    vignette: str
    vitals: Vitals
    age_years: float | None # months converted to years
    sex: Literal["M","F"] | None
    race: str | None        # always None for this dataset
    esi_true: int           # 1–5; never serialized into any prompt
    split: Literal["train","test"]
    chief_complaint: str    # short heuristic (first clause), used in the queue UI only
```
Ground-truth guard: prompts are built from `PatientView` (vignette only). `esi_true` is not reachable from the prompt builders, and a test asserts that no rendered prompt contains the label or the handbook explanation text.

---

## 3. Architecture

```
data.py ──> Patient ──> agents.py (prompt + parse) ──> llm.py (LLMClient: cache → backend)
                              │
                         debate.py (rounds, early stop, aggregation, disagreement, escalation)
                              │
        ┌─────────────────────┼──────────────────────┐
   queue_sim.py         evaluate.py (A–D, metrics)   fairness.py (sex swap A vs C)
        │                     │                      │
        └──────────> results/*.csv, summary.json, runs/*.jsonl <──────┘
                              │
                 scripts/make_charts.py → results/charts/*.png
                 app/streamlit_app.py (reads results/ only; optional live case)
```

### LLM provider layer (`llm.py`)
- `LLMClient.complete(system, user, json_schema, *, sample_idx=0) -> dict` (async under the hood, with a sync wrapper)
- Backends behind one protocol, selected by `config.yaml: llm.provider`:
  - **watsonx (default):** `ibm-watsonx-ai` `ModelInference.achat`, JSON mode / `response_format` where supported. Model ID candidates: `ibm/granite-3-3-8b-instruct` (stable 8B instruct) or `ibm/granite-4-h-small` (newer, 32B MoE, still cheap). **At build time I'll confirm against the live `get_foundation_model_specs()` for your region instead of trusting docs**, and fail loudly if the configured ID isn't served there.
  - **ollama:** `granite3.3:8b` (or `granite4` tag if present), using `format=<json schema>`.
  - **anthropic:** `claude-haiku-5-5`, tool-use for structured output.
- Cache: `.cache/llm/<sha256>.json`, keyed by `sha256(provider, model, system, user, schema, temperature, sample_idx)`. `sample_idx` lets condition B draw distinct samples at temperature > 0 while still caching deterministically.
- Retries: `tenacity`, exponential backoff with jitter, 5 attempts, retry on 429/5xx/timeouts only.
- Concurrency: `asyncio.Semaphore(config.llm.max_concurrency)` (default 4; watsonx free tier is rate-limited).
- Logging: every request appends a line to `results/runs/<run_id>/calls.jsonl` with provider, model, prompt hash, cache hit, input/output tokens, latency in ms, retry count, and error.
- JSON repair: if parsing or pydantic validation fails, send **one** repair call ("Your previous output was invalid: <error>. Return only the JSON."). If that fails too, record `AgentFailure`; aggregation then uses the remaining agents. If all fail, the case escalates.

### Debate engine (`debate.py`) — pure functions, easy to test
1. Round 1: 3 agents in parallel, independent.
2. Early stop if all three ESI values are equal.
3. Round 2: each agent sees the other two's round-1 JSON (its own too) and returns the same schema plus `"change_reason"` (one sentence).
4. Aggregation: **confidence-weighted median**. Sort ESI values, accumulate weights = confidence (floor 0.05 so a 0.0 never zeroes an agent), and pick the first value where cumulative weight ≥ 50% of the total. If it lands exactly on 50%, take the lower (more urgent) ESI.
5. Disagreement: `range = max − min` over final-round ESIs; secondary `mean_conf`. Continuous score for AUROC: `range + (1 − mean_conf)`, with range as the primary term and confidence as a tie-breaker. I'll also report AUROC for range alone.
6. Escalation: `range ≥ threshold` (default 1) **OR** (any agent ESI ∈ {1,2} AND aggregate ≥ 3) **OR** any agent failure. The safety override is checked first and cannot be disabled by the threshold. `escalation_reasons: list[str]` is stored for the UI.

### Queue (`queue_sim.py`)
- N patients (default 20) get Poisson arrival times (seeded, mean gap configurable).
- Process them in arrival order. After each one, re-rank by `(escalated pinned first, aggregate ESI, arrival time)`.
- Emit a snapshot per step (`queue_steps.jsonl`) so the UI can replay how the queue reorders.
- Wait time = simulated clock − arrival.

---

## 4. Agents and prompt drafts (`prompts.py`)

All agents use the same model and temperature. Only the system prompt differs. Personas are **roles, not demographic identities**.

### Shared ESI reference (paraphrased; inserted in every system prompt)
```
ESI REFERENCE (Emergency Severity Index v4, 5 levels; 1 = most urgent)
A. Does the patient need an immediate life-saving intervention
   (airway, emergency meds, defibrillation, intubation; unresponsive, apneic, pulseless,
   severe respiratory distress, SpO2 < 90, acute mental status change with unresponsiveness)?  -> ESI 1
B. Is this a high-risk situation, OR new confusion/lethargy/disorientation,
   OR severe pain/distress (>= 7/10)? Should they not wait?                                       -> ESI 2
C. How many different resources will the ED need? (labs, ECG, imaging, IV fluids, IV/IM/neb meds,
   specialty consult, simple procedure = 1, complex procedure = 2. NOT resources: history & exam,
   POC tests, saline lock, PO meds, tetanus shot, prescription refill, simple wound care, crutches/splints.)
   None -> ESI 5   One -> ESI 4   Two or more -> go to D
D. Danger-zone vitals? (adult: HR > 100, RR > 20, SpO2 < 92%; pediatric thresholds by age;
   fever > 38.0C in infants < 3 months). If yes, consider ESI 2; otherwise ESI 3.
```
(I'll write the pediatric thresholds in properly from the handbook, in our own wording.)

### Output contract (appended to every system prompt)
```
Return ONLY a JSON object, no prose, matching:
{"esi": <integer 1-5>, "confidence": <number 0.0-1.0>,
 "key_findings": [<up to 3 short strings>], "rationale": "<60 words max>"}
Base your decision only on the clinical information in the vignette.
```

### Persona system prompts
- **Neutral (Condition A and B)**
  `You are an experienced emergency department triage nurse. Assign an ESI level using the reference below.`
- **Cautious Clinician**
  `You are the Cautious Clinician on a triage panel. Your priority is patient safety. Actively search for red flags: abnormal or borderline vital signs, chest pain, shortness of breath, altered mental status, high-risk mechanisms of injury, extremes of age, immunocompromise, suicidality. When the evidence is genuinely uncertain between two levels, choose the more urgent one; a missed sick patient is worse than an over-triaged well one. Still follow the ESI algorithm; do not escalate without a concrete clinical reason.`
- **Resource Manager**
  `You are the Resource Manager on a triage panel. Your priority is applying the ESI algorithm exactly. Walk decision points A through D in order. For stable patients, count the distinct ED resources explicitly and list them. Push back on over-triage: a patient who is stable and does not meet decision point A or B criteria should not be ESI 1 or 2, because unnecessary high-acuity assignments delay care for sicker patients. Never under-triage a patient who meets A or B criteria.`
- **Equity Auditor**
  `You are the Equity Auditor on a triage panel. Your priority is that the decision rests only on clinical features: vitals, symptoms, mechanism, history, and resource needs. Ignore sex, race, ethnicity, insurance, housing status, demeanor, language, or who accompanies the patient, except where clinically relevant (e.g., pregnancy, age-specific vital thresholds). In round 2, explicitly check whether other agents' reasoning leans on non-clinical cues and say so in your rationale if it does.`

### User prompt, round 1
```
PATIENT VIGNETTE
<vignette>

[Optional, config few_shot_k (default 0 for the main experiment, 3 as an ablation):
 worked examples from TRAIN only: vignette + ESI + one-line reason]

Assign the ESI level.
```

### User prompt, round 2
```
PATIENT VIGNETTE
<vignette>

YOUR ROUND 1 ANSWER
<json>

OTHER PANEL MEMBERS' ROUND 1 ANSWERS
[Cautious Clinician] <json>
[Resource Manager]   <json>

Reconsider. You may change your ESI or hold it. Do not change just to agree; change only if
another member identified a clinical finding or algorithm step you missed.
Return the same JSON plus "change_reason": "<one sentence: why you changed or held>".
```
Agents are named by role in round 2 so the Auditor can critique specific reasoning. The order of others' answers is fixed per agent.

---

## 5. Experiments (`evaluate.py`, `scripts/run_experiments.py`)

Same test patients for every condition. Default 20-patient seeded sample (stratified by ESI so all 5 levels appear); `--full` runs all 79.

| Cond. | Description | Calls/patient |
|---|---|---|
| A | Single neutral agent, temperature from config | 1 |
| B | Neutral prompt × k samples (temp > 0, distinct `sample_idx`), majority vote with ties → more urgent | k = **budget-matched to C** (see Q3) |
| C | Persona debate, rounds 1+2 with early stop | 3–6 |
| D | Persona debate, round 1 only (aggregate the round-1 answers) | 3 (free: reuses C's cached round 1) |

Disagreement and escalation are computed for B too (vote range), so we can show whether *personas* specifically make disagreement more informative. That is the cleanest support for claim 2.

### Metrics (all in `metrics.py`, pure functions, unit-tested)
- `exact_acc`, `within1_acc`
- `under_triage_rate` = P(pred > true); also `over_triage_rate`
- **`critical_miss_rate`** = among true ESI ∈ {1,2}, P(pred ≥ 3) (headline number)
- `escalation_rate`, `acc_non_escalated`, `acc_escalated`, `critical_miss_non_escalated` (misses that slip past the nurse)
- `auroc_disagreement`: disagreement score vs `pred != true` (sklearn `roc_auc_score`; NaN-safe when a sample has one class)
- Coverage vs accuracy: sweep the threshold over {0,1,2,3,4,∞} plus continuous-score quantiles; coverage = fraction auto-decided, accuracy on that fraction. Safety override always on.
- Cost: mean calls, input/output tokens, wall seconds per patient (from `calls.jsonl`, cached and uncached reported separately)
- Uncertainty: 1,000× bootstrap 95% CIs on every rate; paired McNemar (exact) for C vs A and C vs B on correctness. With n = 79 we won't overclaim; the README says so.

### Fairness (`fairness.py`)
- 50 seeded test cases (at full; all applicable ones in sample mode) where sex is stated.
- Swap the patient's sex terms with regex rules: male↔female, man↔woman, boy↔girl, he↔she, him↔her, his↔her(s), Mr↔Ms, son↔daughter. Only patient references are swapped; companions like "mother" stay. **Exclude** sex-specific clinical content (pregnancy, testicular, ovarian, menstrual, etc.), since a swap there would change the medicine, not the bias.
- Flip rate = P(aggregate ESI changes) for A vs C, with a CI. Also "flip to more urgent" vs "less urgent" counts.
- A test checks the swapper on tricky strings ("his mother", "her boyfriend").

### Outputs
- `results/predictions_<cond>.csv` (one row per patient: per-agent R1/R2 ESIs, confidences, aggregate, range, mean conf, escalated, reasons, correct, tokens, latency)
- `results/metrics.csv`, `results/coverage_curve.csv`, `results/fairness.csv`, `results/queue_steps.jsonl`
- `results/debates/<patient_id>.json`: full transcripts for the Case Debate page
- `results/summary.json`: headline numbers, config snapshot, model ID, git hash, run timestamp, n
- `results/charts/*.png` (via plotly + kaleido, 1600×900, slide-ready)

---

## 6. Streamlit app
As specified. Three pages, IBM Plex via Google Fonts CSS, palette and ESI chips exactly as given, footer "Decision support prototype. Not for clinical use." It reads only from `results/`. The "Run one case live" toggle is the only path that touches the LLM, and it's disabled with a note if no credentials are configured. Charts reuse one `plotly` template defined in `app/theme.py` (a shared module so `make_charts.py` and the app match).

---

## 7. File list
```
triage-debate/
  README.md  PLAN.md  config.yaml  .env.example  .gitignore  pyproject.toml  uv.lock
  src/triage_debate/
    __init__.py
    schemas.py      # Patient, Vitals, AgentOutput, Round2Output, DebateResult (pydantic)
    data.py         # load/parse/dedupe/split/extract, sample selection
    llm.py          # LLMClient, backends, cache, retry, logging
    prompts.py      # ESI reference, persona prompts, prompt builders
    agents.py       # run one agent: build prompt → call → parse → repair → result
    debate.py       # rounds, early stop, aggregate, disagreement, escalation
    metrics.py      # pure metric functions (kept separate so tests import nothing heavy)
    evaluate.py     # condition runners A–D + metric tables
    queue_sim.py
    fairness.py
    config.py       # load config.yaml + .env into a typed Settings object
    theme.py        # plotly template + ESI colors (shared by charts and app)
  scripts/
    download_data.py
    run_experiments.py   # --full, --conditions A,B,C,D, --provider, --limit
    make_charts.py
  app/
    streamlit_app.py  style.css  (pages as functions inside one file, or app/pages/*)
  results/            # committed: small CSVs + PNGs so the app works on clone
  data/raw/           # gitignored
  .cache/llm/         # gitignored (optionally commit for a fully reproducible demo; see Q6)
  tests/
    test_data_parsing.py  test_vitals_extract.py  test_json_parse_repair.py
    test_aggregation.py   test_escalation.py      test_metrics.py
    test_fairness_swap.py test_no_label_leak.py   test_cache_key.py
```
Small additions beyond your spec: `schemas.py`, `metrics.py`, `config.py`, `theme.py`, `download_data.py`. Each keeps the pure, testable code apart from the I/O code.

## 8. config.yaml (sketch)
```yaml
seed: 42
data: {raw_dir: data/raw, repo_commit: 5577df8, sample_size: 20}
llm:
  provider: watsonx          # watsonx | ollama | anthropic
  models: {watsonx: ibm/granite-3-3-8b-instruct, ollama: granite3.3:8b, anthropic: claude-haiku-5-5}
  temperature: 0.0
  temperature_sampling: 0.7  # condition B only
  max_tokens: 400
  max_concurrency: 4
  max_retries: 5
  cache_dir: .cache/llm
debate: {few_shot_k: 0, early_stop: true}
escalation: {range_threshold: 1, safety_override: true}
queue: {n_patients: 20, mean_interarrival_min: 4}
fairness: {n_cases: 50}
```
`.env.example`: `WATSONX_APIKEY`, `WATSONX_URL`, `WATSONX_PROJECT_ID`, `ANTHROPIC_API_KEY`, `OLLAMA_HOST`.

---

## 9. Build order (checkpoint with you after each)
1. Data loader + tests → show load report (counts, dropped rows, extracted-field coverage)
2. LLM layer + cache/retry tests → one smoke call per available backend
3. Single agent (A) on 20 patients
4. Debate engine (C, D) + B
5. Evaluation, fairness, queue, charts
6. Streamlit app + README

---

## 10. Risks I want you to know about
- **Small n.** 79 test cases and about 32 critical cases mean a 1–2 case difference moves critical-miss rate by 3–6 points. We'll report CIs and frame results honestly. On the 20-patient default sample, the numbers are a smoke test, not results.
- **Temperature 0 + identical prompts = B collapses.** Three neutral agents at temp 0 give the same answer three times, so B *must* sample at temp > 0. That makes B's single-run numbers noisier, which is why the cache key includes `sample_idx`.
- **Escalation threshold 1 may escalate a lot** (any disagreement). The coverage curve shows the trade-off; we may want threshold 2 as the operating point in the demo.
- **Granite JSON reliability:** 8B models sometimes wrap JSON in prose. We'll use JSON mode where the API offers it, then repair, and report the failure rate.
- **Data quality:** some vignettes appear LLM-generated, and the ESI 2 skew in train means few-shot examples could bias toward 2. Main runs are zero-shot; few-shot is an ablation.
- **Environment:** this machine has no `uv` and only Python 3.13. I'll `brew install uv` and let uv fetch 3.11 (needs your OK, Q7).

---

## 11. Open questions (please answer before I write code)
- **Q1. Google Drive data.** The repo README links a Google Drive folder. Is it fine to use only the repo `datasets/` files (79 unique test, ~165 train), or do you want me to check the Drive for a larger or cleaner release first?
- **Q2. Split.** Use the paper's split (deduped Test-1/2/3 as test, Train_scenario as train), or pool everything and do a seeded random split? I recommend the paper's split for comparability.
- **Q3. Condition B's budget.** C costs 3 calls when agents agree and 6 when they don't. Options: (a) B = 6 samples always (matches C's *max*), (b) B = round(C's mean calls/patient) after C runs, or (c) B = 3 samples + a second "revise after seeing the others" round with neutral prompts (matches the *protocol*, so personas are the only difference). I recommend **(c)**: it isolates the persona effect most cleanly. Matched budget then holds by construction, and we report calls anyway.
- **Q4. watsonx.** Do you have credentials yet (API key, project ID, region URL)? Which region? Preference between Granite 3.3 8B Instruct (smaller, matches "small and cheap") and Granite 4 H Small? I'll verify availability with the SDK either way.
- **Q5. Ollama for development.** Want me to install Ollama and pull `granite3.3:8b` (~5 GB) so we can develop at zero cost?
- **Q6. Commit the LLM cache?** Committing `.cache/llm` (probably a few MB) makes `run_experiments.py` fully reproducible offline for judges. OK?
- **Q7. Tooling and location.** OK to `brew install uv`? And is `~/Documents/CS-Projects/PrioriHealth/triage-debate/` the right home (git-initialized there)?
