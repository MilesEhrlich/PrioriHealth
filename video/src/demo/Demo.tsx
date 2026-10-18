import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Fragment, type ComponentType } from "react";
import { sceneFrames, TRANSITION, type DemoId } from "./common";
import * as S from "./Scenes";

const SCENES: { id: DemoId; C: ComponentType; enter: "fade" | "slide" }[] = [
  { id: "intro", C: S.Intro, enter: "fade" },
  { id: "problem", C: S.Problem, enter: "fade" },
  { id: "solution", C: S.Solution, enter: "fade" },
  { id: "landing", C: S.Landing, enter: "fade" },
  { id: "dashboard", C: S.Dashboard, enter: "fade" },
  { id: "waiting", C: S.Waiting, enter: "fade" },
  { id: "review", C: S.Review, enter: "fade" },
  { id: "nurse", C: S.Nurse, enter: "fade" },
  { id: "patient", C: S.Patient, enter: "slide" },
  { id: "evaluation", C: S.Evaluation, enter: "slide" },
  { id: "platform", C: S.Platform, enter: "slide" },
  { id: "impact", C: S.Impact, enter: "fade" },
  { id: "outro", C: S.Outro, enter: "fade" },
];

export const demoFrames = () => SCENES.reduce((n, s) => n + sceneFrames(s.id), 0) - TRANSITION * (SCENES.length - 1);

export function Demo() {
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
