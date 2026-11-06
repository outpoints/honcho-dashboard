"use client";

import { AUTH_REQUIRED_EVENT, DASHBOARD_HEADER, DASHBOARD_HEADER_VALUE, isAuthRequiredResponse } from "./constants";

/** Browser helpers for the optional dashboard login. Cookies ride along on same-origin fetches. */

/**
 * Login and logout carry no Honcho header, so they send the dashboard marker
 * the cross-site check accepts (see `isCrossSiteWrite`). Without it, a proxy
 * that rewrites `Host` would 403 the login itself on plain HTTP.
 */
const DASHBOARD_WRITE_HEADERS: Record<string, string> = { [DASHBOARD_HEADER]: DASHBOARD_HEADER_VALUE };

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  /** Set when a password is configured but the server cannot issue sessions (bad secret). */
  error?: string;
}

export async function fetchAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status", { cache: "no-store", signal });
  if (!res.ok) throw new Error(`Auth status check failed (HTTP ${res.status})`);
  const body = (await res.json()) as Partial<AuthStatus>;
  return {
    enabled: body.enabled === true,
    authenticated: body.authenticated === true,
    ...(typeof body.error === "string" && body.error ? { error: body.error } : {}),
  };
}

/** Resolves on success; rejects with a user-presentable message otherwise. */
export async function login(password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...DASHBOARD_WRITE_HEADERS },
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
  const res = await fetch("/api/auth/logout", { method: "POST", headers: DASHBOARD_WRITE_HEADERS });
  if (!res.ok) throw new Error(`Logout failed (HTTP ${res.status})`);
}

/**
 * Wrap `window.fetch` so the guard's 401 (session expired or cleared) raises
 * `AUTH_REQUIRED_EVENT`. Every same-origin call funnels through global fetch
 * (raw client, Honcho SDK, operator routes), so one wrapper covers them all.
 * Returns an uninstall function.
 */
export function installAuthFetchInterceptor(): () => void {
  const original = window.fetch;
  const wrapped: typeof window.fetch = async (...args) => {
    const res = await original.apply(window, args);
    if (isAuthRequiredResponse(res)) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    return res;
  };
  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) window.fetch = original;
  };
}
