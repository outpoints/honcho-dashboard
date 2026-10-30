import type { ChatResponse, Evidence, EvidenceObservation, Honcho } from "@honcho-ai/sdk";
import type { HonchoCapabilityState } from "./capabilities.ts";

// SDK 2.5.1–2.6.0 types these IDs as required, but Honcho 3.2.0 omits them.
type DashboardEvidenceObservation = Omit<EvidenceObservation, "observer_id" | "observed_id"> & {
  observer_id?: string | null;
  observed_id?: string | null;
};
export type DashboardEvidence = Omit<Evidence, "conclusions"> & {
  conclusions: DashboardEvidenceObservation[];
};
type DashboardChatResponse = Omit<ChatResponse, "evidence"> & { evidence: DashboardEvidence | null };

export interface DashboardChatOptions {
  peerId?: string;
  session?: string;
  scope?: string;
  reasoningLevel: "minimal" | "low" | "medium" | "high" | "max";
  includeEvidence: boolean;
  evidenceCapability: HonchoCapabilityState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate fields rendered by the UI; tolerate additional server metadata. */
function validateResponse(value: unknown): asserts value is DashboardChatResponse {
  const fail = () => { throw new Error("Invalid chat response from Honcho. Please retry."); };
  if (!isRecord(value)) return fail();
  if (value.content !== null && typeof value.content !== "string") return fail();
  const evidence = value.evidence;
  if (evidence === null) return;
  if (!isRecord(evidence)) return fail();
  const strings = (item: unknown, keys: string[]) => isRecord(item) && keys.every((key) => typeof item[key] === "string");
  if (!Array.isArray(evidence.conclusions) || !evidence.conclusions.every((item) => strings(item, ["id", "content", "level"]))) return fail();
  // Attribution is additive: accept older records, but never render malformed IDs.
  if (!evidence.conclusions.every((item) => ["observer_id", "observed_id"].every((key) =>
    item[key] == null || typeof item[key] === "string"))) return fail();
  if (!Array.isArray(evidence.messages) || !evidence.messages.every((item) => strings(item, ["id", "session_id", "peer_id", "created_at"]))) return fail();
  if (!Array.isArray(evidence.tool_calls) || !evidence.tool_calls.every((item) => strings(item, ["tool_name"]) && isRecord(item.tool_input))) return fail();
  if (evidence.reasoning_trace_id !== null && typeof evidence.reasoning_trace_id !== "string") return fail();
}

/** Keep the SDK's two chat contracts out of the transcript UI. */
export async function chatWithEvidence(sdk: Honcho, query: string, options: DashboardChatOptions): Promise<DashboardChatResponse & { evidenceRequested: boolean }> {
  const { peerId, includeEvidence, evidenceCapability, ...recall } = options;
  if (includeEvidence && evidenceCapability !== "available") {
    throw new Error("Chat evidence requires a verified Honcho 3.2+ server");
  }
  const peer = peerId ? await sdk.peer(peerId) : null;
  if (includeEvidence) {
    const result = peer
      ? await peer.chat(query, { ...recall, includeEvidence: true })
      : await sdk.chat(query, { ...recall, includeEvidence: true });
    validateResponse(result);
    return { ...result, evidenceRequested: true };
  }
  const content = peer ? await peer.chat(query, recall) : await sdk.chat(query, recall);
  validateResponse({ content, evidence: null });
  return { content, evidence: null, evidenceRequested: false };
}

/**
 * Streamed variant: `onText` receives the answer so far after each chunk.
 * Evidence arrives only on the terminal SSE event, so it is read after the
 * stream is consumed. Same validation as the buffered path.
 */
export async function streamChatWithEvidence(
  sdk: Honcho,
  query: string,
  options: DashboardChatOptions,
  onText: (text: string) => void,
): Promise<DashboardChatResponse & { evidenceRequested: boolean }> {
  const { peerId, includeEvidence, evidenceCapability, ...recall } = options;
  if (includeEvidence && evidenceCapability !== "available") {
    throw new Error("Chat evidence requires a verified Honcho 3.2+ server");
  }
  const peer = peerId ? await sdk.peer(peerId) : null;
  // Leave the flag out entirely unless requested, like the buffered path.
  const params = includeEvidence ? { ...recall, includeEvidence: true } : recall;
  const stream = peer ? await peer.chatStream(query, params) : await sdk.chatStream(query, params);
  let content = "";
  for await (const chunk of stream) {
    if (typeof chunk !== "string" || !chunk) continue;
    content += chunk;
    onText(content);
  }
  const evidence = includeEvidence ? stream.evidence : null;
  validateResponse({ content, evidence });
  return { content, evidence: evidence as DashboardEvidence | null, evidenceRequested: includeEvidence };
}
