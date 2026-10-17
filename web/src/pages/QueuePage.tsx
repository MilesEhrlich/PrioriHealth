import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageBody, PageHeader } from "../components/Shell";
import { EmptyState, ErrorNote, EsiChip, Kpi, KpiStrip, Panel, ReviewBadge, Segmented, Skeleton } from "../components/ui";
import { api, type PatientRow, type QueueEntry } from "../lib/api";
import { ageSex, pct, reasonText, shortId } from "../lib/format";
import { useFetch, useResultSet } from "../lib/hooks";

const BASE_INTERVAL_MS = 1200;

export default function QueuePage() {
  const { current } = useResultSet();
  const set = current?.id ?? "";
  const navigate = useNavigate();
  const overview = useFetch(() => api.overview(set), [set]);
  const patients = useFetch(() => api.patients(set), [set]);
  const queue = useFetch(() => api.queue(set), [set]);

  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<"1" | "2" | "4">("1");

  const steps = queue.data ?? [];
  const last = steps.length - 1;
  const step = idx >= 0 ? steps[idx] : null;

  useEffect(() => {
    setIdx(-1);
    setPlaying(false);
  }, [set]);

  useEffect(() => {
    if (!playing) return;
    if (idx >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, last)), BASE_INTERVAL_MS / Number(speed));
    return () => clearTimeout(t);
  }, [playing, idx, last, speed]);

  const byId = useMemo(() => {
    const m = new Map<string, PatientRow>();
    (patients.data ?? []).forEach((p) => m.set(p.patient_id, p));
    return m;
  }, [patients.data]);

  const processed = step?.queue.length ?? 0;
  const reviewCount = step?.review.length ?? 0;
  const agreed = step ? step.queue.filter((e) => byId.get(e.patient_id)?.decision?.range === 0).length : 0;
  const k = overview.data?.kpis;

  if (overview.error || queue.error) return <ErrorNote message={overview.error ?? queue.error ?? ""} />;

  const start = () => {
    if (idx < 0 || idx >= last) setIdx(0);
    setPlaying(true);
  };
  const reset = () => {
    setPlaying(false);
    setIdx(-1);
  };

  return (
    <>
      <PageHeader
        crumbs={["Clinical", "Surge Replay"]}
        title="Surge Replay"
        sub="Waiting-room priority during a simulated surge. Each arrival is triaged by the agent panel and the queue re-ranks by ESI, then arrival time."
        actions={
          <>
            <span className="mr-1 text-xs text-muted">Replay speed</span>
            <Segmented
              size="sm"
              value={speed}
              onChange={setSpeed}
              options={[
                { value: "1", label: "1×" },
                { value: "2", label: "2×" },
                { value: "4", label: "4×" },
              ]}
            />
            <button className="btn btn-tertiary ml-2" onClick={reset} disabled={idx < 0}>
              Reset
            </button>
            {playing ? (
              <button className="btn btn-secondary" onClick={() => setPlaying(false)}>
                Pause
              </button>
            ) : (
              <button className="btn btn-primary" onClick={start} disabled={!steps.length}>
                {idx < 0 ? "Start surge" : idx >= last ? "Replay surge" : "Resume"}
              </button>
            )}
          </>
        }
      />
      <PageBody>
        <KpiStrip>
          <Kpi
            label="Patients processed"
            value={
              <>
                {processed}
                <span className="text-lg text-subtle"> / {steps.length || "—"}</span>
              </>
            }
            sub={step ? `Elapsed T+${step.clock_min.toFixed(1)} min` : "Surge not started"}
          />
          <Kpi
            label="Escalation rate"
            value={processed ? pct(reviewCount / processed) : "—"}
            sub={processed ? `${reviewCount} routed to nurse review` : `Full run ${pct(k?.escalation_rate)}`}
          />
          <Kpi
            label="Unreviewed critical misses"
            value={
              k ? (
                <>
                  {k.critical_misses_unreviewed}
                  <span className="text-lg text-subtle"> / {k.critical_total}</span>
                </>
              ) : (
                "—"
              )
            }
            sub="True ESI 1–2 · evaluation metric"
          />
          <Kpi
            label="Full agreement"
            value={processed ? pct(agreed / processed) : pct(k?.full_agreement)}
            sub={processed ? "All three agents matched" : "Full run"}
          />
        </KpiStrip>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel
            title="Waiting room"
            sub={step ? `Arrival ${idx + 1} of ${steps.length}` : `${steps.length} scheduled arrivals`}
            actions={step && <span className="num text-xs text-muted">Clock T+{step.clock_min.toFixed(1)} min</span>}
          >
            <div className="h-[2px] bg-line">
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: steps.length ? `${((idx + 1) / steps.length) * 100}%` : 0 }}
              />
            </div>
            {queue.loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : !step ? (
              <EmptyState
                title="No patients in the queue"
                body={`Start the surge to replay ${steps.length} arrivals over about ${Math.round(
                  steps[steps.length - 1]?.clock_min ?? 0,
                )} minutes. Cases the agents disagree on are pinned for nurse review.`}
                action={
                  <button className="btn btn-primary" onClick={start}>
                    Start surge
                  </button>
                }
              />
            ) : (
              <QueueTable entries={step.queue} arrived={step.arrived} byId={byId} onOpen={(pid) => navigate(`/app/case/${pid}`)} />
            )}
          </Panel>

          <Panel
            title="Nurse review"
            sub="Pinned until a nurse confirms the level"
            actions={<span className="num text-sm text-ink">{reviewCount}</span>}
            className="self-start xl:sticky xl:top-[72px]"
          >
            <div className="max-h-[600px] overflow-y-auto">
              {!step || !step.review.length ? (
                <div className="px-4 py-8 text-sm text-muted">No cases flagged.</div>
              ) : (
                <ul className="divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {step.queue
                      .filter((e) => e.escalated)
                      .map((e) => (
                        <motion.li
                          key={e.patient_id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <button
                            className="w-full border-l-[3px] border-l-ink px-4 py-2.5 text-left hover:bg-hover"
                            onClick={() => navigate(`/app/case/${e.patient_id}`)}
                          >
                            <div className="flex items-center gap-2">
                              <EsiChip esi={e.esi} size="sm" />
                              <span className="num text-xs text-ink">{shortId(e.patient_id)}</span>
                              <span className="num ml-auto text-xs text-muted">{e.wait_min.toFixed(1)} min</span>
                            </div>
                            <div className="mt-1 truncate text-sm text-ink">
                              {byId.get(e.patient_id)?.chief_complaint || e.chief_complaint}
                            </div>
                            <div className="mt-0.5 text-xs text-muted">{e.escalation_reasons.map(reasonText).join("; ")}</div>
                          </button>
                        </motion.li>
                      ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </Panel>
        </div>
      </PageBody>
    </>
  );
}

function QueueTable({ entries, arrived, byId, onOpen }: {
  entries: QueueEntry[];
  arrived: string;
  byId: Map<string, PatientRow>;
  onOpen: (pid: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[760px]">
        <thead>
          <tr>
            <th className="w-16">Rank</th>
            <th className="w-20">Acuity</th>
            <th className="w-24">Patient</th>
            <th className="w-24">Age / Sex</th>
            <th>Chief complaint</th>
            <th className="w-20 !text-right">Arrived</th>
            <th className="w-20 !text-right">Waiting</th>
            <th className="w-44">Status</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {entries.map((e) => {
              const p = byId.get(e.patient_id);
              const isNew = e.patient_id === arrived;
              return (
                <motion.tr
                  key={e.patient_id}
                  layout="position"
                  initial={{ opacity: 0, backgroundColor: "#edf5ff" }}
                  animate={{ opacity: 1, backgroundColor: isNew ? "#edf5ff" : "rgba(255,255,255,0)" }}
                  transition={{ layout: { duration: 0.4, ease: [0.2, 0, 0.38, 0.9] }, backgroundColor: { duration: 1.2 } }}
                  onClick={() => onOpen(e.patient_id)}
                  className="cursor-pointer"
                >
                  <td>
                    <span className="num">{e.rank}</span>
                    {e.moved !== 0 && (
                      <span className={`num ml-1.5 text-[11px] ${e.moved > 0 ? "text-accent" : "text-subtle"}`}>
                        {e.moved > 0 ? `▲${e.moved}` : `▼${-e.moved}`}
                      </span>
                    )}
                  </td>
                  <td>
                    <EsiChip esi={e.esi} size="sm" />
                  </td>
                  <td className="num text-[13px]">{shortId(e.patient_id)}</td>
                  <td className="text-muted">{p ? ageSex(p) : ""}</td>
                  <td className="max-w-0">
                    <div className="truncate">{p?.chief_complaint || e.chief_complaint}</div>
                  </td>
                  <td className="num text-right text-muted">T+{e.arrival_min.toFixed(1)}</td>
                  <td className="num text-right">{e.wait_min.toFixed(1)}</td>
                  <td>{e.escalated ? <ReviewBadge compact /> : <span className="text-xs text-muted">Auto-triaged</span>}</td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}
