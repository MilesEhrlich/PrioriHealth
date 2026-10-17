import { ServerFigure } from "../components/Plot";
import { PageBody, PageHeader, ResultSetSelect } from "../components/Shell";
import { ErrorNote, Notice, Panel, Skeleton } from "../components/ui";
import { api, type MetricRow, type Overview } from "../lib/api";
import { pct } from "../lib/format";
import { useFetch, useResultSet } from "../lib/hooks";

const ORDER: MetricRow["condition"][] = ["A", "B", "D", "C"];

const CHARTS: { name: string; title: string; sub: string; height?: number }[] = [
  { name: "critical_miss", title: "Critical misses", sub: "True ESI 1–2 patients assigned ESI 3 or lower", height: 320 },
  { name: "coverage", title: "Coverage vs. accuracy", sub: "Escalation threshold sweep; safety override always on", height: 360 },
  { name: "auroc", title: "Error prediction", sub: "AUROC of each configuration's uncertainty signal", height: 300 },
  { name: "accuracy", title: "Exact accuracy", sub: "Bootstrap 95% confidence intervals", height: 300 },
  { name: "fairness", title: "Counterfactual sex swap", sub: "Decisions that change when only the patient's sex is flipped", height: 220 },
  { name: "cost", title: "Cost per patient", sub: "Tokens and model calls", height: 300 },
];

export default function ResultsPage() {
  const { current } = useResultSet();
  const set = current?.id ?? "";
  const ov = useFetch(() => api.overview(set), [set]);

  if (ov.error) return <ErrorNote message={ov.error} />;
  const o = ov.data;

  return (
    <>
      <PageHeader
        crumbs={["Analytics", "Evaluation Results"]}
        title="Evaluation Results"
        sub={`Four configurations on the same ${o?.n_patients ?? "—"} held-out patients from the TriageAgent ESI benchmark, using ${o?.label ?? "—"}.`}
        actions={<ResultSetSelect />}
      />
      <PageBody>
        <Notice title="Interpret with caution">
          n = {o?.n_patients ?? "—"}. One patient moves a rate by {o ? Math.round(100 / o.n_patients) : "—"} percentage points and
          confidence intervals are wide. Differences are directional, not statistically established. Escalation routes a case to a
          nurse when final assessments differ by at least {o?.escalation.range_threshold ?? 1} level, or when any agent assigns ESI
          1–2 while the panel assigns 3 or lower.
        </Notice>

        <Panel title="Configuration comparison" sub="Best value per quality metric in bold. C is the full system.">
          {ov.loading || !o ? (
            <div className="p-4">
              <Skeleton className="h-48" />
            </div>
          ) : (
            <ComparisonTable o={o} />
          )}
          {o && Object.keys(o.paired_tests).length > 0 && (
            <div className="border-t border-line px-4 py-2.5 text-xs text-muted">
              Paired exact McNemar tests on correctness:{" "}
              {Object.entries(o.paired_tests)
                .map(([k, v]) => `${k.replace("_vs_", " vs ")} p = ${v.p_value.toFixed(2)}`)
                .join(" · ")}
              .
            </div>
          )}
        </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {CHARTS.map((c) => (
            <Panel key={c.name} title={c.title} sub={c.sub}>
              <div className="px-2 pt-2">{set && <ServerFigure set={set} name={c.name} height={c.height} />}</div>
              {o?.takeaways[c.name] && (
                <div className="border-t border-line px-4 py-3 text-sm leading-6 text-ink">
                  {o.takeaways[c.name]}
                  {c.name === "fairness" && (
                    <p className="mt-1 text-xs leading-5 text-muted">
                      A flip can reflect bias or ordinary run-to-run instability in the debate. A control run with a neutral wording
                      change is required to separate the two.
                    </p>
                  )}
                </div>
              )}
            </Panel>
          ))}
        </div>
      </PageBody>
    </>
  );
}

const COLS: { key: keyof MetricRow; label: string; better: "high" | "low" | null; fmt?: (v: number) => string }[] = [
  { key: "exact_acc", label: "Exact", better: "high" },
  { key: "within1_acc", label: "Within 1", better: "high" },
  { key: "under_triage", label: "Under-triage", better: "low" },
  { key: "critical_miss", label: "Critical miss", better: "low" },
  { key: "critical_miss_unreviewed", label: "Missed, unreviewed", better: "low" },
  { key: "escalation_rate", label: "Escalated", better: null },
  { key: "acc_non_escalated", label: "Acc. auto-decided", better: "high" },
  { key: "auroc_uncertainty", label: "AUROC", better: "high", fmt: (v) => v.toFixed(2) },
  { key: "calls_per_patient", label: "Calls", better: null, fmt: (v) => v.toFixed(1) },
  { key: "tokens_per_patient", label: "Tokens", better: null, fmt: (v) => Math.round(v).toLocaleString() },
];

function ComparisonTable({ o }: { o: Overview }) {
  const rows = ORDER.map((c) => o.metrics.find((m) => m.condition === c)).filter((m): m is MetricRow => !!m);
  const best: Partial<Record<keyof MetricRow, number>> = {};
  for (const col of COLS) {
    const vals = rows.map((r) => r[col.key]).filter((v): v is number => typeof v === "number");
    if (vals.length && col.better) best[col.key] = col.better === "high" ? Math.max(...vals) : Math.min(...vals);
  }
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[1000px]">
        <thead>
          <tr>
            <th className="min-w-[250px]">Configuration</th>
            {COLS.map((c) => (
              <th key={c.key} className="!text-right">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isC = r.condition === "C";
            const ci = o.conditions[r.condition]?.exact_acc_ci;
            return (
              <tr key={r.condition} className={isC ? "[&>td]:bg-accent-soft" : ""}>
                <td className={`whitespace-nowrap border-l-[3px] ${isC ? "border-l-accent" : "border-l-transparent"}`}>
                  <span className="num mr-2 inline-grid size-5 place-items-center bg-line text-[11px] font-semibold">{r.condition}</span>
                  <span className={isC ? "font-semibold" : ""}>{r.name}</span>
                </td>
                {COLS.map((c) => {
                  const v = r[c.key] as number | null;
                  const isBest = v != null && best[c.key] === v && rows.length > 1;
                  return (
                    <td key={c.key} className={`num text-right whitespace-nowrap ${isBest ? "font-semibold text-ink" : "text-muted"}`}>
                      {v == null ? "—" : c.fmt ? c.fmt(v) : pct(v)}
                      {c.key === "exact_acc" && ci && (
                        <span className="ml-1 text-[11px] font-normal text-subtle">
                          ({pct(ci[0])}–{pct(ci[1])})
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
