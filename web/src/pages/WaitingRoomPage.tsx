import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DecisionPanel, PanelDiscussion } from "../components/Debate";
import { PageBody, PageHeader } from "../components/Shell";
import { EmptyState, EsiChip, Kpi, KpiStrip, Panel, ReviewBadge, Skeleton, StatusText, VitalsStrip, esiLabel } from "../components/ui";
import { api, type Debate, type Example, type Vitals, type WaitRow, type WaitSnapshot } from "../lib/api";
import { reasonShort } from "../lib/format";
import { useFetch } from "../lib/hooks";

const POLL_MS = 2000;

const clock = (epoch: number) =>
  new Date(epoch * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

const mmss = (minutes: number) => {
  const s = Math.max(0, Math.floor(minutes * 60));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

export default function WaitingRoomPage() {
  const [snap, setSnap] = useState<WaitSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0); // server clock - client clock (s)
  const [, tick] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const reviewId = params.get("review");
  const setReviewId = (id: string | null) => setParams(id ? { review: id } : {}, { replace: true });
  const [simCount, setSimCount] = useState(6);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.waitlist();
      setSnap(s);
      setOffset(s.now - Date.now() / 1000);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const p = setInterval(refresh, POLL_MS);
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(p);
      clearInterval(t);
    };
  }, [refresh]);

  const now = Date.now() / 1000 + offset;
  const waitMin = (r: WaitRow) => (now - r.arrived_at) / 60;
  const waiting = snap?.waiting ?? [];
  const triaging = snap?.triaging ?? [];
  const overdue = waiting.filter((r) => r.target_min != null && waitMin(r) > r.target_min && r.nurse_esi == null).length;
  const review = waiting.filter((r) => r.escalated && r.nurse_esi == null).length;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Clinical", "Waiting Room"]}
        title="Waiting Room"
        sub={
          <>
            Live arrivals, triaged by the {snap?.panel_size ?? 10}-member panel and ordered by ESI-weighted wait: each level has a target
            time to be seen
            {snap ? ` (ESI 1 immediately, 2 within ${snap.targets["2"]} min, 3 within ${snap.targets["3"]}, 4 within ${snap.targets["4"]}, 5 within ${snap.targets["5"]})` : ""}.
            Patients closest to or past their target are seen first.
          </>
        }
        actions={
          <>
            <select
              className="h-8 border-0 border-b border-[#8d8d8d] bg-field px-2 text-sm"
              value={simCount}
              onChange={(e) => setSimCount(Number(e.target.value))}
              aria-label="Number of simulated arrivals"
            >
              {[3, 6, 10, 15].map((n) => (
                <option key={n} value={n}>
                  {n} arrivals
                </option>
              ))}
            </select>
            <button className="btn btn-tertiary" disabled={busy} onClick={() => act(() => api.simulate(simCount, 25))}>
              {snap?.simulating ? "Simulating…" : "Simulate arrivals"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || !(waiting.length + triaging.length + (snap?.seen.length ?? 0))}
              onClick={() => window.confirm("Clear the waiting room?") && act(() => api.clearWaitlist())}
            >
              Clear
            </button>
            <button className="btn btn-primary" onClick={() => setAddOpen((v) => !v)}>
              Add patient
            </button>
          </>
        }
      />
      <PageBody>
        {error && <div className="border-l-[3px] border-l-danger bg-surface px-4 py-2 text-sm">Waiting room unavailable: {error}</div>}

        <KpiStrip>
          <Kpi label="Waiting to be seen" value={snap ? waiting.length : "—"} sub="Triaged, not yet seen" />
          <Kpi label="Being triaged" value={snap ? triaging.length : "—"} sub={snap?.engine ? `Engine: ${engineName(snap.engine)}` : "No engine online"} />
          <Kpi label="Past target time" value={snap ? overdue : "—"} sub="Waiting longer than their ESI target" accent={overdue > 0} />
          <Kpi label="Needs nurse review" value={snap ? review : "—"} sub="Escalated, level not yet confirmed" />
        </KpiStrip>

        {snap && !snap.engine && (
          <div className="border-l-[3px] border-l-[#f1c21b] bg-surface px-4 py-2 text-sm text-ink">
            No free inference engine is online. New arrivals wait in “Being triaged” and are processed automatically once Ollama
            (Mac) or the llama.cpp server (LinuxONE) is running.
          </div>
        )}

        <AnimatePresence initial={false}>{addOpen && <AddPatient onDone={() => { setAddOpen(false); refresh(); }} />}</AnimatePresence>

        {triaging.length > 0 && (
          <Panel title="Being triaged" sub="The panel is assessing these arrivals now; they join the list when it decides">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-40">Patient</th>
                  <th>Chief complaint</th>
                  <th className="w-24">Arrived</th>
                  <th className="w-24 !text-right">Waiting</th>
                  <th className="w-72">Panel progress</th>
                </tr>
              </thead>
              <tbody>
                {triaging.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.label}</td>
                    <td className="max-w-0 truncate">{r.chief_complaint}</td>
                    <td className="num text-muted">{clock(r.arrived_at)}</td>
                    <td className="num text-right">{mmss(waitMin(r))}</td>
                    <td>
                      <Progress row={r} panelSize={snap?.panel_size ?? 10} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        <Panel
          title="Waiting list"
          sub="Ordered by minutes past ESI target; ESI 1 always first. Escalated cases rank by the most urgent level any member proposed until a nurse confirms."
        >
          {!snap ? (
            <div className="p-4">
              <Skeleton className="h-40" />
            </div>
          ) : !waiting.length ? (
            <EmptyState
              title="Nobody is waiting"
              body="Add a patient or simulate arrivals. Each arrival is triaged by the panel, then placed in order of ESI-weighted wait."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table min-w-[1080px]">
                <thead>
                  <tr>
                    <th className="w-12">#</th>
                    <th className="w-44">Acuity</th>
                    <th className="w-32">Patient</th>
                    <th>Chief complaint</th>
                    <th className="w-20">Arrived</th>
                    <th className="w-24 !text-right">Waiting</th>
                    <th className="w-20 !text-right">Target</th>
                    <th className="w-52">Status</th>
                    <th className="w-40 !text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {waiting.map((r) => {
                      const w = waitMin(r);
                      const late = r.target_min != null && w > r.target_min;
                      return (
                        <motion.tr
                          key={r.id}
                          layout="position"
                          initial={{ opacity: 0, backgroundColor: "#edf5ff" }}
                          animate={{ opacity: 1, backgroundColor: "rgba(255,255,255,0)" }}
                          exit={{ opacity: 0 }}
                          transition={{ layout: { duration: 0.4 }, backgroundColor: { duration: 1.5 } }}
                        >
                          <td className={`num border-l-[3px] ${late ? "border-l-ink" : "border-l-transparent"}`}>{r.position}</td>
                          <td>
                            <AcuityCell r={r} />
                          </td>
                          <td className="font-medium">{r.label}</td>
                          <td className="max-w-0">
                            <div className="truncate">{r.chief_complaint}</div>
                          </td>
                          <td className="num text-muted">{clock(r.arrived_at)}</td>
                          <td className={`num text-right ${late ? "font-semibold" : ""}`}>{mmss(w)}</td>
                          <td className="num text-right text-muted">{r.target_min === 0 ? "now" : `${r.target_min}m`}</td>
                          <td>
                            <StatusCell r={r} wait={w} />
                          </td>
                          <td className="text-right whitespace-nowrap">
                            <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => setReviewId(r.id)}>
                              Review
                            </button>
                            <button className="btn btn-ghost h-7 px-2 text-xs" disabled={busy} onClick={() => act(() => api.markSeen(r.id))}>
                              Seen
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {!!snap?.seen.length && (
          <Panel title="Recently seen">
            <ul className="divide-y divide-line text-sm">
              {snap.seen.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                  <EsiChip esi={r.nurse_esi ?? r.esi} size="sm" />
                  <span className="font-medium">{r.label}</span>
                  <span className="truncate text-muted">{r.chief_complaint}</span>
                  <span className="num ml-auto text-xs text-muted">
                    waited {mmss(((r.seen_at ?? now) - r.arrived_at) / 60)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </PageBody>

      <ReviewDrawer id={reviewId} onClose={() => setReviewId(null)} onChanged={refresh} />
    </>
  );
}

const engineName = (e: string) => (e === "llamacpp" ? "llama.cpp" : e === "ollama" ? "Ollama" : e);

function Progress({ row, panelSize }: { row: WaitRow; panelSize: number }) {
  if (row.status === "queued")
    return <span className="text-xs text-muted">{row.error ? "Waiting for an engine" : "Queued"}</span>;
  const n = row.progress.agents || panelSize;
  const done = row.progress.agents_done;
  const rnd = row.progress.round || 1;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs whitespace-nowrap text-ink">{rnd === 1 ? "Independent" : `Round ${rnd}`}</span>
      <div className="h-1 flex-1 bg-line">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(done / n) * 100}%` }} />
      </div>
      <span className="num text-xs text-muted">
        {done}/{n}
      </span>
    </div>
  );
}

function AcuityCell({ r }: { r: WaitRow }) {
  const eff = r.effective_esi ?? r.esi;
  return (
    <div className="flex items-center gap-2">
      <EsiChip esi={eff} size="sm" />
      {r.nurse_esi != null ? (
        <span className="text-[11px] font-medium text-ink">Nurse confirmed</span>
      ) : r.escalated && r.safety_esi != null && r.esi != null && r.safety_esi < r.esi ? (
        <span className="text-[11px] text-muted">
          panel <span className="num">{r.esi}</span>, ranked as <span className="num">{r.safety_esi}</span>
        </span>
      ) : r.status === "failed" ? (
        <span className="text-[11px] text-muted">unassessed</span>
      ) : (
        <span className="text-[11px] text-muted">Panel</span>
      )}
    </div>
  );
}

function StatusCell({ r, wait }: { r: WaitRow; wait: number }) {
  const left = (r.target_min ?? 0) - wait;
  return (
    <div className="flex flex-col gap-0.5">
      {r.escalated && r.nurse_esi == null && <ReviewBadge compact />}
      {r.target_min != null &&
        (left < 0 ? (
          <span className="text-xs font-semibold text-ink">Past target by {mmss(-left)}</span>
        ) : (
          <span className="text-xs text-muted">{mmss(left)} to target</span>
        ))}
      {r.escalated && r.nurse_esi == null && r.reasons.length > 0 && (
        <span className="text-[11px] text-muted">{r.reasons.map(reasonShort).join(" · ")}</span>
      )}
    </div>
  );
}

function AddPatient({ onDone }: { onDone: () => void }) {
  const examples = useFetch(() => api.examples(), []);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = async () => {
    setSaving(true);
    try {
      await api.addArrival(text.trim(), label.trim() || undefined);
      onDone();
    } finally {
      setSaving(false);
    }
  };
  return (
    <motion.section initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="panel">
      <header className="panel-head">
        <h2 className="panel-title">Register arrival</h2>
        <select
          className="ml-auto h-8 max-w-[280px] border-0 border-b border-[#8d8d8d] bg-field px-2 text-xs"
          value=""
          onChange={(e) => {
            const ex = (examples.data ?? []).find((x: Example) => x.id === e.target.value);
            if (ex) setText(ex.vignette);
          }}
          aria-label="Use a training example"
        >
          <option value="">Use a training example…</option>
          {(examples.data ?? []).map((ex: Example) => (
            <option key={ex.id} value={ex.id}>
              {ex.chief_complaint.slice(0, 48)}
            </option>
          ))}
        </select>
      </header>
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
        <label className="text-xs text-muted">
          Label (optional)
          <input className="input mt-1" placeholder="e.g. Bed 4" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </label>
        <label className="text-xs text-muted">
          Triage note
          <textarea
            ref={ref}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Presenting complaint, history, and vital signs. Do not enter real patient information."
            className="mt-1 w-full resize-y border-0 border-b border-[#8d8d8d] bg-field p-2 text-sm text-ink focus:outline-2 focus:-outline-offset-2 focus:outline-accent"
          />
        </label>
        <button className="btn btn-primary" disabled={saving || text.trim().length < 20} onClick={submit}>
          Add to waiting room
        </button>
      </div>
    </motion.section>
  );
}

function ReviewDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [entry, setEntry] = useState<(WaitRow & { debate: Debate | null; vitals: Vitals }) | null>(null);
  const [member, setMember] = useState<string | null>(null);
  useEffect(() => {
    setEntry(null);
    setMember(null);
    if (id) api.waitEntry(id).then(setEntry);
  }, [id]);
  const confirm = async (esi: number) => {
    if (!id) return;
    await api.confirmEsi(id, esi);
    setEntry(await api.waitEntry(id));
    onChanged();
  };
  const seen = async () => {
    if (!id) return;
    await api.markSeen(id);
    onChanged();
    onClose();
  };
  return (
    <AnimatePresence>
      {id && (
        <>
          <motion.div className="fixed inset-0 z-[60] bg-ink/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-label="Review waiting patient"
            className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[1240px] flex-col bg-page shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.24, ease: [0.2, 0, 0.38, 0.9] }}
          >
            <header className="flex h-14 shrink-0 items-center justify-between bg-chrome px-6 text-white">
              <div>
                <h2 className="text-base font-semibold">{entry?.label ?? "Patient"}</h2>
                <p className="text-xs text-white/70">{entry?.chief_complaint}</p>
              </div>
              <button className="btn h-8 border border-white/30 text-white hover:bg-chrome-3" onClick={onClose}>
                Close
              </button>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {!entry ? (
                <Skeleton className="h-64" />
              ) : (
                <>
                  <Panel title="Triage note">
                    <div className="px-4 py-3">
                      <p className="text-[15px] leading-6">{entry.vignette}</p>
                      <div className="mt-3">
                        <VitalsStrip v={entry.vitals} />
                      </div>
                    </div>
                  </Panel>
                  <section className="panel">
                    <header className="panel-head">
                      <div className="py-2">
                        <h2 className="panel-title">Nurse decision</h2>
                        <p className="mt-0.5 text-xs text-muted">
                          {entry.nurse_esi != null
                            ? `Confirmed ESI ${entry.nurse_esi} (${esiLabel(entry.nurse_esi)}).`
                            : `Panel assigned ESI ${entry.esi ?? "—"}. Confirm it or set a different level.`}
                        </p>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        {[1, 2, 3, 4, 5].map((e) => (
                          <button
                            key={e}
                            onClick={() => confirm(e)}
                            className={`h-8 px-1 ${entry.nurse_esi === e ? "outline-2 outline-offset-1 outline-ink" : "opacity-80 hover:opacity-100"}`}
                            aria-label={`Confirm ESI ${e}`}
                          >
                            <EsiChip esi={e} />
                          </button>
                        ))}
                        <button className="btn btn-secondary ml-3" onClick={seen}>
                          Mark seen
                        </button>
                      </div>
                    </header>
                    {entry.engine && (
                      <div className="px-4 py-2 text-xs text-muted">
                        <StatusText tone="info">
                          Triaged by {engineName(entry.engine)} · {entry.rounds_used ?? "—"} round{entry.rounds_used === 1 ? "" : "s"}
                          {entry.consensus_reached ? " · consensus" : entry.consensus_reached === false ? " · no consensus" : ""}
                        </StatusText>
                      </div>
                    )}
                  </section>
                  {entry.debate ? (
                    <>
                      <PanelDiscussion agents={entry.debate.agents} rounds={entry.debate.rounds} selected={member} onSelect={setMember} />
                      <DecisionPanel debate={entry.debate} />
                    </>
                  ) : (
                    <Panel>
                      <EmptyState
                        title={entry.status === "failed" ? "Automated triage failed" : "Panel still assessing"}
                        body={entry.error ?? "The discussion appears here when the panel finishes."}
                      />
                    </Panel>
                  )}
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
