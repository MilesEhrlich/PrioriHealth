import { interpolate, useCurrentFrame } from "remotion";
import { clamp, fade, Floor, Kicker, Scene } from "../common";
import { Nurse, Patient } from "../figures";
import { C } from "../theme";

const SPOTS = [260, 400, 540, 680, 820];

function Clock({ x, y }: { x: number; y: number }) {
  const frame = useCurrentFrame();
  const a = frame * 6;
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ position: "absolute", left: x, top: y }}>
      <circle cx="60" cy="60" r="52" fill={C.surface} stroke={C.ink} strokeWidth="3" />
      <line x1="60" y1="60" x2="60" y2="30" stroke={C.ink} strokeWidth="4" strokeLinecap="round" transform={`rotate(${a / 12} 60 60)`} />
      <line x1="60" y1="60" x2="60" y2="18" stroke={C.accent} strokeWidth="3" strokeLinecap="round" transform={`rotate(${a} 60 60)`} />
      <circle cx="60" cy="60" r="4" fill={C.ink} />
    </svg>
  );
}

export function Problem() {
  const frame = useCurrentFrame();
  return (
    <Scene id="problem">
      <Kicker>The challenge</Kicker>
      <Floor />
      <Clock x={1600} y={70} />
      {/* triage desk + nurse (nurse drawn first so the desk hides the legs) */}
      <Nurse x={1480} y={700} scale={1.25} style={{ opacity: fade(frame, 0) }} />
      <div style={{ position: "absolute", left: 1330, top: 640, width: 300, height: 120, border: `3px solid ${C.ink}`, borderBottom: "none", background: C.surface, opacity: fade(frame, 0) }} />
      <div style={{ position: "absolute", left: 1350, top: 660, fontSize: 22, color: C.muted, opacity: fade(frame, 0) }}>Triage</div>
      {SPOTS.map((spot, i) => {
        const start = 8 + i * 22;
        const t = interpolate(frame, [start, start + 40], [0, 1], clamp);
        const x = interpolate(t, [0, 1], [-120, spot]);
        const walking = t > 0 && t < 1;
        return <Patient key={i} x={x} y={760} scale={1.1} legs={walking ? Math.sin(frame / 3) : 0} />;
      })}
      <div
        style={{
          position: "absolute",
          left: 240,
          top: 420,
          fontSize: 40,
          fontWeight: 600,
          color: C.accent,
          opacity: fade(frame, 120, 15),
        }}
      >
        Who should be seen first?
      </div>
    </Scene>
  );
}
