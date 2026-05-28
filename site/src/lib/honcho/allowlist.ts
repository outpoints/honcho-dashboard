import "server-only";

/**
 * Shared Honcho-target resolution + allowlist enforcement.
 *
 * Used by `/api/honcho/[...path]/route.ts` (the SDK + raw-client proxy) and by
 * `/api/operator/diagnostics/route.ts` (the operator that probes Honcho directly).
 *
 * Threat model: any internal caller can ask us to fan a request out to an
 * arbitrary upstream URL via the `X-Honcho-Base-Url` header. We close that hole
 * with a server-side allowlist (`HONCHO_PROXY_ALLOWED_BASES` + the env fallback),
 * compared *origin-only* against the URL parser's output — never substring or
 * prefix. Userinfo, fragments, non-HTTP schemes are rejected up front.
 *
 * What this deliberately does NOT do: block RFC1918 / loopback by DNS lookup.
 * The intended single-host deployment is Honcho at an RFC1918 LAN address,
 * so blanket private-IP denial would break that legitimate case. The
 * allowlist is the operator's explicit choice — that's the trust boundary.
 */

export function parseAllowlist(): string[] {
  const raw = process.env.HONCHO_PROXY_ALLOWED_BASES;
  const fromList = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const single =
    process.env.HONCHO_PROXY_BASE_URL ?? process.env.NEXT_PUBLIC_HONCHO_BASE_URL;
  if (single && !fromList.includes(single)) fromList.push(single);
  return fromList
    .map((u) => canonicalize(u))
    .filter((u): u is string => !!u);
}

/**
 * Reduce a candidate URL to its origin (`scheme://host[:port]`). Returns null
 * if the URL is unparsable, non-HTTP, has userinfo, or has a fragment.
 */
export function canonicalize(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.hash) return null;
  return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
}

export interface ResolveOk {
  ok: true;
  baseUrl: string;
  token?: string;
}

export interface ResolveErr {
  ok: false;
  status: number;
  reason: string;
}

/**
 * Resolve the upstream Honcho base URL + bearer token from request headers,
 * enforcing the server allowlist. Used by every route that talks to Honcho.
 */
export function resolveHonchoTarget(headers: Headers): ResolveOk | ResolveErr {
  const allow = parseAllowlist();
  if (allow.length === 0) {
    return {
      ok: false,
      status: 500,
      reason:
        "Proxy not configured. Set HONCHO_PROXY_BASE_URL (or HONCHO_PROXY_ALLOWED_BASES) on the server.",
    };
  }

  const headerUrl = headers.get("x-honcho-base-url");
  const fallback =
    process.env.HONCHO_PROXY_BASE_URL ?? process.env.NEXT_PUBLIC_HONCHO_BASE_URL;
  const candidate = headerUrl ?? fallback;
  if (!candidate) {
    return {
      ok: false,
      status: 400,
      reason: "Missing target — no X-Honcho-Base-Url and no server default",
    };
  }

  const origin = canonicalize(candidate);
  if (!origin) {
    return {
      ok: false,
      status: 400,
      reason: "Base URL must be http(s) with no userinfo or fragment",
    };
  }
  if (!allow.includes(origin)) {
    return {
      ok: false,
      status: 403,
      reason: `Base URL ${origin} is not in the proxy allowlist. Add it to HONCHO_PROXY_ALLOWED_BASES.`,
    };
  }

  const token = headers.get("x-honcho-token") ?? undefined;
  return { ok: true, baseUrl: origin, token };
}

/**
 * Re-validate a redirect Location against the same allowlist before letting a
 * caller (e.g. an operator probe) follow it manually. Stops a host on the
 * allowlist from bouncing us to cloud-metadata or other internal services.
 */
export function isLocationAllowed(location: string, allow?: string[]): boolean {
  const list = allow ?? parseAllowlist();
  const origin = canonicalize(location);
  return !!origin && list.includes(origin);
}
