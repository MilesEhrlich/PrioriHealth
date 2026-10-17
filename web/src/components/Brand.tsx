import { Link } from "react-router-dom";

export const LOGO = { outer: "#4E8A68", center: "#2F5A46", alert: "#D0393B" };

/** PrioriHealth mark: a cross of sage blocks with an outlined red block below (the case a nurse reviews). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
      <rect x="10.2" y="0" width="9.6" height="9.6" fill={LOGO.outer} />
      <rect x="0" y="10.2" width="9.6" height="9.6" fill={LOGO.outer} />
      <rect x="10.2" y="10.2" width="9.6" height="9.6" fill={LOGO.center} />
      <rect x="20.4" y="10.2" width="9.6" height="9.6" fill={LOGO.outer} />
      <rect x="10.9" y="20.9" width="8.2" height="8.2" fill="none" stroke={LOGO.alert} strokeWidth="1.4" />
    </svg>
  );
}

/** "Priori" bold + "Health" regular, as in the logo. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`tracking-[-0.3px] text-ink ${className}`}>
      <span className="font-semibold">Priori</span>
      <span className="font-normal">Health</span>
    </span>
  );
}

export function Brand({ to = "/", sub }: { to?: string; sub?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-[3px]" aria-label="PrioriHealth home">
      <LogoMark />
      <span className="leading-tight">
        <Wordmark className="block text-[19px]" />
        {sub && <span className="block text-[11px] text-muted">{sub}</span>}
      </span>
    </Link>
  );
}
