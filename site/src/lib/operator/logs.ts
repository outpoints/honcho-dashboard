import "server-only";
import { promises as fs } from "fs";
import { resolve } from "path";

export type LogLevel = "debug" | "info" | "warn" | "error" | "unknown";

export interface LogEntry {
  id: string;
  timestamp?: string;
  level: LogLevel;
  source?: string;
  message: string;
}

const LEVEL_PATTERNS: Array<[RegExp, LogLevel]> = [
  [/\b(error|exception|fatal)\b/i, "error"],
  [/\b(warn|warning)\b/i, "warn"],
  [/\b(debug|trace)\b/i, "debug"],
  [/\b(info|notice)\b/i, "info"],
];

function detectLevel(line: string): LogLevel {
  for (const [re, lvl] of LEVEL_PATTERNS) if (re.test(line)) return lvl;
  return "unknown";
}

export interface LogsResult {
  available: boolean;
  reason?: string;
  source?: string;
  entries?: LogEntry[];
}

export async function tailLogs(limit = 200): Promise<LogsResult> {
  const path = process.env.HONCHO_LOG_FILE;
  if (!path) return { available: false, reason: "HONCHO_LOG_FILE not set" };
  const abs = resolve(path);
  try {
    const buf = await fs.readFile(abs, "utf8");
    const lines = buf.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-Math.max(1, Math.min(2000, limit)));
    const entries: LogEntry[] = tail.map((line, idx) => {
      const tsMatch = line.match(
        /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
      );
      let level: LogLevel = detectLevel(line);
      let source: string | undefined;
      try {
        const j = JSON.parse(line);
        if (typeof j === "object" && j) {
          if (typeof j.level === "string") level = j.level.toLowerCase() as LogLevel;
          if (typeof j.message === "string") {
            return {
              id: String(idx),
              timestamp: typeof j.time === "string" ? j.time : tsMatch?.[1],
              level,
              source: typeof j.logger === "string" ? j.logger : undefined,
              message: j.message,
            };
          }
        }
      } catch {
        // not JSON
      }
      const sourceMatch = line.match(/\[([\w.-]+)\]/);
      if (sourceMatch) source = sourceMatch[1];
      return {
        id: String(idx),
        timestamp: tsMatch?.[1],
        level,
        source,
        message: line,
      };
    });
    return { available: true, source: abs, entries };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
