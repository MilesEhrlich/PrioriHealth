"""Surge simulation: patients arrive over time, each is triaged by the panel, and the
waiting-room queue is re-ranked after every arrival.

Ranking: aggregate ESI (most urgent first), then arrival time. Escalated cases keep their
place in the ranking but are also pinned to a separate "needs nurse review" list.
Nobody is discharged during the surge; the point is to show how the order changes.
"""

from __future__ import annotations

import random
from typing import Any

from pydantic import BaseModel


class QueueEntry(BaseModel):
    patient_id: str
    arrival_min: float
    esi: int | None
    escalated: bool
    escalation_reasons: list[str] = []
    chief_complaint: str = ""
    rank: int = 0
    wait_min: float = 0.0
    moved: int = 0  # +n = moved up n places since the previous step


class QueueStep(BaseModel):
    step: int
    clock_min: float
    arrived: str
    queue: list[QueueEntry]
    review: list[str]  # patient ids pinned for nurse review, in queue order


def arrival_times(n: int, mean_gap_min: float, seed: int) -> list[float]:
    """Poisson-process arrival times (exponential gaps), seeded, rounded to 0.1 min."""
    rng = random.Random(seed)
    t, out = 0.0, []
    for _ in range(n):
        out.append(round(t, 1))
        t += rng.expovariate(1 / mean_gap_min)
    return out


def rank_key(e: QueueEntry) -> tuple[int, float]:
    """Sort key: unknown ESI (system failure) is treated as most urgent."""
    return (e.esi if e.esi is not None else 0, e.arrival_min)


def simulate(decisions: list[dict[str, Any]], mean_gap_min: float, seed: int) -> list[QueueStep]:
    """Replay arrivals one by one and record the re-ranked queue after each.

    `decisions`: per-patient dicts with patient_id, esi, escalated, escalation_reasons,
    chief_complaint, in arrival order.
    """
    times = arrival_times(len(decisions), mean_gap_min, seed)
    queue: list[QueueEntry] = []
    prev_rank: dict[str, int] = {}
    steps: list[QueueStep] = []
    for i, (d, t) in enumerate(zip(decisions, times)):
        queue.append(QueueEntry(patient_id=d["patient_id"], arrival_min=t, esi=d.get("esi"),
                                escalated=bool(d.get("escalated")),
                                escalation_reasons=list(d.get("escalation_reasons") or []),
                                chief_complaint=d.get("chief_complaint", "")))
        queue.sort(key=rank_key)
        snapshot = []
        for r, e in enumerate(queue, 1):
            old = prev_rank.get(e.patient_id)
            snapshot.append(e.model_copy(update={
                "rank": r, "wait_min": round(t - e.arrival_min, 1),
                "moved": (old - r) if old is not None else 0}))
        prev_rank = {e.patient_id: e.rank for e in snapshot}
        steps.append(QueueStep(step=i + 1, clock_min=t, arrived=d["patient_id"], queue=snapshot,
                               review=[e.patient_id for e in snapshot if e.escalated]))
    return steps
