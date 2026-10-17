import type { CSSProperties, ReactNode } from "react";
import { C, ESI, FONT, MONO, STROKE } from "./theme";

type Fig = { x: number; y: number; scale?: number; color?: string; style?: CSSProperties };

const wrap = (x: number, y: number, scale: number, w: number, h: number, children: ReactNode, style?: CSSProperties) => (
  <svg
    width={w * scale}
    height={h * scale}
    viewBox={`0 0 ${w} ${h}`}
    style={{ position: "absolute", left: x - (w * scale) / 2, top: y - h * scale, overflow: "visible", ...style }}
  >
    {children}
  </svg>
);

/** Shared outline body: head + shoulders/torso + legs. Anchored at the feet (x center, y bottom). */
function Body({ color, legs = 0 }: { color: string; legs?: number }) {
  // legs: -1..1 swing for walking
  const l = 10 * legs;
  return (
    <g fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="50" cy="28" r="18" />
      <path d="M22 118 V78 Q22 56 50 56 Q78 56 78 78 V118" />
      <path d={`M38 118 L${38 - l} 170`} />
      <path d={`M62 118 L${62 + l} 170`} />
    </g>
  );
}

export function Patient({ x, y, scale = 1, color = C.ink, legs = 0, style }: Fig & { legs?: number }) {
  return wrap(x, y, scale, 100, 172, <Body color={color} legs={legs} />, style);
}

export function Doctor({ x, y, scale = 1, color = C.ink, style }: Fig) {
  return wrap(
    x,
    y,
    scale,
    100,
    172,
    <>
      <Body color={color} />
      <g fill="none" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        {/* coat lapels */}
        <path d="M42 57 L50 80 L58 57" stroke={color} />
        <path d="M50 80 V118" stroke={color} />
        {/* stethoscope */}
        <path d="M36 60 Q34 92 50 96 Q66 92 64 60" stroke={C.accent} />
        <circle cx="50" cy="100" r="5" stroke={C.accent} />
      </g>
    </>,
    style,
  );
}

export function Nurse({ x, y, scale = 1, color = C.ink, style }: Fig) {
  return wrap(
    x,
    y,
    scale,
    100,
    172,
    <>
      <Body color={color} />
      <g fill="none" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        {/* cap with cross */}
        <path d="M33 16 Q50 2 67 16 L64 22 H36 Z" stroke={C.accent} fill={C.surface} />
        <path d="M50 9 V17 M46 13 H54" stroke={C.accent} />
        {/* scrubs V-neck */}
        <path d="M40 57 L50 70 L60 57" stroke={color} />
      </g>
    </>,
    style,
  );
}

/** Small round reviewer avatar for the AI panel. */
export function Reviewer({ x, y, size = 64, active = true }: { x: number; y: number; size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ position: "absolute", left: x - size / 2, top: y - size / 2 }}>
      <circle cx="32" cy="32" r="30" fill={C.surface} stroke={active ? C.accent : C.lineStrong} strokeWidth={STROKE} />
      <circle cx="32" cy="26" r="9" fill="none" stroke={active ? C.accent : C.lineStrong} strokeWidth={STROKE} />
      <path d="M16 50 Q32 34 48 50" fill="none" stroke={active ? C.accent : C.lineStrong} strokeWidth={STROKE} strokeLinecap="round" />
    </svg>
  );
}

export function EsiChip({ esi, size = 28, style }: { esi: number; size?: number; style?: CSSProperties }) {
  const s = ESI[esi]!;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: size,
        padding: `0 ${size * 0.35}px`,
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        fontFamily: MONO,
        fontWeight: 600,
        fontSize: size * 0.55,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      ESI {esi}
    </span>
  );
}

/** Triage note card: title, text lines that "type" in, and a vitals row. */
export function NoteCard({ progress = 1, width = 420, style }: { progress?: number; width?: number; style?: CSSProperties }) {
  const lines = [0.92, 0.78, 0.86, 0.6];
  return (
    <div
      style={{
        width,
        background: C.surface,
        border: `2px solid ${C.line}`,
        borderRadius: 4,
        padding: 24,
        fontFamily: FONT,
        boxShadow: "0 18px 40px -20px rgba(16,40,28,0.35)",
        ...style,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: C.muted, letterSpacing: 0.5, textTransform: "uppercase" }}>Triage note</div>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {lines.map((w, i) => {
          const p = Math.max(0, Math.min(1, progress * lines.length - i));
          return <div key={i} style={{ height: 10, width: `${w * 100 * p}%`, background: C.lineStrong, borderRadius: 2 }} />;
        })}
      </div>
      <div style={{ marginTop: 20, display: "flex", gap: 10, opacity: Math.max(0, Math.min(1, progress * 4 - 3)) }}>
        {["HR 118", "BP 92/60", "SpO₂ 93%"].map((v) => (
          <span key={v} style={{ fontFamily: MONO, fontSize: 15, color: C.ink, background: C.accentSoft, padding: "4px 8px", borderRadius: 3 }}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

const LOGO = { outer: "#4E8A68", center: "#2F5A46", alert: "#D0393B" };

/** Logo mark: sage cross of blocks + outlined red block. `draw` 0..1 brings the blocks in one by one. */
export function LogoMark({ size = 96, draw = 1 }: { size?: number; draw?: number }) {
  const blocks = [
    { x: 10.2, y: 10.2, fill: LOGO.center },
    { x: 10.2, y: 0, fill: LOGO.outer },
    { x: 0, y: 10.2, fill: LOGO.outer },
    { x: 20.4, y: 10.2, fill: LOGO.outer },
  ];
  const step = (i: number) => Math.max(0, Math.min(1, draw * 5 - i));
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" style={{ overflow: "visible" }}>
      {blocks.map((b, i) => {
        const t = step(i);
        return (
          <rect key={i} x={b.x} y={b.y - (1 - t) * 4} width="9.6" height="9.6" fill={b.fill} opacity={t} />
        );
      })}
      <rect
        x="10.9"
        y="20.9"
        width="8.2"
        height="8.2"
        fill="none"
        stroke={LOGO.alert}
        strokeWidth="1.4"
        strokeDasharray="33"
        strokeDashoffset={33 * (1 - step(4))}
      />
    </svg>
  );
}

/** "Priori" bold + "Health" regular, as in the logo. */
export function Wordmark({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <span style={{ fontSize: size, letterSpacing: -size * 0.02, color: C.ink, ...style }}>
      <span style={{ fontWeight: 600 }}>Priori</span>
      <span style={{ fontWeight: 400 }}>Health</span>
    </span>
  );
}
