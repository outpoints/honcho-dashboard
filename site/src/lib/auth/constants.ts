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

/** True for the guard's 401 (status and marker header), false for any other response. */
export function isAuthRequiredResponse(res: {
  status: number;
  headers: { get(name: string): string | null };
}): boolean {
  return res.status === 401 && res.headers.get(AUTH_REQUIRED_HEADER) === AUTH_REQUIRED_VALUE;
}
