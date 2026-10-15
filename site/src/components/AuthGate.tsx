"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button, Field, TextInput } from "@/components/atoms";
import { Panel } from "@/components/Panel";
import { fetchAuthStatus, installAuthFetchInterceptor, login, logout, type AuthStatus } from "@/lib/auth/client";
import { AUTH_REQUIRED_EVENT } from "@/lib/auth/constants";
import { invalidate } from "@/lib/honcho/useQuery";

interface AuthContextValue {
  /** True when the server requires a dashboard password. */
  enabled: boolean;
  /** Clear the session and return to the login screen. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  enabled: false,
  logout: async () => undefined,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

type GateState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; status: AuthStatus };

/**
 * Renders the app only when auth is off or the visitor holds a valid session;
 * otherwise renders the login screen. The app mounts after login, so no data
 * request is made before the session exists. Logging in reloads the page.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchAuthStatus(controller.signal)
      .then((status) => setState({ kind: "ready", status }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : "Auth check failed" });
      });
    return () => controller.abort();
  }, [attempt]);

  // Session expired or cleared while the app was open: the guard's 401 sends
  // the visitor back to the login screen instead of surfacing "access denied".
  useEffect(() => {
    const uninstall = installAuthFetchInterceptor();
    const onRequired = () => setState({ kind: "ready", status: { enabled: true, authenticated: false } });
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
      uninstall();
    };
  }, []);

  // Reload so the server renders the page with a session (the default Honcho
  // URL meta tag is omitted for unauthenticated page loads).
  const onLoggedIn = useCallback(() => {
    window.location.reload();
  }, []);

  const doLogout = useCallback(async () => {
    await logout();
    invalidate("");
    setState({ kind: "ready", status: { enabled: true, authenticated: false } });
  }, []);

  const enabled = state.kind === "ready" && state.status.enabled;
  const value = useMemo<AuthContextValue>(() => ({ enabled, logout: doLogout }), [enabled, doLogout]);

  if (state.kind === "loading") {
    return (
      <CenteredScreen>
        <div className="text-xs text-text-muted cursor-blink" role="status">
          checking session
        </div>
      </CenteredScreen>
    );
  }

  if (state.kind === "error") {
    return (
      <CenteredScreen>
        <Panel title="AUTH_ERROR" status="idle">
          <p role="alert" className="text-xs text-red-400 break-words">{state.message}</p>
          <div className="mt-3">
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => {
                setState({ kind: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              RETRY
            </Button>
          </div>
        </Panel>
      </CenteredScreen>
    );
  }

  if (state.status.enabled && !state.status.authenticated) {
    return (
      <CenteredScreen>
        <LoginForm onLoggedIn={onLoggedIn} />
      </CenteredScreen>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function CenteredScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || password === "") return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  };

  return (
    <Panel title="LOGIN" status={busy ? "processing" : "active"}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-[11px] text-text-muted">
          This dashboard is password protected. Enter the dashboard password to continue.
        </p>
        <Field label="PASSWORD">
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            aria-label="Dashboard password"
            aria-invalid={error ? true : undefined}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-xs text-red-400 break-words">{error}</p>
        ) : null}
        <Button type="submit" variant="solid" icon="key" disabled={busy || password === ""} className="w-full">
          {busy ? "SIGNING_IN" : "LOGIN"}
        </Button>
      </form>
    </Panel>
  );
}
