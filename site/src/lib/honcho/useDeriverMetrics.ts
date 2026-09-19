"use client";

import { honcho } from "./client";
import { useHonchoCapabilities } from "./useCapabilities";
import { useHonchoQuery } from "./useQuery";

export function useDeriverMetrics() {
  const { deriverMetrics: capability } = useHonchoCapabilities();
  const query = useHonchoQuery(capability === "available" ? "instance/deriver-metrics" : null,
    honcho.deriverMetrics, { refreshInterval: 10000 });
  return {
    ...query,
    capability,
    refetch: () => {
      if (capability === "available") query.refetch();
    },
  };
}
