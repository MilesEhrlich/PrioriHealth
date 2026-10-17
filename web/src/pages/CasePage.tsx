import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DecisionPanel, PanelDiscussion } from "../components/Debate";
import { LiveDrawer } from "../components/LiveDrawer";
import { PageBody, PageHeader } from "../components/Shell";
import { EmptyState, ErrorNote, EsiChip, Field, Panel, ReviewBadge, Segmented, Skeleton, Toggle, VitalsStrip, esiColor } from "../components/ui";
import { api, type Esi } from "../lib/api";
import { ageSex, shortId } from "../lib/format";
import { useFetch, useResultSet } from "../lib/hooks";

export default function CasePage() {
  const { current } = useResultSet();
  const set = current?.id ?? "";
  const { pid } = useParams();
  const navigate = useNavigate();
  const patients = useFetch(() => api.patients(set), [set]);
  const overview = useFetch(() => api.overview(set), [set]);
  const [query, setQuery] = useState("");
  const [cond, setCond] = useState<"C" | "B">("C");
  const [member, setMember] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [truth, setTruth] = useState<Esi | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);

  const list = patients.data ?? [];
  const selected = list.find((p) => p.patient_id === pid) ?? null;

  useEffect(() => {
    if (!pid && list.length) navigate(`/case/${list[0].patient_id}`, { replace: true });
  }, [pid, list, navigate]);

  const debate = useFetch(() => (pid ? api.debate(set, pid, cond) : Promise.resolve(null)), [set, pid, cond]);

  useEffect(() => {
    setReveal(false);
    setTruth(null);
  }, [pid, set]);

  useEffect(() => {
    if (debate.data) setMember(null);
  }, [debate.data]);

  useEffect(() => {
    if (reveal && pid && truth == null) api.truth(set, pid).then((t) => setTruth(t.esi_true));
  }, [reveal, pid, set, truth]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((p) => `${p.patient_id} ${p.chief_complaint} ${p.vignette}`.toLowerCase().includes(q)) : list;
  }, [list, query]);

  if (patients.error) return <ErrorNote message={patients.error} />;

  const d = debate.data;
  const isV2 = !!d?.consensus_protocol || (d?.agents.length ?? 0) > 3;

  return (
    <>
      <PageHeader
        crumbs={["Clinical", "Case Review"]}
        title="Case Review"
        sub="Each agent's assessment, how it changed after discussion, and why the case was or wasn't routed to a nurse."
        actions={
          <button className="btn btn-primary" onClick={() => setLiveOpen(true)}>
            Triage new case
          </button>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* Worklist */}
          <Panel title="Patients" actions={<span className="num text-xs text-muted">{filtered.length}</span>} className="self-start lg:sticky lg:top-[64px]">
            <div className="border-b border-line p-3">
              <input className="input" placeholder="Search ID or complaint" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search patients" />
            </div>
            <ul className="max-h-[calc(100vh-290px)] overflow-y-auto">
              {patients.loading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <li key={i} className="px-4 py-3">
                    <Skeleton className="h-9" />
                  </li>
                ))}
              {filtered.map((p) => {
                const on = p.patient_id === pid;
                return (
                  <li key={p.patient_id}>
                    <button
                      onClick={() => navigate(`/case/${p.patient_id}`)}
                      className={`w-full border-b border-l-[3px] border-b-line px-3 py-2.5 text-left transition-colors ${
                        on ? "border-l-accent bg-line" : "border-l-transparent hover:bg-hover"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <EsiChip esi={p.decision?.esi} size="sm" />
                        <span className="num text-xs text-ink">{shortId(p.patient_id)}</span>
                        <span className="text-xs text-muted">{ageSex(p)}</span>
                        {p.decision?.escalated && (
                          <span className="ml-auto border border-ink px-1 text-[10px] leading-4 font-medium text-ink" title="Needs nurse review">
                            REVIEW
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-sm text-ink">{p.chief_complaint}</div>
                    </button>
                  </li>
                );
              })}
              {!patients.loading && !filtered.length && <li className="px-4 py-6 text-sm text-muted">No matches.</li>}
            </ul>
          </Panel>

          {/* Case */}
          <div className="flex min-w-0 flex-col gap-4">
            {!selected ? (
              <Panel>
                <EmptyState title="Select a patient" body="Choose a case from the list to review the panel's reasoning." />
              </Panel>
            ) : (
              <>
                {/* Patient banner */}
                <section
                  className="panel flex flex-wrap items-center gap-x-8 gap-y-3 border-l-[4px] px-4 py-3"
                  style={{ borderLeftColor: selected.decision?.esi ? esiColor(selected.decision.esi) : "#c6c6c6" }}
                >
                  <Field label="Patient ID" mono>
                    {shortId(selected.patient_id)}
                  </Field>
                  <Field label="Age / Sex">{ageSex(selected)}</Field>
                  <div className="min-w-[220px] flex-1">
                    <Field label="Chief complaint">
                      <span className="font-semibold" title={selected.chief_complaint}>
                        {selected.chief_complaint}
                      </span>
                    </Field>
                  </div>
                  <Field label="Panel acuity">
                    <EsiChip esi={selected.decision?.esi} size="sm" showLabel />
                  </Field>
                  <div className="flex items-center gap-4">
                    {selected.decision?.escalated ? <ReviewBadge compact /> : <span className="text-xs text-muted">Auto-triaged</span>}
                    <Toggle checked={reveal} onChange={setReveal} label="Show reference" />
                  </div>
                </section>

                <Panel title="Triage note" sub="Free-text vignette as presented to the agents">
                  <div className="px-4 py-3">
                    <p className="text-[15px] leading-6 text-ink">{selected.vignette}</p>
                    <div className="mt-3">
                      <VitalsStrip v={selected.vitals} />
                    </div>
                  </div>
                </Panel>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-ink">Panel discussion</h2>
                    <p className="text-xs text-muted">
                      {d
                        ? `${d.agents.length} members · ${
                            d.consensus_protocol
                              ? d.consensus_reached
                                ? d.rounds_used === 1
                                  ? "unanimous on independent assessment"
                                  : `consensus in round ${d.rounds_used}`
                                : `no consensus after ${d.rounds_used} rounds`
                              : `${d.rounds.length} round${d.rounds.length === 1 ? "" : "s"}`
                          }`
                        : "Loading…"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">Panel</span>
                    <Segmented
                      size="sm"
                      value={cond}
                      onChange={(v) => setCond(v)}
                      options={[
                        { value: "C", label: isV2 ? "Trait panel" : "Role-based agents" },
                        { value: "B", label: "Neutral agents" },
                      ]}
                    />
                  </div>
                </div>

                {debate.loading ? (
                  <Skeleton className="h-80" />
                ) : debate.error || !d ? (
                  <Panel>
                    <EmptyState title="No assessment recorded" body="This result set has no transcript for this patient and panel." />
                  </Panel>
                ) : (
                  <>
                    <PanelDiscussion agents={d.agents} rounds={d.rounds} selected={member} onSelect={setMember} />
                    <DecisionPanel debate={d} truth={reveal ? truth : null} threshold={overview.data?.escalation.range_threshold ?? 1} />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </PageBody>

      <LiveDrawer open={liveOpen} onClose={() => setLiveOpen(false)} threshold={overview.data?.escalation.range_threshold ?? 1} />
    </>
  );
}
