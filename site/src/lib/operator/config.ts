import "server-only";

const ALWAYS_SHOW = [
  "NEXT_PUBLIC_HONCHO_BASE_URL",
  "HONCHO_PROXY_BASE_URL",
  "HONCHO_PROXY_ALLOWED_BASES",
  "HONCHO_DATABASE_URL",
  "HONCHO_LOG_FILE",
  "HONCHO_RUNTIME_START_TS",
  "NODE_ENV",
];

const REDACT_KEYS = /(token|secret|password|key|api[_-]?key)/i;

export interface ConfigEntry {
  key: string;
  value: string;
  redacted: boolean;
  set: boolean;
}

export interface ConfigSnapshot {
  available: boolean;
  entries: ConfigEntry[];
}

function redact(value: string | undefined, key: string): { value: string; redacted: boolean } {
  if (!value) return { value: "(not set)", redacted: false };
  if (REDACT_KEYS.test(key) || /:\/\/[^@\s]+@/.test(value)) {
    const last4 = value.length > 4 ? value.slice(-4) : value;
    return { value: `***${last4}`, redacted: true };
  }
  return { value, redacted: false };
}

export function operatorConfig(): ConfigSnapshot {
  const extra = (process.env.HONCHO_OPERATOR_CONFIG_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keys = Array.from(new Set([...ALWAYS_SHOW, ...extra]));
  const entries: ConfigEntry[] = keys.map((key) => {
    const raw = process.env[key];
    const { value, redacted } = redact(raw, key);
    return { key, value, redacted, set: raw !== undefined && raw !== "" };
  });
  return { available: true, entries };
}
