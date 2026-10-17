import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LogoMark, Wordmark } from "../components/Brand";
import { ApiError, publicStatus, type PatientStatus } from "../lib/api";

const POLL_MS = 15_000;
const CODE_LEN = 6;
const LAST_CODE_KEY = "priorihealth.patientCode";

const clean = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LEN);

function remember(code: string | null) {
  try {
    if (code) localStorage.setItem(LAST_CODE_KEY, code);
    else localStorage.removeItem(LAST_CODE_KEY);
  } catch {
    /* storage unavailable: fine */
  }
}

function recall(): string {
  try {
    return localStorage.getItem(LAST_CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

function duration(min: number) {
  if (min < 1) return "Just now";
  if (min < 60) return `${Math.floor(min)} min`;
  return `${Math.floor(min / 60)} h ${Math.floor(min % 60)} min`;
}

/** Bare phone layout: logo bar, centered column, short footer. */
function PatientLayout({ hospital, children }: { hospital?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[480px] items-center gap-2.5 px-4">
          <LogoMark size={26} />
          <Wordmark className="text-[18px]" />
          {hospital && <span className="ml-auto truncate pl-3 text-right text-xs text-muted">{hospital}</span>}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[480px] flex-1 px-4 py-6">{children}</main>
      <footer className="mx-auto w-full max-w-[480px] px-4 pb-6 text-xs leading-5 text-subtle">
        If your symptoms get worse while you wait, tell a member of staff right away.
      </footer>
    </div>
  );
}

export function StatusLookupPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState(recall);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LEN) {
      setError(`Your code has ${CODE_LEN} letters and numbers.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await publicStatus(code);
      remember(code);
      navigate(`/status/${code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't connect. Check your signal and try again.");
      setBusy(false);
    }
  };

  return (
    <PatientLayout>
      <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.4px] text-ink">Check your place in line</h1>
      <p className="mt-2 text-[16px] leading-6 text-muted">Enter the patient code from your check-in ticket.</p>
      <form onSubmit={submit} className="mt-8" noValidate>
        <label htmlFor="code" className="label">
          Patient code
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => {
            setCode(clean(e.target.value));
            setError(null);
          }}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g. K7P4MX"
          aria-invalid={!!error}
          aria-describedby={error ? "code-err" : undefined}
          className="input num h-14 text-center text-[26px] tracking-[0.3em] uppercase placeholder:text-[18px] placeholder:tracking-normal placeholder:normal-case"
        />
        {error && (
          <p id="code-err" role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary mt-5 h-12 w-full text-[16px]" disabled={busy}>
          {busy ? "Checking…" : "Check status"}
        </button>
      </form>
      <p className="mt-8 text-sm leading-6 text-muted">
        Your code is on the ticket you received at triage. Ask the front desk if you can't find it.
      </p>
    </PatientLayout>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[4px] border border-line bg-surface px-4 py-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 text-[22px] font-medium text-ink">{value}</div>
    </div>
  );
}

export function StatusLivePage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PatientStatus | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [flash, setFlash] = useState(false);
  const lastPos = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await publicStatus(code);
      if (lastPos.current != null && s.position != null && s.position !== lastPos.current) {
        setFlash(true);
        setTimeout(() => setFlash(false), 1600);
      }
      lastPos.current = s.position;
      setStatus(s);
      setError(null);
      remember(s.code);
    } catch (err) {
      setError(err instanceof ApiError ? { status: err.status, message: err.message } : { status: 0, message: "Couldn't connect. Retrying…" });
    }
  }, [code]);

  useEffect(() => {
    load();
    let timer = setInterval(load, POLL_MS);
    const onVisible = () => {
      clearInterval(timer);
      if (document.visibilityState === "visible") {
        load();
        timer = setInterval(load, POLL_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  if (error?.status === 404)
    return (
      <PatientLayout>
        <h1 className="text-[24px] font-semibold text-ink">Code not found</h1>
        <p className="mt-2 text-[16px] leading-6 text-muted">{error.message}</p>
        <button
          className="btn btn-primary mt-6 h-12 w-full text-[16px]"
          onClick={() => {
            remember(null);
            navigate("/status");
          }}
        >
          Enter a different code
        </button>
      </PatientLayout>
    );

  const s = status;
  const updated = s ? new Date(s.updated_at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <PatientLayout hospital={s?.hospital.name}>
      <div className="text-xs text-muted">
        Patient code <span className="num font-medium text-ink">{code}</span>
      </div>

      <section
        className={`mt-3 rounded-[4px] border px-5 py-7 text-center transition-colors duration-700 ${
          s?.state === "called" ? "border-accent bg-accent text-white" : flash ? "border-sage bg-accent-soft" : "border-line bg-surface"
        }`}
        aria-live="polite"
      >
        {!s ? (
          <div className="py-6 text-muted">Loading your status…</div>
        ) : s.state === "assessing" ? (
          <>
            <div className="text-[13px] font-semibold tracking-[0.6px] text-accent uppercase">In progress</div>
            <div className="mt-3 text-[26px] leading-8 font-semibold text-ink">We're reviewing your details</div>
            <p className="mt-2 text-[15px] text-muted">Your place in line will appear here in a moment.</p>
          </>
        ) : s.state === "called" ? (
          <>
            <div className="text-[13px] font-semibold tracking-[0.6px] uppercase opacity-80">It's your turn</div>
            <div className="mt-3 text-[28px] leading-9 font-semibold">You've been called</div>
            <p className="mt-2 text-[16px] opacity-90">Please go to the front desk.</p>
          </>
        ) : s.state === "next" ? (
          <>
            <div className="text-[13px] font-semibold tracking-[0.6px] text-accent uppercase">Almost there</div>
            <div className="mt-3 text-[34px] leading-10 font-semibold text-ink">You're next</div>
            <p className="mt-2 text-[16px] text-muted">Please stay nearby. Staff will call you shortly.</p>
          </>
        ) : (
          <>
            <div className="text-[15px] text-muted">You are</div>
            <div className="num mt-1 text-[72px] leading-none font-semibold tracking-[-2px] text-accent">{ordinal(s.position!)}</div>
            <div className="mt-2 text-[17px] text-ink">in line</div>
          </>
        )}
      </section>

      {s && s.state !== "assessing" && s.state !== "called" && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Stat
              label="Estimated wait"
              value={s.estimate_min ? (s.estimate_min[1] <= 5 ? "A few minutes" : `About ${s.estimate_min[0]}–${s.estimate_min[1]} min`) : "—"}
            />
          </div>
          <Stat label="Time waited" value={duration(s.waited_min)} />
          <Stat label="People ahead" value={s.ahead ?? "—"} />
        </div>
      )}
      {s?.state === "assessing" && (
        <div className="mt-4">
          <Stat label="Time waited" value={duration(s.waited_min)} />
        </div>
      )}

      {s && s.state !== "called" && (
        <p className="mt-5 rounded-[4px] bg-[#fdf3dc] px-4 py-3 text-sm leading-6 text-[#6b4a0f]">
          Patients with more urgent needs may be seen first, so your place in line can change.
        </p>
      )}

      <div className="mt-6 flex items-center justify-between text-xs text-muted">
        <span>
          {error ? error.message : updated ? `Updated ${updated} · refreshes automatically` : ""}
        </span>
        <Link
          to="/status"
          className="py-2 font-medium text-accent"
          onClick={() => remember(null)}
        >
          Different code
        </Link>
      </div>
    </PatientLayout>
  );
}
