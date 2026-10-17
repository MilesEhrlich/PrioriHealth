import { Link, useNavigate } from "react-router-dom";
import { PageBody, PageHeader } from "../components/Shell";
import { ErrorNote, EsiChip, Kpi, KpiStrip, Panel, Skeleton, StatusText, esiColor, esiLabel } from "../components/ui";
import { api, type PatientRow } from "../lib/api";
import { ageSex, pct, reasonShort, shortId } from "../lib/format";
import { useFetch, useResultSet } from "../lib/hooks";

const formatRun = (id: string | null | undefined) => {
  const m = id?.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return "—";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};

const STEPS = [
  ["Independent assessment", "Ten panel members, each with a different reasoning style (Empath, Logician, Skeptic, Observer and others), assign an ESI level from the triage note alone."],
  ["Discussion", "If they disagree, each member reads everyone's position and argument, replies to specific members by name, and may revise. Changes need a named clinical reason, not peer pressure."],
  ["Consensus", "Discussion repeats until at least 9 of 10 members agree, for up to five rounds. Without consensus, the confidence-weighted median stands."],
  ["Escalation", "No consensus, or a member who first said ESI 1–2 being talked down, routes the case to a nurse."],
]

export default function HomePage() {
  const { current } = useResultSet();
  const set = current?.id ?? "";
  const navigate = useNavigate();
  const ov = useFetch(() => api.overview(set), [set]);
  const pts = useFetch(() => api.patients(set), [set]);
  const live = useFetch(() => api.liveStatus(), []);
  const sys = useFetch(() => api.system(), []);

  if (ov.error) return <ErrorNote message={ov.error} />;
  const k = ov.data?.kpis;
  const patients = pts.data ?? [];
  const worklist = patients
    .filter((p) => p.decision?.escalated)
    .sort((a, b) => (a.decision?.esi ?? 0) - (b.decision?.esi ?? 0));
  const counts = [1, 2, 3, 4, 5].map((e) => patients.filter((p) => p.decision?.esi === e).length);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const localEngine = live.data?.providers.find((p) => p.id !== "watsonx" && p.available);
  const wx = live.data?.providers.find((p) => p.id === "watsonx");

  return (
    <>
      <PageHeader
        crumbs={["Overview"]}
        title="Emergency Department Triage"
        sub="Multi-agent decision support for Emergency Severity Index (ESI) triage. A ten-member AI panel with different reasoning styles discusses each patient until it agrees, and cases it can't settle are routed to a nurse."
        actions={
          <>
            <button className="btn btn-tertiary" onClick={() => navigate("/case")}>
              Review cases
            </button>
            <button className="btn btn-primary" onClick={() => navigate("/waiting")}>
              Open waiting room
            </button>
          </>
        }
      />
      <PageBody>
        <KpiStrip>
          <Kpi label="Patients assessed" value={k?.patients ?? "—"} sub={ov.data ? `Benchmark ${current?.kind === "full" ? "test set" : "sample"}` : ""} />
          <Kpi
            label="Routed to nurse review"
            value={k ? k.escalated : "—"}
            sub={k ? `${pct(k.escalation_rate)} of patients` : ""}
          />
          <Kpi
            label="Critical patients identified"
            value={
              k ? (
                <>
                  {k.critical_total - k.critical_misses_unreviewed}
                  <span className="text-lg text-subtle"> / {k.critical_total}</span>
                </>
              ) : (
                "—"
              )
            }
            sub="True ESI 1–2 flagged urgent or sent to review"
          />
          <Kpi
            label={k?.consensus_rate != null ? "Panel consensus" : "Full agent agreement"}
            value={k ? pct(k.consensus_rate ?? k.full_agreement) : "—"}
            sub={
              k?.consensus_rate != null
                ? `Unanimous after ${k.mean_rounds?.toFixed(1) ?? "—"} rounds on average`
                : "All agents gave the same level"
            }
          />
        </KpiStrip>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel
            title="Nurse review worklist"
            sub="Cases the panel could not settle, most urgent first"
            actions={
              <Link to="/case" className="text-sm text-accent hover:underline">
                Review cases
              </Link>
            }
          >
            {pts.loading ? (
              <div className="p-4">
                <Skeleton className="h-40" />
              </div>
            ) : worklist.length ? (
              <div className="overflow-x-auto">
                <table className="table min-w-[640px]">
                  <thead>
                    <tr>
                      <th className="w-24">Acuity</th>
                      <th className="w-28">Patient</th>
                      <th className="w-24">Age / Sex</th>
                      <th>Chief complaint</th>
                      <th className="w-52">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worklist.map((p: PatientRow) => (
                      <tr key={p.patient_id} className="cursor-pointer" onClick={() => navigate(`/case/${p.patient_id}`)}>
                        <td>
                          <EsiChip esi={p.decision?.esi} size="sm" />
                        </td>
                        <td className="num text-[13px]">{shortId(p.patient_id)}</td>
                        <td className="text-muted">{ageSex(p)}</td>
                        <td className="max-w-0 truncate">{p.chief_complaint}</td>
                        <td className="text-muted">{p.decision?.reasons.map(reasonShort).join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-8 text-sm text-muted">No cases awaiting review.</div>
            )}
          </Panel>

          <Panel title="Acuity distribution" sub="Panel-assigned ESI level">
            <div className="p-4">
              <div className="flex h-3 w-full overflow-hidden bg-line" aria-hidden>
                {counts.map((c, i) => (
                  <div key={i} style={{ width: `${(c / total) * 100}%`, background: esiColor(i + 1) }} />
                ))}
              </div>
              <table className="mt-4 w-full text-sm">
                <tbody>
                  {counts.map((c, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-2">
                        <EsiChip esi={i + 1} size="sm" />
                      </td>
                      <td className="py-2 text-muted">{esiLabel(i + 1)}</td>
                      <td className="num py-2 text-right">{c}</td>
                      <td className="num w-14 py-2 text-right text-subtle">{pct(c / total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="System status">
            <dl className="divide-y divide-line text-sm">
              <StatusRow
                label="Host platform"
                value={
                  sys.data ? (
                    <StatusText tone={sys.data.platform.is_linuxone ? "info" : "ok"}>
                      {sys.data.platform.label}
                      {sys.data.platform.cpus ? ` · ${sys.data.platform.cpus} CPU` : ""}
                    </StatusText>
                  ) : (
                    "Checking…"
                  )
                }
              />
              {sys.data?.platform.accelerator && (
                <StatusRow label="AI accelerator" value={<StatusText tone="info">On-chip NNPA (IBM z17)</StatusText>} />
              )}
              <StatusRow label="Results shown" value={<StatusText tone="ok">{current?.label ?? "—"}</StatusText>} />
              <StatusRow
                label="Local inference"
                value={
                  live.loading ? (
                    "Checking…"
                  ) : localEngine ? (
                    <StatusText tone="ok">Online · {localEngine.id === "llamacpp" ? "llama.cpp" : "Ollama"}</StatusText>
                  ) : (
                    <StatusText tone="off">Offline</StatusText>
                  )
                }
              />
              <StatusRow
                label="watsonx.ai"
                value={
                  live.loading ? (
                    "Checking…"
                  ) : !wx?.available ? (
                    <StatusText tone="off">Not configured</StatusText>
                  ) : wx.locked ? (
                    <StatusText tone="warn">Connected · usage locked</StatusText>
                  ) : (
                    <StatusText tone="ok">Connected</StatusText>
                  )
                }
              />
              <StatusRow label="Results generated" value={<span className="num">{formatRun(ov.data?.run_id)}</span>} />
              <StatusRow
                label="Escalation rule"
                value={`Range ≥ ${ov.data?.escalation.range_threshold ?? 1} or safety override`}
              />
              <StatusRow label="Safety override" value={<StatusText tone="ok">{ov.data?.escalation.safety_override === false ? "Off" : "On"}</StatusText>} />
              <StatusRow label="Data source" value="TriageAgent benchmark" />
            </dl>
          </Panel>

          <Panel title="How the panel decides">
            <ol className="divide-y divide-line">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="flex gap-3 px-4 py-3">
                  <span className="num grid size-6 shrink-0 place-items-center bg-line text-xs font-semibold">{i + 1}</span>
                  <div>
                    <div className="text-sm font-semibold text-ink">{t}</div>
                    <p className="mt-0.5 text-xs leading-5 text-muted">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Modules">
            <ul className="divide-y divide-line">
              {[
                ["/waiting", "Waiting Room", "Live arrivals triaged by the panel, ordered by ESI-weighted wait."],
                ["/queue", "Surge Replay", "Replay a recorded surge from the evaluation set."],
                ["/case", "Case Review", "Inspect each agent's reasoning, revisions, and the final decision."],
                ["/results", "Evaluation Results", "Accuracy, safety, fairness, and cost across four configurations."],
              ].map(([to, t, d]) => (
                <li key={to}>
                  <Link to={to} className="group flex items-start justify-between gap-3 px-4 py-3 hover:bg-hover">
                    <div>
                      <div className="text-sm font-semibold text-accent group-hover:underline">{t}</div>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{d}</p>
                    </div>
                    <span className="mt-0.5 text-muted" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="border border-line bg-surface px-4 py-3 text-xs leading-5 text-muted">
          <span className="font-semibold text-ink">Intended use.</span> Research prototype for evaluating multi-agent triage
          support. It is not a medical device, has not been clinically validated, and must not be used for patient care. Do
          not enter real patient information. Benchmark vignettes are text-only and partly synthetic.
        </div>
      </PageBody>
    </>
  );
}

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="whitespace-nowrap text-muted">{label}</dt>
      <dd className="truncate text-right text-ink">{value}</dd>
    </div>
  );
}
