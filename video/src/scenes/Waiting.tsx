import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, Kicker, Scene } from "../common";
import { EsiChip } from "../figures";
import { C, MONO } from "../theme";

const ROWS = [
  { id: "A", esi: 3, label: "Patient 011", cc: "Abdominal pain", wait: 34 },
  { id: "B", esi: 4, label: "Patient 009", cc: "Ankle injury", wait: 52 },
  { id: "C", esi: 3, label: "Patient 012", cc: "Fever, cough", wait: 18 },
  { id: "D", esi: 5, label: "Patient 007", cc: "Medication refill", wait: 71 },
];
const NEW = { id: "N", esi: 2, label: "Patient 014", cc: "Shortness of breath", wait: 2 };
const ROW_H = 84;

export function Waiting() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = ROWS.map((_, i) => spring({ frame: frame - 8 - i * 7, fps, config: { damping: 16 } }));
  const newIn = spring({ frame: frame - 70, fps, config: { damping: 16 } });
  const rise = interpolate(frame, [95, 125], [0, 1], { ...clamp, easing: (t) => t * t * (3 - 2 * t) });
  const top = 250;
  const minutes = (w: number) => Math.floor(w + frame / 30);
  return (
    <Scene id="waiting">
      <Kicker step={5}>A live, prioritised waiting room</Kicker>
      <div style={{ position: "absolute", left: 360, top: 180, width: 1200 }}>
        <div style={{ display: "flex", fontSize: 20, color: C.muted, padding: "0 28px", height: 56, alignItems: "center" }}>
          <span style={{ width: 70 }}>#</span>
          <span style={{ width: 150 }}>Acuity</span>
          <span style={{ flex: 1 }}>Patient</span>
          <span style={{ width: 160, textAlign: "right" }}>Waiting</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 360, top: top - 14, width: 1200, height: ROW_H * 5 + 28, background: C.surface, border: `2px solid ${C.line}`, borderRadius: 4 }} />
      {[...ROWS, NEW].map((r, i) => {
        const isNew = r.id === "N";
        const slot = isNew ? interpolate(rise, [0, 1], [4, 0]) : i + rise;
        const a = isNew ? newIn : enter[i]!;
        return (
          <div
            key={r.id}
            style={{
              position: "absolute",
              left: 374,
              width: 1172,
              top: top + slot * ROW_H,
              height: ROW_H - 8,
              display: "flex",
              alignItems: "center",
              padding: "0 14px",
              fontSize: 28,
              opacity: a,
              transform: `translateY(${interpolate(a, [0, 1], [-24, 0])}px)`,
              background: isNew ? interpolate(rise, [0, 1], [0, 1]) > 0.01 ? C.accentSoft : C.surface : C.surface,
              borderBottom: `1px solid ${C.line}`,
            }}
          >
            <span style={{ width: 70, fontFamily: MONO, color: C.muted }}>{Math.round(slot) + 1}</span>
            <span style={{ width: 150 }}>
              <EsiChip esi={r.esi} size={36} />
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{r.label}</span>
              <span style={{ color: C.muted, marginLeft: 18, fontSize: 24 }}>{r.cc}</span>
            </span>
            <span style={{ width: 160, textAlign: "right", fontFamily: MONO }}>{minutes(r.wait)} min</span>
          </div>
        );
      })}
    </Scene>
  );
}
