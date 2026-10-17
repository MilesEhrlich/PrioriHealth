import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/hooks";
import { Brand } from "./Brand";

export const PHOTO_CREDITS = [{ who: "Vitaly Gariev", href: "https://unsplash.com/@silverkblack" }];

export function PublicNav() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-4 md:px-6">
        <Brand />
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex" aria-label="Sections">
          <a href="/#features" className="hover:text-ink">Features</a>
          <a href="/#how" className="hover:text-ink">How it works</a>
          <a href="/#platform" className="hover:text-ink">Platform</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <Link to="/app" className="btn btn-primary">Open dashboard</Link>
          ) : (
            <>
              <Link to="/signin" className="btn btn-ghost hidden sm:inline-flex">Sign in</Link>
              <Link to="/signup" className="btn btn-primary">Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 md:grid-cols-[1.4fr_1fr_1fr] md:px-6">
        <div>
          <Brand />
          <p className="mt-3 max-w-sm text-sm text-muted">
            Decision support prototype for emergency department triage. Not a medical device and not for clinical use.
          </p>
          <p className="mt-2 text-sm text-muted">All hospitals in this demo are fictional.</p>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-ink">Product</div>
          <ul className="mt-3 space-y-2 text-muted">
            <li><a href="/#features" className="hover:text-ink">Features</a></li>
            <li><a href="/#how" className="hover:text-ink">How it works</a></li>
            <li><Link to="/signin" className="hover:text-ink">Sign in</Link></li>
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
            <li>
              Photos:{" "}
              {PHOTO_CREDITS.map((c, i) => (
                <span key={c.who}>
                  {i > 0 && ", "}
                  <a href={c.href} className="underline decoration-line-strong hover:text-ink" target="_blank" rel="noreferrer">
                    {c.who}
                  </a>
                </span>
              ))}{" "}
              on Unsplash
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-4 text-xs text-subtle md:px-6">
          © {new Date().getFullYear()} PrioriHealth · Research build for the IBM datathon
        </div>
      </div>
    </footer>
  );
}

export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <PublicNav />
      <main>{children}</main>
      <PublicFooter />
    </div>
  );
}
