// Typed client for the FastAPI backend (src/triage_debate/api.py).

export type Esi = 1 | 2 | 3 | 4 | 5;

export interface ResultSet {
  id: string;
  provider: string;
  kind: "sample" | "full";
  model: string;
  label: string;
  n: number;
}

export interface Vitals {
  hr: number | null;
  rr: number | null;
  sbp: number | null;
  dbp: number | null;
  spo2: number | null;
  temp_f: number | null;
}

export interface Decision {
  esi: Esi | null;
  escalated: boolean;
  reasons: string[];
  range: number;
  mean_confidence: number;
  early_stopped: boolean;
}

export interface PatientRow {
  patient_id: string;
  vignette: string;
  age_years: number | null;
  sex: "M" | "F" | null;
  chief_complaint: string;
  vitals: Vitals;
  decision?: Decision;
}

export interface AgentOutput {
  esi: Esi;
  confidence: number;
  key_findings: string[];
  rationale: string;
  message?: string;
  change_reason?: string;
}

export interface AgentResult {
  agent: string;
  round: number;
  output: AgentOutput | null;
  failure: string | null;
  repaired: boolean;
}

export interface Debate {
  patient_id: string;
  condition: string;
  agents: string[];
  rounds: AgentResult[][];
  consensus_protocol: boolean;
  consensus_threshold?: number;
  consensus_reached: boolean;
  consensus_share?: number;
  rounds_used: number;
  first_round_esis: Record<string, number>;
  initial_range: number;
  early_stopped: boolean;
  final_esis: Record<string, number>;
  final_confidences: Record<string, number>;
  aggregate: Esi | null;
  majority: Esi | null;
  disagreement_range: number;
  mean_confidence: number;
  disagreement_score: number;
  escalated: boolean;
  escalation_reasons: string[];
}

export interface MetricRow {
  condition: "A" | "B" | "C" | "D";
  name: string;
  n: number;
  exact_acc: number;
  within1_acc: number;
  under_triage: number;
  over_triage: number;
  critical_miss: number;
  critical_miss_unreviewed: number;
  escalation_rate: number;
  acc_non_escalated: number | null;
  acc_escalated: number | null;
  auroc_uncertainty: number | null;
  auroc_range: number | null;
  calls_per_patient: number;
  tokens_per_patient: number;
}

export interface Overview {
  set: string;
  run_id: string | null;
  model: string;
  label: string;
  provider: string;
  n_patients: number;
  kpis: {
    patients: number;
    escalation_rate: number;
    escalated: number;
    critical_total: number;
    critical_misses: number;
    critical_misses_unreviewed: number;
    full_agreement: number;
    early_stopped: number | null;
    consensus_rate?: number | null;
    mean_rounds?: number | null;
    n_agents?: number;
  };
  metrics: MetricRow[];
  conditions: Record<string, { exact_acc_ci: [number, number]; critical_miss_ci: [number, number] }>;
  paired_tests: Record<string, { b: number; c: number; p_value: number }>;
  fairness: Record<string, { n_pairs: number; flip_rate: number; flips: number }>;
  takeaways: Record<string, string>;
  escalation: { range_threshold: number; safety_override: boolean };
  protocol?: string;
  max_rounds?: number | null;
  dataset: { n_test?: number; n_train?: number; test_label_counts?: Record<string, number> };
}

export interface QueueEntry {
  patient_id: string;
  arrival_min: number;
  esi: Esi | null;
  escalated: boolean;
  escalation_reasons: string[];
  chief_complaint: string;
  rank: number;
  wait_min: number;
  moved: number;
}

export interface QueueStep {
  step: number;
  clock_min: number;
  arrived: string;
  queue: QueueEntry[];
  review: string[];
}

export interface LiveProvider {
  id: "llamacpp" | "ollama" | "watsonx";
  label: string;
  model: string;
  available: boolean;
  cost: string;
  locked: boolean;
  budget?: number | null;
  used?: number | null;
  remaining?: number | null;
  estimate?: number;
}

export interface SystemInfo {
  platform: { machine: string; system: string; cpus: number | null; is_linuxone: boolean; label: string; accelerator?: string | null };
  default_provider: string;
  engines: Record<string, boolean>;
}

export interface Example {
  id: string;
  vignette: string;
  chief_complaint: string;
}

export type LiveEvent =
  | { type: "start"; patient_id: string; provider: string; model: string; agents: string[]; max_rounds: number; consensus_threshold?: number }
  | { type: "agent"; agent: string; round: number; output: AgentOutput | null; failure: string | null }
  | { type: "round_end"; round: number; votes: Record<string, number> }
  | { type: "early_stop" }
  | { type: "final"; debate: Debate }
  | { type: "error"; error: string; message: string };

export interface WaitRow {
  id: string;
  label: string;
  vignette: string;
  chief_complaint: string;
  arrived_at: number;
  status: "queued" | "triaging" | "triaged" | "failed" | "seen";
  progress: { round: number; agents_done: number; agents: number; votes: Record<string, number> };
  engine: string | null;
  esi: Esi | null;
  safety_esi: Esi | null;
  escalated: boolean;
  reasons: string[];
  consensus_reached: boolean | null;
  rounds_used: number | null;
  nurse_esi: Esi | null;
  triaged_at: number | null;
  seen_at: number | null;
  error: string | null;
  source: string;
  wait_min: number;
  effective_esi?: Esi | null;
  target_min?: number;
  overdue_min?: number;
  position?: number;
}

export interface WaitSnapshot {
  waiting: WaitRow[];
  triaging: WaitRow[];
  seen: WaitRow[];
  now: number;
  targets: Record<string, number>;
  simulating: boolean;
  engine: string | null;
  panel_size: number;
  max_rounds: number;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  sets: () => get<{ sets: ResultSet[]; default: string | null }>("/api/sets"),
  overview: (set: string) => get<Overview>(`/api/${set}/overview`),
  patients: (set: string) => get<PatientRow[]>(`/api/${set}/patients`),
  debate: (set: string, pid: string, cond = "C") => get<Debate>(`/api/${set}/debate/${pid}?cond=${cond}`),
  truth: (set: string, pid: string) => get<{ esi_true: Esi }>(`/api/${set}/truth/${pid}`),
  queue: (set: string) => get<QueueStep[]>(`/api/${set}/queue`),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  figure: (set: string, name: string) => get<{ data: any[]; layout: any }>(`/api/${set}/figure/${name}`),
  liveStatus: () => get<{ providers: LiveProvider[] }>("/api/live/status"),
  system: () => get<SystemInfo>("/api/system"),
  examples: () => get<Example[]>("/api/examples"),
  waitlist: () => get<WaitSnapshot>("/api/waitlist"),
  waitEntry: (id: string) => get<WaitRow & { debate: Debate | null; vitals: Vitals }>(`/api/waitlist/${id}`),
  addArrival: (vignette: string, label?: string) => send<WaitRow>("POST", "/api/waitlist", { vignette, label }),
  confirmEsi: (id: string, esi: number) => send<WaitRow>("POST", `/api/waitlist/${id}/confirm`, { esi }),
  markSeen: (id: string) => send<WaitRow>("POST", `/api/waitlist/${id}/seen`),
  clearWaitlist: () => send<{ ok: boolean }>("DELETE", "/api/waitlist"),
  simulate: (count: number, interval_s: number) => send<{ scheduled: number }>("POST", "/api/waitlist/simulate", { count, interval_s }),
};

/** POST a live case and invoke `onEvent` for each server-sent event. */
export async function runLive(
  vignette: string,
  provider: string,
  onEvent: (e: LiveEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch("/api/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vignette, provider }),
    signal,
  });
  if (!r.ok || !r.body) {
    let message = `Request failed (${r.status})`;
    try {
      const body = await r.json();
      message = body?.detail?.message ?? body?.detail?.[0]?.msg ?? message;
    } catch {
      /* keep default message */
    }
    onEvent({ type: "error", error: String(r.status), message });
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith("data:")) onEvent(JSON.parse(chunk.slice(5)) as LiveEvent);
    }
  }
}
