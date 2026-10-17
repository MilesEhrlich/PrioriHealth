import { interpolate, useCurrentFrame } from "remotion";
import marks from "../../voice/marks.json";
import { clamp, fade, Scene, usePop, VOICE_DELAY } from "../common";
import { FPS } from "../theme";
import { LogoMark } from "../figures";
import { C } from "../theme";

function Server({ x, y }: { x: number; y: number }) {
  return (
    <svg width="260" height="340" viewBox="0 0 260 340" style={{ position: "absolute", left: x, top: y }}>
      <rect x="10" y="10" width="240" height="320" rx="4" fill={C.surface} stroke={C.ink} strokeWidth="3" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="34" y={40 + i * 66} width="192" height="46" rx="2" fill="none" stroke={C.lineStrong} strokeWidth="3" />
          <circle cx="200" cy={63 + i * 66} r="6" fill={C.accent} />
        </g>
      ))}
    </svg>
  );
}

function Lock({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <svg width="90" height="110" viewBox="0 0 90 110" style={{ position: "absolute", left: x, top: y, opacity: s, transform: `scale(${s})` }}>
      <path d="M22 50 V32 Q22 10 45 10 Q68 10 68 32 V50" fill="none" stroke={C.accent} strokeWidth="6" />
      <rect x="8" y="48" width="74" height="56" rx="4" fill={C.accent} />
      <circle cx="45" cy="74" r="7" fill="#fff" />
    </svg>
  );
}

export function Platform() {
  const frame = useCurrentFrame();
  // Switch to the closing card when the first sentence ("It all runs privately on IBM LinuxONE.") ends.
  const cut = VOICE_DELAY + Math.round(marks.platform * FPS);
  const out = interpolate(frame, [cut - 12, cut + 6], [1, 0], clamp);
  const close = fade(frame, cut, 18);
  const lock = usePop(30);
  return (
    <Scene id="platform" caption={false} background={`linear-gradient(180deg, #E8F0E8 0%, ${C.page} 70%)`}>
      <div style={{ position: "absolute", inset: 0, opacity: out }}>
        <Server x={560} y={300} />
        <Lock x={770} y={250} s={lock} />
        <div style={{ position: "absolute", left: 920, top: 360, opacity: fade(frame, 10, 16) }}>
          <div style={{ fontSize: 56, fontWeight: 600, letterSpacing: -1 }}>IBM LinuxONE</div>
          <div style={{ marginTop: 14, fontSize: 30, color: C.muted, lineHeight: 1.5 }}>
            IBM Granite models · on-chip AI accelerator
            <br />
            Triage notes never leave the server
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: close }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <LogoMark size={96} />
          <span style={{ fontSize: 80, fontWeight: 600, letterSpacing: -1.6 }}>PrioriHealth</span>
        </div>
        <div style={{ marginTop: 22, fontSize: 32, color: C.muted }}>Decision support that keeps clinicians in charge.</div>
        <div style={{ marginTop: 40, fontSize: 28, color: C.accent, fontFamily: "IBM Plex Mono, monospace" }}>priorihealth.miles-ehrlich.com</div>
      </div>
    </Scene>
  );
}
