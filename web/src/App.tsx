import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { EmptyState } from "./components/ui";
import { api, type ResultSet } from "./lib/api";
import { SetContext, readPref, writePref } from "./lib/hooks";
import CasePage from "./pages/CasePage";
import HomePage from "./pages/HomePage";
import QueuePage from "./pages/QueuePage";
import ResultsPage from "./pages/ResultsPage";
import WaitingRoomPage from "./pages/WaitingRoomPage";

export default function App() {
  const [sets, setSets] = useState<ResultSet[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .sets()
      .then((r) => {
        setSets(r.sets);
        const saved = readPref("triage.set");
        setCurrentId(r.sets.some((s) => s.id === saved) ? saved : r.default);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const ctx = useMemo(
    () => ({
      sets,
      current: sets.find((s) => s.id === currentId) ?? null,
      setCurrent: (id: string) => {
        setCurrentId(id);
        writePref("triage.set", id);
      },
    }),
    [sets, currentId],
  );

  if (error)
    return (
      <EmptyState
        title="Backend not reachable"
        body={<>Start it with <code className="num">uv run python scripts/serve.py</code>, then reload.</>}
      />
    );

  return (
    <SetContext.Provider value={ctx}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="waiting" element={<WaitingRoomPage />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="case" element={<CasePage />} />
          <Route path="case/:pid" element={<CasePage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SetContext.Provider>
  );
}
