"use client";

import { honcho } from "./client";
import {
  capabilityFromProbe,
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
  };
}
