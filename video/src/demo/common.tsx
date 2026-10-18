import type { ReactNode } from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import durations from "../../voice/demo-durations.json";
import script from "../../voice/demo-script.json";
import { clamp } from "../common";
import { C, FONT, FPS } from "../theme";

export const VOICE_DELAY = 12;
export const TAIL = 30;
export const TRANSITION = 15;
export const CAPTION_H = 150;

export type DemoId = keyof typeof durations;
export const voiceFrames = (id: DemoId) => Math.ceil(durations[id] * FPS);
export const sceneFrames = (id: DemoId) => VOICE_DELAY + voiceFrames(id) + TAIL;
const lineFor = (id: DemoId) => script.scenes.find((s) => s.id === id)!.text;

function Caption({ id }: { id: DemoId }) {
  const frame = useCurrentFrame();
  const words = lineFor(id).split(" ");
  const shown = interpolate(frame, [VOICE_DELAY, VOICE_DELAY + voiceFrames(id) * 0.92], [0, words.length], clamp);
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: CAPTION_H, background: C.surface,
        borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 140px",
      }}
    >
      <div style={{ fontFamily: FONT, fontSize: 34, lineHeight: 1.35, color: C.ink, textAlign: "center", maxWidth: 1600 }}>
        {words.map((w, i) => (
          <span key={i} style={{ opacity: i < shown ? 1 : 0.18 }}>
            {w}{" "}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One narrated demo scene: its voice clip, a 930px content area and a word-by-word caption. */
export function DemoScene({ id, caption = true, background = C.page, children }: {
  id: DemoId;
  caption?: boolean;
  background?: string;
  children: ReactNode;
}) {
  return (
    <AbsoluteFill style={{ background, fontFamily: FONT, color: C.ink }}>
      <Sequence from={VOICE_DELAY} layout="none">
        <Audio src={staticFile(`voice/demo/${id}.wav`)} />
      </Sequence>
      <AbsoluteFill style={{ height: caption ? 1080 - CAPTION_H : 1080 }}>{children}</AbsoluteFill>
      {caption && <Caption id={id} />}
    </AbsoluteFill>
  );
}

/** Frame at which a fraction (0..1) of this scene's narration has been spoken. */
export const at = (id: DemoId, fraction: number) => VOICE_DELAY + Math.round(voiceFrames(id) * fraction);
