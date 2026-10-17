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
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth
from .charts import FIGURES, load_result_set, takeaways
from .config import PROJECT_ROOT, load_config, resolve
from .data import example_cases, extract_vitals, generated_chief_complaints, load_dataset, patient_id
from .debate import DebateResult, run_debate
from .engines import FREE_ENGINES, engine_status, llamacpp_ready, ollama_ready, pick_free_engine
from .evaluate import consensus_threshold, panel_from_config, panel_temperature
from .llm import LLMClient, TokenBudgetExceeded
from .schemas import AgentResult, PatientView
from .prompts import PERSONAS
from .waitlist import EngineUnavailable, WaitingList, normalize_code, pick_demo_vignettes

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


# ---------------------------------------------------------------- accounts

PUBLIC_API = ("/api/auth/", "/api/public/", "/api/system", "/api/docs", "/api/openapi.json")
_AUTH: auth.AuthStore | None = None


def auth_store() -> auth.AuthStore:
    global _AUTH
    if _AUTH is None:
        _AUTH = auth.AuthStore(resolve(load_config().get("auth", {}).get("db", "data/priorihealth.db")))
    return _AUTH


@app.middleware("http")
async def require_session(request: Request, call_next):
    """Every /api route except sign-in and system status needs a signed-in user."""
    path = request.url.path
    if path.startswith("/api/") and not path.startswith(PUBLIC_API):
        user = auth_store().user_for_token(request.cookies.get(auth.SESSION_COOKIE))
        if user is None:
            return JSONResponse({"detail": "Sign in required"}, status_code=401)
        request.state.user = user
    return await call_next(request)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "")


def _start_session(request: Request, response: Response, user: dict[str, Any]) -> dict[str, Any]:
    token = auth_store().create_session(user["id"])
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(auth.SESSION_COOKIE, token, max_age=auth.SESSION_TTL_S, httponly=True,
                        samesite="lax", secure=secure, path="/")
    return {"user": user}


def _auth_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except auth.AuthError as e:
        raise HTTPException(e.status, e.message) from None


class SignUpRequest(BaseModel):
    name: str = Field(max_length=100)
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)
    hospital_id: str
    role: str


class SignInRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


@app.get("/api/auth/hospitals")
def get_hospitals() -> dict[str, Any]:
    return {"hospitals": auth.HOSPITALS, "roles": auth.ROLES}


@app.post("/api/auth/signup")
def sign_up(req: SignUpRequest, request: Request, response: Response) -> dict[str, Any]:
    user = _auth_call(auth_store().create_user, email=req.email, name=req.name, password=req.password,
                      hospital_id=req.hospital_id, role=req.role)
    return _start_session(request, response, user)


@app.post("/api/auth/signin")
def sign_in(req: SignInRequest, request: Request, response: Response) -> dict[str, Any]:
    user = _auth_call(auth_store().authenticate, req.email, req.password, _client_ip(request))
    return _start_session(request, response, user)


@app.post("/api/auth/demo")
def sign_in_demo(request: Request, response: Response) -> dict[str, Any]:
    return _start_session(request, response, auth_store().demo_user())


@app.post("/api/auth/signout")
def sign_out(request: Request, response: Response) -> dict[str, Any]:
    auth_store().delete_session(request.cookies.get(auth.SESSION_COOKIE))
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def get_me(request: Request) -> dict[str, Any]:
    user = auth_store().user_for_token(request.cookies.get(auth.SESSION_COOKIE))
    if user is None:
        raise HTTPException(401, "Sign in required")
    return {"user": user}


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


def _accelerator() -> str | None:
    """The IBM z17 on-chip AI accelerator, when the model server was built to use it."""
    if os.getenv("PRIORIHEALTH_ACCELERATOR") != "zdnn":
        return None
    try:
        has_nnpa = "nnpa" in Path("/proc/cpuinfo").read_text().split()
    except OSError:
        has_nnpa = False
    return "IBM z17 Telum II AI accelerator (NNPA, via zDNN)" if has_nnpa else None


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
        "accelerator": _accelerator(),
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


# ---------------------------------------------------------------- waiting rooms (one per hospital)

_WAITLISTS: dict[str, WaitingList] = {}
_ENGINE_LOCK: asyncio.Lock | None = None  # every hospital shares the one local engine


def _engine_lock() -> asyncio.Lock:
    global _ENGINE_LOCK
    if _ENGINE_LOCK is None:
        _ENGINE_LOCK = asyncio.Lock()
    return _ENGINE_LOCK


def _make_triage(hospital_id: str):
    async def triage(entry, on_event):
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
        async with _engine_lock():
            return await run_debate(client, waitlist(hospital_id).view(entry.id), personas=panel,
                                    temperature=panel_temperature(cfg),
                                    consensus_threshold=consensus_threshold(cfg),
                                    max_rounds=int(cfg["debate"].get("max_rounds", 5)),
                                    early_stop=bool(cfg["debate"]["early_stop"]),
                                    escalation_cfg=cfg["escalation"], on_event=on_event)
    return triage


def waitlist_dir() -> Path:
    return resolve(load_config().get("waitlist", {}).get("store_dir", "data/waitlists"))


def waitlist(hospital_id: str = auth.DEMO_HOSPITAL) -> WaitingList:
    """The hospital's waiting list (created on first use, worker started lazily)."""
    wl = _WAITLISTS.get(hospital_id)
    if wl is None:
        cfg = load_config()
        wl_cfg = cfg.get("waitlist", {})
        targets = {int(k): float(v) for k, v in (wl_cfg.get("targets") or {}).items()} or None
        path = waitlist_dir() / f"{hospital_id}.json"
        legacy = resolve("data/waitlist.json")  # single waiting room from before accounts
        if hospital_id == auth.DEMO_HOSPITAL and not path.exists() and legacy.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            legacy.replace(path)
        wl = _WAITLISTS[hospital_id] = WaitingList(path, targets=targets,
                                                   triage=_make_triage(hospital_id))
    try:
        wl.start()
    except RuntimeError:  # no running loop (sync test client before startup)
        pass
    return wl


@app.on_event("startup")
async def _start_waitlists() -> None:
    d = waitlist_dir()
    ids = {p.stem for p in d.glob("*.json")} & auth.HOSPITAL_IDS if d.exists() else set()
    for hid in ids | {auth.DEMO_HOSPITAL}:
        waitlist(hid)


def _hospital_id(request: Request) -> str:
    return request.state.user["hospital"]["id"]


class ArrivalRequest(BaseModel):
    vignette: str = Field(min_length=20, max_length=4000)
    label: str | None = Field(default=None, max_length=60)


class ConfirmRequest(BaseModel):
    esi: int = Field(ge=1, le=5)


class SimulateRequest(BaseModel):
    count: int = Field(default=6, ge=1, le=30)
    interval_s: float = Field(default=20.0, ge=1.0, le=600.0)


def _entry_or_404(request: Request, entry_id: str):
    wl = waitlist(_hospital_id(request))
    if entry_id not in wl.entries:
        raise HTTPException(404, "Unknown waiting-room entry")
    return wl


@app.get("/api/waitlist")
async def get_waitlist(request: Request) -> dict[str, Any]:
    cfg = load_config()
    snap = waitlist(_hospital_id(request)).snapshot()
    snap["engine"] = await pick_free_engine(cfg)
    snap["panel_size"] = len(panel_from_config(cfg))
    snap["max_rounds"] = int(cfg["debate"].get("max_rounds", 5))
    return clean(snap)


@app.post("/api/waitlist")
async def add_arrival(request: Request, req: ArrivalRequest) -> dict[str, Any]:
    e = await waitlist(_hospital_id(request)).add(req.vignette, label=req.label)
    return e.model_dump(exclude={"debate"})


@app.get("/api/waitlist/{entry_id}")
def get_arrival(request: Request, entry_id: str) -> dict[str, Any]:
    wl = _entry_or_404(request, entry_id)
    e = wl.entries[entry_id]
    out = e.model_dump()
    out["vitals"] = wl.vitals(entry_id)
    return clean(out)


@app.post("/api/waitlist/{entry_id}/confirm")
async def confirm_arrival(request: Request, entry_id: str, req: ConfirmRequest) -> dict[str, Any]:
    e = await _entry_or_404(request, entry_id).confirm(entry_id, req.esi)
    return e.model_dump(exclude={"debate"})


@app.post("/api/waitlist/{entry_id}/seen")
async def seen_arrival(request: Request, entry_id: str) -> dict[str, Any]:
    e = await _entry_or_404(request, entry_id).mark_seen(entry_id)
    return e.model_dump(exclude={"debate"})


@app.delete("/api/waitlist")
async def clear_waitlist(request: Request) -> dict[str, Any]:
    await waitlist(_hospital_id(request)).clear()
    return {"ok": True}


@app.post("/api/waitlist/simulate")
async def simulate_arrivals(request: Request, req: SimulateRequest) -> dict[str, Any]:
    """Feed training-set vignettes as arrivals (demo). Never evaluation test cases."""
    _, train, _ = load_dataset(load_config())
    picks = pick_demo_vignettes(train, req.count)
    waitlist(_hospital_id(request)).simulate([p.vignette for p in picks], req.interval_s)
    return {"scheduled": len(picks), "interval_s": req.interval_s}


# ---------------------------------------------------------------- patient status (public)

STATUS_EXPIRES_S = 2 * 3600  # a patient's page stops working 2 h after they were seen
_LOOKUPS: dict[str, list[float]] = {}
_MISSES: dict[str, list[float]] = {}


def _hit(store: dict[str, list[float]], key: str, window_s: float, limit: int, record: bool = True) -> bool:
    """Sliding-window counter; True if `key` is over `limit` within `window_s`."""
    now = time.time()
    q = [t for t in store.get(key, []) if t > now - window_s]
    if record:
        q.append(now)
    store[key] = q
    return len(q) > limit if record else len(q) >= limit


def _all_waitlists() -> list[tuple[str, WaitingList]]:
    d = waitlist_dir()
    ids = set(_WAITLISTS) | ({p.stem for p in d.glob("*.json")} & auth.HOSPITAL_IDS if d.exists() else set())
    return [(hid, waitlist(hid)) for hid in sorted(ids)]


@app.get("/api/public/status/{code}")
def public_status(code: str, request: Request, response: Response) -> dict[str, Any]:
    """A patient's place in line and estimated wait. No clinical details, no sign-in."""
    response.headers["Cache-Control"] = "no-store"
    ip = _client_ip(request)
    if _hit(_LOOKUPS, ip, 60, 120) or _hit(_MISSES, ip, 600, 20, record=False):
        raise HTTPException(429, "Too many requests. Please wait a few minutes and try again.")
    norm = normalize_code(code)
    default_mpp = float(load_config().get("waitlist", {}).get("minutes_per_patient", 12))
    for hid, wl in _all_waitlists():
        e = wl.by_code(norm) if len(norm) == 6 else None
        if e is None:
            continue
        if e.status == "seen" and e.seen_at and wl.clock() - e.seen_at > STATUS_EXPIRES_S:
            break
        h = auth.hospital(hid) or {"name": hid}
        return {"code": e.code, "hospital": {"name": h["name"]}, **wl.status_for(e, default_mpp)}
    _hit(_MISSES, ip, 600, 20)
    raise HTTPException(404, "We couldn't find that code. Check your ticket and try again.")


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
