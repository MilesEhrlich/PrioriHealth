// Generate one voiceover clip per scene with the macOS built-in voice (free, offline).
//   node scripts/make-voice.mjs
// Writes public/voice/<id>.wav and voice/durations.json (seconds per clip).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const { say_fallback: { voice, rate }, scenes } = JSON.parse(readFileSync("voice/script.json", "utf8"));
mkdirSync("public/voice", { recursive: true });

const durations = {};
for (const s of scenes) {
  const aiff = `public/voice/${s.id}.aiff`;
  const wav = `public/voice/${s.id}.wav`;
  execFileSync("say", ["-v", voice, "-r", String(rate), "-o", aiff, s.say ?? s.text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@44100", aiff, wav]);
  rmSync(aiff);
  const info = execFileSync("afinfo", [wav], { encoding: "utf8" });
  durations[s.id] = Number(/estimated duration: ([\d.]+)/.exec(info)[1]);
  console.log(`${s.id.padEnd(12)} ${durations[s.id].toFixed(2)} s`);
}
writeFileSync("voice/durations.json", JSON.stringify(durations, null, 2) + "\n");
const total = Object.values(durations).reduce((a, b) => a + b, 0);
console.log(`total voice  ${total.toFixed(1)} s`);
