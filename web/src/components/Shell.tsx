import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/hooks";
import { Brand } from "./Brand";

const NAV: { group: string; items: { to: string; label: string; hint: string }[] }[] = [
  {
    group: "Department",
    items: [
      { to: "/app", label: "Dashboard", hint: "Today at a glance" },
      { to: "/app/waiting", label: "Waiting Room", hint: "Live arrivals and nurse review" },
      { to: "/app/case", label: "Case Review", hint: "Panel reasoning for each patient" },
    ],
  },
  {
    group: "Research",
    items: [
      { to: "/app/queue", label: "Surge Replay", hint: "Replay a recorded surge" },
      { to: "/app/results", label: "Evaluation Results", hint: "Accuracy, safety and cost" },
    ],
  },
];

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden>
      {open ? (
        <path d="M3 1l12 12M15 1L3 13" stroke="#1c2b24" strokeWidth="1.6" />
      ) : (
        <path d="M0 1h18M0 7h18M0 13h18" stroke="#1c2b24" strokeWidth="1.6" />
      )}
    </svg>
  );
}

function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 top-14 z-40 bg-ink/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed top-14 bottom-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col border-r border-line bg-surface"
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ type: "tween", duration: 0.2 }}
            aria-label="Main navigation"
          >
            <nav className="flex-1 overflow-y-auto px-3 py-5">
              {NAV.map((g) => (
                <div key={g.group} className="mb-6">
                  <div className="px-3 pb-2 text-[11px] font-semibold tracking-[0.6px] text-subtle uppercase">{g.group}</div>
                  {g.items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.to === "/app"}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `mb-0.5 block rounded-[3px] border-l-[3px] px-3 py-2 transition-colors ${
                          isActive ? "border-accent bg-accent-soft" : "border-transparent hover:bg-hover"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <div className={`text-sm ${isActive ? "font-semibold text-accent" : "font-medium text-ink"}`}>{n.label}</div>
                          <div className="text-xs text-muted">{n.hint}</div>
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
            {user && (
              <div className="border-t border-line px-6 py-4 text-xs text-muted">
                <div className="font-medium text-ink">{user.hospital.name}</div>
                <div>Fictional facility · decision support prototype</div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function HospitalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="text-accent">
      <path d="M2.5 14.5V4.5l5.5-3 5.5 3v10M1 14.5h14M6.5 14.5v-3h3v3M8 5v3M6.5 6.5h3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
    </svg>
  );
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
        className="flex items-center gap-2.5 rounded-[4px] px-2.5 py-1 hover:bg-hover"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="text-left leading-tight">
          <span className="block max-w-[140px] truncate text-sm font-medium text-ink sm:max-w-none">{user.name}</span>
          <span className="hidden text-[11px] text-muted sm:block">{user.role}</span>
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="#5a6168" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-[6px] border border-line bg-surface shadow-[var(--shadow-lift)]">
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

/** Page title row: title, one-line description, actions. */
export function PageHeader({ title, sub, actions }: {
  crumbs?: string[];
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[1280px] flex-wrap items-end justify-between gap-4 px-4 pt-8 pb-2 md:px-8">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-8 font-semibold tracking-[-0.3px] text-ink">{title}</h1>
        {sub && <p className="mt-1.5 max-w-3xl text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Standard page body padding + max width. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 py-6 md:px-8">{children}</div>;
}

export function Shell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="app-neutral min-h-screen bg-page">
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-3 border-b border-line bg-surface px-3 md:px-5">
        <button
          className="grid size-10 place-items-center rounded-[3px] hover:bg-hover"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          <MenuIcon open={open} />
        </button>
        <Brand to="/app" />
        {user && (
          <span className="ml-3 hidden items-center gap-2 border-l border-line pl-4 text-sm text-muted md:flex">
            <HospitalIcon />
            {user.hospital.name}
          </span>
        )}
        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>
      <NavDrawer open={open} onClose={() => setOpen(false)} />

      <div className="flex min-h-screen flex-col pt-14">
        <main className="flex-1">
          <Outlet />
        </main>
        <footer className="mx-auto w-full max-w-[1280px] px-4 py-6 text-xs text-subtle md:px-8">
          Decision support prototype. Not for clinical use.
        </footer>
      </div>
    </div>
  );
}
