import { interpolate, useCurrentFrame } from "remotion";
import { clamp, fade, Kicker, Scene } from "../common";
import { EsiChip, NoteCard } from "../figures";
import { C } from "../theme";
import { FIRST_VOTES, RING } from "./Panel";
import { Ring } from "./Ring";

// Reviewers 1 and 4 revise from ESI 3 to ESI 2; reviewer 7 keeps ESI 3 -> 9 of 10 agree.
const CHANGES: Record<number, number> = { 1: 60, 4: 100 };

export function Discussion() {
  const frame = useCurrentFrame();
  const votes = FIRST_VOTES.map((v, i) => (CHANGES[i] != null && frame >= CHANGES[i]! ? 2 : v));
  const chipPulse = FIRST_VOTES.map((_, i) =>
    CHANGES[i] != null ? interpolate(frame, [CHANGES[i]! - 6, CHANGES[i]!, CHANGES[i]! + 8], [1, 0.4, 1], clamp) : 1,
  );
  const agree = votes.filter((v) => v === 2).length;
  const bar = agree / 10;
  const ring = { ...RING, cx: 760 };
  const done = fade(frame, 112, 14);
  return (
    <Scene id="discussion">
      <Kicker step={3}>Discussion until 90% agree</Kicker>
      <NoteCard progress={1} width={300} style={{ position: "absolute", left: ring.cx - 150, top: ring.cy - 95, transform: "scale(0.8)" }} />
      <Ring {...ring} appear={Array(10).fill(1)} votes={votes} chipAppear={chipPulse} links={fade(frame, 6, 20) * 0.9} />
      {/* agreement meter */}
      <div style={{ position: "absolute", left: 1300, top: 330, width: 460 }}>
        <div style={{ fontSize: 24, color: C.muted }}>Agreement</div>
        <div style={{ marginTop: 14, display: "flex", gap: 6 }}>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} style={{ flex: 1, height: 18, borderRadius: 2, background: i < agree ? C.accent : C.line }} />
          ))}
        </div>
        <div style={{ marginTop: 14, fontSize: 40, fontWeight: 600, fontFamily: "IBM Plex Mono, monospace" }}>{Math.round(bar * 100)}%</div>
        <div style={{ marginTop: 34, opacity: done, display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
          <EsiChip esi={2} size={44} />
          <span style={{ fontWeight: 600 }}>Consensus: Emergent</span>
        </div>
      </div>
    </Scene>
  );
}
