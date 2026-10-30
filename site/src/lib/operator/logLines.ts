/**
 * Pure log-line parsing for the Diagnostics live tail. No I/O, so it can be
 * tested directly; `logs.ts` does the bounded file read.
 *
 * Lines come from whatever the operator pointed HONCHO_LOG_FILE at: Python
 * logging, uvicorn access lines, JSON logs, or `docker compose logs
 * --timestamps` output that prefixes every line with a container name and an
 * RFC 3339 timestamp. Each entry's id is the byte offset where its line starts,
 * which stays stable while the file is only appended to, so a poller can merge
 * successive reads without duplicates.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "unknown";

export interface LogEntry {
  id: string;
  /** Byte offset of the line in the file. */
  offset: number;
  timestamp?: string;
  level: LogLevel;
  source?: string;
  message: string;
}

const LEVEL_WORDS: Array<[RegExp, LogLevel]> = [
  [/\b(ERROR|CRITICAL|FATAL|EXCEPTION|Traceback)\b/, "error"],
  [/\b(WARN|WARNING)\b/, "warn"],
  [/\b(DEBUG|TRACE)\b/, "debug"],
  [/\b(INFO|NOTICE)\b/, "info"],
];
const LEVEL_WORDS_LOOSE: Array<[RegExp, LogLevel]> = [
  [/\b(error|exception|fatal)\b/i, "error"],
  [/\b(warn|warning)\b/i, "warn"],
  [/\b(debug|trace)\b/i, "debug"],
  [/\b(info|notice)\b/i, "info"],
];
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s*/;
// `docker compose logs` prefix: "api-1  | ".
const COMPOSE_PREFIX = /^([\w.-]+)\s+\|\s?/;
// uvicorn access line: `"GET /path HTTP/1.1" 200`.
const ACCESS_STATUS = /"(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) [^"]*" (\d{3})\b/;

const JSON_LEVELS: Record<string, LogLevel> = {
  debug: "debug", trace: "debug", info: "info", notice: "info",
  warn: "warn", warning: "warn", error: "error", critical: "error", fatal: "error",
};

export function detectLevel(line: string): LogLevel {
  // Uppercase level words are authoritative ("INFO ... error in payload" is info).
  for (const [re, level] of LEVEL_WORDS) if (re.test(line)) {
    // An access line's status code says more than uvicorn's INFO.
    const status = line.match(ACCESS_STATUS)?.[1];
    if (level === "info" && status) return status >= "500" ? "error" : status >= "400" ? "warn" : "info";
    return level;
  }
  const status = line.match(ACCESS_STATUS)?.[1];
  if (status) return status >= "500" ? "error" : status >= "400" ? "warn" : "info";
  for (const [re, level] of LEVEL_WORDS_LOOSE) if (re.test(line)) return level;
  return "unknown";
}

export function parseLogLine(raw: string, offset: number): LogEntry {
  let line = raw;
  let source: string | undefined;
  let timestamp: string | undefined;
  const compose = line.match(COMPOSE_PREFIX);
  if (compose && !TIMESTAMP.test(line)) {
    source = compose[1];
    line = line.slice(compose[0].length);
  }
  const ts = line.match(TIMESTAMP);
  if (ts) {
    timestamp = ts[1];
    line = line.slice(ts[0].length);
    // Docker --timestamps in front of an app timestamp: keep the first, drop the repeat.
    const repeat = line.match(TIMESTAMP);
    if (repeat) line = line.slice(repeat[0].length);
    // Python's "%(asctime)s - %(name)s - ..." leaves a separator behind.
    line = line.replace(/^-\s+/, "");
  }
  const id = String(offset);
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    if (json && typeof json === "object" && typeof json.message === "string") {
      const level = typeof json.level === "string" ? JSON_LEVELS[json.level.toLowerCase()] ?? "unknown" : detectLevel(json.message);
      return {
        id, offset, level, message: json.message,
        timestamp: typeof json.time === "string" ? json.time : typeof json.timestamp === "string" ? json.timestamp : timestamp,
        source: typeof json.logger === "string" ? json.logger : source,
      };
    }
  } catch {
    // Not JSON.
  }
  // Python logging: "src.deriver.queue - INFO - message".
  const python = line.match(/^([\w.]+) - (DEBUG|INFO|WARNING|ERROR|CRITICAL) - /);
  if (python) {
    return { id, offset, timestamp, source: python[1], level: detectLevel(python[2]), message: line.slice(python[0].length) };
  }
  // uvicorn/rich: "INFO   172.25.0.1:1234 - ..." — the level column already says INFO.
  const message = line.replace(LEADING_LEVEL, "");
  return { id, offset, timestamp, source: source ?? line.match(/\[([\w.-]+)\]/)?.[1], level: detectLevel(line), message };
}

const LEADING_LEVEL = /^(?:DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL):?\s+/;
// Docker or compose prefix plus the timestamp, keeping the whitespace after it.
const CONTINUATION = /^(?:[\w.-]+\s+\|\s?)?(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})? )?(\s{6,})(\S.*)$/;

/**
 * Rich's console handler (Honcho's API logs) hard-wraps long lines and indents
 * the remainder. Returns the continuation text, or null when `raw` starts a
 * new record (a level word, an app timestamp, or no deep indent).
 */
export function continuationText(raw: string): string | null {
  const match = raw.match(CONTINUATION);
  if (!match) return null;
  const text = match[2];
  if (LEADING_LEVEL.test(text) || TIMESTAMP.test(text) || /^[\w.]+ - (?:DEBUG|INFO|WARNING|ERROR|CRITICAL) - /.test(text)) return null;
  return text;
}

/**
 * Parse `bytes`, which start at byte `startOffset` of the file. When the read
 * started mid-file, the first (partial) line is dropped. Offsets are counted
 * on the raw bytes, so a read that begins inside a multi-byte character still
 * yields the same ids as any other read of the same lines.
 */
export function parseLogChunk(bytes: Uint8Array, startOffset: number, limit: number): LogEntry[] {
  const decoder = new TextDecoder();
  const entries: LogEntry[] = [];
  let lineStart = 0;
  if (startOffset > 0) {
    const newline = bytes.indexOf(0x0a);
    if (newline < 0) return [];
    lineStart = newline + 1;
  }
  // Lines of the record being read: its raw head line plus any wrapped continuations.
  let group: { raws: string[]; parts: string[] } | null = null;
  const finish = () => {
    if (!group || group.parts.length === 0) { group = null; return; }
    const width = Math.max(...group.raws.map((raw) => raw.length));
    const head = entries[entries.length - 1];
    let message = head.message.trimEnd();
    group.parts.forEach((part, i) => {
      const before = group!.raws[i];
      // Wrapped at a space: the line is padded or short. Split mid-token: it fills the width.
      // An access line's protocol always follows a space, even when the path filled the line.
      const hardBreak = !/\s$/.test(before) && before.length >= width - 1 && !/^HTTP\/\d/.test(part);
      message += (hardBreak ? "" : " ") + part.trimEnd();
    });
    entries[entries.length - 1] = {
      ...head,
      message,
      level: head.level === "error" ? "error" : detectLevel(`${head.level.toUpperCase()} ${message}`),
    };
    group = null;
  };
  while (lineStart < bytes.length) {
    let end = bytes.indexOf(0x0a, lineStart);
    // A final line without a newline may still be being written; keep it anyway.
    if (end < 0) end = bytes.length;
    const clean = decoder.decode(bytes.subarray(lineStart, end)).replace(/\r$/, "");
    const continued = group ? continuationText(clean) : null;
    if (continued !== null && group) {
      group.parts.push(continued);
      group.raws.push(clean);
    } else if (clean.trim()) {
      finish();
      entries.push(parseLogLine(clean, startOffset + lineStart));
      group = { raws: [clean], parts: [] };
    }
    lineStart = end + 1;
  }
  finish();
  return entries.slice(-Math.max(1, Math.min(2000, Math.floor(limit) || 200)));
}

/** Merge a fresh read into what the viewer holds, keyed by offset. */
export function mergeLogEntries(current: LogEntry[], incoming: LogEntry[], max = 1000): LogEntry[] {
  if (incoming.length === 0) return current;
  // A file that shrank was truncated or rotated: start over from the new read.
  const newest = current.at(-1)?.offset ?? -1;
  if (incoming.at(-1)!.offset < newest) return incoming.slice(-max);
  // Same offset means the same record; the newer read wins (a wrapped line may have grown).
  const byOffset = new Map(current.map((entry) => [entry.offset, entry]));
  for (const entry of incoming) byOffset.set(entry.offset, entry);
  return [...byOffset.values()].sort((a, b) => a.offset - b.offset).slice(-max);
}

export function countLevels(entries: LogEntry[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 };
  for (const entry of entries) counts[entry.level]++;
  return counts;
}
