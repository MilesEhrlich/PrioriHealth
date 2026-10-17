import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/hooks";
import { Brand } from "./Brand";

export function PublicNav() {
  const { user } = useAuth();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center px-4 md:px-6">
        <Brand />
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <Link to="/app" className="btn btn-primary">Open dashboard</Link>
          ) : (
            <>
              <Link to="/signin" className="btn btn-ghost">Sign in</Link>
              <Link to="/signup" className="btn btn-primary">Create account</Link>
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
    </div>
  );
}
