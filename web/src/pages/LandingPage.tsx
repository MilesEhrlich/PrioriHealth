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
    body: "When the panel can't agree, or a reviewer who flagged the patient as high acuity is outvoted, the case goes to a nurse for review instead of being decided automatically.",
  },
  {
    title: "Orders the waiting room",
    body: "Arrivals are ranked by how long they have waited relative to the target time for their acuity level, so the patients most overdue for care are seen first.",
  },
  {
    title: "Keeps patients informed",
    body: "Patients scan a QR code in the waiting room and enter their code to see their place in line and an estimated wait, updated automatically on their phone.",
  },
];

function SideLink({ to, onClick, title, body }: { to?: string; onClick?: () => void; title: string; body: string }) {
  const inner = (
    <>
      <div className="flex items-center justify-between text-[15px] font-semibold text-ink group-hover:text-accent">
        {title}
        <span aria-hidden className="text-accent">→</span>
      </div>
      <div className="mt-1 text-sm text-muted">{body}</div>
    </>
  );
  const cls = "group block w-full border-b border-line py-4 text-left last:border-b-0";
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export default function LandingPage() {
  const demo = useDemoSignIn();
  return (
    <PublicPage>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-r from-[#eef4ee] via-[#e3ede4] to-[#d3e3d6]">
        {/* diagonal band behind the photo */}
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 hidden w-[46%] bg-[#c7dccb] lg:block"
          style={{ clipPath: "polygon(22% 0, 100% 0, 100% 100%, 0 100%)" }}
        />
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-14 md:px-6 lg:grid-cols-[1fr_1.02fr] lg:py-[72px]">
          <div>
            <h1 className="text-[40px] leading-[1.12] font-semibold tracking-[-0.8px] text-ink md:text-[52px]">
              Safer triage decisions for every emergency department
            </h1>
            <div className="mt-5 text-[16px]">
              <span className="font-medium text-accent">AI triage support</span>
              <span className="mx-2 text-sage">•</span>
              <span className="text-ink">Nurse in the loop</span>
            </div>
            <p className="mt-5 max-w-lg text-[17px] leading-7 text-muted">
              PrioriHealth reviews each triage note, recommends an Emergency Severity Index level, and sends the uncertain
              cases to a nurse.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                className="inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-6 text-[15px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
                onClick={demo.start}
                disabled={demo.busy}
              >
                {demo.busy ? "Opening demo…" : "Try the demo"}
              </button>
              <Link
                to="/signin"
                className="inline-flex h-12 items-center rounded-full border-2 border-accent/40 bg-surface/60 px-6 text-[15px] font-semibold text-ink hover:border-accent"
              >
                Sign in
              </Link>
            </div>
            {demo.error && <p className="mt-3 text-sm text-danger">{demo.error}</p>}
          </div>
          <img
            src="/img/care-team.jpg"
            alt="Four clinicians in white coats standing in a hospital corridor"
            className="aspect-[1.73] w-full rounded-[16px] object-cover object-top shadow-[0_24px_48px_-24px_rgb(31_58_46/45%)]"
          />
        </div>
      </section>

      {/* Body: content + sidebar, article-style */}
      <section className="bg-surface">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-16 md:px-6 lg:grid-cols-[1fr_340px] lg:py-20">
          <div className="min-w-0">
            <div id="what" className="scroll-mt-32">
              <p className="text-[18px] leading-8 text-ink">
                Running an emergency department means making high-stakes decisions quickly, often with incomplete
                information and a full waiting room. PrioriHealth gives triage nurses a second opinion on every patient
                and makes disagreement visible, so the hardest cases get human attention first.
              </p>
            </div>

            <h2 className="mt-14 text-[30px] leading-[1.2] font-semibold tracking-[-0.5px] text-ink">See it in one minute</h2>
            <p className="mt-3 text-[16px] leading-7 text-muted">
              A short animated overview of how a patient moves from the triage desk to the waiting room.
            </p>
            <video
              className="mt-6 aspect-video w-full rounded-[16px] border border-line bg-page shadow-[0_24px_48px_-28px_rgb(31_58_46/45%)]"
              src="/video/priorihealth-overview.mp4"
              poster="/video/overview-poster.jpg"
              controls
              playsInline
              preload="metadata"
            >
              Your browser can't play this video. <a href="/video/priorihealth-overview.mp4">Download it</a> instead.
            </video>

            <h2 id="how" className="mt-16 scroll-mt-32 text-[30px] leading-[1.2] font-semibold tracking-[-0.5px] text-ink">
              How PrioriHealth works
            </h2>
            <ol className="mt-8 space-y-8">
              {CAPABILITIES.map((c, i) => (
                <li key={c.title} className="grid grid-cols-[44px_1fr] gap-4">
                  <span className="num grid size-11 place-items-center rounded-full bg-accent-soft text-[15px] font-semibold text-accent">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-[19px] font-semibold text-ink">{c.title}</h3>
                    <p className="mt-1.5 text-[16px] leading-7 text-muted">{c.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <aside className="lg:sticky lg:top-36 lg:self-start">
            <h2 className="text-[26px] font-semibold tracking-[-0.4px] text-ink">Get started</h2>
            <div className="mt-4 rounded-[12px] border border-line px-5">
              <SideLink onClick={demo.start} title="Try the demo" body="Open Riverbend General, a fictional ED with a live waiting room." />
              <SideLink to="/signup" title="Create an account" body="Join one of eight fictional hospitals as a nurse or physician." />
              <SideLink to="/status" title="Check a patient's wait" body="For patients: enter the code from your check-in ticket." />
            </div>
          </aside>
        </div>
      </section>
    </PublicPage>
  );
}
