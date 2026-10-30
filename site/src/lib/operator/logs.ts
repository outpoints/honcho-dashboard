import "server-only";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { parseLogChunk, type LogEntry } from "./logLines";

export type { LogEntry, LogLevel } from "./logLines";

/** Read at most this much from the end of the file per request. */
export const LOG_TAIL_BYTES = 512 * 1024;

export interface LogsResult {
  available: boolean;
  reason?: string;
  source?: string;
  entries?: LogEntry[];
  /** File size when read; a smaller size later means rotation or truncation. */
  size?: number;
  truncated?: boolean;
  read_at?: string;
}

/** The path is administrator configuration only; never accept it from a request. */
export async function tailLogs(limit = 200): Promise<LogsResult> {
  const path = process.env.HONCHO_LOG_FILE;
  if (!path) return { available: false, reason: "HONCHO_LOG_FILE not set" };
  const abs = resolve(path);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // O_NONBLOCK keeps a configured FIFO from hanging the request.
    file = await open(abs, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) return { available: false, reason: "HONCHO_LOG_FILE must point to a regular file." };
    // Bounded read: never load a large log into memory.
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(stat.size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const entries = parseLogChunk(buffer.subarray(0, bytesRead), start, limit);
    return { available: true, source: abs, entries, size: stat.size, truncated: start > 0, read_at: new Date().toISOString() };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason = code === "ENOENT" ? "Configured log file was not found. Check the dashboard host mount."
      : code === "EACCES" || code === "EPERM" ? "Dashboard cannot read the configured log file. Check file permissions."
      : err instanceof Error ? err.message : String(err);
    return { available: false, reason };
  } finally {
    await file?.close();
  }
}
