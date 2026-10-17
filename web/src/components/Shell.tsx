import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../lib/api";
import { useFetch, useResultSet } from "../lib/hooks";

const NAV: { group: string; items: { to: string; label: string }[] }[] = [
  { group: "Overview", items: [{ to: "/", label: "Home" }] },
  {
    group: "Clinical",
    items: [
      { to: "/waiting", label: "Waiting Room" },
      { to: "/case", label: "Case Review" },
      { to: "/queue", label: "Surge Replay" },
    ],
  },
  { group: "Analytics", items: [{ to: "/results", label: "Evaluation Results" }] },
];

function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" fill="#0F62FE" />
      <rect x="13" y="7" width="6" height="18" fill="#fff" />
      <rect x="7" y="13" width="18" height="6" fill="#fff" />
    </svg>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="num text-xs text-[#c6c6c6]">
      {now.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}{" "}
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
    </span>
  );
}

function ModelSwitcher() {
  const { sets, current, setCurrent } = useResultSet();
  if (!current) return null;
  return (
    <label className="flex h-12 items-center gap-2 border-l border-chrome-3 px-4 text-xs text-[#c6c6c6]">
      <span className="hidden md:inline">Model</span>
      <span className="relative">
        <select
          value={current.id}
          onChange={(e) => setCurrent(e.target.value)}
          className="h-8 appearance-none border-none bg-chrome-2 pr-8 pl-3 text-sm text-white hover:bg-chrome-3 focus:outline-2 focus:outline-white"
          aria-label="Result set"
        >
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} (n={s.n})
            </option>
          ))}
        </select>
        <svg className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2" width="10" height="6" viewBox="0 0 10 6" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="#c6c6c6" strokeWidth="1.5" fill="none" />
        </svg>
      </span>
    </label>
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
            {i < a.length - 1 && <span className="mx-2 text-line-strong">/</span>}
          </span>
        ))}
      </nav>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl leading-8 font-normal text-ink">{title}</h1>
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
  const [open, setOpen] = useState(false);
  const sys = useFetch(() => api.system(), []);
  const onLinuxONE = !!sys.data?.platform.is_linuxone;

  return (
    <div className="min-h-screen bg-page">
      {/* System header */}
      <header className="fixed inset-x-0 top-0 z-50 flex h-12 items-center bg-chrome text-white">
        <button
          className="grid h-12 w-12 place-items-center hover:bg-chrome-2 lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
        >
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
            <path d="M0 1h16M0 6h16M0 11h16" stroke="#fff" strokeWidth="1.5" />
          </svg>
        </button>
        <NavLink to="/" className="flex h-12 items-center gap-2.5 px-4 hover:bg-chrome-2">
          <Logo />
          <span className="text-sm font-semibold tracking-[0.1px]">PrioriHealth</span>
          <span className="hidden text-sm text-[#c6c6c6] sm:inline">Emergency Department Triage</span>
        </NavLink>
        <div className="ml-auto flex items-center">
          {onLinuxONE && (
            <span className="mr-3 hidden h-5 items-center bg-accent px-2 text-[11px] font-medium tracking-[0.32px] text-white md:inline-flex">
              IBM LINUXONE
            </span>
          )}
          <span className="mr-4 hidden h-5 items-center border border-[#6f6f6f] px-2 text-[11px] tracking-[0.32px] text-[#c6c6c6] md:inline-flex">
            DEMO ENVIRONMENT
          </span>
          <span className="mr-4 hidden lg:inline">
            <Clock />
          </span>
          <ModelSwitcher />
        </div>
      </header>

      {/* Side navigation */}
      <aside
        className={`fixed top-12 bottom-0 left-0 z-40 flex w-[240px] flex-col border-r border-line bg-surface max-lg:transition-transform lg:translate-x-0 ${
          open ? "translate-x-0 shadow-lg" : "-translate-x-full"
        }`}
      >
        <nav className="flex-1 overflow-y-auto py-4" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} className="mb-4">
              <div className="px-4 pb-1 text-[11px] tracking-[0.32px] text-subtle uppercase">{g.group}</div>
              {g.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === "/"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex h-9 items-center border-l-[3px] px-[13px] text-sm transition-colors ${
                      isActive ? "border-accent bg-line font-semibold text-ink" : "border-transparent text-muted hover:bg-hover hover:text-ink"
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-xs">
          <div className="text-[11px] tracking-[0.32px] text-subtle uppercase">Decision model</div>
          <div className="mt-1 font-medium text-ink">{current?.label ?? "—"}</div>
          <div className="mt-0.5 text-muted">
            {current ? `${current.n} benchmark patients · ${current.kind === "full" ? "full test set" : "sample"}` : ""}
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 top-12 z-30 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Content */}
      <div className="flex min-h-screen flex-col pt-12 lg:pl-[240px]">
        <main className="flex-1">
          <Outlet />
        </main>
        <footer className="sticky bottom-0 z-10 flex items-center justify-between border-t border-line bg-surface px-4 py-2 text-xs text-muted md:px-8">
          <span>Decision support prototype. Not for clinical use.</span>
          <span className="hidden sm:inline">Research build · IBM Granite</span>
        </footer>
      </div>
    </div>
  );
}
