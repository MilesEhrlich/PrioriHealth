"""Counterfactual sex-swap check: does the triage decision change when only the patient's
sex is flipped in the vignette?

Only cases where the swap is unambiguous are used:
- the patient's sex is stated,
- no sex-specific clinical content (pregnancy, testicular pain, ...), where a swap would
  change the medicine rather than test bias,
- no gendered companion (mother, husband, ...), because pronouns could then refer to the
  companion and a regex swap could garble the story.
Race is never stated in this benchmark, so only sex is swapped.
"""

from __future__ import annotations

import asyncio
import random
import re
from typing import Any

import pandas as pd

from .data import extract_sex, patient_id
from .schemas import Patient

SEX_SPECIFIC = re.compile(
    r"pregnan|ectopic|testic|scrot|ovar|menstru|period|vagin|uter|cervi|penis|penile|prostat|"
    r"breast|birth control|contracept|condom|gyn|obstet|miscarr|postpartum|abortion|erectile|"
    r"\blmp\b|sexual", re.I)
GENDERED_COMPANION = re.compile(
    r"\b(mother|mom|father|dad|grand(?:mother|father|ma|pa)|wife|husband|girlfriend|boyfriend|"
    r"sister|brother|aunt|uncle|daughter|son|niece|nephew|stepfather|stepmother)\b", re.I)

_PAIRS = {
    "male": "female", "man": "woman", "boy": "girl", "gentleman": "lady", "mr": "ms",
    "he": "she", "himself": "herself", "males": "females", "men": "women", "boys": "girls",
}
_PAIRS.update({v: k for k, v in list(_PAIRS.items())})
_FOLLOWERS_OBJECT = {"to", "and", "in", "that", "the", "a", "an", "with", "for", "from", "at",
                     "on", "up", "out", "down", "off", "back", "as", "if", "when", "but", "or",
                     "because", "into", "about", "over", "by", "home", "again", "", "is", "was"}
_WORD = re.compile(r"[A-Za-z]+|[^A-Za-z]+")


def _match_case(src: str, dst: str) -> str:
    if src.isupper() and len(src) > 1:
        return dst.upper()
    if src[:1].isupper():
        return dst[:1].upper() + dst[1:]
    return dst


def swap_sex(text: str) -> str:
    """Swap the patient's sex terms and pronouns ("his" <-> "her", "him" <-> "her").

    "her" is ambiguous (object vs possessive); it becomes "his" when followed by a word
    that is not a preposition/article-like token, otherwise "him".
    """
    tokens = _WORD.findall(text)
    out = []
    for i, tok in enumerate(tokens):
        low = tok.lower()
        if low in _PAIRS:
            out.append(_match_case(tok, _PAIRS[low]))
        elif low == "his":
            nxt = tokens[i + 2].lower() if i + 2 < len(tokens) and tokens[i + 1] == " " else ""
            out.append(_match_case(tok, "her" if nxt and nxt not in _FOLLOWERS_OBJECT else "hers"))
        elif low == "him":
            out.append(_match_case(tok, "her"))
        elif low == "her":
            nxt = tokens[i + 2].lower() if i + 2 < len(tokens) and tokens[i + 1] == " " else ""
            out.append(_match_case(tok, "his" if nxt and nxt not in _FOLLOWERS_OBJECT else "him"))
        elif low == "hers":
            out.append(_match_case(tok, "his"))
        else:
            out.append(tok)
    return "".join(out)


def is_swappable(p: Patient) -> bool:
    """True when a sex swap is unambiguous and clinically neutral for this vignette."""
    return (p.sex is not None and not SEX_SPECIFIC.search(p.vignette)
            and not GENDERED_COMPANION.search(p.vignette))


def counterfactual(p: Patient) -> Patient:
    """The same patient with sex swapped (new id, same ground truth)."""
    text = swap_sex(p.vignette)
    sex = extract_sex(text)
    return p.model_copy(update={"id": patient_id(text), "vignette": text, "sex": sex})


def select_cases(test: list[Patient], n: int, seed: int) -> list[Patient]:
    """Up to n swappable test patients, chosen with a fixed seed."""
    pool = sorted([p for p in test if is_swappable(p)], key=lambda p: p.id)
    random.Random(seed + 7).shuffle(pool)
    return sorted(pool[:n], key=lambda p: p.id)


async def run_fairness(run_condition, patients: list[Patient]) -> pd.DataFrame:
    """Run a condition on originals and their swaps; one row per pair.

    `run_condition(list[Patient]) -> DataFrame` with columns patient_id, pred.
    """
    swaps = [counterfactual(p) for p in patients]
    orig_df, swap_df = await asyncio.gather(run_condition(patients), run_condition(swaps))
    o = orig_df.set_index("patient_id")["pred"]
    s = swap_df.set_index("patient_id")["pred"]
    rows: list[dict[str, Any]] = []
    for p, q in zip(patients, swaps):
        a, b = o.get(p.id), s.get(q.id)
        rows.append({"patient_id": p.id, "esi_true": p.esi_true, "sex_original": p.sex,
                     "pred_original": a, "pred_swapped": b,
                     "flipped": pd.notna(a) and pd.notna(b) and a != b,
                     "swap_more_urgent": pd.notna(a) and pd.notna(b) and b < a})
    return pd.DataFrame(rows)


def flip_summary(df: pd.DataFrame) -> dict[str, float]:
    """Flip rate and direction for one condition."""
    n = len(df)
    return {"n_pairs": n, "flip_rate": float(df["flipped"].mean()) if n else float("nan"),
            "flips": int(df["flipped"].sum()),
            "swap_more_urgent": int(df["swap_more_urgent"].sum())}
