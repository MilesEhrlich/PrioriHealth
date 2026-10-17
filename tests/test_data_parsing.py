from pathlib import Path

from triage_debate.data import (
    clean_text,
    extract_age,
    extract_sex,
    extract_vitals,
    normalize_key,
    parse_label,
    patient_id,
    read_rows,
    stratified_sample,
)
from triage_debate.schemas import Patient


def test_parse_label():
    assert parse_label("3") == 3
    assert parse_label(" 5 ") == 5
    assert parse_label("4 or 5") is None
    assert parse_label("") is None
    assert parse_label("6") is None


def test_clean_text_and_key():
    assert clean_text("\xa0 A  20-year-old\tmale ") == "A 20-year-old male"
    assert normalize_key("He's 20!") == normalize_key("he s   20")
    assert patient_id("A  b") == patient_id("a b")


def test_read_rows_rescues_glued_label_and_drops_ambiguous(tmp_path: Path):
    f = tmp_path / "Test-x"
    f.write_text(
        "Clinical Vignettes\tESI\n"
        "“I hurt my wrist,” says a 58-year-old woman.\t4\n"
        "A 12-year-old boy fell off his bike. No vomiting. 2\n"
        "Nursemaid elbow case\t4 or 5\n"
        "\n",
        encoding="utf-8",
    )
    rows = read_rows(f, vignette_col=0)
    assert [r.label for r in rows] == [4, 2, None]
    assert rows[1].vignette.endswith("No vomiting.")
    assert rows[0].vignette.startswith("“I hurt")


def test_extract_age():
    assert extract_age("a 56-year-old male") == 56
    assert extract_age("An 8-month-old presents") == round(8 / 12, 3)
    assert extract_age("a 38- year-old male") == 38
    assert extract_age("a 3–week-old infant") == round(3 / 52, 3)
    assert extract_age("an adult") is None


def test_extract_sex():
    assert extract_sex("A 41-year-old male involved in a bicycle accident") == "M"
    assert extract_sex("17-year-old female presents") == "F"
    assert extract_sex("the mother reports that her son has a cough") == "M"
    assert extract_sex("An 11-year-old presents with his mother, she says") is None
    assert extract_sex("A patient presents with a cough") is None


def test_extract_vitals():
    v = extract_vitals("Vital signs: RR 32, HR 96, BP 126/80, SpO2 93% on room air, T 98.6˚F.")
    assert (v.rr, v.hr, v.sbp, v.dbp, v.spo2, v.temp_f) == (32, 96, 126, 80, 93, 98.6)
    v = extract_vitals("VS: 118/78, HR 76, RR 14.")
    assert (v.sbp, v.dbp, v.hr) == (118, 78, 76)
    v = extract_vitals("heart rate is 130, blood pressure is 90/60, oxygen saturation is 92%")
    assert (v.hr, v.sbp, v.spo2) == (130, 90, 92)
    v = extract_vitals("T 38.5 C")
    assert v.temp_f == 101.3
    assert not extract_vitals("Vital signs are within normal limits.").any_present()


def _patients(levels: list[int]) -> list[Patient]:
    return [
        Patient(id=f"p-{i:03d}", vignette=f"case {i}", esi_true=l, split="test")
        for i, l in enumerate(levels)
    ]


def test_stratified_sample_is_seeded_and_covers_levels():
    pats = _patients([1] * 14 + [2] * 22 + [3] * 12 + [4] * 12 + [5] * 15)
    a = stratified_sample(pats, 20, seed=42)
    b = stratified_sample(pats, 20, seed=42)
    assert [p.id for p in a] == [p.id for p in b]
    assert len(a) == 20
    assert {p.esi_true for p in a} == {1, 2, 3, 4, 5}
    assert len({p.id for p in a}) == 20


def test_stratified_sample_returns_all_when_k_large():
    pats = _patients([1, 2, 3])
    assert len(stratified_sample(pats, 10, seed=0)) == 3
