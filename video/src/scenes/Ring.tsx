import { interpolate } from "remotion";
import { EsiChip, Reviewer } from "../figures";
import { C } from "../theme";

export const ringPos = (i: number, cx: number, cy: number, r: number) => {
  const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
};

/** Ten reviewers in a ring with optional vote chips and connecting lines. */
export function Ring({ cx, cy, r, appear, votes, chipAppear, links = 0, size = 72 }: {
  cx: number;
  cy: number;
  r: number;
  appear: number[]; // 0..1 per reviewer
  votes: (number | null)[];
  chipAppear: number[];
  links?: number; // 0..1 opacity of discussion lines
  size?: number;
}) {
  return (
    <>
      <svg width="1920" height="930" style={{ position: "absolute", left: 0, top: 0, opacity: links }}>
        {Array.from({ length: 10 }, (_, i) => {
          const p = ringPos(i, cx, cy, r);
          const q = ringPos((i + 3) % 10, cx, cy, r);
          return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={C.sage} strokeWidth="2" strokeDasharray="6 8" />;
        })}
      </svg>
      {Array.from({ length: 10 }, (_, i) => {
        const p = ringPos(i, cx, cy, r);
        const out = ringPos(i, cx, cy, r + size * 0.95);
        const v = votes[i];
        return (
          <div key={i}>
            <div style={{ opacity: appear[i], transform: `scale(${interpolate(appear[i]!, [0, 1], [0.6, 1])})`, transformOrigin: `${p.x}px ${p.y}px`, position: "absolute", inset: 0 }}>
              <Reviewer x={p.x} y={p.y} size={size} />
            </div>
            {v != null && (
              <div
                style={{
                  position: "absolute",
                  left: out.x,
                  top: out.y,
                  transform: `translate(-50%, -50%) scale(${interpolate(chipAppear[i]!, [0, 1], [0.5, 1])})`,
                  opacity: chipAppear[i],
                }}
              >
                <EsiChip esi={v} size={34} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
