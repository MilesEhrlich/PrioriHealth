import { interpolate, useCurrentFrame } from "remotion";
import { clamp, fade, Floor, Kicker, Scene, usePop } from "../common";
import { NoteCard, Nurse, Patient } from "../figures";
import { C } from "../theme";

export function Arrival() {
  const frame = useCurrentFrame();
  const walk = interpolate(frame, [0, 30], [0, 1], clamp);
  const card = usePop(36);
  const typing = interpolate(frame, [44, 140], [0, 1], clamp);
  return (
    <Scene id="arrival">
      <Kicker step={1}>A patient arrives</Kicker>
      <Floor />
      <Patient x={interpolate(walk, [0, 1], [200, 470])} y={760} scale={1.3} legs={walk < 1 ? Math.sin(frame / 3) : 0} />
      <Nurse x={720} y={760} scale={1.3} />
      {/* arrow nurse -> note */}
      <svg width="220" height="40" style={{ position: "absolute", left: 830, top: 520, opacity: fade(frame, 30) }}>
        <path d="M4 20 H200 M184 8 L204 20 L184 32" fill="none" stroke={C.accent} strokeWidth="3" strokeLinecap="round" strokeDasharray="8 8" />
      </svg>
      <NoteCard
        progress={typing}
        width={560}
        style={{
          position: "absolute",
          left: 1100,
          top: 360,
          opacity: card,
          transform: `translateY(${interpolate(card, [0, 1], [40, 0])}px) scale(${interpolate(card, [0, 1], [0.94, 1])})`,
        }}
      />
    </Scene>
  );
}
