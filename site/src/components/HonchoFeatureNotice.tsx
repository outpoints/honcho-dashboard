import type { HonchoCapabilityState } from "@/lib/honcho/capabilities";

export function HonchoFeatureNotice({ state, minimum, feature }: {
  state: HonchoCapabilityState; minimum: string; feature: string;
}) {
  if (state === "available") return null;
  const message = state === "checking" ? "Checking server capabilities…"
    : state === "unsupported" ? `${feature} requires Honcho ${minimum}+. Existing workflows remain available.`
    : state === "restricted" ? `${feature} requires a workspace or admin key. Check CONFIG.`
    : `Server version is unverified. ${feature} is disabled until Honcho ${minimum}+ can be confirmed.`;
  return <p className="text-[11px] text-text-primary leading-relaxed border border-border bg-void/30 px-3 py-2" role="status">{message}</p>;
}
