import { AUTH_REQUIRED_HEADER } from "../auth/constants.ts";

/** Headers the proxy never copies between client and upstream, in either direction. */
export const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // undici decompresses the body, so the header no longer describes it.
  "content-encoding",
  "cookie",
  "set-cookie",
]);

/** Build the header set returned to the client from an upstream response's headers. */
export function filterResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k.startsWith("access-control-")) return;
    // The dashboard's own "log in again" marker. Honcho must not be able to
    // send it: a Honcho 401 (bad API key) would otherwise bounce the visitor
    // to the login screen.
    if (k === AUTH_REQUIRED_HEADER) return;
    out.set(key, value);
  });
  return out;
}
