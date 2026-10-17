import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageBody, PageHeader } from "../components/Shell";
import { EmptyState, EsiChip, Kpi, KpiStrip, Panel, ReviewBadge, Skeleton } from "../components/ui";
import { api, type WaitRow, type WaitSnapshot } from "../lib/api";
import { useAuth } from "../lib/hooks";

const POLL_MS = 3000;
const ESI_NAMES = ["", "Resuscitation", "Emergent", "Urgent", "Less urgent", "Non-urgent"];

const minutes = (m: number) => (m < 60 ? `${Math.floor(m)} min` : `${Math.floor(m / 60)} h ${Math.floor(m % 60)} min`);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [snap, setSnap] = useState<WaitSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnap(await api.waitlist());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const waiting = snap?.waiting ?? [];
  const triaging = snap?.triaging ?? [];
  const wait = (r: WaitRow) => (snap ? (snap.now - r.arrived_at) / 60 : r.wait_min);
  const late = (r: WaitRow) => r.target_min != null && wait(r) > r.target_min && r.nurse_esi == null;
  const review = waiting.filter((r) => r.escalated && r.nurse_esi == null);
  const overdue = waiting.filter(late);
  const mix = [1, 2, 3, 4, 5].map((e) => waiting.filter((r) => (r.effective_esi ?? r.esi) === e).length);
  const open = (id: string) => navigate(`/app/waiting?review=${id}`);

  const simulate = async () => {
    setBusy(true);
    try {
      await api.simulate(6, 25);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user?.name.split(" ")[0] ?? ""}`}
        sub={`${user?.hospital.name ?? ""} · Emergency Department`}
        actions={
          <>
            <Link to="/app/waiting?add=1" className="btn btn-tertiary">
              Add patient
            </Link>
            <Link to="/app/waiting" className="btn btn-primary">
              Open waiting room
            </Link>
          </>
        }
      />
      <PageBody>
        {error && <div className="panel px-4 py-3 text-sm text-ink">Waiting room unavailable: {error}</div>}

        <KpiStrip>
          <Kpi label="Waiting to be seen" value={snap ? waiting.length : "—"} />
          <Kpi label="Being triaged" value={snap ? triaging.length : "—"} />
          <Kpi label="Needs nurse review" value={snap ? review.length : "—"} accent={review.length > 0} />
          <Kpi label="Past target time" value={snap ? overdue.length : "—"} accent={overdue.length > 0} />
        </KpiStrip>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
          <Panel
            title="Waiting list"
            sub="Next patients to be seen"
            actions={
              waiting.length > 0 && (
                <Link to="/app/waiting" className="text-sm font-medium text-accent hover:underline">
                  View all
                </Link>
              )
            }
          >
            {!snap ? (
              <div className="p-4">
                <Skeleton className="h-48" />
              </div>
            ) : !waiting.length ? (
              <EmptyState
                title={triaging.length ? "The panel is triaging new arrivals" : "Nobody is waiting"}
                body={
                  triaging.length
                    ? "Patients appear here as soon as the panel assigns an acuity level."
                    : "Add a patient from a triage note, or load a few sample arrivals to see the waiting room in action."
                }
                action={
                  !triaging.length && (
                    <div className="flex gap-2">
                      <Link to="/app/waiting?add=1" className="btn btn-primary">
                        Add patient
                      </Link>
                      <button className="btn btn-tertiary" onClick={simulate} disabled={busy}>
                        Load sample arrivals
                      </button>
                    </div>
                  )
                }
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th className="w-20 sm:w-24">Acuity</th>
                    <th>Patient</th>
                    <th className="w-28 !text-right sm:w-32">Waiting</th>
                    <th className="w-44 max-sm:hidden">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.slice(0, 7).map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => open(r.id)}>
                      <td className="num text-muted">{r.position}</td>
                      <td>
                        <EsiChip esi={r.effective_esi ?? r.esi} size="sm" />
                      </td>
                      <td className="max-w-0">
                        <div className="truncate font-medium">{r.label}</div>
                        <div className="truncate text-xs text-muted">{r.chief_complaint}</div>
                      </td>
                      <td className={`num text-right whitespace-nowrap ${late(r) ? "font-semibold text-danger" : ""}`}>{minutes(wait(r))}</td>
                      <td className="max-sm:hidden">
                        {r.escalated && r.nurse_esi == null ? (
                          <ReviewBadge compact />
                        ) : late(r) ? (
                          <span className="text-xs font-medium text-danger">Past target</span>
                        ) : (
                          <span className="text-xs text-muted">{r.nurse_esi != null ? "Nurse confirmed" : "On track"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <div className="flex flex-col gap-5">
            <Panel title="Needs your review" sub="The panel could not settle these">
              {!snap ? (
                <div className="p-4">
                  <Skeleton className="h-20" />
                </div>
              ) : !review.length ? (
                <p className="px-4 py-5 text-sm text-muted">No cases waiting for nurse review.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {review.slice(0, 5).map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                      <EsiChip esi={r.effective_esi ?? r.esi} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{r.label}</div>
                        <div className="truncate text-xs text-muted">{r.chief_complaint}</div>
                      </div>
                      <button className="btn btn-tertiary h-7 px-3 text-xs" onClick={() => open(r.id)}>
                        Review
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Acuity mix" sub="Patients currently waiting">
              <ul className="px-4 py-3">
                {mix.map((n, i) => (
                  <li key={i} className="flex items-center gap-3 py-1.5 text-sm">
                    <EsiChip esi={(i + 1) as 1 | 2 | 3 | 4 | 5} size="sm" />
                    <span className="flex-1 text-muted">{ESI_NAMES[i + 1]}</span>
                    <span className="num font-medium text-ink">{snap ? n : "—"}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
