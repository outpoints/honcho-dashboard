"use client";

import { Icon } from "@/components/icons";
import { Panel } from "@/components/Panel";
import type { HonchoCapabilityState } from "@/lib/honcho/capabilities";

function noticeCopy({
  state,
  version,
  feature,
  fallback,
}: {
  state: HonchoCapabilityState;
  version: string | null;
  feature: string;
  fallback: string;
}) {
  if (state === "checking") {
    return {
      title: "CHECKING_HONCHO_CAPABILITIES",
      text: `Checking whether this server supports ${feature}. ${fallback}`,
    };
  }
  if (state === "unsupported") {
    return {
      title: "HONCHO_3_1_REQUIRED",
      text: `${version ? `Honcho v${version}` : "This Honcho server"} does not include ${feature}. Upgrade to Honcho 3.1.0 or newer. ${fallback}`,
    };
  }
  if (state === "restricted") {
    return {
      title: "WORKSPACE_KEY_REQUIRED",
      text: `This server supports ${feature}, but the active key cannot access it. Use a workspace- or admin-level key. ${fallback}`,
    };
  }
  return {
    title: "CAPABILITY_UNVERIFIED",
    text: `The dashboard could not verify support for ${feature}, so it remains disabled to protect older servers. ${fallback}`,
  };
}

export function Honcho31Notice({
  state,
  version,
  feature,
  fallback,
  panel = false,
}: {
  state: HonchoCapabilityState;
  version: string | null;
  feature: string;
  fallback: string;
  panel?: boolean;
}) {
  if (state === "available") return null;
  const copy = noticeCopy({ state, version, feature, fallback });
  const content = (
    <div className="flex items-start gap-2 text-[10px] leading-relaxed text-text-muted">
      <Icon
        name={state === "checking" ? "loader" : "warning"}
        size={12}
        className={state === "checking" ? "mt-px animate-spin" : "mt-px text-yellow-400"}
      />
      <span>{copy.text}</span>
    </div>
  );

  return panel ? (
    <Panel title={copy.title} status={state === "checking" ? "processing" : "idle"}>
      <div className="border-l-2 border-yellow-500/40 bg-yellow-500/5 px-3 py-2">
        {content}
      </div>
    </Panel>
  ) : (
    <div className="border-l-2 border-yellow-500/40 bg-yellow-500/5 px-3 py-2">
      {content}
    </div>
  );
}
