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
      <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-2 px-4 py-6 text-xs text-subtle md:px-6">
        <span>Decision support prototype. Not for clinical use. All hospitals in this demo are fictional.</span>
        <span>
          Photos:{" "}
          <a href="https://unsplash.com/@silverkblack" className="underline hover:text-ink" target="_blank" rel="noreferrer">
            Vitaly Gariev
          </a>{" "}
          on Unsplash
        </span>
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
