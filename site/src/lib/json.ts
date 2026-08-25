export type ParsedJsonObject =
  | { ok: true; value?: Record<string, unknown> }
  | { ok: false; error: string };

/** Parse an optional JSON object while rejecting arrays and scalar values. */
export function parseOptionalJsonObject(
  input: string,
  label = "JSON",
): ParsedJsonObject {
  const source = input.trim();
  if (!source) return { ok: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { ok: false, error: `${label} must be valid JSON.` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: `${label} must be a JSON object.` };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}
