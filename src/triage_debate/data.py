"""Load the TriageAgent ESI benchmark into `Patient` objects.

The released files are tab-separated text with no extension. Known quirks handled here:
curly/unbalanced quotes (so CSV quoting is disabled), a few rows where the ESI label is
glued onto the end of the vignette, ambiguous labels like "4 or 5", heavy overlap between
the three test files, and some test vignettes that also appear in the train file.
"""

from __future__ import annotations

import difflib
import hashlib
import random
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import resolve
from .schemas import Patient, Vitals

# ---------------------------------------------------------------- text helpers

_WS = re.compile(r"\s+")
_TRAILING_LABEL = re.compile(r"^(.*\S)\s+([1-5])\s*$", re.S)


def clean_text(text: str) -> str:
    """Normalize whitespace and strip stray quote characters at the ends."""
    text = text.replace("\xa0", " ").replace("​", "")
    text = _WS.sub(" ", text).strip()
    text = text.strip('"').strip()
    return text


def normalize_key(text: str) -> str:
    """Lowercase alphanumeric-only form used for exact de-duplication."""
    return _WS.sub(" ", re.sub(r"[^a-z0-9]+", " ", text.lower())).strip()


def patient_id(text: str) -> str:
    """Stable short id derived from the normalized vignette."""
    return "p-" + hashlib.sha1(normalize_key(text).encode()).hexdigest()[:6]


def parse_label(raw: str) -> int | None:
    """Return the ESI label 1-5, or None if missing or ambiguous (e.g. "4 or 5")."""
    raw = raw.strip()
    return int(raw) if re.fullmatch(r"[1-5]", raw) else None


# ---------------------------------------------------------------- field extraction

_AGE = re.compile(
    r"(\d+(?:\.\d+)?)\s*[-–]?\s*(year|yr|month|mo|week|wk|day)s?\s*[-–]?\s*old", re.I
)
_AGE_UNIT_YEARS = {"year": 1.0, "yr": 1.0, "month": 1 / 12, "mo": 1 / 12,
                   "week": 1 / 52, "wk": 1 / 52, "day": 1 / 365}

_MALE_NOUNS = r"male|man|boy|gentleman|son|husband|father|he|him|his"
_FEMALE_NOUNS = r"female|woman|girl|lady|daughter|wife|she|her|hers"
# Noun right after an age phrase ("56-year-old male") is the most reliable cue.
_AGE_SEX = re.compile(
    r"(?:year|yr|month|mo|week|wk|day)s?\s*[-–]?\s*old\s+(?:\w+\s+){0,3}?"
    r"(male|man|boy|gentleman|female|woman|girl|lady)\b", re.I
)
_OWN_CHILD = re.compile(r"\b(?:her|his|their|my)\s+(son|daughter|baby boy|baby girl)\b", re.I)
_SEX_WORD = re.compile(rf"\b({_MALE_NOUNS}|{_FEMALE_NOUNS})\b", re.I)
_COMPANION = re.compile(r"\b(mother|mom|father|dad|parents?|wife|husband|boyfriend|girlfriend|roommate|sister|brother)\b", re.I)


def extract_age(text: str) -> float | None:
    """Age in years from phrases like '56-year-old' or '8-month-old'."""
    m = _AGE.search(text)
    if not m:
        return None
    unit = m.group(2).lower()
    return round(float(m.group(1)) * _AGE_UNIT_YEARS[unit], 3)


def extract_sex(text: str) -> str | None:
    """Patient sex ('M'/'F') or None when not stated or ambiguous.

    Prefers the noun attached to the age phrase. Otherwise counts sex words, but only
    when the vignette has no companion mentions that would make pronouns ambiguous.
    """
    m = _AGE_SEX.search(text)
    if m is None:
        m = _OWN_CHILD.search(text)
    if m:
        return "M" if m.group(1).lower() in {"male", "man", "boy", "gentleman", "son", "baby boy"} else "F"
    words = [w.lower() for w in _SEX_WORD.findall(text)]
    male = sum(w in _MALE_NOUNS.split("|") for w in words)
    female = sum(w in _FEMALE_NOUNS.split("|") for w in words)
    if _COMPANION.search(text) and male and female:
        return None
    if male and not female:
        return "M"
    if female and not male:
        return "F"
    return None


_NUM = r"(\d{1,3}(?:\.\d)?)"
_BP = re.compile(r"(?:\bBP|blood pressure(?: (?:is|of))?|\bVS)\s*:?\s*(\d{2,3})\s*/\s*(\d{2,3})", re.I)
_HR = re.compile(r"(?:\bHR|heart rate(?: (?:is|of))?|\bpulse(?: rate)?(?: (?:is|of))?|\bP)\s*:?\s*(\d{2,3})\b", re.I)
_RR = re.compile(r"(?:\bRR|respiratory rate(?: (?:is|of))?|\bresp(?:irations)?)\s*:?\s*(\d{1,2})\b", re.I)
_SPO2 = re.compile(r"(?:SpO2|SpO₂|SaO2|O2 sat(?:uration)?|oxygen saturation(?: (?:is|of))?|pulse ox(?:imetry)?)\s*:?\s*(\d{2,3})\s*%", re.I)
_TEMP = re.compile(r"(?:\bT|\btemp(?:erature)?(?: (?:is|of))?)\s*:?\s*" + _NUM + r"\s*[°˚º]?\s*([FC])\b")


def extract_vitals(text: str) -> Vitals:
    """Parse BP, HR, RR, SpO2 and temperature (converted to °F) from free text."""
    v = Vitals()
    if m := _BP.search(text):
        v.sbp, v.dbp = int(m.group(1)), int(m.group(2))
    if m := _HR.search(text):
        v.hr = int(m.group(1))
    if m := _RR.search(text):
        v.rr = int(m.group(1))
    if m := _SPO2.search(text):
        v.spo2 = int(m.group(1))
    if m := _TEMP.search(text):
        t = float(m.group(1))
        v.temp_f = round(t * 9 / 5 + 32, 1) if m.group(2).upper() == "C" else t
    return v


_CC_PATTERNS = [
    re.compile(r"(?:complain(?:s|ing)? of|c/o)\s+([^.;:,]{3,60})", re.I),
    re.compile(r"presents?(?: to [\w ]+?)? with\s+(?:a |an )?([^.;:,]{3,60})", re.I),
    re.compile(r"\b(?:after|following)\s+((?:being |a |an )?[^.;:,]{3,60})", re.I),
    re.compile(r"\bfor\s+((?:a |an )?[^.;:,]{3,40})", re.I),
]
_QUOTE = re.compile(r"^[“\"]?([^”\"]{8,80})[”\"]")


def extract_chief_complaint(text: str, max_len: int = 60) -> str:
    """Short heuristic chief complaint for the queue table (display only)."""
    for pat in _CC_PATTERNS:
        if m := pat.search(text):
            cc = m.group(1)
            break
    else:
        m = _QUOTE.match(text)
        cc = m.group(1) if m else re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]
    cc = cc.strip("“”\"' ,.")
    cc = cc[:1].upper() + cc[1:]
    return cc if len(cc) <= max_len else cc[: max_len - 1].rstrip() + "…"


# ---------------------------------------------------------------- file parsing

@dataclass
class RawRow:
    vignette: str
    label: int | None
    source: str
    explanation: str | None = None


def read_rows(path: Path, vignette_col: int, label_col: int = -1,
              explanation_col: int | None = None) -> list[RawRow]:
    """Read one TSV file without CSV quoting, rescuing labels glued to the vignette."""
    lines = path.read_text(encoding="utf-8").splitlines()
    rows = [line.split("\t") for line in lines if line.strip()]
    rows = rows[1:]  # header
    out: list[RawRow] = []
    for cells in rows:
        if len(cells) > max(vignette_col, abs(label_col) - 1):
            vignette, label = cells[vignette_col], parse_label(cells[label_col])
        else:
            vignette, label = cells[0], None
        if label is None and (m := _TRAILING_LABEL.match(vignette.strip())):
            vignette, label = m.group(1), int(m.group(2))
        expl = cells[explanation_col] if explanation_col is not None and len(cells) > explanation_col else None
        vignette = clean_text(vignette)
        if vignette:
            out.append(RawRow(vignette, label, path.name, clean_text(expl) if expl else None))
    return out


# ---------------------------------------------------------------- dataset assembly

@dataclass
class LoadReport:
    """Counts describing what the loader kept and dropped, for transparency."""

    raw_rows: dict[str, int] = field(default_factory=dict)
    dropped_bad_label: list[str] = field(default_factory=list)
    dropped_conflicting_label: list[str] = field(default_factory=list)
    test_duplicates_merged: int = 0
    train_dropped_overlap: int = 0
    n_test: int = 0
    n_train: int = 0
    test_label_counts: dict[int, int] = field(default_factory=dict)
    train_label_counts: dict[int, int] = field(default_factory=dict)
    coverage: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def _similar(a: str, b: str, ratio: float) -> bool:
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    return sm.quick_ratio() >= ratio and sm.ratio() >= ratio


def _dedupe(rows: list[RawRow], ratio: float, report: LoadReport) -> list[RawRow]:
    """Merge exact and near-duplicate vignettes; drop groups whose labels disagree."""
    groups: list[list[RawRow]] = []
    keys: list[str] = []
    for row in rows:
        key = normalize_key(row.vignette)
        for i, k in enumerate(keys):
            if k == key or _similar(k, key, ratio):
                groups[i].append(row)
                break
        else:
            groups.append([row])
            keys.append(key)
    kept: list[RawRow] = []
    for g in groups:
        labels = {r.label for r in g}
        if len(labels) > 1:
            report.dropped_conflicting_label.append(g[0].vignette[:80])
            continue
        report.test_duplicates_merged += len(g) - 1
        # Keep the longest wording (usually the most complete copy).
        best = max(g, key=lambda r: len(r.vignette))
        best.source = "+".join(sorted({r.source for r in g}))
        kept.append(best)
    return kept


_CC_FILE = resolve("data/chief_complaints.json")
_CC_CACHE: dict[str, str] | None = None


def generated_chief_complaints() -> dict[str, str]:
    """Display-only chief complaints written once by scripts/make_chief_complaints.py."""
    global _CC_CACHE
    if _CC_CACHE is None:
        import json

        _CC_CACHE = json.loads(_CC_FILE.read_text()) if _CC_FILE.exists() else {}
    return _CC_CACHE


def _to_patient(row: RawRow, split: str) -> Patient:
    pid = patient_id(row.vignette)
    return Patient(
        id=pid,
        vignette=row.vignette,
        vitals=extract_vitals(row.vignette),
        age_years=extract_age(row.vignette),
        sex=extract_sex(row.vignette),
        race=None,  # the benchmark never states race
        esi_true=row.label,
        split=split,
        chief_complaint=generated_chief_complaints().get(pid) or extract_chief_complaint(row.vignette),
        source=row.source,
        explanation=row.explanation,
    )


def load_dataset(cfg: dict[str, Any]) -> tuple[list[Patient], list[Patient], LoadReport]:
    """Load (test, train, report). Test is the de-duplicated union of the test files;
    train is Train_scenario minus anything that matches a test vignette."""
    dcfg = cfg["data"]
    raw_dir = resolve(dcfg["raw_dir"]) / "datasets"
    if not raw_dir.exists():
        raise FileNotFoundError(f"{raw_dir} not found. Run: uv run python scripts/download_data.py")
    ratio = float(dcfg.get("near_duplicate_ratio", 0.9))
    report = LoadReport()

    test_rows: list[RawRow] = []
    for name in dcfg["test_files"]:
        rows = read_rows(raw_dir / name, vignette_col=0)
        report.raw_rows[name] = len(rows)
        test_rows.extend(rows)
    train_rows = read_rows(raw_dir / dcfg["train_file"], vignette_col=1, explanation_col=2)
    report.raw_rows[dcfg["train_file"]] = len(train_rows)

    def drop_bad(rows: list[RawRow]) -> list[RawRow]:
        good = [r for r in rows if r.label is not None]
        report.dropped_bad_label += [f"{r.source}: {r.vignette[:80]}" for r in rows if r.label is None]
        return good

    test_rows = _dedupe(drop_bad(test_rows), ratio, report)
    merged_test = report.test_duplicates_merged
    train_rows = drop_bad(train_rows)
    train_unique = _dedupe(train_rows, ratio, report)
    report.test_duplicates_merged = merged_test  # only report test merges here

    test_keys = [normalize_key(r.vignette) for r in test_rows]
    train_kept = []
    for r in train_unique:
        k = normalize_key(r.vignette)
        if any(k == t or _similar(k, t, ratio) for t in test_keys):
            report.train_dropped_overlap += 1
        else:
            train_kept.append(r)

    test = [_to_patient(r, "test") for r in test_rows]
    train = [_to_patient(r, "train") for r in train_kept]
    test.sort(key=lambda p: p.id)
    train.sort(key=lambda p: p.id)

    report.n_test, report.n_train = len(test), len(train)
    report.test_label_counts = dict(sorted(Counter(p.esi_true for p in test).items()))
    report.train_label_counts = dict(sorted(Counter(p.esi_true for p in train).items()))
    n = max(len(test), 1)
    report.coverage = {
        "age": round(sum(p.age_years is not None for p in test) / n, 2),
        "sex": round(sum(p.sex is not None for p in test) / n, 2),
        "any_vitals": round(sum(p.vitals.any_present() for p in test) / n, 2),
        "race": 0.0,
    }
    return test, train, report


def stratified_sample(patients: list[Patient], k: int, seed: int) -> list[Patient]:
    """Seeded sample of k patients that keeps every ESI level represented.

    Each level gets at least min(2, available) slots, then the remainder is filled
    proportionally to level frequency. Returns patients sorted by id.
    """
    if k >= len(patients):
        return sorted(patients, key=lambda p: p.id)
    rng = random.Random(seed)
    by_level: dict[int, list[Patient]] = defaultdict(list)
    for p in sorted(patients, key=lambda p: p.id):
        by_level[p.esi_true].append(p)
    for lst in by_level.values():
        rng.shuffle(lst)
    alloc = {lvl: min(2, len(lst)) for lvl, lst in by_level.items()}
    remaining = k - sum(alloc.values())
    total = len(patients)
    # Largest-remainder proportional fill.
    shares = {lvl: len(lst) / total * remaining for lvl, lst in by_level.items()}
    for lvl, s in shares.items():
        alloc[lvl] = min(len(by_level[lvl]), alloc[lvl] + int(s))
    order = sorted(by_level, key=lambda l: (-(shares[l] % 1), l))
    i = 0
    while sum(alloc.values()) < k and i < 10 * len(order):
        lvl = order[i % len(order)]
        if alloc[lvl] < len(by_level[lvl]):
            alloc[lvl] += 1
        i += 1
    chosen = [p for lvl, lst in by_level.items() for p in lst[: alloc[lvl]]]
    return sorted(chosen, key=lambda p: p.id)


def select_patients(test: list[Patient], cfg: dict[str, Any], full: bool) -> list[Patient]:
    """The test patients for a run: all of them with --full, else the seeded sample."""
    if full:
        return sorted(test, key=lambda p: p.id)
    return stratified_sample(test, int(cfg["data"]["sample_size"]), int(cfg["seed"]))


def few_shot_examples(train: list[Patient], k: int, seed: int) -> list[Patient]:
    """k train examples spread across ESI levels (never from test)."""
    if k <= 0:
        return []
    assert all(p.split == "train" for p in train)
    return stratified_sample(train, k, seed + 1) if k >= 5 else random.Random(seed + 1).sample(
        sorted(train, key=lambda p: p.id), k
    )


def example_cases(train: list[Patient], n: int = 8) -> list[Patient]:
    """A fixed spread of training cases offered as live-demo examples (never test cases)."""
    ordered = sorted(train, key=lambda p: (p.esi_true, p.id))
    return ordered[:: max(1, len(ordered) // n)][:n]
