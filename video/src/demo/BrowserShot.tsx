import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp } from "../common";
import { C, FONT } from "../theme";

export type Box = { x: number; y: number; w: number; h: number }; // screenshot pixels (1920x1080 page)
export type Step = { at: number; to?: Box; click?: boolean; image?: string; zoom?: { scale: number; focus: Box } | null };

const PAGE_W = 1920;
const PAGE_H = 1080;
const BAR = 44;
const WIN_W = 1480;
const SCALE = WIN_W / PAGE_W;
const WIN_H = BAR + PAGE_H * SCALE;
const WIN_X = (1920 - WIN_W) / 2;
const WIN_Y = (930 - WIN_H) / 2;

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function Cursor({ x, y, pressed }: { x: number; y: number; pressed: number }) {
  return (
    <svg width="34" height="40" viewBox="0 0 24 28" style={{ position: "absolute", left: x - 4, top: y - 2, transform: `scale(${1 - pressed * 0.12})`, transformOrigin: "4px 2px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))" }}>
      <path d="M2 1 L2 22 L7.5 17 L11 25 L14.5 23.5 L11 15.5 L18.5 15.5 Z" fill="#1D2226" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A browser window showing real screenshots of the site. Steps run in order: at frame `at`
 * the cursor glides to `to`, optionally clicks (ripple), swaps to `image`, or zooms.
 */
export function BrowserShot({ url, image, steps, start }: { url: string; image: string; steps: Step[]; start?: { x: number; y: number } }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Current and previous screenshot (crossfade on swaps).
  let img = image;
  let prev: string | null = null;
  let swapAt = -1;
  for (const s of steps) {
    if (s.image && frame >= s.at) {
      prev = img;
      img = s.image;
      swapAt = s.at;
    }
  }
  const fadeIn = swapAt >= 0 ? interpolate(frame, [swapAt, swapAt + 10], [0, 1], clamp) : 1;

  // Cursor path: glide between targets over 18 frames before each step's frame.
  let pos = start ?? { x: PAGE_W * 0.62, y: PAGE_H * 0.7 };
  for (const s of steps) {
    if (!s.to) continue;
    const target = center(s.to);
    const t = interpolate(frame, [s.at - 18, s.at], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
    pos = { x: pos.x + (target.x - pos.x) * t, y: pos.y + (target.y - pos.y) * t };
  }
  const clicks = steps.filter((s) => s.click);
  const lastClick = clicks.filter((s) => frame >= s.at).pop();
  const since = lastClick ? frame - lastClick.at : 999;
  const pressed = since < 8 ? 1 - since / 8 : 0;
  const ripple = since < 20 ? since / 20 : null;

  // Zoom: the latest zoom step wins; springs toward it.
  let zoom = { scale: 1, cx: PAGE_W / 2, cy: PAGE_H / 2 };
  let zoomFrom = { scale: 1, cx: PAGE_W / 2, cy: PAGE_H / 2 };
  let zoomAt = 0;
  for (const s of steps) {
    if (s.zoom !== undefined && frame >= s.at) {
      zoomFrom = zoom;
      const f = s.zoom ? center(s.zoom.focus) : null;
      zoom = s.zoom && f ? { scale: s.zoom.scale, cx: f.x, cy: f.y } : { scale: 1, cx: PAGE_W / 2, cy: PAGE_H / 2 };
      zoomAt = s.at;
    }
  }
  const zp = spring({ frame: frame - zoomAt, fps, config: { damping: 30, mass: 1.2 } });
  const zs = zoomFrom.scale + (zoom.scale - zoomFrom.scale) * zp;
  const zcx = zoomFrom.cx + (zoom.cx - zoomFrom.cx) * zp;
  const zcy = zoomFrom.cy + (zoom.cy - zoomFrom.cy) * zp;
  // Keep the zoomed page covering the viewport.
  const tx = Math.min(0, Math.max(PAGE_W - PAGE_W * zs, PAGE_W / 2 - zcx * zs));
  const ty = Math.min(0, Math.max(PAGE_H - PAGE_H * zs, PAGE_H / 2 - zcy * zs));
  const toScreen = (p: { x: number; y: number }) => ({ x: p.x * zs + tx, y: p.y * zs + ty });
  const cur = toScreen(pos);

  return (
    <div style={{ position: "absolute", left: WIN_X, top: WIN_Y, width: WIN_W, height: WIN_H, borderRadius: 14, overflow: "hidden", background: C.surface, boxShadow: "0 30px 70px -30px rgba(16,40,28,0.45), 0 0 0 1px rgba(16,40,28,0.08)" }}>
      <div style={{ height: BAR, background: "#F1F3F4", borderBottom: "1px solid #E1E4E6", display: "flex", alignItems: "center", gap: 10, padding: "0 18px" }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
        ))}
        <div style={{ marginLeft: 18, flex: 1, height: 28, borderRadius: 7, background: "#FFFFFF", border: "1px solid #E1E4E6", display: "flex", alignItems: "center", padding: "0 14px", fontFamily: FONT, fontSize: 16, color: "#5A6168" }}>
          🔒&#160; {url}
        </div>
      </div>
      <div style={{ position: "relative", width: WIN_W, height: WIN_H - BAR, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, height: PAGE_H, transform: `scale(${SCALE})`, transformOrigin: "0 0" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: PAGE_W, height: PAGE_H, transform: `translate(${tx}px, ${ty}px) scale(${zs})`, transformOrigin: "0 0" }}>
            {prev && fadeIn < 1 && <Img src={staticFile(`demo/${prev}`)} style={{ position: "absolute", width: PAGE_W, height: PAGE_H }} />}
            <Img src={staticFile(`demo/${img}`)} style={{ position: "absolute", width: PAGE_W, height: PAGE_H, opacity: fadeIn }} />
          </div>
          {ripple !== null && (
            <div style={{ position: "absolute", left: cur.x - 30, top: cur.y - 30, width: 60, height: 60, borderRadius: 30, border: `4px solid ${C.accent}`, opacity: 1 - ripple, transform: `scale(${0.4 + ripple * 1.2})` }} />
          )}
          <Cursor x={cur.x} y={cur.y} pressed={pressed} />
        </div>
      </div>
    </div>
  );
}
