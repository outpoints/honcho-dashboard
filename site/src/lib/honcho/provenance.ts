import type { Honcho } from "@honcho-ai/sdk";
import type { HonchoCapabilityState } from "./capabilities.ts";
import { toApiConclusion } from "./adapters.ts";

export const PROVENANCE_PAGE_SIZE = 25;

function requireProvenance(state: HonchoCapabilityState) {
  if (state !== "available") throw new Error("Conclusion provenance requires a verified Honcho 3.2+ server");
}

export async function getConclusion(sdk: Honcho, id: string, state: HonchoCapabilityState) {
  requireProvenance(state);
  return toApiConclusion(await sdk.conclusions.get(id));
}

export async function getPremises(sdk: Honcho, ids: string[], page: number, state: HonchoCapabilityState) {
  requireProvenance(state);
  const unique = [...new Set(ids)];
  const selected = unique.slice((page - 1) * PROVENANCE_PAGE_SIZE, page * PROVENANCE_PAGE_SIZE);
  const found = (await sdk.conclusions.getMany(selected)).map(toApiConclusion);
  const byId = new Map(found.map((item) => [item.id, item]));
  return {
    items: selected.map((id) => ({ id, conclusion: byId.get(id) ?? null })),
    pages: Math.max(1, Math.ceil(unique.length / PROVENANCE_PAGE_SIZE)),
  };
}

export async function getDerived(sdk: Honcho, id: string, page: number, state: HonchoCapabilityState) {
  requireProvenance(state);
  // Workspace-wide: conclusions in other observer pairs may also cite this ID.
  const result = await sdk.conclusions.list({
    page, size: PROVENANCE_PAGE_SIZE, filters: { source_ids: { contains: id } },
  });
  return { items: result.items.map(toApiConclusion), pages: result.pages, total: result.total };
}
