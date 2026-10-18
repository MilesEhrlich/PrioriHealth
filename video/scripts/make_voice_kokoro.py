"""Generate the narration with Kokoro, a free open-source neural voice that runs locally.

    uv run --with kokoro-onnx==0.4.9 --with soundfile python scripts/make_voice_kokoro.py [name]

name = "" for the overview (voice/script.json) or "demo" (voice/demo-script.json).

Model files live in video/.models (see README). Writes public/voice/<id>.wav and
voice/durations.json, the same outputs as make-voice.mjs (the macOS `say` fallback).
"""

import json
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
NAME = sys.argv[1] if len(sys.argv) > 1 else ""
PREFIX = f"{NAME}-" if NAME else ""
cfg = json.loads((ROOT / "voice" / f"{PREFIX}script.json").read_text())
k = cfg["kokoro"]
tts = Kokoro(str(ROOT / ".models" / "kokoro-v1.0.onnx"), str(ROOT / ".models" / "voices-v1.0.bin"))

out = ROOT / "public" / "voice" / NAME if NAME else ROOT / "public" / "voice"
out.mkdir(parents=True, exist_ok=True)
durations = {}
marks = {}  # seconds into a clip where a leading phrase ends (scene cues)
def phonemes(text: str) -> str:
    """Phonemize a line, swapping in hand-written IPA for words listed under "pronounce"."""
    ipa = tts.tokenizer.phonemize(text, "en-us")
    for word, fixed in cfg.get("pronounce", {}).items():
        default = tts.tokenizer.phonemize(word, "en-us").strip(" .")
        ipa = ipa.replace(default, fixed)
    return ipa


for s in cfg["scenes"]:
    samples, rate = tts.create(phonemes(s.get("say", s["text"])), voice=k["voice"], speed=k["speed"], lang="en-us", is_phonemes=True)
    sf.write(out / f"{s['id']}.wav", samples, rate)
    durations[s["id"]] = round(len(samples) / rate, 3)
    print(f"{s['id']:<12} {durations[s['id']]:.2f} s")
    if "mark" in s:
        head, _ = tts.create(phonemes(s["mark"]), voice=k["voice"], speed=k["speed"], lang="en-us", is_phonemes=True)
        marks[s["id"]] = round(len(head) / rate, 3)

(ROOT / "voice" / f"{PREFIX}durations.json").write_text(json.dumps(durations, indent=2) + "\n")
(ROOT / "voice" / f"{PREFIX}marks.json").write_text(json.dumps(marks, indent=2) + "\n")
print(f"total voice  {sum(durations.values()):.1f} s")
