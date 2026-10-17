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

const PILLARS = [
  { img: "/img/doctor-office.jpg", alt: "Physician at his desk", title: "Panel review", body: "Ten AI reviewers assess each case and must agree." },
  { img: "/img/blood-pressure.jpg", alt: "Doctor checking a patient's blood pressure", title: "Nurse in the loop", body: "Disagreements go to a nurse, not a guess." },
  { img: "/img/senior-doctor.jpg", alt: "Senior physician with a stethoscope", title: "Live waiting room", body: "Patients ordered by acuity and time waited." },
];

export default function LandingPage() {
  const demo = useDemoSignIn();
  return (
    <PublicPage>
      <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-16 md:px-6 lg:grid-cols-2 lg:py-24">
        <div>
          <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.8px] text-ink md:text-[48px]">
            Emergency triage support, with a nurse in the loop.
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-7 text-muted">
            PrioriHealth recommends an ESI level for every arrival and flags the cases a nurse should review.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button className="btn btn-primary btn-lg" onClick={demo.start} disabled={demo.busy}>
              {demo.busy ? "Opening demo…" : "Try the demo"}
            </button>
            <Link to="/signin" className="btn btn-tertiary btn-lg">
              Sign in
            </Link>
          </div>
          {demo.error && <p className="mt-3 text-sm text-danger">{demo.error}</p>}
        </div>
        <img
          src="/img/doctor-desk.jpg"
          alt="Physician with a stethoscope seated at a clinic desk"
          className="aspect-[4/3] w-full rounded-[4px] object-cover"
        />
      </section>

      <section className="border-t border-line bg-page">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-16 md:grid-cols-3 md:px-6">
          {PILLARS.map((p) => (
            <figure key={p.title}>
              <img src={p.img} alt={p.alt} loading="lazy" className="aspect-[3/2] w-full rounded-[4px] object-cover" />
              <figcaption className="mt-4">
                <div className="text-[16px] font-semibold text-ink">{p.title}</div>
                <div className="mt-1 text-sm text-muted">{p.body}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </PublicPage>
  );
}
