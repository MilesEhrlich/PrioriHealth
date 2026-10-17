import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PublicPage } from "../components/PublicLayout";
import { auth } from "../lib/api";
import { useAuth } from "../lib/hooks";
import { STEPS } from "./HomePage";

/** One click into the shared demo account (Riverbend General, a fictional hospital). */
export function useDemoSignIn() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await auth.demo();
      setUser(r.user);
      navigate("/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return { start, busy, error };
}

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="mt-0.5 shrink-0">
      <circle cx="9" cy="9" r="9" fill="#EAF2EC" />
      <path d="M5.5 9.2l2.3 2.3 4.7-4.9" stroke="#3F6B57" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[13px] font-semibold tracking-[0.6px] text-accent uppercase">{children}</div>;
}

/** Static preview of the live waiting room (illustrative rows, no patient data). */
function WaitingPreview() {
  const rows: [number, string, string, string, boolean][] = [
    [2, "Chest pressure, diaphoretic", "4 min", "Panel 10/10", false],
    [3, "Abdominal pain, febrile", "22 min", "Panel 9/10", false],
    [2, "Shortness of breath", "8 min", "Nurse review", true],
    [4, "Ankle injury, weight-bearing", "41 min", "Panel 10/10", false],
    [5, "Medication refill", "63 min", "Panel 10/10", false],
  ];
  const esiBg = ["", "var(--color-esi-1)", "var(--color-esi-2)", "var(--color-esi-3)", "var(--color-esi-4)", "var(--color-esi-5)"];
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lift)]" aria-label="Waiting room preview">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <div className="text-sm font-semibold text-ink">Waiting Room</div>
          <div className="text-xs text-muted">Ordered by ESI-weighted wait</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
          <span className="size-1.5 rounded-full bg-accent" /> Live
        </span>
      </div>
      <ul>
        {rows.map(([esi, cc, wait, status, review]) => (
          <li key={cc} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
            <span
              className="num inline-flex h-6 items-center rounded-[5px] px-2 text-xs font-semibold"
              style={{ background: esiBg[esi], color: esi === 2 || esi === 3 ? "#161616" : "#fff" }}
            >
              ESI {esi}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{cc}</span>
            <span className="num hidden w-14 text-right text-xs text-muted sm:block">{wait}</span>
            <span
              className={`w-[96px] rounded-full px-2 py-0.5 text-center text-[11px] font-medium ${
                review ? "bg-[#fdf3dc] text-[#6b4a0f]" : "bg-field text-muted"
              }`}
            >
              {status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Feature({ eyebrow, title, body, points, media, flip = false }: {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  media: ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 lg:gap-16">
      <div className={flip ? "md:order-2" : ""}>{media}</div>
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="mt-3 text-[28px] leading-9 font-semibold tracking-[-0.4px] text-ink">{title}</h3>
        <p className="mt-4 text-[16px] leading-7 text-muted">{body}</p>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-[15px] text-ink">
              <Check />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Photo({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`aspect-[4/3] w-full rounded-2xl object-cover shadow-[var(--shadow-lift)] ${className}`}
    />
  );
}

export default function LandingPage() {
  const demo = useDemoSignIn();
  return (
    <PublicPage>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#eef4ee] to-surface">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pt-14 pb-16 md:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20 lg:pb-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-sage-light bg-surface px-3 py-1 text-xs font-medium text-accent">
              <span className="size-1.5 rounded-full bg-sage" />
              AI-assisted emergency triage
            </span>
            <h1 className="mt-5 text-[40px] leading-[1.1] font-semibold tracking-[-1px] text-ink md:text-[52px]">
              Safer triage decisions, <span className="text-accent">with a nurse in the loop.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-7 text-muted">
              PrioriHealth reads the triage note, convenes a ten-member AI review panel, and proposes an Emergency
              Severity Index level. When the panel can't agree, the case goes straight to a nurse.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button className="btn btn-primary btn-lg" onClick={demo.start} disabled={demo.busy}>
                {demo.busy ? "Opening demo…" : "Try the demo"}
              </button>
              <Link to="/signup" className="btn btn-tertiary btn-lg">
                Create an account
              </Link>
            </div>
            {demo.error && <p className="mt-3 text-sm text-danger">{demo.error}</p>}
            <p className="mt-5 text-xs text-subtle">Decision support prototype · not for clinical use · no sign-up needed for the demo</p>
          </div>
          <div className="relative">
            <img
              src="/img/doctor-desk.jpg"
              alt="Physician in a white coat with a stethoscope, seated at a clinic desk"
              className="aspect-[4/3] w-full rounded-[20px] object-cover shadow-[var(--shadow-lift)]"
            />
            <div className="absolute -bottom-6 left-4 w-[260px] rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-lift)] sm:-left-6">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Panel decision</span>
                <span className="num">Round 2</span>
              </div>
              <div className="mt-2 flex items-center gap-2.5">
                <span className="num inline-flex h-7 items-center rounded-md px-2.5 text-sm font-semibold text-[#161616]" style={{ background: "var(--color-esi-2)" }}>
                  ESI 2
                </span>
                <span className="text-sm font-medium text-ink">Emergent</span>
              </div>
              <div className="mt-3 flex gap-1" aria-hidden>
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < 9 ? "#3F6B57" : "#DDE5DE" }} />
                ))}
              </div>
              <div className="mt-1.5 text-xs text-muted">9 of 10 members agree</div>
            </div>
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-6 px-4 py-8 md:grid-cols-4 md:px-6">
          {[
            ["10", "reasoning styles on every case"],
            ["90%", "agreement required for consensus"],
            ["5", "discussion rounds at most"],
            ["$0", "cloud AI fees: runs on IBM LinuxONE"],
          ].map(([k, v]) => (
            <div key={v}>
              <div className="num text-[28px] font-medium text-accent">{k}</div>
              <div className="mt-0.5 text-sm text-muted">{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 bg-surface">
        <div className="mx-auto max-w-[1200px] space-y-24 px-4 py-20 md:px-6">
          <div className="max-w-2xl">
            <Eyebrow>Features</Eyebrow>
            <h2 className="mt-3 text-[34px] leading-[1.15] font-semibold tracking-[-0.6px] text-ink">
              Built around the way triage nurses already work
            </h2>
            <p className="mt-4 text-[16px] leading-7 text-muted">
              The panel proposes; the nurse decides. Every recommendation shows its reasoning, and every disagreement is surfaced, not hidden.
            </p>
          </div>

          <Feature
            eyebrow="Review panel"
            title="Ten perspectives, one recommendation"
            body="Each case is assessed independently by ten panel members with different reasoning styles: empathetic, logical, skeptical, observant and more. If they disagree, they discuss by name and may revise, until at least nine agree."
            points={[
              "Independent first opinions before any discussion",
              "Revisions require a named clinical reason, not peer pressure",
              "Full transcript of every round for audit",
            ]}
            media={<Photo src="/img/doctor-office.jpg" alt="Physician smiling at his desk with a laptop" />}
          />

          <Feature
            flip
            eyebrow="Nurse in the loop"
            title="Disagreement goes to a nurse, not a guess"
            body="If the panel can't reach consensus, or a member who first flagged the patient as high acuity is talked down, the case is escalated for nurse review with a safety-weighted level shown first."
            points={[
              "Escalations are flagged in the waiting room immediately",
              "The nurse confirms or overrides with one click",
              "Under-triage of ESI 1–2 patients is tracked as a safety metric",
            ]}
            media={<Photo src="/img/blood-pressure.jpg" alt="Doctor checking a patient's blood pressure" />}
          />

          <Feature
            eyebrow="Live waiting room"
            title="A queue that reflects acuity and time"
            body="Arrivals are triaged in the background and ordered by ESI-weighted wait: how far each patient is past the target time for their level. Each hospital has its own waiting room."
            points={[
              "Target times per ESI level, from immediate to two hours",
              "Patients awaiting nurse review stay visible at the top",
              "Separate, private queue for each facility",
            ]}
            media={<WaitingPreview />}
          />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 bg-page">
        <div className="mx-auto max-w-[1200px] px-4 py-20 md:px-6">
          <div className="max-w-2xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-3 text-[34px] leading-[1.15] font-semibold tracking-[-0.6px] text-ink">From triage note to queue position</h2>
          </div>
          <ol className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="rounded-[14px] border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
                <span className="num grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{i + 1}</span>
                <div className="mt-4 text-[17px] font-semibold text-ink">{title}</div>
                <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Platform */}
      <section id="platform" className="scroll-mt-20 bg-chrome text-white">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-20 md:px-6 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="text-[13px] font-semibold tracking-[0.6px] text-sage uppercase">Platform</div>
            <h2 className="mt-3 text-[34px] leading-[1.15] font-semibold tracking-[-0.6px]">Private by design. Runs on IBM Z.</h2>
            <p className="mt-4 text-[16px] leading-7 text-white/75">
              The whole system, including the language model, runs on an IBM LinuxONE server. Inference uses the z17
              processor's on-chip AI accelerator, so triage notes never leave the machine and there are no per-call cloud fees.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-4">
            {[
              ["Model", "IBM Granite 3.3", "Open-weight, run locally"],
              ["Hardware", "IBM LinuxONE z17", "On-chip AI accelerator"],
              ["Inference", "llama.cpp", "zDNN backend"],
              ["Evaluation", "Open benchmark", "Published ESI-labelled cases"],
            ].map(([k, v, d]) => (
              <div key={k} className="rounded-[14px] border border-white/12 bg-white/[0.06] p-5">
                <dt className="text-xs text-white/60">{k}</dt>
                <dd className="mt-1 text-[17px] font-semibold">{v}</dd>
                <dd className="mt-0.5 text-sm text-white/65">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-20 md:px-6">
          <div className="grid items-center gap-10 overflow-hidden rounded-[20px] bg-accent-soft md:grid-cols-[1.2fr_1fr]">
            <div className="p-8 md:p-12">
              <h2 className="text-[30px] leading-[1.2] font-semibold tracking-[-0.5px] text-ink">See the panel work on a real triage note</h2>
              <p className="mt-3 max-w-lg text-[16px] leading-7 text-muted">
                The demo opens Riverbend General Hospital, a fictional emergency department with a live waiting room.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <button className="btn btn-primary btn-lg" onClick={demo.start} disabled={demo.busy}>
                  {demo.busy ? "Opening demo…" : "Try the demo"}
                </button>
                <Link to="/signin" className="btn btn-tertiary btn-lg">
                  Sign in
                </Link>
              </div>
            </div>
            <img src="/img/senior-doctor.jpg" alt="Senior physician with a stethoscope" loading="lazy" className="h-full max-h-[340px] w-full object-cover max-md:hidden" />
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
