import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth, useFetch, useResultSet } from "../lib/hooks";
import { Brand } from "./Brand";

const NAV: { group: string; items: { to: string; label: string }[] }[] = [
  { group: "Overview", items: [{ to: "/app", label: "Home" }] },
  {
    group: "Clinical",
    items: [
      { to: "/app/waiting", label: "Waiting Room" },
      { to: "/app/case", label: "Case Review" },
      { to: "/app/queue", label: "Surge Replay" },
    ],
  },
  { group: "Analytics", items: [{ to: "/app/results", label: "Evaluation Results" }] },
];

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="num text-xs text-muted">
      {now.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}{" "}
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
    </span>
  );
}

function ModelSwitcher() {
  const { sets, current, setCurrent } = useResultSet();
  if (!current) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="hidden xl:inline">Model</span>
      <span className="relative">
        <select
          value={current.id}
          onChange={(e) => setCurrent(e.target.value)}
          className="h-8 max-w-[180px] appearance-none truncate rounded-lg border border-line bg-surface pr-8 pl-3 text-sm text-ink hover:border-line-strong md:max-w-[240px]"
          aria-label="Result set"
        >
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} (n={s.n})
            </option>
          ))}
        </select>
        <svg className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2" width="10" height="6" viewBox="0 0 10 6" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="#56655d" strokeWidth="1.5" fill="none" />
        </svg>
      </span>
    </label>
  );
}

function HospitalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="text-accent">
      <path d="M2.5 14.5V4.5l5.5-3 5.5 3v10M1 14.5h14M6.5 14.5v-3h3v3M8 5v3M6.5 6.5h3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 hover:bg-hover"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid size-8 place-items-center rounded-[4px] bg-accent text-xs font-semibold text-white">{initials(user.name)}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-ink">{user.name}</span>
          <span className="block text-[11px] text-muted">{user.role}</span>
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className="hidden sm:block">
          <path d="M1 1l4 4 4-4" stroke="#56655d" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-lift)]">
          <div className="border-b border-line px-4 py-3">
            <div className="text-sm font-semibold text-ink">{user.name}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
            <div className="mt-2 text-xs text-ink">{user.hospital.name}</div>
            <div className="text-xs text-muted">
              {user.role}
              {user.demo && " · shared demo account"}
            </div>
          </div>
          <button
            role="menuitem"
            className="flex w-full items-center px-4 py-2.5 text-left text-sm text-ink hover:bg-hover"
            onClick={async () => {
              await signOut();
              navigate("/signin", { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** White band under the system header: breadcrumb, title, page actions. */
export function PageHeader({ crumbs, title, sub, actions }: {
  crumbs: string[];
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-b border-line bg-surface px-4 pt-4 pb-5 md:px-8">
      <nav className="text-xs text-muted" aria-label="Breadcrumb">
        {["PrioriHealth", ...crumbs].map((c, i, a) => (
          <span key={c}>
            {c}
            {i < a.length - 1 && <span className="mx-2 text-line-strong">›</span>}
          </span>
        ))}
      </nav>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl leading-8 font-semibold tracking-[-0.2px] text-ink">{title}</h1>
          {sub && <p className="mt-1 max-w-3xl text-sm text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Standard page body padding + max width. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1584px] flex-col gap-4 px-4 py-6 md:px-8">{children}</div>;
}

export function Shell() {
  const { current } = useResultSet();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const sys = useFetch(() => api.system(), []);
  const onLinuxONE = !!sys.data?.platform.is_linuxone;

  return (
    <div className="min-h-screen bg-page">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-3 backdrop-blur md:px-5">
        <button
          className="grid size-10 place-items-center rounded-lg hover:bg-hover lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
        >
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
            <path d="M0 1h16M0 6h16M0 11h16" stroke="#1c2b24" strokeWidth="1.5" />
          </svg>
        </button>
        <Brand to="/app" sub="Emergency Department Triage" />
        {user && (
          <span className="ml-4 hidden items-center gap-2 border-l border-line pl-4 text-sm text-ink md:flex">
            <HospitalIcon />
            {user.hospital.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {onLinuxONE && (
            <span className="hidden h-6 items-center rounded-[3px] bg-accent-soft px-2 text-[11px] font-medium text-accent xl:inline-flex">
              IBM LinuxONE
            </span>
          )}
          <span className="hidden lg:inline">
            <Clock />
          </span>
          <span className="hidden md:block">
            <ModelSwitcher />
          </span>
          <UserMenu />
        </div>
      </header>

      {/* Side navigation */}
      <aside
        className={`fixed top-16 bottom-0 left-0 z-40 flex w-[240px] flex-col border-r border-line bg-surface max-lg:transition-transform lg:translate-x-0 ${
          open ? "translate-x-0 shadow-lg" : "-translate-x-full"
        }`}
      >
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} className="mb-4">
              <div className="px-3 pb-1.5 text-[11px] font-medium tracking-[0.5px] text-subtle uppercase">{g.group}</div>
              {g.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === "/app"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `mb-0.5 flex h-9 items-center rounded-lg px-3 text-sm transition-colors ${
                      isActive ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-hover hover:text-ink"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="m-3 rounded-[4px] border border-line bg-field px-3 py-3 text-xs">
          <div className="text-[11px] tracking-[0.32px] text-subtle uppercase">Decision model</div>
          <div className="mt-1 font-medium text-ink">{current?.label ?? "—"}</div>
          <div className="mt-0.5 text-muted">
            {current ? `${current.n} benchmark patients · ${current.kind === "full" ? "full test set" : "sample"}` : ""}
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 top-16 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Content */}
      <div className="flex min-h-screen flex-col pt-16 lg:pl-[240px]">
        <main className="flex-1">
          <Outlet />
        </main>
        <footer className="sticky bottom-0 z-10 flex items-center justify-between border-t border-line bg-surface px-4 py-2 text-xs text-muted md:px-8">
          <span>Decision support prototype. Not for clinical use.</span>
          <span className="hidden sm:inline">{user?.hospital.name ?? ""} · fictional facility</span>
        </footer>
      </div>
    </div>
  );
}
