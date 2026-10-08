/**
 * Default Honcho target resolution, shared by the server proxy, the root
 * layout, and the browser instance store. Pure: no env or DOM access, so the
 * rules are testable in plain Node.
 *
 * Why this exists: `next build` inlines `process.env.NEXT_PUBLIC_*` into
 * server code as well as browser code. The published image is built with the
 * `http://localhost:8000` fallback, so the `HONCHO_BASE_URL` an operator set at
 * runtime never reached the proxy fallback or a new browser's seed instance.
 * The server now reads the runtime value and advertises it to the browser.
 *
 * Compatibility contract: the implicit allowlist only grows, explicit
 * `HONCHO_PROXY_BASE_URL` keeps its precedence, and only an untouched
 * dashboard-generated seed instance is ever rewritten in the browser.
 */

export const LEGACY_DEFAULT_BASE_URL = "http://localhost:8000";
export const DEFAULT_BASE_URL_META = "honcho-dashboard:default-base-url";
export const SEED_INSTANCE_ID = "default";
export const SEED_INSTANCE_NAME = "local";

export interface DefaultTargetSources {
  /** `HONCHO_PROXY_BASE_URL`, read at runtime. */
  proxyBaseUrl?: string;
  /** `NEXT_PUBLIC_HONCHO_BASE_URL`, read at runtime (not the inlined copy). */
  runtimePublicBaseUrl?: string;
  /** `NEXT_PUBLIC_HONCHO_BASE_URL` as inlined by `next build`. */
  buildPublicBaseUrl?: string;
}

/**
 * Read an env var by computed key. The bundler only inlines literal
 * `process.env.NAME` member expressions, so this sees the runtime value.
 */
export function readRuntimeEnv(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return env[key];
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

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The server's default Honcho target. The proxy uses it when a request pins no
 * instance, and browsers with no saved instance are seeded with it. Keeps the
 * existing `HONCHO_PROXY_BASE_URL ?? NEXT_PUBLIC_HONCHO_BASE_URL` order, with
 * the runtime value ahead of the build-time copy.
 */
export function defaultBaseUrl(sources: DefaultTargetSources): string | undefined {
  return (
    sources.proxyBaseUrl ?? present(sources.runtimePublicBaseUrl) ?? sources.buildPublicBaseUrl
  );
}

/**
 * Origins the proxy accepts without listing them in
 * `HONCHO_PROXY_ALLOWED_BASES`. Always includes what earlier releases allowed
 * (`HONCHO_PROXY_BASE_URL ?? build-time NEXT_PUBLIC_HONCHO_BASE_URL`), so no
 * previously accepted target starts failing.
 */
export function implicitAllowedBases(sources: DefaultTargetSources): string[] {
  const legacy = sources.proxyBaseUrl ?? sources.buildPublicBaseUrl;
  const out: string[] = [];
  for (const candidate of [legacy, present(sources.runtimePublicBaseUrl)]) {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/** The origin advertised to browsers, or null when unset or invalid. */
export function advertisedBaseUrl(sources: DefaultTargetSources): string | null {
  const url = defaultBaseUrl(sources);
  return url ? canonicalize(url) : null;
}

export interface StoredInstance {
  id: string;
  name: string;
  baseUrl: string;
  token?: string;
}

/**
 * Move the dashboard-generated seed instance to the server's advertised
 * default when it still holds exactly what an older build seeded (same id,
 * name, URL, and token). Instances the user created or edited are untouched.
 * Returns null when nothing changes.
 */
export function upgradeLegacySeed<T extends StoredInstance>(
  instances: T[],
  legacySeed: { baseUrl: string; token?: string },
  advertised: string | null,
): T[] | null {
  if (!advertised) return null;
  const legacyOrigin = canonicalize(legacySeed.baseUrl);
  if (!legacyOrigin || legacyOrigin === advertised) return null;
  let changed = false;
  const next = instances.map((instance) => {
    if (instance.id !== SEED_INSTANCE_ID || instance.name !== SEED_INSTANCE_NAME) return instance;
    if (instance.baseUrl !== legacySeed.baseUrl) return instance;
    if ((instance.token || undefined) !== (legacySeed.token || undefined)) return instance;
    changed = true;
    return { ...instance, baseUrl: advertised };
  });
  return changed ? next : null;
}
