import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Fragment, type ComponentType } from "react";
import { sceneFrames, TRANSITION, type SceneId } from "./common";
import { Arrival } from "./scenes/Arrival";
import { Discussion } from "./scenes/Discussion";
import { Escalation } from "./scenes/Escalation";
import { Panel } from "./scenes/Panel";
import { Platform } from "./scenes/Platform";
import { Problem } from "./scenes/Problem";
import { Title } from "./scenes/Title";
import { Waiting } from "./scenes/Waiting";

export const SCENES: { id: SceneId; C: ComponentType; enter: "fade" | "slide" }[] = [
  { id: "title", C: Title, enter: "fade" },
  { id: "problem", C: Problem, enter: "fade" },
  { id: "arrival", C: Arrival, enter: "slide" },
  { id: "panel", C: Panel, enter: "slide" },
  { id: "discussion", C: Discussion, enter: "fade" },
  { id: "escalation", C: Escalation, enter: "slide" },
  { id: "waiting", C: Waiting, enter: "slide" },
  { id: "platform", C: Platform, enter: "fade" },
];

export const totalFrames = () => SCENES.reduce((n, s) => n + sceneFrames(s.id), 0) - TRANSITION * (SCENES.length - 1);

export function Overview() {
  return (
    <TransitionSeries>
      {SCENES.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && (
            <TransitionSeries.Transition
              presentation={s.enter === "slide" ? slide({ direction: "from-right" }) : fade()}
              timing={linearTiming({ durationInFrames: TRANSITION })}
            />
          )}
          <TransitionSeries.Sequence durationInFrames={sceneFrames(s.id)}>
            <s.C />
          </TransitionSeries.Sequence>
        </Fragment>
      ))}
    </TransitionSeries>
  );
}
