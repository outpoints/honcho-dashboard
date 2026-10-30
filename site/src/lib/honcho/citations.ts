import type { Honcho } from "@honcho-ai/sdk";
import type { HonchoCapabilityState } from "./capabilities.ts";
import { toApiConclusion } from "./adapters.ts";
import type { ApiConclusion } from "./types.ts";

/**
 * Honcho 3.5 message citations. The deriver records which messages each
 * explicit conclusion came from (`source_message_ids`, citation order).
 * Derived levels and conclusions written before the upgrade carry null: there
 * is no backfill, so a missing citation is not an error.
 */

export const CITATION_PAGE_SIZE = 25;

/** The cited message ids, deduplicated, in citation order. */
export function citedMessageIds(conclusion: Pick<ApiConclusion, "source_message_ids">): string[] {
  const ids = conclusion.source_message_ids;
  return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))] : [];
}

/**
 * Why a conclusion shows no cited messages. Explicit conclusions are the only
 * level the deriver cites for; everything written before the server recorded
 * citations stays null.
 */
export function noCitationReason(conclusion: Pick<ApiConclusion, "level">): string {
  return (conclusion.level ?? "explicit") === "explicit"
    ? "No messages recorded. Honcho records citations for explicit conclusions derived on 3.5 or later; older ones keep none."
    : "Deductive and inductive conclusions build on other conclusions, not messages. See the parent conclusions below.";
}

function requireCitations(state: HonchoCapabilityState) {
  if (state !== "available") throw new Error("Message citations require a Honcho 3.5+ server");
}

/**
 * Conclusions anywhere in the workspace that cite a message. One message can
 * be cited by dozens of conclusions (several observers, scope copies), so the
 * list is paged.
 */
export async function getCitingConclusions(
  sdk: Honcho,
  messageId: string,
  page: number,
  state: HonchoCapabilityState,
): Promise<{ items: ApiConclusion[]; pages: number; total: number }> {
  requireCitations(state);
  const result = await sdk.conclusions.list({
    page,
    size: CITATION_PAGE_SIZE,
    filters: { source_message_ids: { contains: messageId } },
  });
  return { items: result.items.map(toApiConclusion), pages: result.pages, total: result.total };
}
