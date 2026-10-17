import type { ReactNode } from "react";
import type { Esi, Vitals } from "../lib/api";

/* ------------------------------------------------------------------ ESI */

const ESI_STYLE: Record<number, { bg: string; fg: string; label: string }> = {
  1: { bg: "var(--color-esi-1)", fg: "#ffffff", label: "Resuscitation" },
  2: { bg: "var(--color-esi-2)", fg: "#161616", label: "Emergent" },
  3: { bg: "var(--color-esi-3)", fg: "#161616", label: "Urgent" },
  4: { bg: "var(--color-esi-4)", fg: "#ffffff", label: "Less urgent" },
  5: { bg: "var(--color-esi-5)", fg: "#ffffff", label: "Non-urgent" },
};

export const esiLabel = (e: number | null | undefined) => (e ? ESI_STYLE[e]?.label : "Unassigned");
export const esiColor = (e: number) => ESI_STYLE[e]?.bg ?? "#e0e0e0";

export function EsiChip({ esi, size = "md", showLabel = false }: {
  esi: Esi | number | null | undefined;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}) {
  const s = esi ? ESI_STYLE[esi] : null;
  const dims = { sm: "h-5 px-1.5 text-[11px]", md: "h-6 px-2 text-xs", lg: "h-8 px-3 text-sm" }[size];
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <span
        className={`num inline-flex shrink-0 items-center justify-center rounded-[4px] font-semibold whitespace-nowrap ${dims}`}
        style={s ? { background: s.bg, color: s.fg } : { background: "#e3e9e4", color: "#56655d" }}
        aria-label={esi ? `ESI ${esi}, ${s?.label}` : "ESI unassigned"}
      >
        {esi ? `ESI ${esi}` : "ESI —"}
      </span>
      {showLabel && <span className="text-sm text-muted">{esiLabel(esi)}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ status */

export function ReviewBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] border border-[#b8862b]/40 bg-[#fdf3dc] font-medium whitespace-nowrap text-[#6b4a0f] ${
        compact ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs"
      }`}
    >
      Needs nurse review
    </span>
  );
}

export function StatusText({ tone, children }: { tone: "ok" | "warn" | "off" | "info"; children: ReactNode }) {
  const dot = { ok: "#24a148", warn: "#f1c21b", off: "#8d8d8d", info: "#3f6b57" }[tone];
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <span className="inline-block size-2 rounded-full" style={{ background: dot }} aria-hidden />
      {children}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "dark" }) {
  const cls = {
    neutral: "bg-line text-ink",
    accent: "bg-accent-soft text-accent",
    dark: "bg-chrome-3 text-white",
  }[tone];
  return <span className={`inline-flex h-5 items-center px-2 text-[11px] font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

/* ------------------------------------------------------------------ layout */

export function Panel({ title, sub, actions, children, className = "", bodyClass = "" }: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <div className="min-w-0 py-2">
            <h2 className="panel-title">{title}</h2>
            {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
          </div>
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Card({ children, className = "", pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={`panel ${pad ? "p-4" : ""} ${className}`}>{children}</section>;
}

export function CardHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div>
        <h2 className="panel-title">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** A row of metric tiles sharing one frame. */
export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className="panel grid grid-cols-2 xl:grid-cols-4 [&>*]:border-line max-xl:[&>*:nth-child(-n+2)]:border-b xl:[&>*:not(:first-child)]:border-l max-xl:[&>*:nth-child(even)]:border-l">{children}</div>;
}

export function Kpi({ label, value, sub, accent = false }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="px-4 py-3.5">
      <div className="eyebrow">{label}</div>
      <div className={`num mt-1.5 text-[28px] leading-9 font-light ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-subtle">{sub}</div>}
    </div>
  );
}

/** Label/value pair, EHR-banner style. */
export function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] leading-4 tracking-[0.32px] text-subtle uppercase">{label}</div>
      <div className={`mt-0.5 truncate text-sm text-ink ${mono ? "num" : ""}`}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ data */

export function ConfidenceBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-3" aria-label={`Confidence ${Math.round(v * 100)} percent`}>
      <div className="h-1 flex-1 bg-line">
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${v * 100}%` }} />
      </div>
      <span className="num w-10 text-right text-xs text-muted">{Math.round(v * 100)}%</span>
    </div>
  );
}

export function VitalsStrip({ v }: { v: Partial<Vitals> }) {
  const items: [string, string | null, string][] = [
    ["HR", v.hr != null ? `${v.hr}` : null, "bpm"],
    ["BP", v.sbp != null && v.dbp != null ? `${v.sbp}/${v.dbp}` : null, "mmHg"],
    ["RR", v.rr != null ? `${v.rr}` : null, "/min"],
    ["SpO₂", v.spo2 != null ? `${v.spo2}` : null, "%"],
    ["Temp", v.temp_f != null ? `${v.temp_f}` : null, "°F"],
  ];
  if (items.every(([, val]) => val == null))
    return <div className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-subtle">No vital signs documented in this note.</div>;
  return (
    <dl className="grid grid-cols-5 divide-x divide-line overflow-hidden rounded-lg border border-line bg-field">
      {items.map(([k, val, unit]) => (
        <div key={k} className="px-3 py-2">
          <dt className="text-[11px] tracking-[0.32px] text-subtle uppercase">{k}</dt>
          <dd className="num mt-0.5 text-sm text-ink">
            {val ?? <span className="text-subtle">—</span>}
            {val && <span className="ml-1 text-[11px] text-subtle">{unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ controls */

/** Content switcher (square, bordered). */
export function Segmented<T extends string>({ value, options, onChange, size = "md" }: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-[4px] border border-line bg-field p-0.5" role="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`${size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3.5 text-sm"} rounded-[4px] transition-colors ${
              on ? "bg-surface font-medium text-accent shadow-[0_1px_2px_rgb(16_24_20/12%)]" : "text-muted hover:text-ink disabled:text-line-strong"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Line tabs (underline). */
export function Tabs<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex" role="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`h-10 border-b-2 px-4 text-sm transition-colors ${
              on
                ? "border-accent font-semibold text-ink"
                : "border-line text-muted hover:border-line-strong hover:text-ink disabled:text-line-strong disabled:hover:border-line"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-4 w-8 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line-strong"}`}
      >
        <span className={`absolute top-[2px] left-[2px] size-3 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start justify-center px-6 py-12">
      <div className="text-base font-semibold text-ink">{title}</div>
      {body && <p className="mt-1 max-w-lg text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-line/70 ${className}`} />;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-[4px] border border-danger/30 bg-[#fdf1f0] p-4 text-sm text-ink">
      <div className="font-semibold">Could not load data</div>
      <div className="mt-1 text-muted">{message}</div>
    </div>
  );
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[4px] border border-sage-light bg-accent-soft px-4 py-3 text-sm">
      <div className="font-semibold text-ink">{title}</div>
      <div className="mt-0.5 text-muted">{children}</div>
    </div>
  );
}
