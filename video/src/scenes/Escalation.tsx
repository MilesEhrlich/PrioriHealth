import { interpolate, useCurrentFrame } from "remotion";
import { clamp, fade, Floor, Kicker, Scene, usePop } from "../common";
import { EsiChip, Nurse } from "../figures";
import { C } from "../theme";
import { Ring } from "./Ring";

const SPLIT = [2, 3, 3, 2, 3, 2, 3, 2, 3, 2];

export function Escalation() {
  const frame = useCurrentFrame();
  const tag = usePop(30);
  const move = interpolate(frame, [55, 95], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const confirm = usePop(120);
  const ring = { cx: 470, cy: 430, r: 200 };
  const cardX = interpolate(move, [0, 1], [ring.cx - 170, 1150]);
  const cardY = interpolate(move, [0, 1], [ring.cy - 70, 300]);
  return (
    <Scene id="escalation">
      <Kicker step={4}>No consensus? A nurse decides.</Kicker>
      <Ring {...ring} size={60} appear={Array(10).fill(1)} votes={SPLIT} chipAppear={Array(10).fill(1)} links={0.6} />
      <Floor y={780} />
      <Nurse x={1560} y={780} scale={1.3} />
      {/* case card */}
      <div
        style={{
          position: "absolute",
          left: cardX,
          top: cardY,
          width: 340,
          background: C.surface,
          border: `2px solid ${C.line}`,
          borderRadius: 4,
          padding: 20,
          boxShadow: "0 18px 40px -20px rgba(16,40,28,0.35)",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 600 }}>Patient 014</div>
        <div style={{ fontSize: 18, color: C.muted, marginTop: 4 }}>Shortness of breath</div>
        <div
          style={{
            marginTop: 14,
            display: "inline-block",
            background: C.review,
            color: C.reviewInk,
            border: "1px solid rgba(184,134,43,0.4)",
            borderRadius: 3,
            padding: "4px 10px",
            fontSize: 18,
            fontWeight: 500,
            opacity: tag,
            transform: `scale(${interpolate(tag, [0, 1], [0.7, 1])})`,
            transformOrigin: "left center",
          }}
        >
          Needs nurse review
        </div>
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, opacity: confirm, fontSize: 20 }}>
          <EsiChip esi={2} size={32} />
          <span style={{ color: C.accent, fontWeight: 600 }}>✓ Confirmed by nurse</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: ring.cx - 110, top: ring.cy + 290, fontSize: 24, color: C.muted, opacity: fade(frame, 20) }}>
        Split 5 – 5: no consensus
      </div>
    </Scene>
  );
}
