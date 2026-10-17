import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api, runLive, type AgentResult, type Debate, type LiveEvent, type LiveProvider } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { DecisionPanel, PanelDiscussion } from "./Debate";

type Phase = "idle" | "running" | "done" | "error";

export function LiveDrawer({ open, onClose, threshold }: { open: boolean; onClose: () => void; threshold: number }) {
  const status = useFetch(() => (open ? api.liveStatus() : Promise.resolve(null)), [open]);
  const examples = useFetch(() => (open ? api.examples() : Promise.resolve([])), [open]);
  const [text, setText] = useState("");
  const [provider, setProvider] = useState<LiveProvider["id"] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [agents, setAgents] = useState<string[]>([]);
  const [rounds, setRounds] = useState<AgentResult[][]>([]);
  const [current, setCurrent] = useState<number | null>(null); // 0-based round streaming now
  const [maxRounds, setMaxRounds] = useState(5);
  const [threshold90, setThreshold] = useState(0.9);
  const [member, setMember] = useState<string | null>(null);
  const [final, setFinal] = useState<Debate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) abort.current?.abort();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const providers = status.data?.providers ?? [];

  // Preselect the first engine that can run right now (the server lists its default first).
  useEffect(() => {
    if (provider == null && providers.length) {
      setProvider((providers.find((p) => p.available && !p.locked) ?? providers[0]).id);
    }
  }, [providers, provider]);
  const chosen = providers.find((p) => p.id === provider);
  const canRun = text.trim().length >= 20 && chosen?.available && !chosen.locked && phase !== "running";

  const reset = () => {
    setAgents([]);
    setRounds([]);
    setCurrent(null);
    setMember(null);
    setFinal(null);
    setError(null);
  };

  const run = async () => {
    reset();
    setPhase("running");
    abort.current = new AbortController();
    const handle = (e: LiveEvent) => {
      if (e.type === "start") {
        setAgents(e.agents);
        setMaxRounds(e.max_rounds);
        if (e.consensus_threshold) setThreshold(e.consensus_threshold);
        setCurrent(0);
      } else if (e.type === "agent") {
        const res: AgentResult = { agent: e.agent, round: e.round, output: e.output, failure: e.failure, repaired: false };
        setRounds((rs) => {
          const next = rs.map((r) => [...r]);
          while (next.length < e.round) next.push([]);
          next[e.round - 1] = [...next[e.round - 1].filter((x) => x.agent !== e.agent), res];
          return next;
        });
      } else if (e.type === "round_end") {
        setCurrent(e.round); // next round (0-based index) may start
      } else if (e.type === "final") {
        setFinal(e.debate);
        setRounds(e.debate.rounds);
        setCurrent(null);
        setPhase("done");
      } else if (e.type === "error") {
        setError(e.message);
        setPhase("error");
      }
    };
    try {
      await runLive(text.trim(), provider ?? "llamacpp", handle, abort.current.signal);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(String(e));
        setPhase("error");
      }
    }
  };

  const inRound = current != null && current < maxRounds ? current : null;
  const doneInRound = inRound != null ? rounds[inRound]?.length ?? 0 : 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-ink/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label="Triage a new case"
            className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[1240px] flex-col bg-page shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.24, ease: [0.2, 0, 0.38, 0.9] }}
          >
            <header className="flex h-14 shrink-0 items-center justify-between bg-chrome px-6 text-white">
              <div>
                <h2 className="text-base font-semibold">Triage new case</h2>
                <p className="text-xs text-[#c6c6c6]">
                  The panel discusses until {Math.round(threshold90 * 100)}% agree (up to {maxRounds} rounds). Results are not saved.
                </p>
              </div>
              <button className="btn h-8 border border-[#6f6f6f] text-white hover:bg-chrome-3" onClick={onClose}>
                Close
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="panel p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="vignette" className="eyebrow">
                      Triage note
                    </label>
                    <select
                      className="h-8 max-w-[260px] border-0 border-b border-[#8d8d8d] bg-field px-2 text-xs text-ink"
                      value=""
                      onChange={(e) => {
                        const ex = examples.data?.find((x) => x.id === e.target.value);
                        if (ex) setText(ex.vignette);
                      }}
                      aria-label="Load a training example"
                    >
                      <option value="">Load a training example…</option>
                      {(examples.data ?? []).map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.chief_complaint.slice(0, 48)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    id="vignette"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={6}
                    placeholder="e.g. A 58-year-old man with crushing chest pain for 30 minutes, diaphoretic. HR 118, BP 92/60, RR 24, SpO2 94%."
                    className="w-full resize-y border-0 border-b border-[#8d8d8d] bg-field p-3 text-[15px] leading-6 text-ink placeholder:text-subtle focus:outline-2 focus:-outline-offset-2 focus:outline-accent"
                  />
                  <div className="mt-1 text-xs text-muted">Do not enter real patient information.</div>
                </section>

                <section className="panel flex flex-col p-4">
                  <div className="eyebrow mb-2">Model</div>
                  <div className="space-y-2">
                    {providers.map((p) => (
                      <ProviderOption key={p.id} p={p} selected={provider === p.id} onSelect={() => setProvider(p.id)} />
                    ))}
                    {status.loading && <div className="text-sm text-subtle">Checking models…</div>}
                  </div>
                  <button className="btn btn-primary btn-lg mt-4 w-full justify-between" disabled={!canRun} onClick={run}>
                    {phase === "running" ? "Running panel…" : "Run panel"}<span aria-hidden>→</span>
                  </button>
                </section>
              </div>

              {error && (
                <div className="mt-4 border-l-[3px] border-l-danger bg-surface p-4 text-sm">
                  <div className="font-semibold text-ink">Could not run this case</div>
                  <div className="mt-1 text-muted">{error}</div>
                </div>
              )}

              {phase !== "idle" && phase !== "error" && (
                <div className="mt-6 space-y-4">
                  {phase === "running" && (
                    <div className="flex items-center gap-3 border-l-[3px] border-l-accent bg-surface px-4 py-2 text-sm">
                      <span className="font-semibold text-ink">
                        {inRound == null || inRound === 0 ? "Independent assessments" : `Discussion round ${inRound + 1}`}
                      </span>
                      <span className="num text-muted">
                        {doneInRound} / {agents.length || "—"} members
                      </span>
                      <div className="h-1 flex-1 bg-line">
                        <div
                          className="h-full bg-accent transition-[width] duration-300"
                          style={{ width: agents.length ? `${(doneInRound / agents.length) * 100}%` : 0 }}
                        />
                      </div>
                    </div>
                  )}
                  {agents.length > 0 && (
                    <PanelDiscussion
                      agents={agents}
                      rounds={rounds}
                      selected={member}
                      onSelect={setMember}
                      pendingRound={phase === "running" ? inRound : null}
                      maxRounds={maxRounds}
                    />
                  )}
                  {final && <DecisionPanel debate={final} threshold={threshold} />}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function ProviderOption({ p, selected, onSelect }: { p: LiveProvider; selected: boolean; onSelect: () => void }) {
  const disabled = !p.available || p.locked;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full border px-3 py-2.5 text-left transition-colors ${
        selected ? "border-accent bg-accent-soft outline outline-1 -outline-offset-2 outline-accent" : "border-line hover:bg-hover"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{p.label}</span>
        {p.locked ? (
          <span className="border border-ink px-1.5 text-[11px] font-medium text-ink">LOCKED</span>
        ) : !p.available ? (
          <span className="border border-line-strong px-1.5 text-[11px] font-medium text-muted">OFFLINE</span>
        ) : (
          <span className="text-[11px] text-subtle">{p.cost}</span>
        )}
      </div>
      <div className="num mt-0.5 text-[11px] text-subtle">{p.model}</div>
      {selected && disabled && (
        <p className="mt-2 text-xs leading-5 text-muted">
          {p.id === "llamacpp"
            ? "llama-server is not running on this host. Start the priorihealth-llama service (see deploy/linuxone/DEPLOY.md)."
            : p.id === "watsonx"
            ? p.available
              ? `Uses about ${p.estimate?.toLocaleString()} watsonx tokens per case. Locked to protect your credits (${p.used?.toLocaleString()} of ${p.budget?.toLocaleString()} approved this month). Raise the budget in config.yaml to enable.`
              : "watsonx credentials are not configured in .env."
            : "Ollama is not running or the model is not downloaded. Start Ollama and try again."}
        </p>
      )}
    </button>
  );
}
