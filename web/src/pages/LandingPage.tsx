import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PublicPage } from "../components/PublicLayout";
import { auth } from "../lib/api";
import { useAuth } from "../lib/hooks";

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

const CAPABILITIES = [
  {
    title: "Recommends an ESI level",
    body: "Each triage note is read by a panel of ten AI reviewers, each with a different reasoning style. They assess the patient independently, then discuss until at least nine agree on an Emergency Severity Index level.",
  },
  {
    title: "Escalates uncertain cases",
    body: "When the panel can't agree, or a reviewer who flagged the patient as high acuity is outvoted, the case is sent to a nurse for review instead of being decided automatically.",
  },
  {
    title: "Orders the waiting room",
    body: "Arrivals are ranked by how long they have waited relative to the target time for their acuity level, so the patients most overdue for care are seen first.",
  },
];

const FACTS = [
  ["Decision support only", "The nurse confirms or overrides every recommendation."],
  ["Transparent reasoning", "Every reviewer's assessment and revision is recorded."],
  ["Runs on-premises", "Hosted on IBM LinuxONE with IBM Granite models; notes stay on the server."],
];

export default function LandingPage() {
  const demo = useDemoSignIn();
  return (
    <PublicPage>
      {/* Hero */}
      <section className="bg-gradient-to-b from-[#e8f0e8] via-[#f3f7f2] to-surface">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-16 md:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <div className="text-[13px] font-semibold tracking-[0.6px] text-accent uppercase">Emergency department triage</div>
            <h1 className="mt-4 text-[40px] leading-[1.1] font-semibold tracking-[-0.8px] text-ink md:text-[48px]">
              Consistent triage decisions, with a nurse in the loop.
            </h1>
            <p className="mt-5 max-w-lg text-[17px] leading-7 text-muted">
              PrioriHealth helps emergency departments assign acuity at the front door. It reviews each triage note,
              recommends an ESI level, and routes the uncertain cases to a nurse.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button className="btn btn-primary btn-lg" onClick={demo.start} disabled={demo.busy}>
                {demo.busy ? "Opening demo…" : "Try the demo"}
              </button>
              <Link to="/signup" className="btn btn-tertiary btn-lg">
                Create an account
              </Link>
            </div>
            {demo.error && <p className="mt-3 text-sm text-danger">{demo.error}</p>}
            <p className="mt-5 text-xs text-subtle">The demo opens Riverbend General Hospital, a fictional emergency department.</p>
          </div>
          <img
            src="/img/doctor-desk.jpg"
            alt="Physician with a stethoscope seated at a clinic desk"
            className="aspect-[4/3] w-full rounded-[4px] object-cover"
          />
        </div>
      </section>

      {/* What it does */}
      <section className="bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-20 md:px-6">
          <div className="max-w-2xl">
            <h2 className="text-[30px] leading-[1.2] font-semibold tracking-[-0.5px] text-ink">What PrioriHealth does</h2>
            <p className="mt-4 text-[16px] leading-7 text-muted">
              Triage nurses make high-stakes decisions quickly, often with incomplete information and a full waiting room.
              PrioriHealth gives them a second opinion on every patient and makes disagreement visible, so the hardest
              cases get human attention first.
            </p>
          </div>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {CAPABILITIES.map((c, i) => (
              <div key={c.title} className="border-t-2 border-accent pt-5">
                <div className="num text-xs text-subtle">0{i + 1}</div>
                <h3 className="mt-2 text-[18px] font-semibold text-ink">{c.title}</h3>
                <p className="mt-2 text-[15px] leading-6 text-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Clinician focus */}
      <section className="border-t border-line bg-page">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-20 md:px-6 lg:grid-cols-2">
          <img
            src="/img/blood-pressure.jpg"
            alt="Doctor checking a patient's blood pressure"
            loading="lazy"
            className="aspect-[4/3] w-full rounded-[4px] object-cover"
          />
          <div>
            <h2 className="text-[30px] leading-[1.2] font-semibold tracking-[-0.5px] text-ink">Built to support clinicians, not replace them</h2>
            <p className="mt-4 text-[16px] leading-7 text-muted">
              PrioriHealth never makes a final call on its own. Recommendations appear alongside the vital signs and the
              panel's reasoning, and the nurse decides. Each hospital has its own private waiting room and staff accounts.
            </p>
            <dl className="mt-8 divide-y divide-line border-y border-line">
              {FACTS.map(([k, v]) => (
                <div key={k} className="grid gap-1 py-4 sm:grid-cols-[200px_1fr]">
                  <dt className="text-sm font-semibold text-ink">{k}</dt>
                  <dd className="text-sm text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
