"""Live waiting room: patients arrive, the trait panel triages them in the background, and the
list is ordered by ESI-weighted wait.

Ordering: each ESI level has a target time from arrival to being seen (config
`waitlist.targets`, minutes). A patient's priority is how far they are past that target
(minutes waited - target), so a long-waiting ESI 4 eventually rises above a fresh ESI 3 and
nobody is forgotten. ESI 1 is always first. Until a nurse confirms an escalated case, it is
ranked by the most urgent level any agent proposed (safety first).

Only free local engines (llama.cpp or Ollama) are used. Simulated arrivals use TRAINING
vignettes, never evaluation test cases.
"""

from __future__ import annotations

import asyncio
import json
import random
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from .data import extract_chief_complaint, extract_vitals, generated_chief_complaints, patient_id
from .schemas import PatientView

Status = Literal["queued", "triaging", "triaged", "failed", "seen"]
RETRY_S = 10.0


class EngineUnavailable(RuntimeError):
    """No free inference engine is online yet; the arrival stays queued and is retried."""
DEFAULT_TARGETS = {1: 0, 2: 10, 3: 30, 4: 60, 5: 120}


class Progress(BaseModel):
    round: int = 0
    agents_done: int = 0
    agents: int = 0
    votes: dict[str, int] = Field(default_factory=dict)


class WaitEntry(BaseModel):
    id: str
    label: str
    vignette: str
    chief_complaint: str = ""
    arrived_at: float
    status: Status = "queued"
    progress: Progress = Field(default_factory=Progress)
    engine: str | None = None
    esi: int | None = None              # panel decision
    safety_esi: int | None = None       # most urgent level any member proposed
    escalated: bool = False
    reasons: list[str] = Field(default_factory=list)
    consensus_reached: bool | None = None
    rounds_used: int | None = None
    nurse_esi: int | None = None        # set when a nurse confirms or overrides
    triaged_at: float | None = None
    seen_at: float | None = None
    error: str | None = None
    source: str = "manual"              # manual | simulated
    debate: dict[str, Any] | None = None


# ---------------------------------------------------------------- ordering (pure)


def effective_esi(e: WaitEntry) -> int | None:
    """Nurse-confirmed level, else (if escalated) the most urgent proposal, else the panel's."""
    if e.nurse_esi is not None:
        return e.nurse_esi
    if e.escalated and e.safety_esi is not None:
        return min(e.safety_esi, e.esi or 5)
    return e.esi


def priority_view(entries: list[WaitEntry], now: float,
                  targets: dict[int, float] | None = None) -> dict[str, list[dict[str, Any]]]:
    """Split and order the list for display.

    waiting: triaged/failed patients not yet seen, highest priority first.
    triaging: arrivals still being assessed, in arrival order.
    seen: most recently seen first (last 20).
    """
    targets = {int(k): float(v) for k, v in (targets or DEFAULT_TARGETS).items()}
    waiting, triaging, seen = [], [], []
    for e in entries:
        wait_min = (now - e.arrived_at) / 60.0
        row = e.model_dump(exclude={"debate"})
        row["wait_min"] = round(wait_min, 2)
        if e.status == "seen":
            seen.append(row)
            continue
        if e.status in ("queued", "triaging"):
            triaging.append(row)
            continue
        eff = effective_esi(e)
        # A failed triage has no level: treat as ESI 2 until a nurse looks (never buried).
        level = eff if eff is not None else 2
        target = targets.get(level, 60.0)
        row.update(effective_esi=eff, target_min=target, overdue_min=round(wait_min - target, 2),
                   score=float("inf") if level == 1 else wait_min - target)
        waiting.append(row)
    waiting.sort(key=lambda r: (-r["score"], r["arrived_at"]))
    for i, r in enumerate(waiting, 1):
        r["position"] = i
        if r["score"] == float("inf"):
            r["score"] = None  # JSON-safe
    triaging.sort(key=lambda r: r["arrived_at"])
    seen.sort(key=lambda r: -(r.get("seen_at") or 0))
    return {"waiting": waiting, "triaging": triaging, "seen": seen[:20]}


def pick_demo_vignettes(train: list, n: int, seed: int | None = None) -> list:
    """Simulated arrivals: training cases only (never the evaluation test split)."""
    pool = [p for p in train if p.split == "train"]
    rng = random.Random(seed)
    return rng.sample(pool, min(n, len(pool)))


# ---------------------------------------------------------------- store + worker


class WaitingList:
    """Persistent waiting list with a single background triage worker."""

    def __init__(self, path: Path, targets: dict[int, float] | None = None,
                 triage: Callable[[WaitEntry, Callable[[str, Any], Any]], Any] | None = None,
                 clock: Callable[[], float] = time.time):
        self.path = Path(path)
        self.targets = targets or DEFAULT_TARGETS
        self.clock = clock
        self._triage = triage
        self._lock = asyncio.Lock()
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._sim: asyncio.Task | None = None
        self.entries: dict[str, WaitEntry] = {}
        self._load()

    # ---- persistence
    def _load(self) -> None:
        if self.path.exists():
            data = json.loads(self.path.read_text())
            self.entries = {d["id"]: WaitEntry.model_validate(d) for d in data.get("entries", [])}
        for e in self.entries.values():
            if e.status == "triaging":  # interrupted by a restart: start over
                e.status, e.progress = "queued", Progress()

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"entries": [e.model_dump() for e in self.entries.values()]}))
        tmp.replace(self.path)

    # ---- worker
    def start(self) -> None:
        """Start the background worker (call from a running event loop)."""
        if self._worker is None or self._worker.done():
            for e in sorted(self.entries.values(), key=lambda e: e.arrived_at):
                if e.status == "queued":
                    self._queue.put_nowait(e.id)
            self._worker = asyncio.create_task(self._run())

    async def stop(self) -> None:
        for t in (self._worker, self._sim):
            if t:
                t.cancel()

    async def _run(self) -> None:
        while True:
            entry_id = await self._queue.get()
            e = self.entries.get(entry_id)
            if e is None or e.status != "queued":
                continue
            await self._process(e)

    async def _process(self, e: WaitEntry) -> None:
        async with self._lock:
            e.status = "triaging"
            self._save()

        async def on_event(kind: str, payload: Any) -> None:
            if kind == "agent":
                e.progress.agents_done += 1
                e.progress.round = max(e.progress.round, payload.round)
            elif kind == "round_end":
                e.progress.votes = dict(payload["votes"])
                e.progress.agents_done = 0

        try:
            if self._triage is None:
                raise RuntimeError("no triage engine configured")
            result = await self._triage(e, on_event)
            votes = [v for rnd in result.vote_matrix() for v in rnd if v is not None]
            async with self._lock:
                e.esi = result.aggregate
                e.safety_esi = min(votes) if votes else None
                e.escalated = result.escalated
                e.reasons = list(result.escalation_reasons)
                e.consensus_reached = result.consensus_reached
                e.rounds_used = result.rounds_used
                e.debate = json.loads(result.model_dump_json())
                e.status, e.triaged_at, e.error = "triaged", self.clock(), None
                self._save()
        except asyncio.CancelledError:
            raise
        except EngineUnavailable as exc:
            async with self._lock:
                e.status, e.error, e.progress = "queued", str(exc), Progress()
                self._save()
            await asyncio.sleep(RETRY_S)
            self._queue.put_nowait(e.id)
        except Exception as exc:  # never lose a patient: show them, flagged for a nurse
            async with self._lock:
                e.status, e.error = "failed", f"{type(exc).__name__}: {str(exc)[:200]}"
                e.escalated, e.reasons = True, ["triage_failed"]
                e.triaged_at = self.clock()
                self._save()

    # ---- commands
    async def add(self, vignette: str, label: str | None = None, source: str = "manual") -> WaitEntry:
        text = " ".join(vignette.split())
        async with self._lock:
            n = len(self.entries) + 1
            e = WaitEntry(id=uuid.uuid4().hex[:8], label=label or f"Patient {n:03d}", vignette=text,
                          chief_complaint=generated_chief_complaints().get(patient_id(text))
                          or extract_chief_complaint(text), arrived_at=self.clock(),
                          source=source)
            self.entries[e.id] = e
            self._save()
        self._queue.put_nowait(e.id)
        return e

    async def confirm(self, entry_id: str, esi: int) -> WaitEntry:
        if esi not in (1, 2, 3, 4, 5):
            raise ValueError("esi must be 1-5")
        async with self._lock:
            e = self.entries[entry_id]
            e.nurse_esi = esi
            self._save()
            return e

    async def mark_seen(self, entry_id: str) -> WaitEntry:
        async with self._lock:
            e = self.entries[entry_id]
            e.status, e.seen_at = "seen", self.clock()
            self._save()
            return e

    async def clear(self) -> None:
        async with self._lock:
            if self._sim:
                self._sim.cancel()
            self.entries.clear()
            while not self._queue.empty():
                self._queue.get_nowait()
            self._save()

    def simulate(self, vignettes: list[str], interval_s: float) -> None:
        """Feed arrivals one by one in the background (demo)."""
        if self._sim and not self._sim.done():
            self._sim.cancel()

        async def feed() -> None:
            for i, v in enumerate(vignettes):
                if i:
                    await asyncio.sleep(interval_s)
                await self.add(v, source="simulated")

        self._sim = asyncio.create_task(feed())

    def snapshot(self) -> dict[str, Any]:
        view = priority_view(list(self.entries.values()), self.clock(), self.targets)
        view["now"] = self.clock()
        view["targets"] = {str(k): v for k, v in self.targets.items()}
        view["simulating"] = bool(self._sim and not self._sim.done())
        return view

    def view(self, entry_id: str) -> PatientView:
        e = self.entries[entry_id]
        return PatientView(id=f"wl-{e.id}", vignette=e.vignette)

    def vitals(self, entry_id: str) -> dict[str, Any]:
        return extract_vitals(self.entries[entry_id].vignette).model_dump()
