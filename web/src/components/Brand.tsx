import { Link } from "react-router-dom";

/** PrioriHealth mark: a rounded sage square with a medical cross and a pulse notch. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#3F6B57" />
      <path d="M13 7.5h6v5.5h5.5v6H19v5.5h-6V19H7.5v-6H13z" fill="#fff" />
      <circle cx="16" cy="16" r="2.2" fill="#8BA888" />
    </svg>
  );
}

export function Brand({ to = "/", sub }: { to?: string; sub?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-lg" aria-label="PrioriHealth home">
      <LogoMark />
      <span className="leading-tight">
        <span className="block text-[17px] font-semibold tracking-[-0.2px] text-ink">PrioriHealth</span>
        {sub && <span className="block text-[11px] text-muted">{sub}</span>}
      </span>
    </Link>
  );
}
