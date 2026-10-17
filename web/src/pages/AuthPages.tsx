import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { PublicPage } from "../components/PublicLayout";
import { auth, type Hospital } from "../lib/api";
import { useAuth } from "../lib/hooks";
import { useDemoSignIn } from "./LandingPage";

/** Only follow in-app paths after sign-in (never an external URL). */
function safeNext(next: string | null): string {
  return next && next.startsWith("/app") ? next : "/app";
}

function AuthLayout({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <PublicPage>
      <section className="bg-gradient-to-r from-[#eef4ee] via-[#e3ede4] to-[#d3e3d6] px-4 py-12 md:py-16">
        <div className="mx-auto w-full max-w-[460px] rounded-[16px] border border-line bg-surface p-7 shadow-[0_24px_48px_-28px_rgb(31_58_46/45%)] sm:p-9">
          <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.4px] text-ink">{title}</h1>
          <p className="mt-2 text-sm text-muted">{sub}</p>
          <div className="mt-7">{children}</div>
        </div>
      </section>
    </PublicPage>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-[#fdf1f0] px-3 py-2.5 text-sm text-ink">
      {message}
    </div>
  );
}

export function SignInPage() {
  const { user, checking, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const demo = useDemoSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(params.get("next"));

  if (!checking && user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await auth.signIn(email, password);
      setUser(r.user);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      sub={
        <>
          New to PrioriHealth?{" "}
          <Link to="/signup" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FormError message={error ?? demo.error} />
        <Field id="email" label="Work email">
          <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="password" label="Password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-lg w-full rounded-full" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Just looking?{" "}
        <button className="font-medium text-accent hover:underline" onClick={demo.start} disabled={demo.busy}>
          {demo.busy ? "Opening demo…" : "Try the demo"}
        </button>
      </p>
    </AuthLayout>
  );
}

function strength(pw: string): { label: string; score: number } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return { score, label: ["Too short", "Weak", "Fair", "Good", "Strong"][score]! };
}

export function SignUpPage() {
  const { user, checking, setUser } = useAuth();
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", hospital_id: "", role: "" });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    auth
      .hospitals()
      .then((r) => {
        setHospitals(r.hospitals);
        setRoles(r.roles);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (!checking && user) return <Navigate to="/app" replace />;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const errors = {
    name: form.name.trim() ? undefined : "Enter your name.",
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) ? undefined : "Enter a valid email address.",
    password: form.password.length >= 8 ? undefined : "Use at least 8 characters.",
    hospital_id: form.hospital_id ? undefined : "Choose your hospital.",
    role: form.role ? undefined : "Choose your role.",
  };
  const show = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const pw = strength(form.password);
  const selected = hospitals.find((h) => h.id === form.hospital_id);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await auth.signUp({ ...form, name: form.name.trim(), email: form.email.trim() });
      setUser(r.user);
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      sub={
        <>
          Already have an account?{" "}
          <Link to="/signin" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FormError message={error} />
        <Field id="name" label="Full name" error={show("name")}>
          <input id="name" autoComplete="name" className="input" value={form.name} onChange={set("name")} aria-invalid={!!show("name")} />
        </Field>
        <Field id="email" label="Work email" error={show("email")}>
          <input id="email" type="email" autoComplete="email" className="input" value={form.email} onChange={set("email")} aria-invalid={!!show("email")} />
        </Field>
        <Field id="password" label="Password" error={show("password")} hint={form.password ? undefined : "At least 8 characters."}>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            className="input"
            value={form.password}
            onChange={set("password")}
            aria-invalid={!!show("password")}
          />
          {form.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1" aria-hidden>
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`h-1 flex-1 ${i <= pw.score ? "bg-accent" : "bg-line"}`} />
                ))}
              </div>
              <span className="w-16 text-right text-xs text-muted">{pw.label}</span>
            </div>
          )}
        </Field>
        <Field id="hospital" label="Hospital" error={show("hospital_id")} hint={selected ? selected.description : "Demo facilities. All are fictional."}>
          <select id="hospital" className="input" value={form.hospital_id} onChange={set("hospital_id")} aria-invalid={!!show("hospital_id")}>
            <option value="">Select a hospital</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="role" label="Role" error={show("role")}>
          <select id="role" className="input" value={form.role} onChange={set("role")} aria-invalid={!!show("role")}>
            <option value="">Select your role</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="btn btn-primary btn-lg w-full rounded-full" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="text-center text-xs text-muted">This is a research demo. Don't reuse a password from another site.</p>
      </form>
    </AuthLayout>
  );
}
