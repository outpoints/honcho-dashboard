"use client";

import { honcho } from "./client";
import {
  capabilityFromProbe,
  capabilityAtVersion,
  honcho35Capability,
  type Honcho35Feature,
  honcho36Capability,
  type Honcho36Feature,
  honcho31FromVersion,
  normalizeHonchoVersion,
  shouldProbeHoncho31,
  type HonchoCapabilityState,
} from "./capabilities";
import { HonchoApiError, type ApiScope, type Page } from "./types";
import { useActiveWorkspace } from "./config";
import { useHonchoQuery } from "./useQuery";

function errorStatus(error: Error | undefined): number | undefined {
  if (error instanceof HonchoApiError) return error.status;
  const status = (error as Error & { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

export function isHonchoPermissionError(error: Error | undefined): boolean {
  const status = errorStatus(error);
  return status === 401 || status === 403;
}

export function useHonchoVersion() {
  const query = useHonchoQuery("openapi-version", (options) => honcho.openapi(options), {
    refreshInterval: 0,
  });
  const rawVersion = query.data?.info?.version;
  return {
    ...query,
    rawVersion,
    version: normalizeHonchoVersion(rawVersion),
  };
}

export interface HonchoCapabilities {
  version: string | null;
  honcho31: HonchoCapabilityState;
  scopes: HonchoCapabilityState;
  workspaceChat: HonchoCapabilityState;
  evidence: HonchoCapabilityState;
  provenance: HonchoCapabilityState;
  deriverMetrics: HonchoCapabilityState;
  /** Shared and per-agent `custom_instructions` in workspace configuration (3.3.0+). */
  customInstructions: HonchoCapabilityState;
  /** Session clone resolves its source inside the workspace (fixed in 3.3.0). */
  scopedSessionClone: HonchoCapabilityState;
  /** `POST /v3/keys?scope_id=` mints named-scope keys (3.4.0+). */
  scopeKeys: HonchoCapabilityState;
  /** 3.5.0 features, each detected from `/openapi.json` first (see HONCHO_35_FEATURES). */
  messageCitations: HonchoCapabilityState;
  sessionScopes: HonchoCapabilityState;
  scopeSessionCounts: HonchoCapabilityState;
  scopeBulkRemove: HonchoCapabilityState;
  workspaceConfigReplace: HonchoCapabilityState;
  /** 3.6.0 features, each detected from `/openapi.json` first (see HONCHO_36_FEATURES). */
  dreamHistory: HonchoCapabilityState;
  cappedListTotals: HonchoCapabilityState;
}

export function useHonchoCapabilities(): HonchoCapabilities {
  const { workspaceId } = useActiveWorkspace();
  const version = useHonchoVersion();
  const knownState = honcho31FromVersion(version.rawVersion);
  const probeEnabled = shouldProbeHoncho31({
    rawVersion: version.rawVersion,
    openApiResolved: version.data !== undefined,
    openApiErrorStatus: errorStatus(version.error),
    hasWorkspace: !!workspaceId,
  });
  const probe = useHonchoQuery<Page<ApiScope>>(
    probeEnabled && workspaceId ? `capabilities/honcho31/${workspaceId}` : null,
    (options) => honcho.compatibility.probeScopes(options, workspaceId!),
  );

  let state: HonchoCapabilityState;
  if (knownState) {
    state = knownState;
  } else if (version.isLoading) {
    state = "checking";
  } else if (probeEnabled) {
    state = capabilityFromProbe({
      loading: probe.isLoading,
      succeeded: probe.data !== undefined,
      errorStatus: errorStatus(probe.error),
    });
  } else {
    state = "unknown";
  }

  return {
    version: version.version,
    honcho31: state === "restricted" ? "available" : state,
    scopes: state,
    workspaceChat: state === "restricted" ? "available" : state,
    evidence: version.isLoading ? "checking" : capabilityAtVersion(version.rawVersion, [3, 2, 0]),
    provenance: version.isLoading ? "checking" : capabilityAtVersion(version.rawVersion, [3, 2, 0]),
    deriverMetrics: version.isLoading ? "checking" : capabilityAtVersion(version.rawVersion, [3, 1, 2]),
    customInstructions: version.isLoading ? "checking" : capabilityAtVersion(version.rawVersion, [3, 3, 0]),
    scopedSessionClone: version.isLoading ? "checking" : capabilityAtVersion(version.rawVersion, [3, 3, 0]),
    scopeKeys: version.isLoading ? "checking" : capabilityAtVersion(version.rawVersion, [3, 4, 0]),
    messageCitations: at35("messageCitations"),
    sessionScopes: at35("sessionScopes"),
    scopeSessionCounts: at35("scopeSessionCounts"),
    scopeBulkRemove: at35("scopeBulkRemove"),
    workspaceConfigReplace: at35("workspaceConfigReplace"),
    dreamHistory: at36("dreamHistory"),
    cappedListTotals: at36("cappedListTotals"),
  };

  function at35(feature: Honcho35Feature): HonchoCapabilityState {
    return version.isLoading ? "checking" : honcho35Capability(version.data, version.rawVersion, feature);
  }

  function at36(feature: Honcho36Feature): HonchoCapabilityState {
    return version.isLoading ? "checking" : honcho36Capability(version.data, version.rawVersion, feature);
  }
}
