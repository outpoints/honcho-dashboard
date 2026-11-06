import { canonicalize } from "../honcho/defaultTarget.ts";

/** Request headers that carry a credential and must not follow a redirect to another origin. */
const CREDENTIAL_HEADERS = ["authorization", "proxy-authorization", "cookie", "x-honcho-token", "x-api-key"];

/** `headers` without credentials; undefined stays undefined. The input is not modified. */
export function withoutCredentials(headers: HeadersInit | undefined): Headers | undefined {
  if (!headers) return undefined;
  const out = new Headers(headers);
  for (const name of CREDENTIAL_HEADERS) out.delete(name);
  return out;
}

/**
 * Manual-redirect fetch: refuse to follow a 3xx unless `isAllowed(location)`
 * says the Location is on the proxy allowlist. Closes the loophole where a host
 * on our allowlist could 302 us to e.g. 169.254.169.254/latest/meta-data/.
 *
 * Credentials follow a redirect only within the same origin. A redirect to a
 * second allowlisted server is a different trust boundary, so `Authorization`
 * and the other credential headers are dropped there, as `fetch` does itself.
 * Only one hop is followed; a second 3xx is returned to the caller as is.
 */
export async function safeFetch(
  url: string,
  init: RequestInit,
  isAllowed: (location: string) => boolean,
): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: "manual", cache: "no-store" });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location || !isAllowed(location)) {
      const blocked = new Error(
        `Blocked redirect to ${location ?? "(no Location)"} — not in proxy allowlist`,
      );
      blocked.name = "BlockedRedirect";
      throw blocked;
    }
    const sameOrigin = canonicalize(location) === canonicalize(url);
    const next = sameOrigin ? init : { ...init, headers: withoutCredentials(init.headers) };
    return fetch(location, { ...next, redirect: "manual", cache: "no-store" });
  }
  return res;
}
