import type { PatientRow } from "./api";

export const pct = (v: number | null | undefined, digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

export const ageSex = (p: Pick<PatientRow, "age_years" | "sex">) => {
  const a = p.age_years;
  let age = "—";
  if (a != null) {
    if (a < 1 / 12) age = `${Math.round(a * 365)} d`;
    else if (a < 2) age = `${Math.round(a * 12)} mo`;
    else age = `${Math.round(a)} y`;
  }
  return `${age}${p.sex ? ` · ${p.sex}` : ""}`;
};

export const minutes = (m: number) => `${m.toFixed(1)} min`;

export const REASON_TEXT: Record<string, string> = {
  disagreement: "Agents disagree on acuity",
  safety_override: "One agent rated it ESI 1–2",
  agent_failure: "An agent gave no usable answer",
  no_consensus: "Panel did not reach consensus",
  urgent_dissent_overruled: "An agent's initial ESI 1–2 was overruled",
  triage_failed: "Automated triage failed",
};

export const reasonText = (r: string) => REASON_TEXT[r] ?? r;

export const AGENT_ROLES: Record<string, string> = {
  Empath: "Weighs the patient's own words, distress and pain.",
  Logician: "Walks ESI decision points A to D strictly.",
  Skeptic: "Challenges claims the note doesn't support.",
  Observer: "Detail-first: vitals, numbers, small clues.",
  Synthesizer: "Builds the most likely clinical picture.",
  Pragmatist: "Counts what the patient will actually need.",
  Vigilant: "Names dangers, raises acuity only on evidence.",
  Impartial: "Clinical features only; flags non-clinical cues.",
  Mediator: "Finds where the panel splits and what settles it.",
  Reflective: "Calibrates confidence; states uncertainty.",
  "Cautious Clinician": "Safety first. Looks hard for red flags.",
  "Resource Manager": "Applies the ESI algorithm strictly.",
  "Equity Auditor": "Clinical features only. Checks for bias.",
  "Agent 1": "Neutral triage nurse",
  "Agent 2": "Neutral triage nurse",
  "Agent 3": "Neutral triage nurse",
};

export const shortId = (id: string) => id.replace(/^p-/, "").toUpperCase();

export const REASON_SHORT: Record<string, string> = {
  disagreement: "Disagreement",
  safety_override: "Safety override",
  agent_failure: "Agent failure",
  no_consensus: "No consensus",
  urgent_dissent_overruled: "Urgent dissent overruled",
  triage_failed: "Triage failed",
};

export const reasonShort = (r: string) => REASON_SHORT[r] ?? r;
