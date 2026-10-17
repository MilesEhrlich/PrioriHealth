import { interpolate, useCurrentFrame } from "remotion";
import { clamp, fade, Scene } from "../common";
import { LogoMark } from "../figures";
import { C } from "../theme";

export function Title() {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [4, 34], [0, 1], clamp);
  const word = fade(frame, 22, 16);
  const tag = fade(frame, 40, 16);
  return (
    <Scene id="title" caption={false} background={`linear-gradient(180deg, #E8F0E8 0%, ${C.page} 70%)`}>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <LogoMark size={120} draw={draw} />
          <span
            style={{
              fontSize: 96,
              fontWeight: 600,
              letterSpacing: -2,
              opacity: word,
              transform: `translateX(${interpolate(word, [0, 1], [-20, 0])}px)`,
            }}
          >
            PrioriHealth
          </span>
        </div>
        <div style={{ marginTop: 28, fontSize: 38, color: C.muted, opacity: tag, transform: `translateY(${interpolate(tag, [0, 1], [14, 0])}px)` }}>
          Emergency triage support, with a nurse in the loop.
        </div>
      </div>
    </Scene>
  );
}
