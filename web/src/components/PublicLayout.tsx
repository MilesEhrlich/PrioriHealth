import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/hooks";
import { Brand } from "./Brand";

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg width="7" height="11" viewBox="0 0 7 11" aria-hidden className={className}>
      <path d="M1 1l4.5 4.5L1 10" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Thin top strip: environment note + quick links (patient status, sign in). */
function UtilityBar() {
  const { user } = useAuth();
  return (
    <div className="border-t-[3px] border-t-sage bg-[#eef3ee] text-[13px] text-ink">
      <div className="mx-auto flex h-10 max-w-[1200px] items-center gap-6 px-4 md:px-6">
        <span className="hidden text-muted sm:inline">Decision support prototype · all hospitals are fictional</span>
        <Link to="/status" className="ml-auto hover:text-accent">
          Patient status
        </Link>
        {user ? (
          <Link to="/app" className="hover:text-accent">
            Dashboard
          </Link>
        ) : (
          <Link to="/signin" className="hover:text-accent">
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}

export function PublicNav() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 bg-surface/95 shadow-[0_1px_0_var(--color-line)] backdrop-blur">
      <UtilityBar />
      <div className="mx-auto flex h-[76px] max-w-[1200px] items-center gap-8 px-4 md:px-6">
        <Brand large />
        <nav className="ml-auto hidden items-center gap-7 text-[15px] text-ink md:flex" aria-label="Main">
          <a href="/#what" className="hover:text-accent">Product</a>
          <a href="/#how" className="hover:text-accent">How it works</a>
          <Link to="/status" className="hover:text-accent">For patients</Link>
        </nav>
        <Link
          to={user ? "/app" : "/signup"}
          className="ml-auto inline-flex h-11 items-center gap-2.5 rounded-full border-2 border-sage px-5 text-[15px] font-semibold text-ink transition-colors hover:bg-accent-soft md:ml-0"
        >
          {user ? "Open dashboard" : "Get started"}
          <Chevron />
        </Link>
      </div>
    </header>
  );
}

/** Floating help pill (bottom right), like a support widget: takes patients to their status page. */
function PatientPill() {
  return (
    <Link
      to="/status"
      className="fixed right-4 bottom-4 z-40 inline-flex h-12 items-center gap-2.5 rounded-full bg-accent px-5 text-[15px] font-semibold text-white shadow-[0_10px_24px_-8px_rgb(31_58_46/55%)] hover:bg-accent-hover md:right-6 md:bottom-6"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r="7.5" fill="none" stroke="#fff" strokeWidth="1.6" />
        <path d="M9 4.8V9l2.8 1.8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      Check my wait
    </Link>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-12 md:grid-cols-[1.6fr_1fr_1fr] md:px-6">
        <div>
          <Brand />
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted">
            AI-assisted emergency department triage with a nurse in the loop. Decision support prototype, not a medical
            device and not for clinical use.
          </p>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-ink">Product</div>
          <ul className="mt-3 space-y-2 text-muted">
            <li><Link to="/signin" className="hover:text-ink">Sign in</Link></li>
            <li><Link to="/signup" className="hover:text-ink">Create an account</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-ink">About</div>
          <ul className="mt-3 space-y-2 text-muted">
            <li>
              <a href="https://github.com/MilesEhrlich/PrioriHealth" className="hover:text-ink" target="_blank" rel="noreferrer">
                Source on GitHub
              </a>
            </li>
            <li>Built on IBM LinuxONE and IBM Granite</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-2 px-4 py-5 text-xs text-subtle md:px-6">
          <span>© {new Date().getFullYear()} PrioriHealth · All hospitals in this demo are fictional.</span>
          <span>
            Photos:{" "}
            <a href="https://unsplash.com/@silverkblack" className="underline hover:text-ink" target="_blank" rel="noreferrer">
              Vitaly Gariev
            </a>{" "}
            on Unsplash
          </span>
        </div>
      </div>
    </footer>
  );
}

export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <PublicNav />
      <main className="flex-1">{children}</main>
      <PublicFooter />
      <PatientPill />
    </div>
  );
}
