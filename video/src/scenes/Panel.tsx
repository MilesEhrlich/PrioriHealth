import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, Kicker, Scene } from "../common";
import { NoteCard } from "../figures";
import { Ring } from "./Ring";

export const FIRST_VOTES = [2, 3, 2, 2, 3, 2, 2, 3, 2, 2];
export const RING = { cx: 960, cy: 470, r: 290 };

export function Panel() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const note = interpolate(frame, [0, 24], [0, 1], clamp);
  const appear = FIRST_VOTES.map((_, i) => spring({ frame: frame - 18 - i * 5, fps, config: { damping: 14, mass: 0.6 } }));
  const chips = FIRST_VOTES.map((_, i) => spring({ frame: frame - 80 - i * 6, fps, config: { damping: 12, mass: 0.5 } }));
  return (
    <Scene id="panel">
      <Kicker step={2}>Ten independent reviews</Kicker>
      <NoteCard
        progress={1}
        width={300}
        style={{
          position: "absolute",
          left: RING.cx - 150,
          top: RING.cy - 95,
          opacity: note,
          transform: `scale(${interpolate(note, [0, 1], [1.4, 0.8])})`,
        }}
      />
      <Ring {...RING} appear={appear} votes={FIRST_VOTES} chipAppear={chips} />
    </Scene>
  );
}
