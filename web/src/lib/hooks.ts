import { createContext, useContext, useEffect, useState } from "react";
import type { ResultSet, User } from "./api";

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Run `fn` whenever `deps` change; ignores stale responses. */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => live && setState({ data: null, error: String(e), loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export interface SetContextValue {
  sets: ResultSet[];
  current: ResultSet | null;
  setCurrent: (id: string) => void;
}

export const SetContext = createContext<SetContextValue>({ sets: [], current: null, setCurrent: () => {} });

export const useResultSet = () => useContext(SetContext);

/** Read a value from localStorage, tolerating private mode / blocked storage. */
export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

export interface AuthContextValue {
  user: User | null;
  /** True until the first /api/auth/me answer arrives. */
  checking: boolean;
  setUser: (u: User | null) => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  checking: true,
  setUser: () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);
