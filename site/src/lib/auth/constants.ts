/**
 * Shared between the server guard and the browser interceptor. Import-free.
 *
 * The guard marks its own 401 with a header because a Honcho 401 (bad API key)
 * looks identical otherwise, and the UI must send only the former back to the
 * login screen.
 */
export const AUTH_REQUIRED_HEADER = "x-dashboard-auth";
export const AUTH_REQUIRED_VALUE = "required";
/** `window` event dispatched when a same-origin request hits the guard's 401. */
export const AUTH_REQUIRED_EVENT = "honcho-dashboard:auth-required";

/**
 * Custom header the dashboard's own UI adds to state-changing requests that
 * carry no other dashboard header (login, logout, operator writes). A page on
 * another site cannot add a non-safelisted header without a CORS preflight, and
 * the dashboard never answers one, so any of the headers below proves the
 * request came from the dashboard. `src/lib/operator/writes.ts` re-exports the
 * first two for the operator write route.
 */
export const DASHBOARD_HEADER = "X-Honcho-Dashboard";
export const DASHBOARD_HEADER_VALUE = "1";
/** Request headers only the dashboard sends; any one of them marks a same-origin request. */
export const DASHBOARD_REQUEST_HEADERS = [DASHBOARD_HEADER, "X-Honcho-Base-Url", "X-Honcho-Token"] as const;

/** True when the request carries at least one dashboard header with a value. */
export function hasDashboardRequestHeader(headers: { get(name: string): string | null }): boolean {
  return DASHBOARD_REQUEST_HEADERS.some((name) => {
    const value = headers.get(name);
    return typeof value === "string" && value.trim() !== "";
  });
}

/** True for the guard's 401 (status and marker header), false for any other response. */
export function isAuthRequiredResponse(res: {
  status: number;
  headers: { get(name: string): string | null };
}): boolean {
  return res.status === 401 && res.headers.get(AUTH_REQUIRED_HEADER) === AUTH_REQUIRED_VALUE;
}
