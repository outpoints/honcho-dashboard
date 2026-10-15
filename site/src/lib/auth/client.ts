"use client";

/** Browser helpers for the optional dashboard login. Cookies ride along on same-origin fetches. */

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

export async function fetchAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status", { cache: "no-store", signal });
  if (!res.ok) throw new Error(`Auth status check failed (HTTP ${res.status})`);
  const body = (await res.json()) as Partial<AuthStatus>;
  return { enabled: body.enabled === true, authenticated: body.authenticated === true };
}

/** Resolves on success; rejects with a user-presentable message otherwise. */
export async function login(password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new Error("Could not reach the dashboard server");
  }
  if (res.ok) return;
  let message = `Login failed (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  throw new Error(message);
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error(`Logout failed (HTTP ${res.status})`);
}
