import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import shots from "../../public/demo/shots.json";
import { clamp, fade, usePop } from "../common";
import { LogoMark, Wordmark } from "../figures";
import { DiscussionVisual } from "../scenes/Discussion";
import { ProblemVisual } from "../scenes/Problem";
import { C, MONO } from "../theme";
import { BrowserShot, type Box } from "./BrowserShot";
import { at, DemoScene } from "./common";

const B = shots.boxes as Record<string, Box>;
const SITE = "priorihealth.miles-ehrlich.com";

function Kicker({ step, children }: { step?: number; children: string }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 120, top: 60, display: "flex", alignItems: "center", gap: 14, opacity: fade(frame, 0, 15) }}>
      {step != null && (
        <span style={{ width: 40, height: 40, borderRadius: 4, background: C.accent, color: "#fff", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 20 }}>{step}</span>
      )}
      <span style={{ fontSize: 30, fontWeight: 600, color: C.ink }}>{children}</span>
    </div>
  );
}

export function Intro() {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [4, 34], [0, 1], clamp);
  const word = fade(frame, 22, 16);
  const tag = fade(frame, 40, 16);
  return (
    <DemoScene id="intro" caption={false} background={`linear-gradient(180deg, #E8F0E8 0%, ${C.page} 70%)`}>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <LogoMark size={128} draw={draw} />
          <Wordmark size={104} style={{ opacity: word, display: "inline-block", transform: `translateX(${interpolate(word, [0, 1], [-20, 0])}px)` }} />
        </div>
        <div style={{ marginTop: 28, fontSize: 38, color: C.muted, opacity: tag }}>AI triage support with a nurse in the loop</div>
        <div style={{ marginTop: 18, fontSize: 24, color: C.accent, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", opacity: fade(frame, 60, 16) }}>Product demo</div>
      </div>
    </DemoScene>
  );
}

export function Problem() {
  return (
    <DemoScene id="problem">
      <ProblemVisual />
    </DemoScene>
  );
}

export function Solution() {
  return (
    <DemoScene id="solution">
      <DiscussionVisual />
    </DemoScene>
  );
}

export function Landing() {
  return (
    <DemoScene id="landing">
      <BrowserShot url={SITE} image="landing.png" steps={[{ at: at("landing", 0.75), to: B.landing_demo, click: true }]} />
    </DemoScene>
  );
}

export function Dashboard() {
  return (
    <DemoScene id="dashboard">
      <BrowserShot
        url={`${SITE}/app`}
        image="dashboard.png"
        start={{ x: B.landing_demo.x + B.landing_demo.w / 2, y: B.landing_demo.y + B.landing_demo.h / 2 }}
        steps={[{ at: at("dashboard", 0.85), to: B.dashboard_open, click: true }]}
      />
    </DemoScene>
  );
}

export function Waiting() {
  return (
    <DemoScene id="waiting">
      <BrowserShot
        url={`${SITE}/app/waiting`}
        image="waiting.png"
        start={{ x: B.dashboard_open.x, y: B.dashboard_open.y }}
        steps={[
          { at: at("waiting", 0.25), zoom: { scale: 1.3, focus: B.waiting_list } },
          { at: at("waiting", 0.8), zoom: null },
          { at: at("waiting", 0.95), to: B.waiting_review, click: true },
        ]}
      />
    </DemoScene>
  );
}

export function Review() {
  return (
    <DemoScene id="review">
      <BrowserShot
        url={`${SITE}/app/waiting`}
        image="review.png"
        start={{ x: B.waiting_review.x, y: B.waiting_review.y }}
        steps={[
          { at: at("review", 0.55), to: B.review_member, click: true },
          { at: at("review", 0.58), image: "review_member.png" },
        ]}
      />
    </DemoScene>
  );
}

export function Nurse() {
  return (
    <DemoScene id="nurse">
      <BrowserShot
        url={`${SITE}/app/waiting`}
        image="nurse.png"
        start={{ x: B.review_member.x + 200, y: B.review_member.y }}
        steps={[
          { at: at("nurse", 0.2), zoom: { scale: 1.35, focus: B.nurse_confirm } },
          { at: at("nurse", 0.6), to: B.nurse_confirm, click: true },
          { at: at("nurse", 0.63), image: "nurse_done.png" },
          { at: at("nurse", 0.9), zoom: null },
        ]}
      />
    </DemoScene>
  );
}

function Phone({ src, style }: { src: string; style?: React.CSSProperties }) {
  return (
    <div style={{ position: "absolute", width: 360, height: 779, borderRadius: 52, background: "#1D2226", padding: 14, boxShadow: "0 30px 70px -30px rgba(16,40,28,0.5)", ...style }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 40, overflow: "hidden", background: "#fff" }}>
        <Img src={staticFile(`demo/${src}`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
      </div>
    </div>
  );
}

export function Patient() {
  const frame = useCurrentFrame();
  const phoneIn = usePop(at("patient", 0.25));
  const swap = interpolate(frame, [at("patient", 0.55), at("patient", 0.55) + 12], [0, 1], clamp);
  return (
    <DemoScene id="patient">
      <Kicker>For patients</Kicker>
      <div style={{ position: "absolute", left: 360, top: 120, width: 504, height: 758, borderRadius: 10, overflow: "hidden", background: "#fff", boxShadow: "0 30px 70px -30px rgba(16,40,28,0.45), 0 0 0 1px rgba(16,40,28,0.08)" }}>
        <Img src={staticFile("demo/sign.png")} style={{ position: "absolute", width: 1517, height: 853, left: -506, top: -95 }} />
      </div>
      <div style={{ position: "absolute", left: 360, top: 892, width: 504, textAlign: "center", fontSize: 24, color: C.muted }}>QR sign in the waiting room</div>
      <div style={{ position: "absolute", left: 1180, top: 70, opacity: phoneIn, transform: `translateY(${interpolate(phoneIn, [0, 1], [40, 0])}px)` }}>
        <Phone src="phone_lookup.png" style={{ left: 0, top: 0, opacity: 1 - swap }} />
        <Phone src="phone_status.png" style={{ left: 0, top: 0, opacity: swap }} />
      </div>
    </DemoScene>
  );
}

export function Evaluation() {
  const frame = useCurrentFrame();
  const rows = [
    ["A", "One AI triage nurse"],
    ["B", "A panel of identical neutral reviewers"],
    ["C", "Our trait panel, discussing to 90% agreement"],
    ["D", "The trait panel without discussion"],
  ];
  const metrics = ["Exact-level accuracy", "Critical misses: urgent patients rated too low", "How often cases go to a nurse"];
  return (
    <DemoScene id="evaluation" background="#FFFFFF">
      <Kicker>Evaluation</Kicker>
      <div style={{ position: "absolute", left: 120, top: 150, fontSize: 64, fontWeight: 600, letterSpacing: -1.2, opacity: fade(frame, 6, 16) }}>Tested on a public ESI benchmark</div>
      <div style={{ position: "absolute", left: 120, top: 290, width: 980, display: "flex", flexDirection: "column" }}>
        {rows.map(([k, v], i) => {
          const a = fade(frame, at("evaluation", 0.2 + i * 0.12), 12);
          const ours = k === "C";
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 28, padding: "26px 28px", borderTop: `1px solid ${C.line}`, background: ours ? C.accentSoft : "transparent", opacity: a }}>
              <span style={{ fontFamily: MONO, fontSize: 36, fontWeight: 600, color: C.accent, width: 40 }}>{k}</span>
              <span style={{ fontSize: 34, color: C.ink, fontWeight: ours ? 600 : 400 }}>{v}</span>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 1180, top: 290, width: 620, background: C.page, border: `1px solid ${C.line}`, borderRadius: 10, padding: 44, opacity: fade(frame, at("evaluation", 0.55), 14) }}>
        <div style={{ fontSize: 34, fontWeight: 600 }}>What we measure</div>
        {metrics.map((m) => (
          <div key={m} style={{ marginTop: 20, fontSize: 28, lineHeight: 1.35, color: C.muted }}>{m}</div>
        ))}
        <div style={{ marginTop: 26, fontSize: 24, color: C.muted }}>Benchmark: TriageAgent (EMNLP 2024 Findings)</div>
      </div>
    </DemoScene>
  );
}

export function Platform() {
  const frame = useCurrentFrame();
  const stats = [
    ["5×", "faster note reading with the z17 on-chip AI accelerator"],
    ["3.4×", "faster answers with IBM Z vector instructions"],
    ["$0", "per-call cloud AI fees"],
    ["0", "patient notes leave the server"],
  ];
  return (
    <DemoScene id="platform" background="#FFFFFF">
      <Kicker>Built on IBM</Kicker>
      <div style={{ position: "absolute", left: 120, top: 170, fontSize: 72, fontWeight: 600, letterSpacing: -1.5, opacity: fade(frame, 6, 16) }}>
        IBM LinuxONE z17 · IBM Granite
      </div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 380, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 40 }}>
        {stats.map(([n, label], i) => {
          const a = fade(frame, at("platform", 0.15 + i * 0.12), 14);
          return (
            <div key={n} style={{ borderTop: `3px solid ${C.accent}`, paddingTop: 26, opacity: a, transform: `translateY(${interpolate(a, [0, 1], [24, 0])}px)` }}>
              <div style={{ fontSize: 130, fontWeight: 600, lineHeight: 1, letterSpacing: -4, color: C.accent }}>{n}</div>
              <div style={{ marginTop: 16, fontSize: 30, lineHeight: 1.35, color: C.muted }}>{label}</div>
            </div>
          );
        })}
      </div>
    </DemoScene>
  );
}

export function Impact() {
  const frame = useCurrentFrame();
  const cards = [
    ["Nurses", "A second opinion on every patient, with the reasoning shown and uncertain cases flagged"],
    ["Patients", "Urgent cases get attention first, and everyone can see their place in line"],
    ["Hospitals", "Private, affordable decision support that runs on their own IBM LinuxONE"],
  ];
  return (
    <DemoScene id="impact">
      <Kicker>Impact</Kicker>
      <div style={{ position: "absolute", left: 120, top: 160, fontSize: 72, fontWeight: 600, letterSpacing: -1.5, opacity: fade(frame, 6, 16) }}>Who benefits</div>
      <div style={{ position: "absolute", left: 120, right: 120, top: 330, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 36 }}>
        {cards.map(([t, body], i) => {
          const a = fade(frame, at("impact", 0.18 + i * 0.22), 14);
          return (
            <div key={t} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: 48, opacity: a, transform: `translateY(${interpolate(a, [0, 1], [24, 0])}px)` }}>
              <div style={{ fontSize: 46, fontWeight: 600, color: C.accent }}>{t}</div>
              <div style={{ marginTop: 18, fontSize: 32, lineHeight: 1.4, color: C.ink }}>{body}</div>
            </div>
          );
        })}
      </div>
    </DemoScene>
  );
}

export function Outro() {
  const frame = useCurrentFrame();
  return (
    <DemoScene id="outro" caption={false} background={`linear-gradient(180deg, #E8F0E8 0%, ${C.page} 70%)`}>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, opacity: fade(frame, 0, 16) }}>
          <LogoMark size={104} />
          <Wordmark size={88} />
        </div>
        <div style={{ marginTop: 26, fontSize: 38, color: C.muted, opacity: fade(frame, 14, 16) }}>Decision support that keeps clinicians in charge</div>
        <div style={{ marginTop: 44, fontSize: 34, color: C.accent, fontFamily: MONO, opacity: fade(frame, 30, 16) }}>{SITE}</div>
        <div style={{ marginTop: 18, fontSize: 24, color: C.muted, opacity: fade(frame, 44, 16) }}>Research prototype · not for clinical use · all hospitals are fictional</div>
      </div>
    </DemoScene>
  );
}
