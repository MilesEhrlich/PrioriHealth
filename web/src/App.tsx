import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { EmptyState } from "./components/ui";
import { api, auth, UNAUTHORIZED_EVENT, type ResultSet, type User } from "./lib/api";
import { AuthContext, SetContext, readPref, useAuth, writePref } from "./lib/hooks";
import CasePage from "./pages/CasePage";
import HomePage from "./pages/HomePage";
import LandingPage from "./pages/LandingPage";
import QrSignPage from "./pages/QrSignPage";
import QueuePage from "./pages/QueuePage";
import ResultsPage from "./pages/ResultsPage";
import { SignInPage, SignUpPage } from "./pages/AuthPages";
import { StatusLivePage, StatusLookupPage } from "./pages/StatusPages";
import WaitingRoomPage from "./pages/WaitingRoomPage";

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    auth
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await auth.signOut();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, checking, setUser, signOut }), [user, checking, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Loading() {
  return <div className="grid min-h-screen place-items-center bg-page text-sm text-muted">Loading…</div>;
}

/** Signed-in area: loads the evaluation result sets, then renders the app shell. */
function ProtectedApp() {
  const { user, checking } = useAuth();
  const location = useLocation();
  const [sets, setSets] = useState<ResultSet[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .sets()
      .then((r) => {
        setSets(r.sets);
        const saved = readPref("triage.set");
        setCurrentId(r.sets.some((s) => s.id === saved) ? saved : r.default);
      })
      .catch((e) => setError(String(e)));
  }, [user]);

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

  if (checking) return <Loading />;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (error)
    return (
      <EmptyState
        title="Backend not reachable"
        body={<>Start it with <code className="num">uv run python scripts/serve.py</code>, then reload.</>}
      />
    );
  return (
    <SetContext.Provider value={ctx}>
      <Shell />
    </SetContext.Provider>
  );
}

/** Old (pre-accounts) URLs keep working. */
function LegacyRedirect({ to }: { to: string }) {
  const { pid } = useParams();
  const { search } = useLocation();
  return <Navigate to={`${to}${pid ? `/${pid}` : ""}${search}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route index element={<LandingPage />} />
        <Route path="signin" element={<SignInPage />} />
        <Route path="signup" element={<SignUpPage />} />
        <Route path="status" element={<StatusLookupPage />} />
        <Route path="status/:code" element={<StatusLivePage />} />
        <Route path="app" element={<ProtectedApp />}>
          <Route index element={<HomePage />} />
          <Route path="waiting" element={<WaitingRoomPage />} />
          <Route path="waiting/sign" element={<QrSignPage />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="case" element={<CasePage />} />
          <Route path="case/:pid" element={<CasePage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
        <Route path="waiting" element={<LegacyRedirect to="/app/waiting" />} />
        <Route path="queue" element={<LegacyRedirect to="/app/queue" />} />
        <Route path="case" element={<LegacyRedirect to="/app/case" />} />
        <Route path="case/:pid" element={<LegacyRedirect to="/app/case" />} />
        <Route path="results" element={<LegacyRedirect to="/app/results" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
