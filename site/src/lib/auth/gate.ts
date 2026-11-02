/**
 * What the browser can know about authentication before asking the server.
 * Import-free so it is testable.
 */

/**
 * The root layout reads the auth config on the server and tells the client
 * whether a dashboard password is set. With none, the answer to "who is
 * logged in" is fixed (everyone may use the app) and `/api/auth/status` is
 * never called. Returns null when the server must be asked.
 */
export function initialAuthStatus(
  passwordRequired: boolean,
): { enabled: false; authenticated: true } | null {
  return passwordRequired ? null : { enabled: false, authenticated: true };
}
