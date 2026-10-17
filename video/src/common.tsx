import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import durations from "../voice/durations.json";
import script from "../voice/script.json";
import { C, FONT, FPS } from "./theme";

export const VOICE_DELAY = 12; // frames of silence before each line
export const TAIL = 48; // frames after each line finishes
export const TRANSITION = 15;

export type SceneId = keyof typeof durations;
export const voiceFrames = (id: SceneId) => Math.ceil(durations[id] * FPS);
export const sceneFrames = (id: SceneId) => VOICE_DELAY + voiceFrames(id) + TAIL;
export const lineFor = (id: SceneId) => script.scenes.find((s) => s.id === id)!.text;

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0→1 spring starting at `start` frames. */
export function usePop(start: number, damping = 14) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - start, fps, config: { damping, mass: 0.6 } });
}

export function fade(frame: number, start: number, len = 12) {
  return interpolate(frame, [start, start + len], [0, 1], clamp);
}

/** Lower-third caption that reveals the narration word by word in step with the voice. */
function Caption({ id }: { id: SceneId }) {
  const frame = useCurrentFrame();
  const words = lineFor(id).split(" ");
  const shown = interpolate(frame, [VOICE_DELAY, VOICE_DELAY + voiceFrames(id) * 0.92], [0, words.length], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 150,
        background: C.surface,
        borderTop: `1px solid ${C.line}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 160px",
      }}
    >
      <div style={{ fontFamily: FONT, fontSize: 36, lineHeight: 1.35, color: C.ink, textAlign: "center", maxWidth: 1500 }}>
        {words.map((w, i) => (
          <span key={i} style={{ opacity: i < shown ? 1 : 0.18, transition: "none" }}>
            {w}{" "}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Scene({ id, caption = true, children, background = C.page }: {
  id: SceneId;
  caption?: boolean;
  children: ReactNode;
  background?: string;
}) {
  return (
    <AbsoluteFill style={{ background, fontFamily: FONT, color: C.ink }}>
      <Sequence from={VOICE_DELAY} layout="none">
        <Audio src={staticFile(`voice/${id}.wav`)} />
      </Sequence>
      <AbsoluteFill style={{ bottom: caption ? 150 : 0, height: caption ? 930 : 1080 }}>{children}</AbsoluteFill>
      {caption && <Caption id={id} />}
    </AbsoluteFill>
  );
}

/** Small section label in the top-left corner of a scene. */
export function Kicker({ step, children }: { step?: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 80,
        opacity: fade(frame, 0, 15),
        transform: `translateY(${interpolate(fade(frame, 0, 15), [0, 1], [12, 0])}px)`,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      {step != null && (
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: 4,
            background: C.accent,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontWeight: 600,
            fontSize: 22,
          }}
        >
          {step}
        </span>
      )}
      <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.4, color: C.ink }}>{children}</span>
    </div>
  );
}

export function Floor({ y = 760 }: { y?: number }) {
  return <div style={{ position: "absolute", left: 80, right: 80, top: y, height: 3, background: C.line }} />;
}

export function Pos({ x, y, children, style }: { x: number; y: number; children: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: "absolute", left: x, top: y, ...style }}>{children}</div>;
}
