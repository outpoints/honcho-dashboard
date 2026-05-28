"use client";

import { useEffect, useMemo } from "react";
import { honcho } from "@/lib/honcho/client";
import { useActiveWorkspace } from "@/lib/honcho/config";
import { useHonchoQuery } from "@/lib/honcho/useQuery";
import { Select } from "@/components/Select";

export function WorkspaceSelector({ className }: { className?: string }) {
  const { workspaceId, setWorkspaceId } = useActiveWorkspace();
  const { data, isLoading, error } = useHonchoQuery("workspaces/list?size=100", (o) =>
    honcho.workspaces.list(o, { size: 100 }),
  );

  const items = useMemo(() => data?.items ?? [], [data]);
  const options = useMemo(
    () => items.map((w) => ({ value: w.id, label: w.id })),
    [items],
  );

  useEffect(() => {
    if (!workspaceId && items.length > 0) {
      setWorkspaceId(items[0].id);
    } else if (workspaceId && items.length > 0 && !items.find((i) => i.id === workspaceId)) {
      setWorkspaceId(items[0].id);
    }
  }, [items, workspaceId, setWorkspaceId]);

  return (
    <Select
      className={className}
      value={workspaceId ?? ""}
      onChange={(v) => setWorkspaceId(v || null)}
      options={options}
      disabled={isLoading || !!error || options.length === 0}
      placeholder={
        isLoading ? "loading…" : error ? "(error)" : options.length === 0 ? "(none)" : "select…"
      }
      triggerClassName="px-2 py-1.5"
    />
  );
}
