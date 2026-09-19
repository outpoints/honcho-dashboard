import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parseTraceLines, type TraceResult } from "./traceRecords.ts";

export const TRACE_TAIL_BYTES = 2 * 1024 * 1024;

/** The path is administrator configuration only; never accept a request path. */
export async function readTraceFile(path: string | undefined, limit = 200): Promise<TraceResult> {
  const base = { entries: [], bytes_read: 0, truncated: false, skipped: 0, malformed: 0, generated_at: new Date().toISOString() };
  if (!path) return { ...base, available: false, reason: "Set HONCHO_TRACE_FILE on the dashboard host to a collector's CloudEvents JSONL export." };
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // O_NONBLOCK prevents a configured FIFO from hanging a dashboard request.
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) return { ...base, available: false, reason: "HONCHO_TRACE_FILE must point to a regular file." };
    const start = Math.max(0, stat.size - TRACE_TAIL_BYTES);
    const buffer = Buffer.alloc(Math.min(stat.size, TRACE_TAIL_BYTES));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    // The first record may have been cut mid-byte or mid-JSON; discard it.
    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline >= 0 ? text.slice(newline + 1) : "";
    }
    return { ...base, ...parseTraceLines(text, limit), available: true, bytes_read: bytesRead, truncated: start > 0 };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason = code === "ENOENT" ? "Configured trace file was not found. Check the dashboard host mount."
      : code === "EACCES" || code === "EPERM" ? "Dashboard cannot read the configured trace file. Check file permissions."
      : "Unable to read the configured trace file. Check the dashboard host configuration.";
    return { ...base, available: false, reason };
  } finally {
    await file?.close();
  }
}
