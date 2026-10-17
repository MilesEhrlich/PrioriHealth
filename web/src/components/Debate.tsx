import { motion } from "motion/react";
import type { AgentResult, Debate, Esi } from "../lib/api";
import { AGENT_ROLES, pct, reasonText } from "../lib/format";
import { ConfidenceBar, EsiChip, ReviewBadge, Skeleton, esiLabel } from "./ui";

const roundLabel = (i: number) => (i === 0 ? "Independent" : `Round ${i + 1}`);

/** Latest valid answer for `agent` at or before round index `upto`. */
export function latestFor(rounds: AgentResult[][], agent: string, upto = rounds.length - 1): AgentResult | null {
  for (let i = Math.min(upto, rounds.length - 1); i >= 0; i--) {
    const r = rounds[i].find((x) => x.agent === agent);
    if (r?.output) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ vote matrix */

/** Rows = agents, columns = rounds, cells = ESI. Shows the panel converging. */
export function VoteMatrix({ agents, rounds, selected, onSelect, pendingRound, maxRounds }: {
  agents: string[];
  rounds: AgentResult[][];
  selected?: string | null;
  onSelect?: (agent: string) => void;
  pendingRound?: number | null; // 0-based round index currently streaming
  maxRounds?: number;
}) {
  const cols = Math.max(rounds.length, pendingRound != null ? pendingRound + 1 : 0, 1);
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[520px]">
        <thead>
          <tr>
            <th className="w-44">Panel member</th>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className="!text-center">
                {roundLabel(i)}
              </th>
            ))}
            {maxRounds && cols < maxRounds && <th className="!text-center text-subtle">…</th>}
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const on = selected === a;
            return (
              <tr
                key={a}
                onClick={() => onSelect?.(a)}
                className={onSelect ? "cursor-pointer" : ""}
                aria-selected={on}
              >
                <td className={`border-l-[3px] ${on ? "border-l-accent bg-accent-soft font-semibold" : "border-l-transparent"}`}>
                  <div className="text-sm text-ink">{a}</div>
                </td>
                {Array.from({ length: cols }, (_, i) => {
                  const r = rounds[i]?.find((x) => x.agent === a);
                  const prev = i > 0 ? latestFor(rounds, a, i - 1)?.output?.esi : undefined;
                  const esi = r?.output?.esi ?? null;
                  const changed = esi != null && prev != null && esi !== prev;
                  const waiting = pendingRound === i && !r;
                  return (
                    <td key={i} className={`text-center ${on ? "bg-accent-soft" : ""}`}>
                      {waiting ? (
                        <Skeleton className="mx-auto h-5 w-12" />
                      ) : r && !r.output ? (
                        <span className="text-xs text-subtle" title={r.failure ?? ""}>
                          no answer
                        </span>
                      ) : esi != null ? (
                        <span className="relative inline-flex">
                          <EsiChip esi={esi} size="sm" />
                          {changed && (
                            <span
                              className="absolute -top-1 -right-1.5 size-2 rounded-full bg-accent ring-2 ring-white"
                              title={`Changed from ESI ${prev}`}
                            />
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-line-strong">—</span>
                      )}
                    </td>
                  );
                })}
                {maxRounds && cols < maxRounds && <td />}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ transcript */

/** The discussion as a meeting record: independent positions, then each round's messages. */
export function Transcript({ rounds, agents }: { rounds: AgentResult[][]; agents: string[] }) {
  if (!rounds.length) return <div className="px-4 py-6 text-sm text-muted">No discussion yet.</div>;
  return (
    <div className="divide-y divide-line">
      {rounds.map((rnd, i) => {
        const ordered = agents.map((a) => rnd.find((r) => r.agent === a)).filter((r): r is AgentResult => !!r);
        const votes = ordered.map((r) => r.output?.esi).filter((e): e is Esi => e != null);
        const counts = votes.reduce<Record<number, number>>((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {});
        const top = Math.max(0, ...Object.values(counts));
        const unanimous = votes.length > 0 && top === agents.length;
        const majorityTag = !unanimous && top / agents.length >= 0.9 ? `${top}/${agents.length} AGREE` : null;
        return (
          <section key={i} className="px-4 py-3">
            <header className="mb-2 flex items-center gap-3">
              <h4 className="text-sm font-semibold text-ink">
                {i === 0 ? "Independent assessments" : `Discussion round ${i + 1}`}
              </h4>
              <span className="num text-xs text-muted">votes {votes.join(" · ")}</span>
              {unanimous && <span className="bg-line px-1.5 text-[11px] font-medium text-ink">UNANIMOUS</span>}
              {majorityTag && <span className="bg-line px-1.5 text-[11px] font-medium text-ink">{majorityTag}</span>}
            </header>
            <ul className="space-y-2">
              {ordered.map((r) => {
                const prev = i > 0 ? latestFor(rounds, r.agent, i - 1)?.output?.esi : undefined;
                const changed = r.output && prev != null && r.output.esi !== prev;
                const said = i === 0 ? r.output?.rationale : r.output?.message || r.output?.rationale;
                return (
                  <li key={r.agent} className="grid grid-cols-[120px_64px_minmax(0,1fr)] gap-3 text-sm">
                    <span className="font-semibold text-ink">{r.agent}</span>
                    <span>{r.output ? <EsiChip esi={r.output.esi} size="sm" /> : <span className="text-xs text-subtle">—</span>}</span>
                    <div className="min-w-0">
                      <p className="leading-5 text-ink">{said ?? <span className="text-subtle">No usable answer this round.</span>}</p>
                      {i > 0 && r.output?.change_reason && (
                        <p className={`mt-0.5 text-xs ${changed ? "text-accent" : "text-muted"}`}>
                          <span className="num font-semibold">{changed ? `Revised ${prev} → ${r.output.esi}. ` : "Held. "}</span>
                          {r.output.change_reason}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ agent detail */

export function AgentCard({ name, result, previous, pending = false }: {
  name: string;
  result?: AgentResult | null;
  previous?: AgentResult | null;
  pending?: boolean;
}) {
  const o = result?.output;
  const prevEsi = previous?.output?.esi;
  const changed = o && prevEsi != null && o.esi !== prevEsi;
  return (
    <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="flex flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{name}</h3>
          <p className="text-xs text-muted">{AGENT_ROLES[name] ?? ""}</p>
        </div>
        {o ? <EsiChip esi={o.esi} /> : pending ? <Skeleton className="h-6 w-14" /> : <EsiChip esi={null} />}
      </header>
      <div className="flex flex-1 flex-col px-4 py-3">
        {previous !== undefined && o && (
          <div className={`mb-3 border-l-[3px] px-3 py-2 text-xs ${changed ? "border-l-accent bg-accent-soft" : "border-l-line-strong bg-field"}`}>
            <div className="num font-semibold text-ink">{changed ? `Revised ESI ${prevEsi} → ${o.esi}` : `Maintained ESI ${o.esi}`}</div>
            {o.change_reason && <p className="mt-1 leading-5 text-muted">{o.change_reason}</p>}
          </div>
        )}
        {o ? (
          <>
            <div>
              <div className="eyebrow mb-1">Confidence</div>
              <ConfidenceBar value={o.confidence} />
            </div>
            <div className="mt-3">
              <div className="eyebrow mb-1">Key findings</div>
              <ul className="space-y-0.5">
                {o.key_findings.map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-5 text-ink">
                    <span className="text-subtle">–</span>
                    {f}
                  </li>
                ))}
                {!o.key_findings.length && <li className="text-sm text-subtle">None documented</li>}
              </ul>
            </div>
            {o.message && (
              <div className="mt-3">
                <div className="eyebrow mb-1">To the panel</div>
                <p className="text-sm leading-5 text-ink">{o.message}</p>
              </div>
            )}
            <div className="mt-3 border-t border-line pt-3">
              <div className="eyebrow mb-1">Rationale</div>
              <p className="text-sm leading-5 text-muted">{o.rationale}</p>
            </div>
          </>
        ) : pending ? (
          <div className="space-y-2.5">
            <div className="text-xs text-muted">Assessing…</div>
            <Skeleton className="h-1" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <div className="border-l-[3px] border-l-danger bg-field px-3 py-2 text-sm text-ink">No usable assessment.</div>
        )}
      </div>
    </motion.article>
  );
}

/* ------------------------------------------------------------------ decision */

export function DecisionPanel({ debate, truth, threshold = 1 }: { debate: Debate; truth?: Esi | null; threshold?: number }) {
  const agg = debate.aggregate;
  const diff = truth != null && agg != null ? agg - truth : null;
  const finals = Object.values(debate.final_esis);
  const first = Object.values(debate.first_round_esis ?? {});
  const n = debate.agents.length;
  const agreeing = Math.round((debate.consensus_share ?? (debate.consensus_reached ? 1 : 0)) * n);
  const share = agreeing === n ? "unanimous" : `${agreeing} of ${n} agreed`;
  const outcome = !debate.consensus_protocol
    ? "Single round (no discussion)"
    : debate.consensus_reached
      ? debate.rounds_used === 1
        ? `Consensus on independent assessment (${share})`
        : `Consensus in round ${debate.rounds_used} (${share})`
      : `No consensus after ${debate.rounds_used} rounds (best: ${share})`;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title">Panel decision</h2>
        <span className="text-xs text-muted">{outcome}</span>
        <div className="ml-auto">{debate.escalated ? <ReviewBadge /> : <span className="text-xs text-muted">Auto-triaged</span>}</div>
      </header>
      <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-[240px_1fr_260px] lg:divide-x lg:divide-y-0">
        <div className="px-4 py-4">
          <div className="eyebrow">Assigned acuity</div>
          <div className="mt-2 flex items-center gap-3">
            <EsiChip esi={agg} size="lg" />
            <span className="text-sm text-ink">{esiLabel(agg)}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">
            {debate.consensus_reached
              ? agreeing === n
                ? "Every panel member agreed on this level."
                : `${agreeing} of ${n} members agreed on this level (consensus threshold ${Math.round((debate.consensus_threshold ?? 1) * 100)}%).`
              : "Confidence-weighted median of the final positions. Ties resolve to the more urgent level."}
          </p>
        </div>

        <div className="px-4 py-4">
          <div className="eyebrow">Routing rationale</div>
          {debate.escalated ? (
            <ul className="mt-2 space-y-1 text-sm text-ink">
              {debate.escalation_reasons.map((r) => (
                <li key={r}>
                  {r === "no_consensus"
                    ? `Agreement stayed below the ${Math.round((debate.consensus_threshold ?? 1) * 100)}% threshold after ${debate.rounds_used} rounds (final range ${debate.disagreement_range}). A nurse decides.`
                    : r === "urgent_dissent_overruled"
                      ? `At least one member said ESI 1–2 (initially or as the holdout); the panel settled on ESI ${agg}. A nurse should confirm.`
                      : r === "disagreement"
                        ? `${reasonText(r)}: final positions span ${debate.disagreement_range} level${debate.disagreement_range === 1 ? "" : "s"} (threshold ${threshold}).`
                        : r === "safety_override"
                          ? `${reasonText(r)} while the panel assigned ESI ${agg}. Safety override applied.`
                          : reasonText(r)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink">
              Auto-triaged. The panel {debate.rounds_used <= 1 ? "agreed independently" : `converged after ${debate.rounds_used - 1} discussion round${debate.rounds_used > 2 ? "s" : ""}`} ({share}), and no
              member at ESI 1–2 was overruled.
            </p>
          )}
          <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-3">
            <div>
              <dt className="eyebrow">Initial spread</dt>
              <dd className="num mt-0.5 text-base text-ink">
                {debate.initial_range ?? 0} <span className="text-xs text-subtle">levels</span>
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Rounds</dt>
              <dd className="num mt-0.5 text-base text-ink">{debate.rounds_used || debate.rounds.length}</dd>
            </div>
            <div>
              <dt className="eyebrow">Mean confidence</dt>
              <dd className="num mt-0.5 text-base text-ink">{pct(debate.mean_confidence)}</dd>
            </div>
          </dl>
          <p className="num mt-3 text-xs text-muted">
            Initial votes {first.join(" · ") || "—"} → final {finals.join(" · ") || "—"}
          </p>
        </div>

        <div className="bg-field px-4 py-4">
          <div className="eyebrow">Benchmark reference</div>
          {truth == null ? (
            <p className="mt-2 text-sm text-muted">Hidden. Enable “Show reference” to compare with the benchmark label.</p>
          ) : (
            <div className="mt-2 space-y-2">
              <EsiChip esi={truth} size="lg" showLabel />
              <p className="text-sm text-ink">
                {diff === 0
                  ? "Panel matches the benchmark."
                  : diff! > 0
                    ? `Panel was ${diff} level${diff === 1 ? "" : "s"} less urgent (under-triage).`
                    : `Panel was ${-diff!} level${diff === -1 ? "" : "s"} more urgent (over-triage).`}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Vote matrix + selected member detail + transcript, used by Case Review and live views. */
export function PanelDiscussion({ agents, rounds, selected, onSelect, pendingRound, maxRounds }: {
  agents: string[];
  rounds: AgentResult[][];
  selected: string | null;
  onSelect: (a: string) => void;
  pendingRound?: number | null;
  maxRounds?: number;
}) {
  const sel = selected ?? agents[0];
  const res = latestFor(rounds, sel);
  const idx = res ? rounds.findIndex((rnd) => rnd.includes(res)) : -1;
  const prev = idx > 0 ? latestFor(rounds, sel, idx - 1) : undefined;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="panel">
          <header className="panel-head">
            <div className="py-2">
              <h2 className="panel-title">Votes by round</h2>
              <p className="mt-0.5 text-xs text-muted">Select a member to read their reasoning. A dot marks a changed vote.</p>
            </div>
          </header>
          <VoteMatrix agents={agents} rounds={rounds} selected={sel} onSelect={onSelect} pendingRound={pendingRound} maxRounds={maxRounds} />
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">Discussion transcript</h2>
          </header>
          <Transcript rounds={rounds} agents={agents} />
        </section>
      </div>
      <section className="panel self-start xl:sticky xl:top-[64px]">
        <AgentCard
          name={sel}
          result={res}
          previous={idx > 0 ? prev ?? null : undefined}
          pending={pendingRound != null && !res}
        />
      </section>
    </div>
  );
}
