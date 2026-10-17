// Colors and type from web/src/styles/index.css so the video matches the product.
export const C = {
  page: "#F5F7F4",
  surface: "#FFFFFF",
  line: "#DDE5DE",
  lineStrong: "#C3CFC5",
  ink: "#1C2B24",
  muted: "#56655D",
  accent: "#3F6B57",
  accentSoft: "#EAF2EC",
  sage: "#8BA888",
  chrome: "#1F3A2E",
  review: "#FDF3DC",
  reviewInk: "#6B4A0F",
};

export const ESI: Record<number, { bg: string; fg: string; label: string }> = {
  1: { bg: "#DA1E28", fg: "#FFFFFF", label: "Resuscitation" },
  2: { bg: "#FF832B", fg: "#161616", label: "Emergent" },
  3: { bg: "#F1C21B", fg: "#161616", label: "Urgent" },
  4: { bg: "#24A148", fg: "#FFFFFF", label: "Less urgent" },
  5: { bg: "#0F62FE", fg: "#FFFFFF", label: "Non-urgent" },
};

export const FONT = '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"IBM Plex Mono", Menlo, monospace';
export const FPS = 30;
export const STROKE = 3;
