export const HONCHO_31_MIN_VERSION = "3.1.0";

export type HonchoCapabilityState =
  | "checking"
  | "available"
  | "unsupported"
  | "restricted"
  | "unknown";

export function normalizeHonchoVersion(raw: string | undefined): string | null {
  const version = raw?.trim();
  if (!version || ["unknown", "undefined", "null", "n/a"].includes(version.toLowerCase())) {
    return null;
  }
  return version.replace(/^v(?=\d)/i, "");
}

function numericVersion(raw: string | undefined): [number, number, number] | null {
  const version = normalizeHonchoVersion(raw);
  const match = version?.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Return null when OpenAPI did not provide a comparable semantic version. */
export function honcho31FromVersion(
  raw: string | undefined,
): Extract<HonchoCapabilityState, "available" | "unsupported"> | null {
  const parsed = numericVersion(raw);
  if (!parsed) return null;
  const [major, minor] = parsed;
  return major > 3 || (major === 3 && minor >= 1) ? "available" : "unsupported";
}

export function shouldProbeHoncho31(input: {
  rawVersion?: string;
  openApiResolved: boolean;
  openApiErrorStatus?: number;
  hasWorkspace: boolean;
}): boolean {
  if (!input.hasWorkspace || honcho31FromVersion(input.rawVersion) !== null) return false;
  if (input.openApiResolved) return true;
  return input.openApiErrorStatus === 404 || input.openApiErrorStatus === 405;
}

export function capabilityFromProbe(input: {
  loading: boolean;
  succeeded: boolean;
  errorStatus?: number;
}): HonchoCapabilityState {
  if (input.loading) return "checking";
  if (input.succeeded) return "available";
  if (input.errorStatus === 404 || input.errorStatus === 405) return "unsupported";
  if (input.errorStatus === 401 || input.errorStatus === 403) return "restricted";
  return "unknown";
}
