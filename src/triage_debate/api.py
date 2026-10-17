"""HTTP API for the web app. Reads results/ for the evaluation pages. Two features run the
model live: POST /api/live (one case) and the waiting room (/api/waitlist). Both use free
local engines (llama.cpp or Ollama); watsonx only when its token budget is unlocked.

Ground truth is never included in patient or debate payloads. It is served separately
by /truth so the UI can hide it behind a "Reveal answer" toggle.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .charts import FIGURES, load_result_set, takeaways
from .config import PROJECT_ROOT, load_config, resolve
from .data import example_cases, extract_vitals, generated_chief_complaints, load_dataset, patient_id
from .debate import DebateResult, run_debate
from .engines import FREE_ENGINES, engine_status, llamacpp_ready, ollama_ready, pick_free_engine
from .evaluate import consensus_threshold, panel_from_config, panel_temperature
from .llm import LLMClient, TokenBudgetExceeded
from .schemas import AgentResult, PatientView
from .prompts import PERSONAS
from .waitlist import EngineUnavailable, WaitingList, pick_demo_vignettes

MODEL_LABELS = {
    "ibm/granite-4-h-small": "Granite 4 Small · watsonx",
    "granite3.3:8b": "Granite 3.3 8B · local",
    "granite-3.3-2b-instruct-be-q8_0": "Granite 3.3 2B · LinuxONE",
}
PROVIDER_LABELS = {
    "llamacpp": "Granite on this server (llama.cpp)",
    "ollama": "Local Granite (Ollama)",
    "watsonx": "watsonx.ai Granite 4",
    "anthropic": "Anthropic",
}
FREE_PROVIDERS = FREE_ENGINES
DEFAULT_TOKENS_PER_CASE = 3500

app = FastAPI(title="PrioriHealth", docs_url="/api/docs", openapi_url="/api/openapi.json")


# ---------------------------------------------------------------- helpers

def clean(v: Any) -> Any:
    """JSON-safe values: NaN -> None, numpy scalars -> Python, recursively."""
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):
        v = v.item()
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def set_label(summary: dict[str, Any]) -> str:
    """Model label, with the platform the experiment actually ran on for llama.cpp runs."""
    label = MODEL_LABELS.get(summary.get("model"), summary.get("model") or "Unknown model")
    if summary.get("provider") == "llamacpp":
        machine = (summary.get("platform") or {}).get("machine")
        label = label.replace("LinuxONE", "LinuxONE" if machine == "s390x" else f"llama.cpp ({machine or 'local'})")
    if not summary.get("protocol"):  # results from before the 10-member consensus panel
        label += " · v1 3-agent (archived)"
    return label


def results_root() -> Path:
    return resolve(load_config()["results_dir"])


def discover_sets(root: Path | None = None) -> list[dict[str, Any]]:
    """Every results/<provider>/<kind>/summary.json, watsonx first, full before sample."""
    root = root or results_root()
    out = []
    for f in sorted(root.glob("*/*/summary.json")):
        s = json.loads(f.read_text())
        provider, kind = f.parent.parent.name, f.parent.name
        out.append({"id": f"{provider}-{kind}", "provider": provider, "kind": kind,
                    "model": s.get("model"), "label": set_label(s),
                    "n": s.get("n_patients"), "path": str(f.parent)})
    out.sort(key=lambda d: (d["provider"] != "watsonx", d["kind"] != "full", d["id"]))
    return out


def set_path(set_id: str) -> Path:
    for s in discover_sets():
        if s["id"] == set_id:
            return Path(s["path"])
    raise HTTPException(404, f"Unknown result set {set_id!r}")


@lru_cache(maxsize=16)
def _load(path: str, mtime: float) -> dict[str, Any]:
    return load_result_set(Path(path))


def result_set(set_id: str) -> dict[str, Any]:
    path = set_path(set_id)
    return _load(str(path), (path / "summary.json").stat().st_mtime)


def _reasons(v: Any) -> list[str]:
    return [r for r in str(v).split(",") if r and r != "nan"]


# ---------------------------------------------------------------- read-only endpoints

@app.get("/api/sets")
def get_sets() -> dict[str, Any]:
    sets = discover_sets()
    return {"sets": [{k: v for k, v in s.items() if k != "path"} for s in sets],
            "default": sets[0]["id"] if sets else None}


@app.get("/api/{set_id}/overview")
def get_overview(set_id: str) -> dict[str, Any]:
    rs = result_set(set_id)
    s = rs["summary"]
    c = rs["predictions"].get("C")
    kpis: dict[str, Any] = {"patients": s["n_patients"]}
    if c is not None:
        crit = c["esi_true"] <= 2
        missed = crit & (c["pred"] >= 3)
        kpis.update({
            "escalation_rate": float(c["escalated"].mean()),
            "escalated": int(c["escalated"].sum()),
            "critical_total": int(crit.sum()),
            "critical_misses": int(missed.sum()),
            "critical_misses_unreviewed": int((missed & ~c["escalated"].astype(bool)).sum()),
            "full_agreement": float((c["disagreement_range"] == 0).mean()),
            "early_stopped": float(c["early_stopped"].mean()) if "early_stopped" in c else None,
            "consensus_rate": float(c["consensus_reached"].mean()) if "consensus_reached" in c else None,
            "mean_rounds": float(c["rounds_used"].mean()) if "rounds_used" in c else None,
            "n_agents": int(c["n_agents"].max()) if "n_agents" in c else 3,
        })
    return clean({
        "set": set_id, "run_id": s.get("run_id"), "model": s["model"], "label": set_label(s),
        "platform": s.get("platform"),
        "provider": s["provider"], "n_patients": s["n_patients"], "kpis": kpis,
        "metrics": rs["metrics"].to_dict(orient="records"),
        "conditions": s["conditions"], "paired_tests": s.get("paired_tests", {}),
        "fairness": s.get("fairness", {}), "takeaways": takeaways(rs),
        "dataset": s.get("dataset", {}), "escalation": s.get("escalation", {}),
        "protocol": s.get("protocol", "v1-three-role-panel"), "max_rounds": s.get("max_rounds"),
    })


@app.get("/api/{set_id}/patients")
def get_patients(set_id: str) -> list[dict[str, Any]]:
    rs = result_set(set_id)
    pts = rs["patients"].drop(columns=["esi_true"], errors="ignore")
    c = rs["predictions"].get("C")
    c = c.set_index("patient_id") if c is not None else None
    out = []
    for r in pts.to_dict(orient="records"):
        vit = {k.removeprefix("vital_"): r.pop(k) for k in list(r) if k.startswith("vital_")}
        row = {**r, "vitals": vit}
        row["chief_complaint"] = generated_chief_complaints().get(r["patient_id"]) or r.get("chief_complaint", "")
        if c is not None and r["patient_id"] in c.index:
            d = c.loc[r["patient_id"]]
            row["decision"] = {
                "esi": None if pd.isna(d["pred"]) else int(d["pred"]),
                "escalated": bool(d["escalated"]),
                "reasons": _reasons(d["escalation_reasons"]),
                "range": int(d["disagreement_range"]),
                "mean_confidence": float(d["mean_confidence"]),
                "early_stopped": bool(d.get("early_stopped", False)),
            }
        out.append(row)
    return clean(out)


@app.get("/api/{set_id}/debate/{pid}")
def get_debate(set_id: str, pid: str, cond: str = "C") -> dict[str, Any]:
    if cond not in {"B", "C"}:
        raise HTTPException(400, "cond must be B or C")
    f = set_path(set_id) / "debates" / cond / f"{pid}.json"
    if not f.exists():
        raise HTTPException(404, "No debate for that patient")
    # Normalize v1 (round1/round2) and v2 (rounds) transcripts to one shape. No ground truth.
    raw = json.loads(f.read_text())
    try:
        return json.loads(DebateResult.model_validate(raw).model_dump_json())
    except ValueError:  # partial/foreign transcript: serve as stored
        return raw


@app.get("/api/{set_id}/truth/{pid}")
def get_truth(set_id: str, pid: str) -> dict[str, Any]:
    pts = result_set(set_id)["patients"].set_index("patient_id")
    if pid not in pts.index:
        raise HTTPException(404, "Unknown patient")
    return {"patient_id": pid, "esi_true": int(pts.loc[pid, "esi_true"])}


@app.get("/api/{set_id}/queue")
def get_queue(set_id: str) -> list[dict[str, Any]]:
    f = set_path(set_id) / "queue_steps.jsonl"
    return [json.loads(line) for line in f.read_text().splitlines()] if f.exists() else []


@app.get("/api/{set_id}/figure/{name}")
def get_figure(set_id: str, name: str) -> JSONResponse:
    if name not in FIGURES:
        raise HTTPException(404, "Unknown figure")
    fig = FIGURES[name](result_set(set_id))
    if fig is None:
        raise HTTPException(404, "Figure not available for this result set")
    fig.update_layout(width=None, autosize=True, title=None, margin=dict(t=48))
    return JSONResponse(json.loads(fig.to_json()))


# ---------------------------------------------------------------- live case

class LiveRequest(BaseModel):
    vignette: str = Field(min_length=20, max_length=4000)
    provider: str = "ollama"


def _estimate_tokens() -> int:
    for s in discover_sets():
        if s["provider"] == "watsonx":
            c = json.loads((Path(s["path"]) / "summary.json").read_text())["conditions"].get("C", {})
            if c.get("tokens_per_patient"):
                return int(c["tokens_per_patient"] * 1.2)
    return DEFAULT_TOKENS_PER_CASE


async def _ollama_ready(cfg: dict[str, Any]) -> bool:
    return await ollama_ready(cfg)


async def _llamacpp_ready() -> bool:
    return await llamacpp_ready()


def _host_platform() -> dict[str, Any]:
    import platform

    machine = platform.machine()
    return {
        "machine": machine,
        "system": platform.system(),
        "release": platform.release(),
        "python": platform.python_version(),
        "cpus": os.cpu_count(),
        "is_linuxone": machine == "s390x",
        "label": "IBM LinuxONE · s390x" if machine == "s390x" else f"{platform.system()} · {machine}",
    }


@app.get("/api/system")
async def get_system() -> dict[str, Any]:
    """Host platform and inference engines (shown on the Home page)."""
    cfg = load_config()
    return {"platform": _host_platform(), "default_provider": cfg["llm"]["provider"],
            "engines": {"llamacpp": await _llamacpp_ready(), "ollama": await _ollama_ready(cfg)}}


@app.get("/api/live/status")
async def live_status() -> dict[str, Any]:
    cfg = load_config()
    est = _estimate_tokens()
    budget = (cfg["llm"].get("monthly_token_budget") or {}).get("watsonx")
    ready = {"llamacpp": await _llamacpp_ready(), "ollama": await _ollama_ready(cfg)}
    providers = [{"id": pid, "label": PROVIDER_LABELS[pid], "model": cfg["llm"]["models"][pid],
                  "available": ready[pid], "cost": "free", "locked": False}
                 for pid in FREE_PROVIDERS]
    # Put the configured default first so the UI preselects it.
    providers.sort(key=lambda p: (p["id"] != cfg["llm"]["provider"], not p["available"]))
    wx_creds = all(os.getenv(k) for k in ("WATSONX_APIKEY", "WATSONX_URL", "WATSONX_PROJECT_ID"))
    used = remaining = None
    if wx_creds:
        probe = LLMClient.from_config(cfg, provider="watsonx", offline=True)
        used = probe.tokens_used_this_month()
        remaining = None if budget is None else max(0, budget - used)
    providers.append({
        "id": "watsonx", "label": PROVIDER_LABELS["watsonx"], "model": cfg["llm"]["models"]["watsonx"],
        "available": wx_creds, "cost": f"~{est:,} tokens per case",
        "locked": (not wx_creds) or (remaining is not None and remaining < est),
        "budget": budget, "used": used, "remaining": remaining, "estimate": est,
    })
    return {"providers": providers}


@app.get("/api/examples")
def get_examples(n: int = 8) -> list[dict[str, Any]]:
    """A few training vignettes to try live (never test cases)."""
    _, train, _ = load_dataset(load_config())
    picks = example_cases(train, n)
    return [{"id": p.id, "vignette": p.vignette, "chief_complaint": p.chief_complaint} for p in picks]


def _agent_event(r: AgentResult) -> dict[str, Any]:
    return {"type": "agent", "agent": r.agent, "round": r.round,
            "output": r.output.model_dump() if r.output else None, "failure": r.failure}


def _final_event(d: DebateResult) -> dict[str, Any]:
    return {"type": "final", "debate": json.loads(d.model_dump_json())}


@app.post("/api/live")
async def post_live(req: LiveRequest) -> StreamingResponse:
    cfg = load_config()
    if req.provider not in {*FREE_PROVIDERS, "watsonx"}:
        raise HTTPException(400, "provider must be llamacpp, ollama or watsonx")
    if req.provider == "watsonx":
        # Check the lock with an offline probe first: no client, no network, no tokens.
        probe = LLMClient.from_config(cfg, provider="watsonx", offline=True)
        est = _estimate_tokens()
        if probe.token_budget is not None and probe.tokens_used_this_month() + est > probe.token_budget:
            raise HTTPException(403, {
                "error": "locked",
                "message": (f"watsonx is locked: this case needs about {est:,} tokens and the approved "
                            f"monthly budget is used up ({probe.tokens_used_this_month():,} of "
                            f"{probe.token_budget:,}). Raise llm.monthly_token_budget.watsonx in "
                            "config.yaml to allow it."),
            })
    log = results_root() / "runs" / "live" / "calls.jsonl"
    client = LLMClient.from_config(cfg, provider=req.provider, log_path=log)
    text = " ".join(req.vignette.split())
    view = PatientView(id="live-" + patient_id(text), vignette=text)
    q: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def on_event(kind: str, payload: Any) -> None:
        if kind == "agent":
            await q.put(_agent_event(payload))
        elif kind == "round_end":
            await q.put({"type": "round_end", **payload})
        elif kind == "early_stop":
            await q.put({"type": "early_stop"})
        elif kind == "final":
            await q.put(_final_event(payload))

    async def run() -> None:
        try:
            panel = panel_from_config(cfg)
            await q.put({"type": "start", "patient_id": view.id, "provider": req.provider,
                         "model": client.model, "agents": [PERSONAS[p]["name"] for p in panel],
                         "max_rounds": int(cfg["debate"].get("max_rounds", 5)),
                         "consensus_threshold": consensus_threshold(cfg)})
            await run_debate(client, view, personas=panel, escalation_cfg=cfg["escalation"],
                             temperature=panel_temperature(cfg),
                            consensus_threshold=consensus_threshold(cfg),
                             max_rounds=int(cfg["debate"].get("max_rounds", 5)),
                             early_stop=bool(cfg["debate"]["early_stop"]), on_event=on_event)
        except TokenBudgetExceeded as exc:
            await q.put({"type": "error", "error": "locked", "message": str(exc)})
        except Exception as exc:  # surface to the UI instead of a broken stream
            await q.put({"type": "error", "error": type(exc).__name__, "message": str(exc)[:300]})
        finally:
            await q.put(None)

    async def stream():
        task = asyncio.create_task(run())
        try:
            while (item := await q.get()) is not None:
                yield f"data: {json.dumps(clean(item))}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/vitals")
def post_vitals(req: LiveRequest) -> dict[str, Any]:
    """Vitals parsed from free text, for the live-case preview."""
    return extract_vitals(req.vignette).model_dump()


# ---------------------------------------------------------------- waiting room

_WAITLIST: WaitingList | None = None


async def _triage_waitlist_entry(entry, on_event):
    """Run the trait panel on one waiting-room arrival with a free local engine."""
    cfg = load_config()
    engine = await pick_free_engine(cfg)
    if engine is None:
        raise EngineUnavailable("No free engine online. Start Ollama or the llama.cpp server; "
                                "this patient will be triaged automatically when one is up.")
    panel = panel_from_config(cfg)
    entry.engine = engine
    entry.progress.agents = len(panel)
    client = LLMClient.from_config(cfg, provider=engine,
                                   log_path=results_root() / "runs" / "waitlist" / "calls.jsonl")
    return await run_debate(client, waitlist().view(entry.id), personas=panel,
                            temperature=panel_temperature(cfg),
                            consensus_threshold=consensus_threshold(cfg),
                            max_rounds=int(cfg["debate"].get("max_rounds", 5)),
                            early_stop=bool(cfg["debate"]["early_stop"]),
                            escalation_cfg=cfg["escalation"], on_event=on_event)


def waitlist() -> WaitingList:
    """The process-wide waiting list (created on first use, worker started lazily)."""
    global _WAITLIST
    if _WAITLIST is None:
        cfg = load_config()
        wl_cfg = cfg.get("waitlist", {})
        targets = {int(k): float(v) for k, v in (wl_cfg.get("targets") or {}).items()} or None
        _WAITLIST = WaitingList(resolve(wl_cfg.get("store", "data/waitlist.json")), targets=targets,
                                triage=_triage_waitlist_entry)
    try:
        _WAITLIST.start()
    except RuntimeError:  # no running loop (sync test client before startup)
        pass
    return _WAITLIST


@app.on_event("startup")
async def _start_waitlist() -> None:
    waitlist()


class ArrivalRequest(BaseModel):
    vignette: str = Field(min_length=20, max_length=4000)
    label: str | None = Field(default=None, max_length=60)


class ConfirmRequest(BaseModel):
    esi: int = Field(ge=1, le=5)


class SimulateRequest(BaseModel):
    count: int = Field(default=6, ge=1, le=30)
    interval_s: float = Field(default=20.0, ge=1.0, le=600.0)


def _entry_or_404(entry_id: str):
    wl = waitlist()
    if entry_id not in wl.entries:
        raise HTTPException(404, "Unknown waiting-room entry")
    return wl


@app.get("/api/waitlist")
async def get_waitlist() -> dict[str, Any]:
    cfg = load_config()
    snap = waitlist().snapshot()
    snap["engine"] = await pick_free_engine(cfg)
    snap["panel_size"] = len(panel_from_config(cfg))
    snap["max_rounds"] = int(cfg["debate"].get("max_rounds", 5))
    return clean(snap)


@app.post("/api/waitlist")
async def add_arrival(req: ArrivalRequest) -> dict[str, Any]:
    e = await waitlist().add(req.vignette, label=req.label)
    return e.model_dump(exclude={"debate"})


@app.get("/api/waitlist/{entry_id}")
def get_arrival(entry_id: str) -> dict[str, Any]:
    wl = _entry_or_404(entry_id)
    e = wl.entries[entry_id]
    out = e.model_dump()
    out["vitals"] = wl.vitals(entry_id)
    return clean(out)


@app.post("/api/waitlist/{entry_id}/confirm")
async def confirm_arrival(entry_id: str, req: ConfirmRequest) -> dict[str, Any]:
    e = await _entry_or_404(entry_id).confirm(entry_id, req.esi)
    return e.model_dump(exclude={"debate"})


@app.post("/api/waitlist/{entry_id}/seen")
async def seen_arrival(entry_id: str) -> dict[str, Any]:
    e = await _entry_or_404(entry_id).mark_seen(entry_id)
    return e.model_dump(exclude={"debate"})


@app.delete("/api/waitlist")
async def clear_waitlist() -> dict[str, Any]:
    await waitlist().clear()
    return {"ok": True}


@app.post("/api/waitlist/simulate")
async def simulate_arrivals(req: SimulateRequest) -> dict[str, Any]:
    """Feed training-set vignettes as arrivals (demo). Never evaluation test cases."""
    _, train, _ = load_dataset(load_config())
    picks = pick_demo_vignettes(train, req.count)
    waitlist().simulate([p.vignette for p in picks], req.interval_s)
    return {"scheduled": len(picks), "interval_s": req.interval_s}


# ---------------------------------------------------------------- built frontend

DIST = PROJECT_ROOT / "web" / "dist"
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    f = DIST / path
    if path and f.is_file():
        return FileResponse(f)
    index = DIST / "index.html"
    if not index.exists():
        return JSONResponse({"error": "Frontend not built. Run: cd web && npm install && npm run build"},
                            status_code=503)
    return FileResponse(index)
