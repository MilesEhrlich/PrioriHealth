"""API tests against a tiny fixture result set (no LLM calls, no network)."""

import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from triage_debate import api as api_mod


@pytest.fixture()
def client(tmp_path, monkeypatch):
    d = tmp_path / "results" / "watsonx" / "sample"
    (d / "debates" / "C").mkdir(parents=True)
    summary = {
        "model": "ibm/granite-4-h-small", "provider": "watsonx", "n_patients": 2,
        "conditions": {"C": {"exact_acc": 0.5, "exact_acc_ci": [0, 1], "critical_miss": 0.0,
                             "critical_miss_ci": [0, 0], "critical_miss_unreviewed": 0.0,
                             "escalation_rate": 0.5, "acc_non_escalated": 1.0,
                             "auroc_uncertainty": 0.7, "calls_per_patient": 4.0,
                             "tokens_per_patient": 3000}},
        "paired_tests": {}, "fairness": {}, "escalation": {"range_threshold": 1, "safety_override": True},
    }
    (d / "summary.json").write_text(json.dumps(summary))
    pd.DataFrame([{"condition": "C", "name": "Persona debate", **summary["conditions"]["C"]}]).drop(
        columns=["exact_acc_ci", "critical_miss_ci"]).to_csv(d / "metrics.csv", index=False)
    pd.DataFrame([{"condition": "C", "threshold": 1, "coverage": 0.5, "escalation_rate": 0.5,
                   "acc_auto": 1.0, "critical_miss_unreviewed": 0.0}]).to_csv(d / "coverage_curve.csv", index=False)
    pd.DataFrame([
        {"patient_id": "p-aaa", "esi_true": 2, "vignette": "Chest pain, HR 120.", "age_years": 50, "sex": "M",
         "chief_complaint": "Chest pain", "vital_hr": 120, "vital_rr": None, "vital_sbp": None,
         "vital_dbp": None, "vital_spo2": None, "vital_temp_f": None},
        {"patient_id": "p-bbb", "esi_true": 5, "vignette": "Needs a refill.", "age_years": 40, "sex": "F",
         "chief_complaint": "Refill", "vital_hr": None, "vital_rr": None, "vital_sbp": None,
         "vital_dbp": None, "vital_spo2": None, "vital_temp_f": None},
    ]).to_csv(d / "patients.csv", index=False)
    pd.DataFrame([
        {"patient_id": "p-aaa", "esi_true": 2, "pred": 2, "escalated": True,
         "escalation_reasons": "disagreement", "disagreement_range": 1, "mean_confidence": 0.8,
         "early_stopped": False, "calls": 6, "input_tokens": 100, "output_tokens": 50, "latency_ms": 1},
        {"patient_id": "p-bbb", "esi_true": 5, "pred": 5, "escalated": False,
         "escalation_reasons": "", "disagreement_range": 0, "mean_confidence": 0.9,
         "early_stopped": True, "calls": 3, "input_tokens": 100, "output_tokens": 50, "latency_ms": 1},
    ]).to_csv(d / "predictions_C.csv", index=False)
    (d / "debates" / "C" / "p-aaa.json").write_text(json.dumps({"patient_id": "p-aaa", "aggregate": 2}))
    (d / "queue_steps.jsonl").write_text(json.dumps({"step": 1, "queue": [], "review": []}) + "\n")

    monkeypatch.setattr(api_mod, "results_root", lambda: tmp_path / "results")
    monkeypatch.setattr(api_mod, "_AUTH", api_mod.auth.AuthStore(tmp_path / "auth.db"))
    monkeypatch.setattr(api_mod, "_WAITLISTS", {})
    api_mod._load.cache_clear()
    c = TestClient(api_mod.app)
    assert c.post("/api/auth/demo").status_code == 200
    return c


def test_sets_and_overview(client):
    r = client.get("/api/sets").json()
    assert r["default"] == "watsonx-sample"
    ov = client.get("/api/watsonx-sample/overview").json()
    assert ov["kpis"]["critical_total"] == 1 and ov["kpis"]["escalated"] == 1


def test_patients_never_include_ground_truth(client):
    rows = client.get("/api/watsonx-sample/patients").json()
    assert len(rows) == 2
    assert "esi_true" not in json.dumps(rows)
    assert rows[0]["decision"]["reasons"] == ["disagreement"]
    assert rows[0]["vitals"]["hr"] == 120


def test_truth_only_from_truth_endpoint(client):
    assert client.get("/api/watsonx-sample/truth/p-aaa").json()["esi_true"] == 2
    assert "esi_true" not in client.get("/api/watsonx-sample/debate/p-aaa").text
    assert client.get("/api/watsonx-sample/debate/p-zzz").status_code == 404


def test_figure_and_queue(client):
    fig = client.get("/api/watsonx-sample/figure/coverage").json()
    assert "data" in fig and "layout" in fig
    assert client.get("/api/watsonx-sample/figure/nope").status_code == 404
    assert len(client.get("/api/watsonx-sample/queue").json()) == 1


def test_live_watsonx_locked_without_any_client(client, monkeypatch, tmp_path):
    cfg = api_mod.load_config()
    cfg["llm"]["monthly_token_budget"] = {"watsonx": 0}
    cfg["llm"]["cache_dir"] = str(tmp_path / "cache")
    monkeypatch.setattr(api_mod, "load_config", lambda: cfg)
    made = []
    import triage_debate.llm as llm_mod
    monkeypatch.setattr(llm_mod, "make_backend", lambda *a, **k: made.append(a) or (_ for _ in ()).throw(AssertionError("no backend")))
    r = client.post("/api/live", json={"vignette": "A 50-year-old with chest pain and sweating.", "provider": "watsonx"})
    assert r.status_code == 403 and r.json()["detail"]["error"] == "locked"
    assert made == []  # no watsonx client was ever constructed


def test_live_rejects_unknown_provider(client):
    r = client.post("/api/live", json={"vignette": "A 50-year-old with chest pain and sweating.", "provider": "x"})
    assert r.status_code == 400


def test_system_reports_platform(client):
    s = client.get("/api/system").json()
    assert s["platform"]["machine"] and "is_linuxone" in s["platform"]
    assert set(s["engines"]) == {"llamacpp", "ollama"}


def test_live_status_lists_all_engines(client, monkeypatch):
    monkeypatch.setenv("PRIORIHEALTH_PROVIDER", "llamacpp")
    ids = [p["id"] for p in client.get("/api/live/status").json()["providers"]]
    assert set(ids) == {"llamacpp", "ollama", "watsonx"}
    assert ids[0] == "llamacpp"  # configured default listed first


def test_waitlist_endpoints_without_engine(client, monkeypatch, tmp_path):
    import triage_debate.api as A
    from triage_debate.waitlist import WaitingList

    A._WAITLISTS["riverbend"] = WaitingList(tmp_path / "wl.json")  # no triage function: nothing runs
    r = client.post("/api/waitlist", json={"vignette": "A 40-year-old with a laceration to the palm.", "label": "Bed 4"})
    eid = r.json()["id"]
    snap = client.get("/api/waitlist").json()
    assert {"waiting", "triaging", "seen", "panel_size"} <= set(snap)
    assert client.post(f"/api/waitlist/{eid}/confirm", json={"esi": 4}).json()["nurse_esi"] == 4
    assert client.post(f"/api/waitlist/{eid}/confirm", json={"esi": 9}).status_code == 422
    assert client.post(f"/api/waitlist/{eid}/seen").json()["status"] == "seen"
    assert client.get("/api/waitlist/nope").status_code == 404
    assert client.delete("/api/waitlist").json()["ok"]
